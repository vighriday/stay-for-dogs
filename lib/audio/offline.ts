import { DETECTOR_DEFAULTS } from "@/lib/types";
import type { DetectorEvent, DetectorFrame } from "./graph";

/**
 * Runs recorded audio through the same detector the live session uses.
 *
 * This is deliberately not a simulation. Demo mode and the published test
 * numbers both come through here, which means the figures in the results
 * table describe the code that actually ships — not a model of it.
 *
 * Two ways in:
 *   runOffline   — as fast as the machine allows, for sweeping many clips
 *   playThrough  — in real time through the speakers, for the demo
 */

const WORKLET_URL = "/stay-detector.worklet.js";

function processorOptions(sensitivity: number) {
  return {
    sensitivity,
    minBandRatio: DETECTOR_DEFAULTS.minBandRatio,
    onsetWindowMs: DETECTOR_DEFAULTS.onsetWindowMs,
    onsetCount: DETECTOR_DEFAULTS.onsetCount,
    continuousMs: DETECTOR_DEFAULTS.continuousMs,
      refractoryMs: DETECTOR_DEFAULTS.refractoryMs,
    quietMs: DETECTOR_DEFAULTS.quietMs,
    ceilingMs: DETECTOR_DEFAULTS.ceilingMs,
    episodeEndMs: DETECTOR_DEFAULTS.episodeEndMs,
    cooldownMs: DETECTOR_DEFAULTS.cooldownMs,
    playbackTailMs: DETECTOR_DEFAULTS.playbackTailMs,
  };
}

/** Wires source → [raw, band-passed] → detector. Identical to the live graph. */
function wire(
  ctx: BaseAudioContext,
  source: AudioNode,
  node: AudioWorkletNode,
): AudioNode[] {
  const hp1 = ctx.createBiquadFilter();
  hp1.type = "highpass";
  hp1.frequency.value = DETECTOR_DEFAULTS.bandLowHz;
  hp1.Q.value = 0.707;

  const hp2 = ctx.createBiquadFilter();
  hp2.type = "highpass";
  hp2.frequency.value = DETECTOR_DEFAULTS.bandLowHz;
  hp2.Q.value = 0.707;

  const lp1 = ctx.createBiquadFilter();
  lp1.type = "lowpass";
  lp1.frequency.value = DETECTOR_DEFAULTS.bandHighHz;
  lp1.Q.value = 0.707;

  const lp2 = ctx.createBiquadFilter();
  lp2.type = "lowpass";
  lp2.frequency.value = DETECTOR_DEFAULTS.bandHighHz;
  lp2.Q.value = 0.707;

  source.connect(node, 0, 0);
  source.connect(hp1);
  hp1.connect(hp2);
  hp2.connect(lp1);
  lp1.connect(lp2);
  lp2.connect(node, 0, 1);

  return [hp1, hp2, lp1, lp2];
}

export interface OfflineResult {
  /** True if the clip produced at least one sustained episode. */
  detected: boolean;
  /** Seconds into the clip when it first counted as noise. */
  firstDetectionSec: number | null;
  /** Loudest frame in the clip, dBFS. */
  peakDb: number;
  /** Highest share of energy inside the dog band. */
  peakBandRatio: number;
  frames: number;
}

/**
 * Sweeps one clip. Runs faster than real time.
 *
 * The cooldown is stretched past the clip length so a single clip can only
 * ever count once — otherwise a long recording of continuous barking would
 * inflate the detection rate by firing repeatedly.
 */
export async function runOffline(
  buffer: AudioBuffer,
  sensitivity: number,
): Promise<OfflineResult> {
  const ctx = new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.max(1, buffer.length),
    sampleRate: buffer.sampleRate,
  });

  await ctx.audioWorklet.addModule(WORKLET_URL);

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const node = new AudioWorkletNode(ctx, "stay-detector", {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: "explicit",
    processorOptions: {
      ...processorOptions(sensitivity),
      cooldownMs: (buffer.duration + 60) * 1000,
    },
  });

  wire(ctx, source, node);

  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.connect(sink);
  sink.connect(ctx.destination);

  let detected = false;
  let firstFrame: number | null = null;
  let peakDb = -Infinity;
  let peakBandRatio = 0;
  let frames = 0;

  node.port.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === "frame") {
      frames++;
      if (Number.isFinite(m.db) && m.db > peakDb) peakDb = m.db;
      if (m.ratio > peakBandRatio) peakBandRatio = m.ratio;
    } else if (m.type === "upset" && !detected) {
      detected = true;
      firstFrame = frames;
    }
  };

  source.start();
  await ctx.startRendering();

  // Messages from the audio thread land a tick behind the render finishing.
  await new Promise((r) => setTimeout(r, 0));

  const frameSec = DETECTOR_DEFAULTS.frameSize / buffer.sampleRate;

  return {
    detected,
    firstDetectionSec: firstFrame === null ? null : firstFrame * frameSec,
    peakDb: Number.isFinite(peakDb) ? peakDb : -Infinity,
    peakBandRatio,
    frames,
  };
}

export interface PlayThroughHandle {
  stop: () => void;
  /** Same interlock as a live session: the detector goes deaf while Stay talks. */
  setSpeaking: (v: boolean) => void;
  markSpoke: () => void;
  /** Resolves when the clip finishes on its own. */
  done: Promise<void>;
}

/**
 * Plays a clip aloud and runs the detector on it in real time.
 *
 * Demo mode uses this: you hear the dog, you watch the strip swell, and the
 * response comes out of the same state machine a live microphone would drive.
 */
export async function playThrough(
  ctx: AudioContext,
  buffer: AudioBuffer,
  sensitivity: number,
  onFrame: (f: DetectorFrame) => void,
  onEvent: (e: DetectorEvent) => void,
): Promise<PlayThroughHandle> {
  await ctx.audioWorklet.addModule(WORKLET_URL);

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const node = new AudioWorkletNode(ctx, "stay-detector", {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: "explicit",
    processorOptions: processorOptions(sensitivity),
  });

  const filters = wire(ctx, source, node);

  // Audible, but gently — this is a recording of a distressed animal.
  const out = ctx.createGain();
  out.gain.value = 0.55;
  source.connect(out);
  out.connect(ctx.destination);

  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.connect(sink);
  sink.connect(ctx.destination);

  node.port.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === "frame") {
      onFrame({
        db: m.db,
        ratio: m.ratio,
        isNoise: m.isNoise,
        deaf: m.deaf,
        cooldownLeft: m.cooldownLeft,
      });
    } else {
      onEvent(m as DetectorEvent);
    }
  };

  let settled = false;
  const done = new Promise<void>((resolve) => {
    source.onended = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
  });

  const teardown = () => {
    node.port.onmessage = null;
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
    source.disconnect();
    out.disconnect();
    node.disconnect();
    sink.disconnect();
    filters.forEach((f) => f.disconnect());
  };

  source.start();

  return {
    stop() {
      teardown();
      if (!settled) settled = true;
    },
    setSpeaking(v: boolean) {
      node.port.postMessage({ type: "speaking", value: v });
    },
    markSpoke() {
      node.port.postMessage({ type: "spoke" });
    },
    done,
  };
}
