# Architecture

How Stay is put together, and why each piece is where it is. The README has the
diagrams; this is the reasoning and the exact numbers.

---

## The shape of it

Three processes matter, and they run in three different places:

| Where | What runs there | Why there |
|---|---|---|
| **Audio thread** (AudioWorklet) | Detection, timing, the state machine | Browsers throttle timers and `requestAnimationFrame` in background tabs. Away Mode *is* a background tab, for hours. |
| **Main thread** | Rendering the strip, the timeline, playback | Nothing time-critical. If it stutters, a pixel is late; no decision is affected. |
| **Server** (route handlers) | Every third-party API call | Keys must never reach the client. |

There is no database, no session store and no account system. A session lives in the
page. Close the tab and it's gone. That's a deliberate feature, not a shortcut — an
always-on microphone in someone's living room should leave as little behind as possible.

---

## The detector

`public/stay-detector.worklet.js`. Plain JavaScript, because worklets are loaded by URL
rather than bundled.

### Input

Two inputs, not one:

```
microphone ─┬──────────────────────────────────► input 0   (raw)
            └─ highpass 300 ─ lowpass 2500 ────► input 1   (dog band)
```

Four biquads — two poles each side — give a steep enough skirt to drop traffic rumble
and most of a fridge. Comparing `rms(input1) / rms(input0)` gives the band ratio without
a hand-rolled FFT. Native filters, and the browser's DSP is better than mine.

### Frame

2048 samples, about 43 ms at 48 kHz. Per frame:

```
rmsFull   = sqrt(mean(input0²))
rmsBand   = sqrt(mean(input1²))
db        = 20 · log10(rmsFull + 1e-9)
bandRatio = min(1, rmsBand / rmsFull)
```

### The four tests

```
1. not deaf      Stay isn't speaking, and 3s have passed since it stopped
2. loud          db > threshold        threshold = -25 + (1 - sensitivity) · -25
3. in band       bandRatio > 0.55
4. voiced        periodicity() > 0.75
```

Ordered by cost. Test 4 is the expensive one and only runs on frames that already passed
1–3, which in a quiet house is almost none of them.

### Voicing

The one that makes it work indoors.

```js
periodicity() {
  // Normalised autocorrelation peak across the lags a dog's fundamental occupies.
  // lagMin = sampleRate / 1200 Hz     lagMax = sampleRate / 140 Hz
  // Prefix sums of squares make each lag's normalisation O(1).
}
```

A bark or a whine is **voiced**: it has a pitch, so the waveform repeats and
autocorrelation finds a strong peak. A door slam, a footstep, a dropped pan are
broadband transients with no periodicity at all.

Measured across the test clips, this took false positives from **4/7 to 0/7** without
losing a dog. It runs on the band-passed signal rather than the raw one, because the
fundamental is easier to find once the room rumble is gone.

Cost: roughly 300k multiply-adds per qualifying frame, inside a 2.7 ms budget. The prefix
sums matter — computing the normalisation inline doubled the work for no benefit.

### Onset, not duration

The mistake worth documenting. The first version required 400 ms of unbroken in-band
noise. Barking never produces that:

```
40s recording of a barking dog:
  frames 497 · loud 37 · in-band 174 · both 37
  longest unbroken noisy run: 6 frames   (rule wanted 10)
```

So an episode now starts on either of two conditions:

- **3 separate onsets within 1.5 s** — catches barking, which is repetitive
- **1.2 s unbroken** — catches whining and howling, which are continuous

An "onset" is a rising edge (quiet → noisy), with a **200 ms refractory gap** so a
decaying tail isn't counted several times over.

### The state machine

All counters are in samples, never milliseconds read off a clock — that's what makes it
immune to tab throttling.

```
IDLE
  └─ episode starts ─────────────────► UPSET   (emit "upset")

UPSET
  ├─ 2500 ms unbroken quiet ─────────► SPEAK   trigger "settled"
  ├─ 20 s unbroken noise ────────────► SPEAK   trigger "ceiling"
  ├─ 1250 ms quiet ──────────────────► emit "settling" (UI only)
  └─ 10 s quiet, no response ────────► IDLE    (emit "episode-end")

SPEAK  → main thread plays a line → COOLDOWN 90 s
COOLDOWN
  detection still runs and still logs; it just cannot release a response
  └─ 90 s ───────────────────────────► IDLE
```

**Why `settled` and `ceiling` are separate:** answering the bark rewards barking.
Answering the quiet rewards settling. But a dog that never settles must not be ignored
either, so there's a ceiling — and the timeline records which rule fired, because
those two events mean genuinely different things to an owner reading the log.

### The interlock

```js
port.onmessage = ({ data }) => {
  if (data.type === "speaking") {
    this.speaking = !!data.value;
    if (!data.value) this.tailLeft = this.playbackTail;   // 3s
    this.noiseRun = 0;                                     // whatever we heard was us
    this.quietRun = 0;
  }
}
```

Stay plays audio out of the same speaker its microphone is listening to. Without this,
the app hears itself, decides the dog is upset, and answers itself — forever, about five
seconds into the first demo.

Three defences, all needed: this flag, `echoCancellation: true`, and — the non-obvious
one — **`autoGainControl: false`**. AGC normalises loudness, so a quiet whine reads as
loud and a bark reads as normal. It silently destroys any fixed threshold.

