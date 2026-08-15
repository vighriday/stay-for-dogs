"use client";

import type { StayEvent } from "@/lib/types";

/**
 * The session record. Mono for what was measured, the serif for what was said —
 * the same split the whole application runs on.
 *
 * Newest first, because during a live session the thing you want is the last
 * thing that happened.
 */
export function Timeline({ events }: { events: StayEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col gap-4 border-t border-line pt-8">
        <p className="said text-[20px] text-dim">Nothing has happened yet.</p>
        <p className="max-w-prose text-[13px] text-dim">
          That is the good outcome. Every time your dog gets upset, and everything Stay
          says back, lands here with a timestamp.
        </p>
      </div>
    );
  }

  const ordered = [...events].reverse();

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between border-b border-line pb-3">
        <span className="label">Session log</span>
        <span className="label">{events.length} events</span>
      </div>

      <ol className="flex flex-col" aria-live="polite" aria-relevant="additions">
        {ordered.map((event) => (
          <li
            key={event.id}
            className="grid grid-cols-[64px_1fr] gap-4 border-b border-line/60 py-4 sm:grid-cols-[72px_92px_1fr]"
          >
            <time className="mono text-dim" dateTime={new Date(event.at).toISOString()}>
              {clock(event.at)}
            </time>

            <span className={`mono hidden sm:block ${KIND_COLOUR[event.kind]}`}>
              {KIND_LABEL[event.kind]}
            </span>

            <div className="flex flex-col gap-1">
              <span className={`mono sm:hidden ${KIND_COLOUR[event.kind]}`}>
                {KIND_LABEL[event.kind]}
              </span>

              {event.line && (
                <p className="said text-[18px] text-lamp">&ldquo;{event.line}&rdquo;</p>
              )}

              <span className="mono text-[12px] text-dimmer">{detail(event)}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const KIND_LABEL: Record<StayEvent["kind"], string> = {
  "session-start": "started",
  "session-end": "ended",
  upset: "upset",
  settled: "settled",
  spoke: "spoke",
  held: "held",
};

const KIND_COLOUR: Record<StayEvent["kind"], string> = {
  "session-start": "text-dim",
  "session-end": "text-dim",
  upset: "text-clay",
  settled: "text-moss",
  spoke: "text-lamp",
  held: "text-dim",
};

function detail(e: StayEvent): string {
  const bits: string[] = [];

  if (e.kind === "spoke") {
    bits.push(
      e.trigger === "settled"
        ? "answered the quiet"
        : e.trigger === "ceiling"
          ? "answered anyway — never settled"
          : "asked for by you",
    );
    if (e.fromBank) bits.push("backup line");
  }

  if (e.kind === "held") bits.push("still in cooldown, did not speak");
  if (e.kind === "session-start") bits.push("listening");
  if (e.kind === "session-end") bits.push("microphone released");

  if (typeof e.durationMs === "number") bits.push(`${Math.round(e.durationMs / 1000)}s`);
  if (typeof e.peakDb === "number" && Number.isFinite(e.peakDb)) {
    bits.push(`peak ${e.peakDb.toFixed(0)} dB`);
  }

  return bits.join(" · ");
}

function clock(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
