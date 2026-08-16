"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { Button, Notice, Slider } from "@/components/ui";
import { runOffline } from "@/lib/audio/offline";

/**
 * The evidence page.
 *
 * I don't have a dog, so rather than film one dog once and call it proof, the
 * detector is run against recorded clips with the numbers published — and the
 * clips ship with the repository so anyone can re-run this in their own browser.
 *
 * It runs the same worklet the live session uses. Nothing here is a model of
 * the detector; it is the detector.
 */

interface Clip {
  group: "dog" | "control";
  file: string;
  title: string;
  licence: string;
  author: string;
  source: string;
}

interface Row extends Clip {
  detected: boolean;
  firstDetectionSec: number | null;
  peakDb: number;
  peakBandRatio: number;
  durationSec: number;
  failed?: string;
}

export default function TestPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [sensitivity, setSensitivity] = useState(0.5);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setRows([]);
    cancelled.current = false;

    let ctx: AudioContext | null = null;
    try {
      const res = await fetch("/test-audio/manifest.json");
      if (!res.ok) throw new Error("The test clips are missing from this deployment.");
      const clips = (await res.json()) as Clip[];
      setProgress({ done: 0, total: clips.length });

      ctx = new AudioContext();
      if (ctx.state === "suspended") await ctx.resume();

      for (const clip of clips) {
        if (cancelled.current) break;
        try {
          const audioRes = await fetch(clip.file);
          if (!audioRes.ok) throw new Error(`${audioRes.status}`);
          const buffer = await ctx.decodeAudioData(await audioRes.arrayBuffer());
          const result = await runOffline(buffer, sensitivity);
          setRows((prev) => [
            ...prev,
            { ...clip, ...result, durationSec: buffer.duration },
          ]);
        } catch (err) {
          setRows((prev) => [
            ...prev,
            {
              ...clip,
              detected: false,
              firstDetectionSec: null,
              peakDb: -Infinity,
              peakBandRatio: 0,
              durationSec: 0,
              failed: err instanceof Error ? err.message : "could not decode",
            },
          ]);
        }
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The sweep failed to start.");
    } finally {
      void ctx?.close();
      setRunning(false);
    }
  }, [sensitivity]);

  const dogs = rows.filter((r) => r.group === "dog" && !r.failed);
  const controls = rows.filter((r) => r.group === "control" && !r.failed);
  const hits = dogs.filter((r) => r.detected);
  const falsePositives = controls.filter((r) => r.detected);
  const latencies = hits
    .map((r) => r.firstDetectionSec)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  const median = latencies.length
    ? latencies[Math.floor(latencies.length / 2)]
    : null;

  return (
    <main className="flex min-h-dvh flex-col py-8">
      <div className="column flex items-center justify-between">
        <Link href="/" className="label transition-colors hover:text-bone">
          ← Stay
        </Link>
        <span className="label">Detector test</span>
      </div>

      <div className="column mt-16 flex flex-col gap-8">
        <h1 className="display text-[clamp(30px,6vw,44px)]">
          Don&apos;t take my word for it.
        </h1>

        <div className="flex max-w-[62ch] flex-col gap-5 text-[16px] leading-relaxed text-dim">
          <p>
            I don&apos;t own a dog. So instead of filming one dog once and calling that
            proof, Stay&apos;s detector is run against recorded clips — dogs that should
            trigger it, and household noise that shouldn&apos;t — with the results
            published.
          </p>
          <p>
            <span className="text-bone">This runs in your browser, right now.</span> The
            clips ship with the repository and this page drives the same detector a live
            session uses. Change the sensitivity and re-run it if you don&apos;t believe
            the defaults.
          </p>
        </div>

        <div className="flex flex-col gap-6 border border-line bg-ink-raised p-6">
          <Slider
            label="Sensitivity"
            value={sensitivity}
            onChange={setSensitivity}
            format={(v) =>
              `${Math.round(-25 + (1 - v) * -25)} dB gate · ${
                v < 0.34 ? "quiet room" : v < 0.67 ? "default" : "noisy room"
              }`
            }
          />
          <div className="flex flex-wrap items-center gap-4">
            <Button onClick={run} busy={running}>
              {rows.length ? "Run it again" : "Run the sweep"}
            </Button>
            {running && (
              <>
                <span className="mono text-dim">
                  {progress.done} / {progress.total}
                </span>
                <Button
                  kind="quiet"
                  onClick={() => {
                    cancelled.current = true;
                  }}
                >
                  Stop
                </Button>
              </>
            )}
          </div>
        </div>

        {error && (
          <Notice tone="warn">
            <strong>{error}</strong>
          </Notice>
        )}

        {rows.length > 0 && (
          <div className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
            <Stat
              label="Dogs detected"
              value={dogs.length ? `${hits.length}/${dogs.length}` : "—"}
              tone="good"
            />
            <Stat
              label="False positives"
              value={controls.length ? `${falsePositives.length}/${controls.length}` : "—"}
              tone={falsePositives.length ? "warn" : "good"}
            />
            <Stat
              label="Median detection"
              value={median === null ? "—" : `${median.toFixed(1)}s`}
            />
            <Stat label="Clips swept" value={String(rows.length)} />
          </div>
        )}

        {rows.length > 0 && (
          <>
            <ResultTable
              title="Should trigger — dog vocalisation"
              rows={rows.filter((r) => r.group === "dog")}
              expect
            />
            <ResultTable
              title="Should stay quiet — household noise"
              rows={rows.filter((r) => r.group === "control")}
              expect={false}
            />
          </>
        )}

        <section className="mt-8 flex flex-col gap-5 border-t border-line pt-8">
          <span className="label">What this does and doesn&apos;t show</span>
          <div className="flex max-w-[62ch] flex-col gap-4 text-[15px] leading-relaxed text-dim">
            <p>
              These clips are played straight into the audio graph, so there is no room,
              no microphone and no distance in the measurement. Real rooms are harder.
              The sensitivity slider exists because of exactly that.
            </p>
            <p>
              The set is small and it comes from what is freely licensed and
              redistributable, which is a narrower pool than what exists. Every clip and
              its licence is listed in{" "}
              <code className="mono text-bone">public/test-audio/SOURCES.md</code>.
            </p>
            <p>
              <span className="text-bone">
                The threshold was tuned against 12 of these clips, and it scored 5/5 and
                0/7 on them.
              </span>{" "}
              The other 22 arrived afterwards from a different source, and on those it
              gets 5/9 dogs with 4/13 false alarms. The perfect score was overfitting.
              The held-out number is the real one.
            </p>
            <p>
              <span className="text-bone">A television will set it off.</span> One of the
              false alarms is a recording of people talking — human speech is voiced and
              sits inside the same 300–2500 Hz band as a bark, so this detector cannot
              tell a person from a dog. Raising the pitch floor fixes it and costs a
              whining clip, and whining is the sound this app exists for. So it stays.
            </p>
            <p>
              That is where signal processing runs out: it can tell you what shape a
              sound is, never what made it. Past here you need a classifier.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
}) {
  return (
    <div className="flex flex-col gap-2 bg-ink p-5">
      <span className="label">{label}</span>
      <span
        className={`mono text-[22px] ${
          tone === "good" ? "text-moss" : tone === "warn" ? "text-clay" : "text-bone"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function ResultTable({
  title,
  rows,
  expect,
}: {
  title: string;
  rows: Row[];
  expect: boolean;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="label">{title}</h2>
      <div className="overflow-x-auto border border-line">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th className="label p-3 font-normal">Clip</th>
              <th className="label p-3 font-normal">Result</th>
              <th className="label p-3 font-normal">At</th>
              <th className="label p-3 font-normal">Peak</th>
              <th className="label p-3 font-normal">Band</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const correct = r.failed ? null : r.detected === expect;
              return (
                <tr key={r.file} className="border-b border-line/50 last:border-0">
                  <td className="p-3">
                    <a
                      href={r.source}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[13px] underline decoration-line underline-offset-4 hover:text-bone"
                    >
                      {r.title.replace(/\.[a-z0-9]+$/i, "")}
                    </a>
                    <span className="mono block text-[11px] text-dimmer">{r.licence}</span>
                  </td>
                  <td className="mono p-3">
                    {r.failed ? (
                      <span className="text-dimmer">could not decode</span>
                    ) : (
                      <span className={correct ? "text-moss" : "text-clay"}>
                        {r.detected ? "detected" : "quiet"}
                      </span>
                    )}
                  </td>
                  <td className="mono p-3 text-dim">
                    {r.firstDetectionSec === null ? "—" : `${r.firstDetectionSec.toFixed(1)}s`}
                  </td>
                  <td className="mono p-3 text-dim">
                    {Number.isFinite(r.peakDb) ? `${r.peakDb.toFixed(0)} dB` : "—"}
                  </td>
                  <td className="mono p-3 text-dim">
                    {r.peakBandRatio ? r.peakBandRatio.toFixed(2) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
