/**
 * Runs the real detector outside a browser.
 *
 * `public/stay-detector.worklet.js` is written against the AudioWorklet API,
 * so it has never been runnable anywhere except a page. That is a problem:
 * the numbers on /test come from a browser sweep nobody can re-run in CI, and
 * the detector is the one part of this project where a silent regression is
 * invisible — the first version of it failed by detecting *nothing*, and it
 * looked completely healthy while doing so.
 *
 * The worklet is only a class. Shimming the three globals it touches —
 * `AudioWorkletProcessor`, `registerProcessor`, `sampleRate` — lets it run
 * unmodified under Node, driven by signals generated in code.
 *
 * Nothing here is a reimplementation of the detector. It imports the exact
 * file the browser loads, which is the same promise the /test page makes.
 */

const SR = 48_000;
const QUANTUM = 128;

export interface Emitted {
  type: string;
  [k: string]: unknown;
}

interface Detector {
  process(inputs: Float32Array[][]): boolean;
  port: { onmessage: ((e: { data: unknown }) => void) | null };
}

type DetectorCtor = new (opts: { processorOptions: Record<string, unknown> }) => Detector;

let cached: DetectorCtor | null = null;

/** Loads the production worklet under a minimal AudioWorklet shim. */
export async function loadDetector(): Promise<DetectorCtor> {
  if (cached) return cached;

  const g = globalThis as Record<string, unknown>;
  g.sampleRate = SR;
  g.currentTime = 0;
  g.AudioWorkletProcessor = class {
    port = { postMessage: () => {}, onmessage: null };
  };
  g.registerProcessor = (_name: string, ctor: DetectorCtor) => {
    cached = ctor;
  };

  // Held in a variable on purpose. The worklet is a script, not a module — it
  // declares a class and calls registerProcessor, and exports nothing — so a
  // literal specifier makes TypeScript reject it as "not a module". Node
  // executes it happily, which is all this needs: the side effect of that
  // registerProcessor call is the entire point.
  const worklet = "../public/stay-detector.worklet.js";
  await import(worklet);

  if (!cached) throw new Error("the worklet did not register a processor");
  return cached;
}

/**
 * Feeds a signal through the detector and returns everything it emitted.
 *
 * The band-passed second input is produced here by the same filter design the
 * live graph uses — two 2nd-order highpasses at 300 Hz and two lowpasses at
 * 2500 Hz, Q 0.707 — because the detector reads two inputs and compares them.
 */
export async function run(
  signal: Float32Array,
  options: Record<string, unknown> = {},
): Promise<Emitted[]> {
  const Ctor = await loadDetector();
  const node = new Ctor({
    processorOptions: { sensitivity: 0.5, ...options },
  });

  const emitted: Emitted[] = [];
  (node as unknown as { port: { postMessage: (m: Emitted) => void } }).port.postMessage = (m) => {
    // Per-frame telemetry is noise for behavioural assertions.
    if (m.type !== "frame") emitted.push(m);
  };

  const band = bandPass(signal);

  for (let i = 0; i + QUANTUM <= signal.length; i += QUANTUM) {
    node.process([
      [signal.subarray(i, i + QUANTUM)],
      [band.subarray(i, i + QUANTUM)],
    ]);
  }
  return emitted;
}

/** Sends a control message to a running detector, as the page would. */
export function send(node: Detector, message: unknown): void {
  node.port.onmessage?.({ data: message });
}

/* ── the same filter cascade the live graph builds ───────────── */

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

function design(kind: "highpass" | "lowpass", freq: number, q = 0.707): Biquad {
  const w = (2 * Math.PI * freq) / SR;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;

  if (kind === "highpass") {
    return {
      b0: ((1 + cos) / 2) / a0,
      b1: (-(1 + cos)) / a0,
      b2: ((1 + cos) / 2) / a0,
      a1: (-2 * cos) / a0,
      a2: (1 - alpha) / a0,
    };
  }
  return {
    b0: ((1 - cos) / 2) / a0,
    b1: (1 - cos) / a0,
    b2: ((1 - cos) / 2) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function apply(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const out = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x[i];
    y2 = y1; y1 = out;
    y[i] = out;
  }
  return y;
}

export function bandPass(x: Float32Array): Float32Array {
  const stages = [
    design("highpass", 300),
    design("highpass", 300),
    design("lowpass", 2500),
    design("lowpass", 2500),
  ];
  return stages.reduce(apply, x);
}

/* ── signals ─────────────────────────────────────────────────── */

const samples = (ms: number) => Math.round((ms / 1000) * SR);

export function silence(ms: number): Float32Array {
  return new Float32Array(samples(ms));
}

/**
 * A voiced sound: a fundamental plus harmonics, which is what makes a waveform
 * repeat and what the autocorrelation test is looking for.
 */
export function voiced(freqHz: number, ms: number, amp = 0.3): Float32Array {
  const out = new Float32Array(samples(ms));
  const harmonics = [1, 2, 3, 4, 5];
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (const h of harmonics) {
      v += Math.sin((2 * Math.PI * freqHz * h * i) / SR) / h;
    }
    // Soft edges, so the start and end are not themselves broadband clicks.
    const edge = Math.min(1, i / 400, (out.length - i) / 400);
    out[i] = v * amp * edge;
  }
  return out;
}

/**
 * A speaking voice.
 *
 * The fundamental of adult speech sits at 85–255 Hz, below the band Stay
 * listens to — but almost none of speech's energy is down there. It is in the
 * formants, a few hundred to a few thousand hertz, squarely inside the dog
 * band. So the harmonics are weighted to peak around the fourth and fifth
 * rather than falling off as 1/h.
 *
 * That distinction is the whole reason a television defeats this detector:
 * what reaches the microphone is voiced, in-band and loud, exactly like a
 * bark. Modelling speech as a bass-heavy tone would make the limitation
 * disappear from the test bench while leaving it in the product.
 */
export function speech(f0: number, ms: number, amp = 0.3): Float32Array {
  const out = new Float32Array(samples(ms));
  const weights = [0.15, 0.5, 1, 1, 0.8, 0.5, 0.3, 0.2];
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    weights.forEach((w, h) => {
      v += w * Math.sin((2 * Math.PI * f0 * (h + 1) * i) / SR);
    });
    const edge = Math.min(1, i / 400, (out.length - i) / 400);
    out[i] = (v / 4) * amp * edge;
  }
  return out;
}

/**
 * An unvoiced transient: loud, broadband, and gone. A door slam, a dropped
 * pan, a footstep. No periodicity whatsoever.
 */
export function transient(ms: number, amp = 0.6): Float32Array {
  const out = new Float32Array(samples(ms));
  let seed = 12345;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const noise = (seed / 4294967296) * 2 - 1;
    out[i] = noise * amp * Math.exp(-i / (SR * 0.03));
  }
  return out;
}

export function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Barking: short voiced bursts with gaps, repeated. */
export function barking(bursts: number, burstMs = 200, gapMs = 300): Float32Array {
  const parts: Float32Array[] = [];
  for (let i = 0; i < bursts; i++) {
    parts.push(voiced(500, burstMs));
    if (i < bursts - 1) parts.push(silence(gapMs));
  }
  return concat(...parts);
}

export const kinds = (events: Emitted[]): string[] => events.map((e) => String(e.type));
