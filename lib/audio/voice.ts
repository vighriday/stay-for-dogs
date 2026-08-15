import { fillBank } from "@/lib/fallbackLines";
import { LIMITS } from "@/lib/types";
import type { DogProfile, Mood } from "@/lib/types";

export interface SpokenLine {
  text: string;
  buffer: AudioBuffer;
  fromBank: boolean;
}

export interface VoiceEngineOptions {
  context: AudioContext;
  elKey: string;
  voiceId: string;
  profile: DogProfile;
  geminiKey?: string;
  /** Told whenever playback starts and stops, so the detector can go deaf. */
  onSpeakingChange: (speaking: boolean) => void;
  /** Surfaced in the UI as a quiet note, never as a blocking error. */
  onDegraded: (reason: string) => void;
}

/**
 * Owns every sentence Stay will say, and says them.
 *
 * The whole design exists to remove latency from the moment that matters.
 * Generating a line and synthesising it after the dog goes quiet costs two
 * to six seconds — the moment is gone and the demo looks broken. So lines
 * are written and rendered to audio *before* they are needed, and playback
 * is a decoded buffer that starts instantly.
 *
 * The bank is the floor beneath all of it. If Gemini is rate-limited, or
 * the network drops, or ElevenLabs has a bad minute, Stay still speaks.
 * It must never go quiet because a request failed.
 */
export class VoiceEngine {
  private readonly ctx: AudioContext;
  private readonly opts: VoiceEngineOptions;

  private bank: SpokenLine[] = [];
  private fresh: SpokenLine[] = [];
  private used: string[] = [];
  private bankCursor = 0;

  private refilling = false;
  private disposed = false;
  private current: AudioBufferSourceNode | null = null;

  constructor(opts: VoiceEngineOptions) {
    this.ctx = opts.context;
    this.opts = opts;
  }

  get freshCount() {
    return this.fresh.length;
  }
  get bankCount() {
    return this.bank.length;
  }

  /**
   * Renders the offline bank, then the first batch of written lines.
   *
   * Bank first, deliberately: the moment this resolves Stay can speak, even
   * if Gemini never answers at all.
   */
  async prime(onProgress?: (done: number, total: number) => void): Promise<void> {
    const bankTexts = fillBank(this.opts.profile.name);
    const total = bankTexts.length + LIMITS.lineBufferTarget;
    let done = 0;

    const rendered = await this.renderAll(bankTexts, () => onProgress?.(++done, total));
    this.bank = rendered.map((r) => ({ ...r, fromBank: true }));

    if (this.bank.length === 0) {
      throw new Error("Stay could not render a single line with that voice.");
    }

    try {
      const lines = await this.writeLines("calm", LIMITS.lineBufferTarget);
      const freshRendered = await this.renderAll(lines, () => onProgress?.(++done, total));
      this.fresh = freshRendered.map((r) => ({ ...r, fromBank: false }));
    } catch (err) {
      this.opts.onDegraded(
        err instanceof Error ? err.message : "Gemini is unavailable right now.",
      );
    }
    onProgress?.(total, total);
  }

  /** Pulls the next line: a written one if there is one, otherwise the bank. */
  private take(): SpokenLine {
    const next = this.fresh.shift();
    if (next) {
      this.used.push(next.text);
      return next;
    }
    // Walk the bank in order rather than at random so a full-fallback
    // session still never repeats until all twenty have been heard.
    const line = this.bank[this.bankCursor % this.bank.length];
    this.bankCursor++;
    return line;
  }

  /** Speaks the next line. Resolves when the audio has finished playing. */
  async speak(mood: Mood = "calm"): Promise<SpokenLine> {
    const line = this.take();

    this.opts.onSpeakingChange(true);

    await new Promise<void>((resolve) => {
      const src = this.ctx.createBufferSource();
      src.buffer = line.buffer;
      src.connect(this.ctx.destination);
      src.onended = () => {
        this.current = null;
        resolve();
      };
      this.current = src;
      src.start();
    });

    this.opts.onSpeakingChange(false);

    void this.refill(mood);
    return line;
  }