---

## Constants, and where they came from

All in `lib/types.ts`, with the reasoning in comments.

| Constant | Value | Why |
|---|---|---|
| `frameSize` | 2048 | ~43 ms at 48 kHz. Fine enough for onsets, long enough for pitch. |
| `bandLowHz` / `bandHighHz` | 300 / 2500 | Where barks and whines put their energy |
| `minBandRatio` | 0.55 | Empirical; rejects rumble without losing quiet whines |
| `minPeriodicity` | 0.75 | Middle of the 0.75–0.80 plateau where the sweep is clean |
| `pitchMinHz` / `pitchMaxHz` | 140 / 1200 | Autocorrelation lag range for a dog's fundamental |
| `onsetWindowMs` / `onsetCount` | 1500 / 3 | Barking is repetitive |
| `continuousMs` | 1200 | Whining and howling are not |
| `refractoryMs` | 200 | Barks are 200–500 ms apart; a slam's ringing is much closer |
| `quietMs` | 2500 | Long enough to be real settling, short enough to still feel responsive |
| `ceilingMs` | 20000 | Never ignore an inconsolable dog |
| `cooldownMs` | 90000 | A voice every 90 s is presence; more often is nagging |
| `playbackTailMs` | 3000 | Room reverb after Stay stops speaking |

---

## The voice engine

`lib/audio/voice.ts`. Its whole job is removing latency from the moment that matters.

Generating a line and synthesising it *after* the dog settles costs 2–6 seconds. The
moment is gone. So:

**At session start**, in this order:

1. Render the **20-line offline bank** to audio. Bank first, deliberately — the instant
   this resolves, Stay can speak even if Gemini never answers at all.
2. Ask Gemini for 10 fresh lines.
3. Synthesise those.

**At playback**, take from `fresh` if there is one, otherwise walk the bank in order —
in order rather than at random, so a full-fallback session still doesn't repeat until
all twenty have been heard.

**Refill** in the background when `fresh` drops below 4. If the refill fails, it fails
silently: the bank covers it, the session continues, and nobody is interrupted over a
background request.

Synthesis is **sequential, not parallel**. A burst of concurrent calls is the fastest way
to get rate-limited on a free ElevenLabs plan, during the one part of setup the user is
actually watching.

---

## Server routes

Every route returns `{ error: { code, message, hint? } }` with a real status. No bare
500s, and the UI renders `message` and `hint` directly.

| Route | Does |
|---|---|
| `GET /api/el/capabilities` | Tier introspection. Decides which voice path the user gets. |
| `POST /api/el/voice` | Verifies a voice ID **by synthesising two real words** — a free plan can list a voice it isn't allowed to speak with, so a lookup alone proves nothing |
| `POST /api/el/tts` | One line → mp3 |
| `POST /api/el/clone` | Instant Voice Cloning. Re-checks capability server-side before accepting the upload. |
| `POST /api/gemini/lines` | Writes lines, then **validates them server-side** |
| `POST /api/gemini/score` | Video → behaviour scores |
| `POST /api/gemini/vocal` | Audio → vocalisation type |

### Line validation

The model is instructed, and then not trusted. Every returned line is rejected and
regenerated if it:

- is under 3 or over 14 words
- contains a banned word (word-boundary match, case-insensitive) — the user's list plus
  a built-in one: walk, leash, bye, outside, door, car, vet, treat, dinner, food, park, ball
- contains `?`, `!`, quotation marks, or an emoji
- repeats anything already spoken this session

The rejection count is returned to the client, because it's a useful signal about whether
the constraints are actually holding.

### Upload limits

Vercel caps a serverless request body at **4.5 MB**. Anything above that works perfectly
on localhost and fails in production, which is the worst possible way to find out. So:
video 4 MB, audio 3 MB, clone samples 4 MB, and the recorder drops to 64 kbps opus —
still over ten minutes of speech inside the cap.

### Rate limiting

The shared Gemini key is limited to 10 requests per IP per 10 minutes, in memory, per
instance. Deliberately crude: a visitor using their own key skips it entirely, and the
client treats 429 as non-fatal and falls back to the bank without interrupting anything.

---

## What crosses the boundary

| Data | Leaves the browser? |
|---|---|
| Microphone audio | **Never.** Only loudness and a band ratio are computed, on-device. |
| Dog profile | Yes — to Gemini, because it's what makes the lines specific to your dog |
| Generated lines | Yes — to ElevenLabs, to be spoken |
| The ElevenLabs key | To Stay's server per request, used once, never stored |
| Session timeline | Never. Lives in the page. |
| Review clips | Yes — to Gemini, only when the user uploads one |

Demo mode makes **no outbound requests at all**.

---

## Testing

`lib/audio/offline.ts` runs the same worklet over recorded audio two ways:

- `runOffline()` — `OfflineAudioContext`, faster than real time, for sweeping clips
- `playThrough()` — real time through the speakers, for demo mode

Both build an identical graph to the live one. That's the point: the numbers on `/test`
describe the code that ships, not a model of it. Demo mode isn't a simulation either —
it's a real recording driven through the real detector, with the response released by
the same state machine a live microphone would drive.

The cooldown is stretched past the clip length during a sweep, so one clip can only
count once — otherwise a long recording of continuous barking would inflate the
detection rate by firing repeatedly.
