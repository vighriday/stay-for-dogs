# Detector test results

I don't own a dog. Rather than film one dog once and call it proof, Stay's detector is
run against recorded clips — dogs that should trigger it, household noise that
shouldn't — and the numbers are published.

**You can re-run all of this yourself.** Open `/test` in the app and press *Run the
sweep*. The clips ship with the repository, and the page drives the same AudioWorklet a
live session uses. Nothing here is a model of the detector; it *is* the detector.

---

## Headline

Shipped defaults, sensitivity 0.5:

| | |
|---|---|
| Dog clips detected | **5 / 5** |
| Dog clips that produced a spoken response | **5 / 5** |
| Household-noise clips that triggered it | **0 / 7** |

---

## Per-clip

### Should trigger — dog vocalisation

| Clip | Length | Detected | First detection |
|---|---|---|---|
| `dog-barking.webm` | 41.4 s | yes | 0.7 s |
| `paisaje-sonoro-perros-voces-autos-en-la-noche-01.mp3` | 68.0 s | yes | 23.6 s |
| `perro-hembra-ladrando.mp3` | 39.8 s | yes | 4.9 s |
| `perros-ligeti-y-malena-ladrando.wav` | 14.4 s | yes | 0.9 s |
| `soundscape-cricket-and-dogs.mp3` | 58.7 s | yes | 23.0 s |

All five went on to release a spoken response, meaning the full loop ran: detect the
dog, wait for it to go quiet, then speak.

### Should stay quiet — household noise

| Clip | Length | Detected |
|---|---|---|
| `close-bathroom-door-gravity-sound.wav` | 2.1 s | no |
| `close-closet-door-gravity-sound.wav` | 5.0 s | no |
| `close-door-gravity-sound.wav` | 1.5 s | no |
| `close-door-2-gravity-sound.wav` | 1.0 s | no |
| `close-door-3-gravity-sound.wav` | 1.5 s | no |
| `close-squeaky-door-gravity-sound.wav` | 1.5 s | no |
| `footstep-on-gravel-gravity-sound.mp3` | 0.6 s | no |

---

## How the voicing threshold was chosen

Before the voicing test existed, the same sweep gave **5/5 dogs and 4/7 false
positives** — every substantial door slam triggered it.

Sweeping the autocorrelation threshold:

| Threshold | Dogs | False positives |
|---|---|---|
| 0.30 | 5/5 | 5/7 |
| 0.40 | 4/5 | 3/7 |
| 0.45 | 4/5 | 2/7 |
| 0.50 | 4/5 | 1/7 |
| 0.58 | 4/5 | 1/7 |
| 0.62 | 4/5 | 1/7 |
| 0.65 | 5/5 | 1/7 |
| 0.70 | 5/5 | 1/7 |
| **0.75** | **5/5** | **0/7** |
| 0.80 | 5/5 | 0/7 |

0.75 and 0.80 both give a clean sweep, so 0.75 was taken as the middle of that plateau
rather than its edge. The last clip to hold out was a *squeaking* door — a hinge squeak
genuinely has a pitch, which is exactly the thing this test looks for.

---

## What these numbers do not show

**The threshold was tuned on these same clips.** That means the results flatter it. The
honest test is a larger set the detector has never seen, which I did not have time to
assemble inside the challenge window. Treat 0/7 as evidence the *idea* works, not as a
measured false-positive rate.

**There is no room in the measurement.** Clips are played straight into the audio graph:
no speaker, no microphone, no distance, no reverb. A real living room is harder, which is
what the sensitivity slider is for.

**The set is small and skewed.** Twelve clips, and six of the seven controls are doors,
because that is what was freely licensed and redistributable. A fair control set would
include television dialogue, traffic, a washing machine, and human speech.

**Loud, genuinely pitched sounds can still get through.** A smoke alarm chirp is a tone
and would probably trigger it. Judging by periodicity rather than by what the sound
actually *is* has a ceiling, and that ceiling is where an audio classifier would start.

---

## Reproducing

```bash
npm install && npm run dev
# open http://localhost:3000/test → "Run the sweep"
```

Move the sensitivity slider and re-run to see the operating point shift. Every clip's
origin and licence is in [`public/test-audio/SOURCES.md`](../public/test-audio/SOURCES.md).
