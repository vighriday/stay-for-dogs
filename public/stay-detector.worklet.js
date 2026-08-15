/**
 * Stay — dog vocalisation detector.
 *
 * Runs on the audio thread. That is not a detail: Away Mode means an
 * unattended tab for hours, and browsers throttle timers and rAF in
 * background tabs. The audio thread is not throttled, so every decision
 * here is timed by counting samples rather than reading a clock.
 *
 * Two inputs:
 *   input 0 — the raw microphone
 *   input 1 — the same signal through a 300-2500 Hz band pass
 *
 * Barks and whines put most of their energy in that band. Traffic rumble,
 * a fridge, footsteps and door thuds do not. Comparing the two RMS values
 * gives a band ratio without needing an FFT.
 *
 * Four conditions must all hold before noise counts:
 *   1. loud enough              (rms above the sensitivity threshold)
 *   2. mostly in the dog band   (ratio > 0.55)
 *   3. persistent               (enough noisy frames inside a sliding window)
 *   4. not us                   (Stay is not speaking, and 3 s have passed
 *                                since it stopped)
 *
 * Condition 3 is the interesting one, because dogs make two acoustically
 * different kinds of noise and a single rule cannot catch both:
 *
 *   Barking is repetitive. Bursts of 150-250 ms with gaps between them.
 *   Measured on a 40 s recording, the longest unbroken noisy run was 6
 *   frames — so an early version of this file, which waited for 400 ms of
 *   continuous sound, detected precisely nothing.
 *
 *   Whining and howling are the opposite: quiet, but continuous.
 *
 * So there are two ways in. Three or more separate onsets inside a second
 * and a half catches barking. A single unbroken stretch over 1.2 s catches
 * whining and howling. Counting *onsets* rather than noisy frames is what
 * keeps a door slam out: a slam is loud and lands in the same frequency
 * band as a bark, but it is one event with a decaying tail, not three.
 */

const FRAME = 2048;

const S = {
  IDLE: 0,
  UPSET: 1,
  COOLDOWN: 2,
};

