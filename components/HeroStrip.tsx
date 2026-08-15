"use client";

import { useEffect, useRef } from "react";
import { Strip, type StripHandle } from "@/components/Strip";

/**
 * The hero.
 *
 * The most characteristic thing in this product's world is a quiet room, a
 * sound arriving in it, and an answer that waits for the quiet before it
 * comes. So that is the hero: not a screenshot of the app, the app's own
 * signal, playing.
 *
 * This is an illustration of the shape a session takes, drawn with the same
 * component the live session uses. It is not presented as recorded data.
 */

interface Beat {
  /** How many columns this beat lasts. */
  span: number;
  mode: 0 | 1 | 2 | 3;
  /** Peak dB during the beat. */
  db: number;
  say?: string;
}

const SCORE: Beat[] = [
  { span: 90, mode: 0, db: -54 },
  { span: 46, mode: 1, db: -26 },
  { span: 30, mode: 1, db: -22 },
  { span: 22, mode: 2, db: -40 },
  { span: 26, mode: 2, db: -52, say: "Easy, Biscuit. You're alright." },
  { span: 70, mode: 3, db: -55 },
  { span: 60, mode: 0, db: -56 },
  { span: 34, mode: 1, db: -24 },
  { span: 26, mode: 2, db: -46 },
  { span: 20, mode: 2, db: -53, say: "That's it. Settle down now." },
  { span: 80, mode: 3, db: -56 },
  { span: 110, mode: 0, db: -57 },
];

/** Wide enough to fill any screen before the first paint, with room to scroll. */
const CAPACITY = 3200;
const PREFILL = 2600;

export function HeroStrip() {
  const strip = useRef<StripHandle | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let beat = 0;
    let step = 0;
    let raf = 0;
    let last = 0;

    const advance = (columns: number) => {
      for (let n = 0; n < columns; n++) {
        const b = SCORE[beat];
        if (!b) return;

        // Shape the beat so noise swells and decays rather than sitting flat.
        const t = step / b.span;
        const envelope = b.mode === 0 ? 1 : Math.sin(Math.PI * Math.min(1, t)) * 0.7 + 0.3;
        const jitter = (Math.sin(step * 2.7) + Math.sin(step * 0.9)) * 2.2;
        strip.current?.push(b.db * (b.mode === 0 ? 1 : 1 / envelope) + jitter, b.mode);

        step++;
        if (step >= b.span) {
          if (b.say) strip.current?.mark(b.say, "settled");
          step = 0;
          beat++;
          if (beat >= SCORE.length) {
            beat = 0;
            strip.current?.clear();
          }
        }
      }
    };

    // Fill the strip before the first paint, wide enough for any screen. An
    // instrument that starts empty reads as broken, and the hero has one job:
    // be understood immediately.
    advance(PREFILL);

    if (reduced) return;

    const loop = (now: number) => {
      if (!last) last = now;
      const columns = Math.min(6, Math.floor((now - last) / 22));
      if (columns > 0) {
        advance(columns);
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(raf);
  }, []);

  return <Strip ref={strip} height={112} capacity={CAPACITY} />;
}
