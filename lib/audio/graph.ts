import { DETECTOR_DEFAULTS } from "@/lib/types";

export interface DetectorFrame {
  db: number;
  ratio: number;
  isNoise: boolean;
  deaf: boolean;
  cooldownLeft: number;
}

export type DetectorEvent =
  | { type: "upset"; peakDb: number }
  | { type: "settling" }
  | { type: "speak"; trigger: "settled" | "ceiling"; peakDb: number; durationMs: number }
  | { type: "episode-end"; peakDb: number; durationMs: number }
  | { type: "held"; peakDb: number };

export interface ListenerHandle {
  context: AudioContext;
  stop: () => Promise<void>;
  setSensitivity: (v: number) => void;
  setSpeaking: (v: boolean) => void;
  markSpoke: () => void;
}

export class MicrophoneDenied extends Error {
  constructor(readonly reason: "denied" | "missing" | "insecure" | "unknown") {
    super("microphone unavailable");
  }
}

/**
 * Builds the listening graph and starts the detector.
 *
 *   microphone ─┬─────────────────────────────► input 0  (raw)
 *               └─ highpass 300 ─ lowpass 2500 ─► input 1  (dog band)
 *
 * Comparing the two RMS values gives the band ratio with native filters
 * instead of a hand-rolled FFT. Two poles each side is a steep enough
 * skirt to drop traffic rumble and most of a fridge.
 */
export async function startListening(
  onFrame: (f: DetectorFrame) => void,
  onEvent: (e: DetectorEvent) => void,
  sensitivity: number,
): Promise<ListenerHandle> {
  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new MicrophoneDenied(window?.isSecureContext === false ? "insecure" : "missing");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        // Both of these must stay off. Noise suppression eats exactly the
        // sound we are listening for, and automatic gain control normalises
        // loudness — which makes a quiet whine read as loud and a bark read
        // as normal, silently destroying any fixed threshold.
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new MicrophoneDenied("denied");
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new MicrophoneDenied("missing");
    }
    throw new MicrophoneDenied("unknown");
  }

  const context = new AudioContext({ latencyHint: "interactive" });
  if (context.state === "suspended") await context.resume();

  await context.audioWorklet.addModule("/stay-detector.worklet.js");

  const source = context.createMediaStreamSource(stream);

  const hp1 = context.createBiquadFilter();
  hp1.type = "highpass";
  hp1.frequency.value = DETECTOR_DEFAULTS.bandLowHz;
  hp1.Q.value = 0.707;

  const hp2 = context.createBiquadFilter();
  hp2.type = "highpass";
  hp2.frequency.value = DETECTOR_DEFAULTS.bandLowHz;
  hp2.Q.value = 0.707;

  const lp1 = context.createBiquadFilter();
  lp1.type = "lowpass";
  lp1.frequency.value = DETECTOR_DEFAULTS.bandHighHz;
  lp1.Q.value = 0.707;

  const lp2 = context.createBiquadFilter();
  lp2.type = "lowpass";
  lp2.frequency.value = DETECTOR_DEFAULTS.bandHighHz;
  lp2.Q.value = 0.707;

  const node = new AudioWorkletNode(context, "stay-detector", {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: "explicit",
    processorOptions: {
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
    },
  });

  source.connect(node, 0, 0);
  source.connect(hp1);
  hp1.connect(hp2);
  hp2.connect(lp1);
  lp1.connect(lp2);
  lp2.connect(node, 0, 1);

  // The graph is pull-based from the destination, so a node with nothing
  // downstream may never be asked to process. A silent sink keeps it alive
  // without putting the microphone into the speakers.
  const sink = context.createGain();
  sink.gain.value = 0;
  node.connect(sink);
  sink.connect(context.destination);

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

  let wakeLock: WakeLockSentinel | null = null;
  try {
    wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    // Wake lock is a nicety. Denied is fine; the session still runs.
  }

  const reacquire = async () => {
    if (document.visibilityState === "visible" && wakeLock === null) {
      try {
        wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        /* still fine */
      }
    }
  };
  document.addEventListener("visibilitychange", reacquire);

  return {
    context,
    async stop() {
      document.removeEventListener("visibilitychange", reacquire);
      try {
        await wakeLock?.release();
      } catch {
        /* already gone */
      }
      node.port.onmessage = null;
      node.disconnect();
      sink.disconnect();
      source.disconnect();
      [hp1, hp2, lp1, lp2].forEach((f) => f.disconnect());
      stream.getTracks().forEach((t) => t.stop());
      await context.close();
    },
    setSensitivity(v) {
      node.port.postMessage({ type: "sensitivity", value: v });
    },
    setSpeaking(v) {
      node.port.postMessage({ type: "speaking", value: v });
    },
    markSpoke() {
      node.port.postMessage({ type: "spoke" });
    },
  };
}
