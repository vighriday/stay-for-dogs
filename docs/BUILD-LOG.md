# Build log

Everything in this repository was written inside the DEV Weekend Challenge window:
**14 August 2026, 02:00 UTC → 17 August 2026, 06:59 UTC**.

Times below are IST (UTC+5:30), which is where this was built. `git log` is the
authoritative record; this file is the narrative version.

---

## Saturday 15 August

**13:00** — Repo initialised. Next.js 16, TypeScript, Tailwind v4. Verified both APIs
with real calls before writing anything on top of them.

That verification immediately changed the plan. A free ElevenLabs account returns
`can_use_instant_voice_cloning: false`, and two further endpoints refuse outright:

```
TTS with a library voice  → 402  "Free users cannot use library voices via the API"
Voice Design via the API  → 403  "Creating a voice through the API is only available
                                  on a paid plan"
```

So the free path can't create a voice programmatically at all. What *does* work is a
voice the user creates in ElevenLabs' own dashboard — a personal voice, not a library
one — driven through the API afterwards. Confirmed with a real synthesis returning
54 KB of MP3. That single test decided the whole setup flow: detect what the key can do,
then offer the path that matches it.

**14:00–17:00** — Server clients with typed errors, all seven API routes, the
Gemini prompt with server-side validation that rejects banned words, questions and
repeats rather than trusting the model.

**17:00–19:00** — AudioWorklet detector, voice engine that pre-renders lines to audio
before they're needed, offline line bank so a failed request never leaves the app
silent. Setup flow, session screen, the ethogram strip, landing page.

**19:00** — First end-to-end browser test. **The detector never fired.** Forty seconds
of a barking dog produced two log entries: started, ended.

Instrumented it rather than guessing:

```
frames 497 · loud 37 · in-band 174 · both 37
longest unbroken noisy run: 6 frames    rule required: 10
```

The rule wanted 400 ms of continuous in-band noise. Barking is bursts of 150–250 ms with
gaps — it never produces that, so the detector was never going to fire on a real dog.
Replaced with two routes in: three separate onsets inside 1.5 s for barking, or 1.2 s
unbroken for whining and howling.

Dogs went to 5/5. **False positives went to 4/7** — every substantial door slam.

**19:00–19:30** — A slam is loud, sits in the same 300–2500 Hz band as a bark, and is
made of several separated transients. A refractory gap between onsets didn't help. No
threshold rule separates them.

What does: a bark is *voiced*. It has a pitch, so the waveform repeats. A slam is a
broadband transient with no periodicity. Added an autocorrelation test over the lags a
dog's fundamental occupies, swept the threshold across the clip set, and took 0.75 from
the middle of the plateau where it holds.

```
dogs detected            5/5
dogs given a response    5/5
false positives          0/7   (was 4/7)
```

No model, no download, nothing leaves the device.

**19:30** — Public repo, README, published test results.

---

## Notes on what this log is for

The challenge reviews commit history, and a weekend project that appears fully formed in
two commits is a fair thing to be suspicious of. The commits here are incremental and the
messages say what changed and why — including the two occasions where a measurement
proved the design wrong and the design had to move.
