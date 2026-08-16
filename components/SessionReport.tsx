"use client";

import { useCallback, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { summariseSession } from "@/lib/sessionStats";
import type { SessionReading, StayEvent } from "@/lib/types";

/**
 * The closing summary.
 *
 * Stay spends a session producing a behavioural record of a dog that was
 * alone — when it got upset, how long for, how loud, how the episodes
 * compared. That record is the thing an owner actually wants and cannot get
 * from a camera, and it is unreadable as a list of timestamps.
 *
 * So the numbers are measured in code and Gemini is given only the job of
 * saying them to a worried person. The mono column is what was measured; the
 * serif is what was said about it — the same split the whole application runs
 * on, applied one last time at the end.
 *
 * It runs on Stay's shared Gemini key, which means demo mode gets this too,
 * with no key of any kind.
 */
export function SessionReport({
  events,
  dogName,
  geminiKey,
}: {
  events: StayEvent[];
  dogName: string;
  geminiKey?: string;
}) {
  const [reading, setReading] = useState<SessionReading | null>(null);
  const [facts, setFacts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stats = summariseSession(events);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (geminiKey) headers["x-gemini-key"] = geminiKey;

      const res = await fetch("/api/gemini/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ stats, dogName }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string; hint?: string };
        } | null;
        setError(
          [body?.error?.message, body?.error?.hint].filter(Boolean).join(" ") ||
            "That session couldn't be read.",
        );
        return;
      }
      const data = (await res.json()) as { reading: SessionReading; facts?: string[] };
      setReading(data.reading);
      setFacts(data.facts ?? []);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [stats, dogName, geminiKey]);

  if (stats.episodes === 0) return null;

  const shortest = Math.min(...stats.episodeSeconds);
  const longest = Math.max(...stats.episodeSeconds);

  return (
    <section className="flex flex-col gap-6 border-t border-line pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="label">What that session contained</span>
        <span className="mono text-[11px] text-dimmer">measured, not inferred</span>
      </div>

      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
        <Cell label="Upsets" value={String(stats.episodes)} note="episodes" />
        <Cell label="Stay spoke" value={String(stats.responses)} note="times" />
        <Cell
          label="Episode length"
          value={
            stats.episodeSeconds.length === 1
              ? `${longest}s`
              : `${shortest}–${longest}s`
          }
          note="shortest to longest"
        />
        <Cell
          label="Longest quiet"
          value={`${stats.longestQuietMinutes}m`}
          note="unbroken"
        />
      </div>

      {stats.episodeSeconds.length > 1 && (
        <EpisodeBars seconds={stats.episodeSeconds} />
      )}

      {!reading && !error && (
        <div className="flex flex-col gap-3">
          <p className="max-w-[62ch] text-[15px] leading-relaxed text-dim">
            Those are the numbers. Gemini turns them into something a worried person can
            actually read — and it never sees a single figure above, only plain statements
            worked out from them in code. It can say what happened. It has nothing to
            invent from.
          </p>
          <div>
            <Button onClick={run} busy={busy}>
              Read this session back to me
            </Button>
          </div>
        </div>
      )}

      {error && (
        <Notice tone="warn">
          <strong>{error}</strong>
        </Notice>
      )}

      {reading && (
        <div className="flex flex-col gap-5 border border-line bg-ink-raised p-6">
          <p className="said text-[24px] text-bone">{reading.headline}</p>
          <p className="max-w-[58ch] text-[15px] leading-relaxed text-dim">
            {reading.reading}
          </p>

          <div className="flex flex-col gap-4 border-t border-line pt-5">
            <Line label="Worth knowing" text={reading.observation} />
            <Line label="Next time, notice" text={reading.watchFor} />
          </div>

          {facts.length > 0 && (
            <details className="border-t border-line pt-4">
              <summary className="cursor-pointer text-[13px] text-dim hover:text-bone">
                Everything Gemini was given
              </summary>
              <div className="mt-4 flex flex-col gap-3">
                <ul className="flex flex-col gap-1.5">
                  {facts.map((f) => (
                    <li key={f} className="mono text-[12px] leading-relaxed text-dim">
                      {f}
                    </li>
                  ))}
                </ul>
                <p className="max-w-[58ch] text-[13px] leading-relaxed text-dimmer">
                  That is the whole input — no timings, no loudness figures, no session
                  log. Those sentences were worked out from the timestamps in code, and
                  the model was asked only to join them up.{" "}
                  {stats.episodes < 3
                    ? "With fewer than three upsets it is told outright that no direction may be described, and that decision is made on the server rather than left to the prompt."
                    : "It cannot report a trend that was not established before it saw anything, because a number it could misread never reaches it."}
                </p>
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function Cell({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1.5 bg-ink p-4">
      <span className="label">{label}</span>
      <span className="mono text-[22px] text-bone">{value}</span>
      <span className="mono text-[11px] text-dimmer">{note}</span>
    </div>
  );
}

/**
 * Each episode as a bar, in order. The question an owner has is "are these
 * getting shorter?", and a row of bars answers it faster than a sentence can.
 */
function EpisodeBars({ seconds }: { seconds: number[] }) {
  const max = Math.max(...seconds, 1);
  return (
    <div className="flex flex-col gap-3">
      <span className="label">Each upset, in order</span>
      <div className="flex items-end gap-2" role="img" aria-label={`Episode lengths in seconds, in order: ${seconds.join(", ")}`}>
        {seconds.map((s, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-2">
            <div
              className="w-full bg-clay/70"
              style={{ height: `${Math.max(4, (s / max) * 64)}px` }}
            />
            <span className="mono text-[11px] text-dimmer">{s}s</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Line({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      <p className="max-w-[58ch] text-[15px] leading-relaxed text-bone/90">{text}</p>
    </div>
  );
}
