"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { LIMITS } from "@/lib/types";
import type { BehaviourScores, VocalReading } from "@/lib/types";

/**
 * Session Review.
 *
 * One clip, one reading. There is deliberately no shipped before-and-after:
 * a real comparison needs the same dog in two states, and pairing two
 * unrelated dogs to imply a result would be dishonest. The comparison is
 * something you can run on your own dog — it is not something I can fake here.
 */

interface Sample {
  file: string;
  title: string;
  source: string;
  licence: string;
}

export default function ReviewPage() {
  return (
    <main className="flex min-h-dvh flex-col py-8">
      <div className="column flex items-center justify-between">
        <Link href="/" className="label transition-colors hover:text-bone">
          ← Stay
        </Link>
        <span className="label">Session review</span>
      </div>

      <div className="column mt-16 flex flex-col gap-8">
        <h1 className="display text-[clamp(30px,6vw,44px)]">
          What was your dog actually doing?
        </h1>
        <p className="max-w-[62ch] text-[16px] leading-relaxed text-dim">
          Stay can read a short clip of your dog alone and put structure on what it sees
          and hears. Not a diagnosis — a second pair of eyes, and a starting point for a
          conversation with a vet.
        </p>
      </div>

      <div className="column mt-20 flex flex-col gap-24">
        <VocalSection />
        <VideoSection />
      </div>

      <div className="column mt-24 flex flex-col gap-5 border-t border-line pt-8">
        <span className="label">Why there is no before-and-after here</span>
        <div className="flex max-w-[62ch] flex-col gap-4 text-[15px] leading-relaxed text-dim">
          <p>
            A real comparison needs the same dog, in the same room, before and during. I
            don&apos;t have a dog, and no stock library has a matched pair — so putting
            two unrelated dogs side by side and calling it a result would be a lie.
          </p>
          <p>
            <span className="text-bone">You can run that comparison.</span> Record your
            dog alone before you start using Stay, record it again during a session, and
            score both here. That&apos;s the honest version of this feature, and it
            belongs to you rather than to me.
          </p>
        </div>
      </div>
    </main>
  );
}

/* ── Vocalisation, from audio ──────────────────────────────── */

function VocalSection() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [reading, setReading] = useState<VocalReading | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/test-audio/manifest.json");
        if (!res.ok) return;
        const all = (await res.json()) as (Sample & { group: string })[];
        setSamples(all.filter((s) => s.group === "dog").slice(0, 4));
      } catch {
        /* the upload path still works without samples */
      }
    })();
  }, []);

  const classify = useCallback(async (blob: Blob, label: string) => {
    setBusy(true);
    setError(null);
    setReading(null);
    setCurrent(label);
    try {
      const form = new FormData();
      form.append("clip", blob, "clip");
      const res = await fetch("/api/gemini/vocal", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string; hint?: string };
        } | null;
        setError(
          [body?.error?.message, body?.error?.hint].filter(Boolean).join(" ") ||
            "That clip couldn't be read.",
        );
        return;
      }
      const data = (await res.json()) as { reading: VocalReading };
      setReading(data.reading);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  const runSample = async (s: Sample) => {
    try {
      const res = await fetch(s.file);
      const blob = await res.blob();
      if (audio.current) {
        audio.current.src = s.file;
        void audio.current.play().catch(() => {});
      }
      await classify(blob, s.title);
    } catch {
      setError("That sample couldn't be loaded.");
    }
  };

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <span className="label">From audio</span>
        <h2 className="display text-[26px]">What kind of noise was that?</h2>
        <p className="max-w-[58ch] text-dim">
          Not all barking means the same thing. Whining and howling are distress. A short
          burst of sharp barks usually means something walked past the window. Gemini
          listens and tells the two apart.
        </p>
      </div>

      {samples.length > 0 && (
        <div className="flex flex-col gap-3">
          <span className="label">Try one of the test clips</span>
          <div className="flex flex-wrap gap-2">
            {samples.map((s) => (
              <button
                key={s.file}
                type="button"
                disabled={busy}
                onClick={() => void runSample(s)}
                className="rounded-xs border border-line px-3 py-2 text-[13px] text-dim transition-colors hover:border-line-bright hover:text-bone disabled:opacity-40"
              >
                {s.title.replace(/\.[a-z0-9]+$/i, "").slice(0, 34)}
              </button>
            ))}
          </div>
        </div>
      )}

      <audio ref={audio} className="hidden" />

      <div className="flex flex-wrap items-center gap-4">
        <input
          ref={input}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > LIMITS.maxAudioClipBytes) {
              setError(
                `That file is ${(f.size / 1024 / 1024).toFixed(1)} MB. The limit is 3 MB.`,
              );
              return;
            }
            void classify(f, f.name);
          }}
        />
        <Button kind="secondary" onClick={() => input.current?.click()} busy={busy}>
          Upload your own clip
        </Button>
        <span className="text-[13px] text-dim">Up to 30 seconds, 3 MB.</span>
      </div>

      {error && (
        <Notice tone="warn">
          <strong>{error}</strong>
        </Notice>
      )}

      {reading && (
        <div className="flex flex-col gap-5 border border-line bg-ink-raised p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <span className="label">{current}</span>
            <span className="mono text-dim">
              {Math.round(reading.confidence * 100)}% confident
            </span>
          </div>
          <p className={`display text-[30px] ${VOCAL_TONE[reading.kind]}`}>
            {VOCAL_LABEL[reading.kind]}
          </p>
          <p className="max-w-[54ch] text-[15px] leading-relaxed text-dim">
            {reading.note}
          </p>
          <p className="border-t border-line pt-4 text-[13px] text-dimmer">
            {VOCAL_MEANING[reading.kind]}
          </p>
        </div>
      )}
    </section>
  );
}

