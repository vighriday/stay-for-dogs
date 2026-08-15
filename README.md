# Stay

**You leave. Your voice doesn't.**

Stay listens for a home-alone dog, waits for it to go quiet, and then speaks to it in
its owner's voice — different words every time, generated fresh, never a loop.

Built for the [DEV Weekend Challenge: Dog Days Edition](https://dev.to/challenges/weekend-2026-08-13),
14–17 August 2026.

---

## Why

A [survey of 3,284 dogs](https://www.sciencedirect.com/science/article/pii/S1558787816300569) put separation anxiety at 17.2% — roughly one dog in six.

In 2021 a Finnish app called Digital Dogsitter was [put through a proper trial](https://www.sciencedirect.com/science/article/pii/S0168159121002471): it
listened for the dog crying and played back a short recording of the owner's voice. Across 40
dogs, total vocalisation dropped by 95.7% after two weeks (P < 0.001). At an eight-month
follow-up, 68.7% of the owners who replied still felt it was helping.
(Tiira, *Applied Animal Behaviour Science* 243:105460.)

But the same literature carries a warning. A single clip, looped identically, can flip
from comfort into a cue — the sound that means you're gone. In 2021 there was no way
around that, because you could only play back what you had already recorded.

Stay is the version where the voice can say things it never said.

---

## What it does

1. **Gets your voice.** On a paid ElevenLabs plan it clones from a recording. On a free
   plan it walks you through building a voice description, you create the voice in
   ElevenLabs' dashboard, and you paste the ID back. Both paths work identically after
   that.
2. **Listens.** The microphone runs in the tab. Nothing is recorded or uploaded.
3. **Waits.** When your dog gets upset, Stay marks it and keeps listening. It speaks
   only after 2.5 seconds of quiet — it answers the calm, not the noise.
4. **Speaks.** Every line is written by Gemini from your dog's profile, spoken by
   ElevenLabs in your voice, and rendered to audio *before* the session starts so the
   answer is instant.
5. **Keeps a record.** Every episode and every response lands on a timeline you could
   hand to a vet — including the times Stay decided to stay quiet.

---

## Why it waits for the quiet

If the voice arrives the instant the dog barks, the dog learns that barking summons its
human. That trains the dog to bark more.

So Stay marks the dog as upset, keeps listening, and releases a response only after 2.5
seconds of quiet. If the dog never settles, it speaks anyway after 20 seconds — an
inconsolable dog shouldn't be ignored. The timeline records which of the two rules fired.

---

## How the detector works

Four things must be true before a sound counts as the dog:

| # | Test | Why |
|---|---|---|
| 1 | Louder than the sensitivity gate | Cheap first filter |
| 2 | Most energy in **300–2500 Hz** | Where barks and whines live; drops traffic rumble and fridge hum |
| 3 | **Voiced** — autocorrelation peak > 0.75 | The one that matters indoors, see below |
| 4 | Three onsets in 1.5 s, *or* 1.2 s unbroken | Barking repeats; whining sustains |

Plus a hard interlock: detection is deaf while Stay is speaking, and for three seconds
after. Without it the speaker feeds the microphone and the app talks to itself forever.

**Two things I got wrong and had to measure my way out of:**

*The first detector never fired at all.* It waited for 400 ms of unbroken in-band noise.
Barking never produces that — it's bursts of 150–250 ms with gaps. On a 40-second
recording of a barking dog, the longest unbroken run was 6 frames where the rule needed
10. Counting separate onsets in a window fixed it.

*Then it fired on everything.* Six door-slam recordings produced four false positives. A
slam is loud, sits in the same frequency band as a bark, and is made of several separated
transients — no threshold tuning separates them.

What does separate them is **voicing**. A bark or a whine has a pitch, so its waveform
repeats. A door slam is a broadband transient with no periodicity at all. Autocorrelating
across the lags a dog's fundamental occupies took false positives from four in seven to
zero, without losing a single dog — and it needs no model, no download, and no audio
leaving the device.

---

## Test results

Rather than film one dog once and call it proof, the detector is run against recorded
clips and the numbers are published. **You can re-run this yourself** at `/test` — the
clips ship with the repo.

With shipped defaults, sensitivity 0.5:

| | |
|---|---|
| Dog clips detected | **5 / 5** |
| Dog clips that produced a spoken response | **5 / 5** |
| Household-noise clips that triggered it | **0 / 7** |

**Read that honestly.** The voicing threshold was tuned on these same clips, so these
numbers flatter it. The real test is a larger set the detector has never seen, which I
didn't have time to assemble. Treat this as "the idea works", not as a measured
false-positive rate. Full detail and per-clip results in [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md).

Every clip's source and licence is listed in
[public/test-audio/SOURCES.md](public/test-audio/SOURCES.md).

---

## Running it

```bash
npm install
cp .env.example .env.local   # add your keys
npm run dev
```

`.env.local`:

```
ELEVENLABS_API_KEY=...   # only needed for the demo-audio build script
GEMINI_API_KEY=...       # server-side, used to write the calming lines
STAY_DEMO_VOICE_ID=...   # only needed to regenerate demo audio
```

Users bring their **own** ElevenLabs key through the UI. It's kept in their browser,
sent per request, and never stored server-side. The `ELEVENLABS_API_KEY` above is only
used by `scripts/build-demo-audio.mjs`, which pre-renders demo mode's audio.

**Demo mode needs no keys at all** — `/demo` plays a real recording of a barking dog
through the real detector, with pre-rendered audio.

---

## Stack

- **Next.js 16** (App Router) on Vercel — route handlers keep every third-party key off
  the client
- **ElevenLabs** — subscription introspection to pick a path, Instant Voice Cloning,
  and streaming TTS pre-rendered into a queue
- **Gemini 2.5 Flash** — writes every calming line under hard constraints, scores video
  behaviour, and classifies vocalisation type from audio
- **Web Audio AudioWorklet** — detection runs on the audio thread, not a render loop,
  because browsers throttle background tabs and Away Mode is an unattended tab for hours
- No component library, no analytics, no cookies, no database

---

## Privacy

The microphone audio never leaves your browser. Stay measures how loud the room is and
how much of that sits in the dog band, on-device. Nothing is recorded, buffered to disk,
or uploaded — that's a property of how it's built, not a promise. Full detail at
[/privacy](https://github.com/vighriday/stay/blob/main/app/privacy/page.tsx).

---

## Honest limitations

- **A prototype, not a treatment.** A badly anxious dog needs a veterinary behaviourist.
- **I don't own a dog.** Everything here is tested against recorded clips, which is why
  the numbers are published rather than asserted.
- **Test clips are played straight into the audio graph** — no room, no microphone, no
  distance. Real rooms are harder. That's what the sensitivity slider is for.
- **Sounds that are loud *and* genuinely pitched can still get through.** A squeaking
  door hinge did, before the threshold moved. A smoke alarm chirp probably would.
- **The behaviour scores come from a general-purpose vision model** watching a short
  clip. A structured second opinion, not a measurement.
- **No before-and-after ships.** A real comparison needs the same dog in two states, and
  pairing two unrelated dogs to imply a result would be dishonest. The compare flow is
  there for you to run on your own dog.

---

## Build window

Everything in this repository was written between **14 August 2026, 02:00 UTC** and the
challenge deadline of **17 August 2026, 06:59 UTC**. The first commit is the Next.js
scaffold; every line of application code came after it. Timestamped notes in
[docs/BUILD-LOG.md](docs/BUILD-LOG.md).

## Licence

Code is MIT. The audio clips under `public/test-audio/` keep their original licences —
see [SOURCES.md](public/test-audio/SOURCES.md).
