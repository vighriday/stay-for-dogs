# Detector test results

I don't own a dog. Rather than film one dog once and call it proof, Stay's detector is
run against recorded clips — dogs that should trigger it, household noise that
shouldn't — and the numbers are published, including the ones that don't flatter it.

**You can re-run all of this yourself.** Open `/test` and press *Run the sweep*. The
clips ship with the repository, and the page drives the same AudioWorklet a live session
uses. Nothing here is a model of the detector; it *is* the detector.

---

## The headline, and the honest version of it

The detector was tuned against an initial set of 12 clips. It scored perfectly on them:

| Tuned-on set (12 clips) | |
|---|---|
| Dogs detected | 5 / 5 |
| False positives | 0 / 7 |

Then I added 22 clips it had never seen, from a different source, including
vocalisation types the first set didn't contain — whimpering, crying, yelping — and
household sounds the first set had none of, like television-style conversation, a
washing machine, and a smoke alarm.

| Held-out set (22 clips) | |
|---|---|
| Dogs detected | **5 / 9** |
| False positives | **4 / 13** |

**The perfect score was overfitting.** The honest figure for a detector meeting new
audio is 56% detection and a 31% false-positive rate.

Across all 34 clips: **10/14 dogs detected, 4/20 false positives.**

I'm reporting the held-out number as the real one, because it's the only one that
describes what happens to somebody who isn't me.

---

## What it misses, and why

| Missed clip | Why, most likely |
|---|---|
| `452202-dog-small-whimper-run` | A small dog's whimper is quiet and brief — it never clears the loudness gate |
| `452180-bark-yelp-dog-small-int` | Single short yelp: one onset, and too short for the continuous route |
| `749351-barking-inez-2` | Sparse barking with long gaps — never three onsets inside 1.5 s |
| `438484-g31-46-dog-bark-and-door` | Bark mixed with door noise; the broadband transient drags the voicing score down |

The pattern is clear: **the onset rule wants a dog that barks repeatedly.** A dog that
yelps once, or whimpers quietly, or barks every four seconds, gets missed. That's a real
gap, and it's the one I'd fix first with more time.

## What it falsely fires on, and why

| False alarm | Why |
|---|---|
| `845919-talking-crowd` | **Human speech is voiced.** This is the big one — see below. |
| `740168-water-boiling-inside-electric-kettle` | A boiling kettle has genuine tonal resonance |
| `832998-chair-scrape` | A scrape across a hard floor is periodic enough to pass |
| `546088-keyboard-typing` | Rapid repeated transients read as repeated onsets |

### Human speech is the real limitation

Speech is the most voiced sound there is, and it lives right inside 300–2500 Hz. The
voicing test cannot tell a person from a dog, which means **a television left on will
trigger Stay.** In a home, that's not an edge case.

I tried the obvious fix: raising the autocorrelation pitch floor from 140 Hz to 300 Hz,
on the reasoning that adult human speech sits at 85–255 Hz while dogs sit above it.

| Pitch floor | Dogs | False positives |
|---|---|---|
| **140 Hz (shipped)** | **10/14** | **4/20** |
| 250 Hz | 9/14 | 3/20 |
| 300 Hz | 9/14 | 2/20 |
| 350 Hz | 9/14 | 2/20 |

It works — it removes the talking-crowd false alarm. But it costs a **whining** clip, and
whining is the single most characteristic sound of separation distress. This app exists
for dogs that whine when they're alone.

So I kept 140 Hz deliberately. Missing a distressed dog is the product failing at its
purpose; speaking when it shouldn't is mildly annoying and capped at once per 90 seconds
by the cooldown. For a comfort device, over-responding beats under-responding.

That's a product decision, not a metric decision, and I'd rather state it than quietly
optimise for a better-looking table.

---

## Where this approach runs out

Everything here is signal processing: loudness, a frequency band, periodicity, and the
rhythm of onsets. That gets you a detector with no model, no download, and no audio
leaving the device — which is genuinely worth something for an always-on microphone in
someone's home.

But it cannot answer the question *"what made this sound?"* It can only answer *"what
shape is this sound?"* Speech and a bark have the same shape. So do a squeaking hinge and
a whine.

**That's the ceiling, and 56% on unseen audio is where it sits.** Past this point you
need a classifier — something like YAMNet running on-device, which keeps the privacy
property while actually identifying the source. That's the first thing I'd build next.

---

## What these numbers still don't show

**There is no room in the measurement.** Clips are played straight into the audio graph:
no speaker, no microphone, no distance, no reverb. A real living room is harder, which is
what the sensitivity slider exists for.

**The set is small.** 34 clips, and it comes from what is freely licensed and
redistributable, which is a narrower pool than what exists.

**Every clip is a clean recording of one thing.** Real rooms layer sounds — a dog
whining while the washing machine runs is not represented here at all.

---

## Reproducing

```bash
npm install && npm run dev
# open http://localhost:3000/test → "Run the sweep"
```

Move the sensitivity slider and re-run to watch the operating point shift. Every clip's
origin and licence is in [`public/test-audio/SOURCES.md`](../public/test-audio/SOURCES.md):
22 CC0 clips from Freesound, 12 from Wikimedia Commons.