const VOCAL_LABEL: Record<VocalReading["kind"], string> = {
  whine: "Whining",
  "separation-bark": "Separation barking",
  "alert-bark": "Alert barking",
  howl: "Howling",
  other: "No clear dog vocalisation",
};

const VOCAL_TONE: Record<VocalReading["kind"], string> = {
  whine: "text-clay",
  "separation-bark": "text-clay",
  "alert-bark": "text-bone",
  howl: "text-clay",
  other: "text-dim",
};

const VOCAL_MEANING: Record<VocalReading["kind"], string> = {
  whine: "Distress or seeking contact. This is the kind Stay is built for.",
  "separation-bark":
    "Repetitive and untriggered, the pattern associated with being left alone.",
  "alert-bark":
    "A reaction to something outside. Usually passes on its own and needs nothing from you.",
  howl: "Long and tonal. Often a contact call rather than alarm.",
  other: "Mostly background noise, or too unclear to call.",
};

/* ── Behaviour, from video ─────────────────────────────────── */

function VideoSection() {
  const [scores, setScores] = useState<BehaviourScores | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const score = async (file: File) => {
    if (file.size > LIMITS.maxClipBytes) {
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 4 MB.`);
      return;
    }
    setBusy(true);
    setError(null);
    setScores(null);
    setName(file.name);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));

    try {
      const form = new FormData();
      form.append("clip", file, file.name);
      const res = await fetch("/api/gemini/score", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string; hint?: string };
        } | null;
        setError(
          [body?.error?.message, body?.error?.hint].filter(Boolean).join(" ") ||
            "That clip couldn't be scored.",
        );
        return;
      }
      const data = (await res.json()) as { scores: BehaviourScores };
      setScores(data.scores);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <span className="label">From video</span>
        <h2 className="display text-[26px]">A read on the whole clip</h2>
        <p className="max-w-[58ch] text-dim">
          Upload up to a minute of your dog alone in a room. Gemini reports how much of
          the clip it spent pacing, how often it went to the door, how many times it
          vocalised, and how long it took to lie down and stay down.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <input
          ref={input}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void score(f);
          }}
        />
        <Button onClick={() => input.current?.click()} busy={busy}>
          Choose a clip
        </Button>
        <span className="text-[13px] text-dim">
          Up to {LIMITS.maxClipSeconds} seconds, 4 MB — about half a minute of phone
          video. MP4, WebM or MOV.
        </span>
      </div>

      <Notice>
        No sample video ships with Stay. Freely licensed footage of a dog actually alone
        in a room is scarce, and I would rather hand you an empty box than something
        borrowed under an unclear licence.
      </Notice>

      {error && (
        <Notice tone="warn">
          <strong>{error}</strong>
        </Notice>
      )}

      {preview && (
        <video
          src={preview}
          controls
          playsInline
          className="w-full border border-line bg-ink-well"
        />
      )}

      {scores && (
        <div className="flex flex-col gap-6 border border-line bg-ink-raised p-6">
          <span className="label">{name}</span>

          <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
            <Metric
              label="Pacing"
              value={`${Math.round(scores.pacingPercent)}%`}
              note="of the clip"
            />
            <Metric
              label="Door checks"
              value={String(scores.doorFixations)}
              note="times"
            />
            <Metric label="Vocal events" value={String(scores.vocalEvents)} note="bursts" />
            <Metric
              label="Time to settle"
              value={
                scores.settleLatencySec === null
                  ? "never"
                  : `${Math.round(scores.settleLatencySec)}s`
              }
              note={scores.settleLatencySec === null ? "in this clip" : "to lie down"}
            />
          </div>

          <p className="said text-[19px] text-bone">{scores.notes}</p>

          <p className="border-t border-line pt-4 text-[13px] text-dim">
            These scores come from a general-purpose vision model watching a short clip.
            Treat them as a structured second opinion, not a measurement.
          </p>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1.5 bg-ink-raised p-4">
      <span className="label">{label}</span>
      <span className="mono text-[22px] text-bone">{value}</span>
      <span className="mono text-[11px] text-dimmer">{note}</span>
    </div>
  );
}
