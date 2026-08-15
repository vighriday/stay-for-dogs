"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

/**
 * The ethogram strip.
 *
 * Behavioural scientists chart an animal's behaviour over time as horizontal
 * bands. That is where this comes from, not from dashboard convention — and
 * it is why the same component draws both a live session and a scored clip.
 *
 * Quiet is a hairline. Distress swells, clay while the dog is upset and easing
 * to moss as it settles. A single amber tick marks each time Stay spoke.
 *
 * Amber appears nowhere else in the application.
 *
 * Data arrives from the audio thread at roughly 23 Hz. Pushing that through
 * React state would re-render the page a thousand times a minute, so the
 * buffer lives in a ref and drawing happens on an animation frame.
 */

export interface StripColumn {
  /** 0-1 height of the band. Derived from loudness above the floor. */
  level: number;
  /** 0 quiet · 1 upset · 2 settling · 3 holding (cooldown) */
  mode: 0 | 1 | 2 | 3;
}

export interface StripMarker {
  /** Column index the tick sits on. */
  at: number;
  line: string;
  trigger: "settled" | "ceiling" | "manual";
}

export interface StripHandle {
  push: (db: number, mode: StripColumn["mode"]) => void;
  mark: (line: string, trigger: StripMarker["trigger"]) => void;
  clear: () => void;
  /** Everything drawn so far, for saving or scoring. */
  snapshot: () => { columns: StripColumn[]; markers: StripMarker[] };
}

const FLOOR_DB = -60;
const CEIL_DB = -10;

const COLOURS = {
  ink: "#15110d",
  line: "#2c251e",
  lineBright: "#3d342a",
  clay: "#c4705a",
  moss: "#7c8f6b",
  lamp: "#e8a33d",
  dim: "#8a8075",
};

function levelFromDb(db: number): number {
  if (!Number.isFinite(db)) return 0;
  const clamped = Math.min(CEIL_DB, Math.max(FLOOR_DB, db));
  return (clamped - FLOOR_DB) / (CEIL_DB - FLOOR_DB);
}

export const Strip = forwardRef<
  StripHandle,
  {
    height?: number;
    /** How many columns fit before the strip starts scrolling. */
    capacity?: number;
    initial?: { columns: StripColumn[]; markers: StripMarker[] };
    /** Shown under the most recent tick. */
    showLastLine?: boolean;
    label?: string;
  }
>(function Strip(
  { height = 96, capacity = 900, initial, showLastLine = true, label },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const columns = useRef<StripColumn[]>(initial?.columns ?? []);
  const markers = useRef<StripMarker[]>(initial?.markers ?? []);
  const dirty = useRef(true);
  const lineEl = useRef<HTMLParagraphElement | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth;
    const cssH = height;

    if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = COLOURS.ink;
    ctx.fillRect(0, 0, cssW, cssH);

    const cols = columns.current;
    const visible = Math.min(cols.length, Math.floor(cssW));
    const start = cols.length - visible;
    const baseline = cssH - 18;

    // Baseline. Barely there, but it anchors the quiet.
    ctx.fillStyle = COLOURS.line;
    ctx.fillRect(0, baseline, cssW, 1);

    for (let i = 0; i < visible; i++) {
      const col = cols[start + i];
      const x = i;
      const h = Math.max(1, col.level * (baseline - 8));

      if (col.mode === 0) {
        ctx.fillStyle = COLOURS.lineBright;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(x, baseline - Math.min(h, 2), 1, Math.min(h, 2));
        ctx.globalAlpha = 1;
        continue;
      }

      ctx.fillStyle =
        col.mode === 1 ? COLOURS.clay : col.mode === 2 ? COLOURS.moss : COLOURS.dim;
      // Cooldown is drawn faded so you can see Stay deliberately holding back.
      ctx.globalAlpha = col.mode === 3 ? 0.4 : 0.9;
      ctx.fillRect(x, baseline - h, 1, h);
      ctx.globalAlpha = 1;
    }

    // Ticks. The only amber in the application.
    ctx.fillStyle = COLOURS.lamp;
    for (const m of markers.current) {
      const x = m.at - start;
      if (x < 0 || x > cssW) continue;
      ctx.fillRect(x, 6, 1, baseline - 6);
      ctx.fillRect(x - 2, baseline, 5, 3);
    }

    dirty.current = false;
  }, [height]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (dirty.current) draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onResize = () => {
      dirty.current = true;
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [draw]);

  useImperativeHandle(
    ref,
    () => ({
      push(db, mode) {
        columns.current.push({ level: levelFromDb(db), mode });
        if (columns.current.length > capacity) {
          const drop = columns.current.length - capacity;
          columns.current.splice(0, drop);
          markers.current = markers.current
            .map((m) => ({ ...m, at: m.at - drop }))
            .filter((m) => m.at >= 0);
        }
        dirty.current = true;
      },
      mark(line, trigger) {
        markers.current.push({ at: columns.current.length - 1, line, trigger });
        if (lineEl.current) lineEl.current.textContent = line;
        dirty.current = true;
      },
      clear() {
        columns.current = [];
        markers.current = [];
        if (lineEl.current) lineEl.current.textContent = "";
        dirty.current = true;
      },
      snapshot() {
        return {
          columns: [...columns.current],
          markers: [...markers.current],
        };
      },
    }),
    [capacity],
  );

  return (
    <div className="flex flex-col gap-3">
      {label && <span className="label column block">{label}</span>}
      <canvas
        ref={canvasRef}
        style={{ height, width: "100%", display: "block" }}
        role="img"
        aria-label="Session strip: loudness over time, with a mark each time Stay spoke"
      />
      {showLastLine && (
        <div className="column">
          <p ref={lineEl} className="said min-h-[1.4em] text-[20px] text-lamp" />
        </div>
      )}
    </div>
  );
});
