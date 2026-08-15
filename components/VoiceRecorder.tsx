"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { LIMITS } from "@/lib/types";

/**
 * The paid-plan path: record a sample in the browser and clone it directly.
 *
 * Sixty seconds is the floor, but three minutes is what actually sounds like
 * you — so the meter is scaled to three minutes and the button stays honest
 * about which side of that line you're on.
 */

const SCRIPT = [
  "It's a quiet afternoon and there's nothing much happening. The kettle is on, and the light is coming through the window at that low angle it gets late in the day.",
  "I've been meaning to sort out the cupboard for weeks now. Every time I open it something falls out, and every time I tell myself I'll deal with it tomorrow.",
  "There's a particular kind of silence a house has when everyone else is out. Not empty exactly. Just waiting.",
  "Good morning. Good afternoon. Good evening. Easy now. Steady. That's it. Settle down. You're alright. Nothing to worry about here at all.",
  "The train was late again, which I should have expected, and by the time I got in the rain had stopped completely. Typical.",
];

export function VoiceRecorder({
  elKey,
  onCloned,
  onError,
}: {
  elKey: string;
  onCloned: (voiceId: string) => void;
  onError: (e: { message: string; hint?: string }) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [level, setLevel] = useState(0);
  const [uploading, setUploading] = useState(false);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const teardown = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (ticker.current) clearInterval(ticker.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      });
      stream.current = s;

      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(s);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);

      const meter = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        raf.current = requestAnimationFrame(meter);
      };
      meter();

      chunks.current = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(s, { mimeType: mime, audioBitsPerSecond: 128_000 });
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        setBlob(new Blob(chunks.current, { type: mime }));
        void ctx.close();
        teardown();
      };
      rec.start(1000);
      recorder.current = rec;

      setBlob(null);
      setSeconds(0);
      setRecording(true);
      ticker.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      onError({
        message: "Stay couldn't reach your microphone.",
        hint: "Allow microphone access in your browser, then try again.",
      });
    }
  };

  const stop = () => {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
    setLevel(0);
    if (ticker.current) clearInterval(ticker.current);
  };

  const upload = async () => {
    if (!blob) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("sample", blob, "sample.webm");
      form.append("name", "Stay");

      const res = await fetch("/api/el/clone", {
        method: "POST",
        headers: { "x-el-key": elKey },
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string; hint?: string };
        } | null;
        onError({
          message: body?.error?.message ?? "Cloning failed.",
          hint: body?.error?.hint,
        });
        return;
      }
      const { voiceId } = (await res.json()) as { voiceId: string };
      onCloned(voiceId);
    } catch {
      onError({ message: "Couldn't reach ElevenLabs.", hint: "Try again in a moment." });
    } finally {
      setUploading(false);
    }
  };

  const enough = seconds >= LIMITS.minSampleSeconds;
  const good = seconds >= LIMITS.targetSampleSeconds;
  const progress = Math.min(1, seconds / LIMITS.targetSampleSeconds);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 border border-line bg-ink-raised p-5">
        <span className="label">Read this out, in your normal voice</span>
        <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-bone/90">
          {SCRIPT.map((para) => (
            <p key={para.slice(0, 24)}>{para}</p>
          ))}
        </div>
        <p className="text-[13px] text-dim">
          Quiet room, no fan or air conditioning, phone or laptop close. Three minutes
          sounds far more like you than one.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <span className="label">
            {recording ? "Recording" : blob ? "Recorded" : "Not started"}
          </span>
          <span className="mono text-dim">
            {String(Math.floor(seconds / 60)).padStart(2, "0")}:
            {String(seconds % 60).padStart(2, "0")} / 03:00
          </span>
        </div>

        <div className="h-px w-full bg-line">
          <div
            className={`h-px transition-[width] duration-500 ${good ? "bg-moss" : enough ? "bg-bone" : "bg-dim"}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {recording && (
          <div className="flex h-6 items-end gap-[2px]" aria-hidden>
            {Array.from({ length: 48 }).map((_, i) => (
              <span
                key={i}
                className="w-[3px] bg-dim"
                style={{
                  height: `${Math.max(2, level * 24 * (0.4 + Math.abs(Math.sin(i * 0.7)) * 0.6))}px`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {blob && !enough && (
        <Notice tone="warn">
          That&apos;s {seconds} seconds. Cloning needs at least a minute, and three gets a
          noticeably better result. Record again.
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-4">
        {!recording && (
          <Button kind={blob ? "secondary" : "primary"} onClick={start}>
            {blob ? "Record again" : "Start recording"}
          </Button>
        )}
        {recording && (
          <Button kind="secondary" onClick={stop}>
            Stop
          </Button>
        )}
        {blob && enough && (
          <Button onClick={upload} busy={uploading}>
            Clone this voice
          </Button>
        )}
      </div>
    </div>
  );
}