  /** Stops mid-sentence. Used when the session ends while Stay is talking. */
  stop() {
    if (this.current) {
      try {
        this.current.stop();
      } catch {
        /* already ended */
      }
      this.current = null;
      this.opts.onSpeakingChange(false);
    }
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.bank = [];
    this.fresh = [];
  }

  private async refill(mood: Mood) {
    if (this.disposed || this.refilling) return;
    if (this.fresh.length >= LIMITS.lineBufferFloor) return;

    this.refilling = true;
    try {
      const lines = await this.writeLines(mood, 6);
      const rendered = await this.renderAll(lines);
      if (!this.disposed) {
        this.fresh.push(...rendered.map((r) => ({ ...r, fromBank: false })));
      }
    } catch {
      // Silent on purpose. The bank covers it and the session continues.
      // A failed background refill is not something to interrupt anyone over.
    } finally {
      this.refilling = false;
    }
  }

  private async writeLines(mood: Mood, count: number): Promise<string[]> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.opts.geminiKey) headers["x-gemini-key"] = this.opts.geminiKey;

    const res = await fetch("/api/gemini/lines", {
      method: "POST",
      headers,
      body: JSON.stringify({
        profile: this.opts.profile,
        mood,
        count,
        used: this.used.slice(-40),
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string; hint?: string };
      } | null;
      throw new Error(body?.error?.hint ?? body?.error?.message ?? "Gemini is unavailable.");
    }

    const { lines } = (await res.json()) as { lines: string[] };
    return lines;
  }

  private async renderAll(
    texts: string[],
    onOne?: () => void,
  ): Promise<{ text: string; buffer: AudioBuffer }[]> {
    // Sequential on purpose. ElevenLabs rate-limits concurrent requests hard
    // on free plans, and a burst of parallel calls is the fastest way to get
    // a 429 during the one part of setup the user is actually watching.
    const out: { text: string; buffer: AudioBuffer }[] = [];
    for (const text of texts) {
      if (this.disposed) break;
      try {
        out.push({ text, buffer: await this.render(text) });
      } catch {
        // One bad line does not sink the batch.
      }
      onOne?.();
    }
    return out;
  }

  private async render(text: string): Promise<AudioBuffer> {
    const res = await fetch("/api/el/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-el-key": this.opts.elKey },
      body: JSON.stringify({ voiceId: this.opts.voiceId, text }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(body?.error?.message ?? "ElevenLabs could not speak that line.");
    }

    return this.ctx.decodeAudioData(await res.arrayBuffer());
  }
}

/**
 * Demo mode's engine. Same shape, same playback path, zero network calls —
 * every line was rendered ahead of time and ships with the app.
 */
export class PrerenderedVoiceEngine {
  private lines: SpokenLine[] = [];
  private cursor = 0;
  private current: AudioBufferSourceNode | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly onSpeakingChange: (speaking: boolean) => void,
  ) {}

  get freshCount() {
    return Math.max(0, this.lines.length - this.cursor);
  }
  get bankCount() {
    return this.lines.length;
  }

  async prime(
    manifest: { text: string; file: string }[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    let done = 0;
    for (const entry of manifest) {
      try {
        const res = await fetch(entry.file);
        if (!res.ok) throw new Error(`missing ${entry.file}`);
        const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.lines.push({ text: entry.text, buffer, fromBank: false });
      } catch {
        /* skip a missing clip rather than break the demo */
      }
      onProgress?.(++done, manifest.length);
    }
    if (this.lines.length === 0) {
      throw new Error("Demo audio failed to load.");
    }
  }

  async speak(): Promise<SpokenLine> {
    const line = this.lines[this.cursor % this.lines.length];
    this.cursor++;

    this.onSpeakingChange(true);
    await new Promise<void>((resolve) => {
      const src = this.ctx.createBufferSource();
      src.buffer = line.buffer;
      src.connect(this.ctx.destination);
      src.onended = () => {
        this.current = null;
        resolve();
      };
      this.current = src;
      src.start();
    });
    this.onSpeakingChange(false);

    return line;
  }

  stop() {
    if (this.current) {
      try {
        this.current.stop();
      } catch {
        /* already ended */
      }
      this.current = null;
      this.onSpeakingChange(false);
    }
  }

  dispose() {
    this.stop();
    this.lines = [];
  }
}