class StayDetector extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const o = (options && options.processorOptions) || {};
    const sr = sampleRate;

    this.ms = (n) => Math.round((n / 1000) * sr);

    this.minBandRatio = o.minBandRatio ?? 0.55;
    this.quiet = this.ms(o.quietMs ?? 2500);
    this.ceiling = this.ms(o.ceilingMs ?? 20000);
    this.episodeEnd = this.ms(o.episodeEndMs ?? 10000);
    this.cooldown = this.ms(o.cooldownMs ?? 90000);
    this.playbackTail = this.ms(o.playbackTailMs ?? 3000);

    this.setSensitivity(o.sensitivity ?? 0.5);

    // Onset window. Frames are ~43 ms, so 1500 ms is about 35 of them.
    // The window holds a rising edge per frame, not a noisy flag, so what
    // gets counted is how many separate times the dog started making noise.
    const frameMs = (FRAME / sr) * 1000;
    this.windowFrames = Math.max(4, Math.round((o.onsetWindowMs ?? 1500) / frameMs));
    this.onsetsNeeded = Math.max(2, o.onsetCount ?? 3);
    this.continuous = this.ms(o.continuousMs ?? 1200);
    // Refractory gap between onsets. A door slam is one event, but its
    // decaying tail oscillates across the threshold and would otherwise be
    // counted as three or four separate onsets. Real barks are 200-500 ms
    // apart, so ignoring anything closer than 200 ms collapses the ringing
    // without losing a bark.
    this.refractory = this.ms(o.refractoryMs ?? 200);
    this.sinceOnset = this.refractory;
    this.window = new Uint8Array(this.windowFrames);
    this.windowAt = 0;
    this.windowOnsets = 0;
    this.wasNoise = false;

    // Frame accumulation
    this.acc = 0;
    this.sumFull = 0;
    this.sumBand = 0;

    // State machine, all counters in samples
    this.state = S.IDLE;
    this.noiseRun = 0; // unbroken noise, still used for the ceiling rule
    this.quietRun = 0; // unbroken quiet
    this.episodeLen = 0; // length of the current episode
    this.cooldownLeft = 0;
    this.peakDb = -Infinity;
    this.announcedUpset = false;
    this.announcedSettling = false;

    // Playback interlock — the single most important flag in the file.
    // Without it the speaker feeds the microphone and the app talks to itself
    // forever, about five seconds into the first demo.
    this.speaking = false;
    this.tailLeft = 0;

    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === "sensitivity") {
        this.setSensitivity(m.value);
      } else if (m.type === "speaking") {
        this.speaking = !!m.value;
        if (!m.value) this.tailLeft = this.playbackTail;
        // Whatever the microphone heard while we were talking was us.
        this.noiseRun = 0;
        this.quietRun = 0;
      } else if (m.type === "spoke") {
        this.state = S.COOLDOWN;
        this.cooldownLeft = this.cooldown;
        this.resetEpisode();
      } else if (m.type === "reset") {
        this.state = S.IDLE;
        this.cooldownLeft = 0;
        this.resetEpisode();
      }
    };
  }

  /** sensitivity 0..1 maps to a -50 dBFS .. -25 dBFS gate. */
  setSensitivity(v) {
    const s = Math.min(1, Math.max(0, Number(v) || 0));
    this.thresholdDb = -25 + (1 - s) * -25;
  }

  resetEpisode() {
    this.noiseRun = 0;
    this.quietRun = 0;
    this.episodeLen = 0;
    this.peakDb = -Infinity;
    this.announcedUpset = false;
    this.announcedSettling = false;
    this.clearWindow();
  }

  clearWindow() {
    this.window.fill(0);
    this.windowAt = 0;
    this.windowOnsets = 0;
    this.wasNoise = false;
    this.sinceOnset = this.refractory;
  }

  /**
   * Slides the window on by one frame, recording whether this frame was the
   * *start* of a noise rather than merely noisy, and returns how many separate
   * onsets are inside the window.
   */
  pushWindow(isNoise, samples) {
    this.sinceOnset += samples;

    const rising = isNoise && !this.wasNoise;
    const onset = rising && this.sinceOnset >= this.refractory ? 1 : 0;
    if (onset) this.sinceOnset = 0;
    this.wasNoise = isNoise;

    this.windowOnsets += onset - this.window[this.windowAt];
    this.window[this.windowAt] = onset;
    this.windowAt = (this.windowAt + 1) % this.windowFrames;
    return this.windowOnsets;
  }

  /** Barking repeats; whining holds. Either one counts. */
  isEpisodeStarting(onsets) {
    return onsets >= this.onsetsNeeded || this.noiseRun >= this.continuous;
  }

  process(inputs) {
    const full = inputs[0] && inputs[0][0];
    const band = inputs[1] && inputs[1][0];
    if (!full || !band) return true;

    const n = full.length;
    for (let i = 0; i < n; i++) {
      this.sumFull += full[i] * full[i];
      this.sumBand += band[i] * band[i];
    }
    this.acc += n;

    if (this.acc >= FRAME) {
      this.evaluate(this.acc);
      this.acc = 0;
      this.sumFull = 0;
      this.sumBand = 0;
    }
    return true;
  }

  evaluate(samples) {
    const rmsFull = Math.sqrt(this.sumFull / samples);
    const rmsBand = Math.sqrt(this.sumBand / samples);
    const db = 20 * Math.log10(rmsFull + 1e-9);
    const ratio = rmsFull > 1e-7 ? Math.min(1, rmsBand / rmsFull) : 0;

    if (this.tailLeft > 0) this.tailLeft = Math.max(0, this.tailLeft - samples);
    if (this.cooldownLeft > 0) {
      this.cooldownLeft = Math.max(0, this.cooldownLeft - samples);
      if (this.cooldownLeft === 0 && this.state === S.COOLDOWN) this.state = S.IDLE;
    }

    const deaf = this.speaking || this.tailLeft > 0;
    const isNoise = !deaf && db > this.thresholdDb && ratio > this.minBandRatio;

    // The strip draws from this. It is the same measurement the decision
    // uses, so the picture is literally what the detector sees.
    this.port.postMessage({
      type: "frame",
      db,
      ratio,
      isNoise,
      deaf,
      state: this.state,
      cooldownLeft: this.cooldownLeft / sampleRate,
    });

    if (deaf) return;

    const onsets = this.pushWindow(isNoise, samples);

    if (isNoise) {
      this.noiseRun += samples;
      this.quietRun = 0;
      if (db > this.peakDb) this.peakDb = db;
    } else {
      this.quietRun += samples;
      this.noiseRun = 0;
    }

    if (this.state === S.UPSET) this.episodeLen += samples;

    switch (this.state) {
      case S.IDLE:
        if (this.isEpisodeStarting(onsets)) {
          this.state = S.UPSET;
          this.episodeLen = this.windowFrames * FRAME;
          this.announcedUpset = true;
          this.port.postMessage({ type: "upset", peakDb: this.peakDb });
        }
        break;

      case S.UPSET: {
        // The dog has gone quiet. Answer the quiet, not the barking —
        // responding to a bark teaches the dog that barking works.
        if (this.quietRun >= this.quiet) {
          this.port.postMessage({
            type: "speak",
            trigger: "settled",
            peakDb: this.peakDb,
            durationMs: (this.episodeLen / sampleRate) * 1000,
          });
          this.state = S.COOLDOWN;
          this.cooldownLeft = this.cooldown;
          this.resetEpisode();
          break;
        }

        // Never ignore a dog that cannot settle on its own.
        if (this.noiseRun >= this.ceiling) {
          this.port.postMessage({
            type: "speak",
            trigger: "ceiling",
            peakDb: this.peakDb,
            durationMs: (this.episodeLen / sampleRate) * 1000,
          });
          this.state = S.COOLDOWN;
          this.cooldownLeft = this.cooldown;
          this.resetEpisode();
          break;
        }

        // Halfway to the release point, tell the UI it is settling.
        if (!this.announcedSettling && this.quietRun >= this.quiet / 2) {
          this.announcedSettling = true;
          this.port.postMessage({ type: "settling" });
        }

        // Quiet for a long stretch without ever reaching the threshold:
        // the episode is simply over.
        if (this.quietRun >= this.episodeEnd) {
          this.port.postMessage({
            type: "episode-end",
            peakDb: this.peakDb,
            durationMs: (this.episodeLen / sampleRate) * 1000,
          });
          this.state = S.IDLE;
          this.resetEpisode();
        }
        break;
      }

      case S.COOLDOWN:
        // Detection keeps running and keeps logging during cooldown; it just
        // cannot release another response. The UI shows this as "holding".
        if (this.isEpisodeStarting(onsets) && !this.announcedUpset) {
          this.announcedUpset = true;
          this.port.postMessage({ type: "held", peakDb: this.peakDb });
        }
        if (this.quietRun >= this.episodeEnd) {
          this.announcedUpset = false;
          this.peakDb = -Infinity;
        }
        break;
    }
  }
}

registerProcessor("stay-detector", StayDetector);
