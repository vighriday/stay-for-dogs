"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Notice, Slider, Toast } from "@/components/ui";
import { Strip, type StripHandle } from "@/components/Strip";
import { Timeline } from "@/components/Timeline";
import { useSession, useStay } from "@/lib/store";
import { MicrophoneDenied, startListening, type ListenerHandle } from "@/lib/audio/graph";
import { VoiceEngine } from "@/lib/audio/voice";

type Phase = "idle" | "priming" | "live" | "ended";
type DogState = "quiet" | "upset" | "settling" | "holding";

const MODE: Record<DogState, 0 | 1 | 2 | 3> = {
  quiet: 0,
  upset: 1,
  settling: 2,
  holding: 3,
};

export default function SessionPage() {
  const router = useRouter();
  const { elKey, geminiKey, voiceId, voiceName, profile, sensitivity, setSensitivity } =
    useStay();
  const session = useSession();

  const [phase, setPhase] = useState<Phase>("idle");
  const [dogState, setDogState] = useState<DogState>("quiet");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [degraded, setDegraded] = useState<string | null>(null);
  const [fatal, setFatal] = useState<{ message: string; hint?: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const strip = useRef<StripHandle | null>(null);
  const listener = useRef<ListenerHandle | null>(null);
  const engine = useRef<VoiceEngine | null>(null);
  const dogStateRef = useRef<DogState>("quiet");
  const speaking = useRef(false);

  const ready = Boolean(elKey && voiceId && profile?.name);

  const setDog = useCallback((s: DogState) => {
    dogStateRef.current = s;
    setDogState(s);
  }, []);

  /* Everything is torn down together — the microphone, the wake lock,
     the audio graph and any half-spoken line. */
  const teardown = useCallback(async () => {
    engine.current?.dispose();
    engine.current = null;
    await listener.current?.stop();
    listener.current = null;
  }, []);

  useEffect(() => {
    return () => {
      void teardown();
    };
  }, [teardown]);

  useEffect(() => {
    if (phase !== "live" || !session.startedAt) return;
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - session.startedAt!) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [phase, session.startedAt]);

  const speak = useCallback(
    async (trigger: "settled" | "ceiling" | "manual") => {
      const e = engine.current;
      if (!e || speaking.current) return;
      speaking.current = true;
      try {
        const line = await e.speak(trigger === "ceiling" ? "reassure" : "settle");
        strip.current?.mark(line.text, trigger);
        session.push({
          kind: "spoke",
          line: line.text,
          trigger,
          fromBank: line.fromBank,
        });
        setDog("holding");
      } finally {
        speaking.current = false;
      }
    },
    [session, setDog],
  );

  const begin = useCallback(async () => {
    if (!profile) return;
    setPhase("priming");
    setFatal(null);
    setDegraded(null);
    strip.current?.clear();
    session.clear();

    const context = new AudioContext({ latencyHint: "interactive" });
    if (context.state === "suspended") await context.resume();

    const voice = new VoiceEngine({
      context,
      elKey,
      voiceId,
      profile,
      geminiKey: geminiKey || undefined,
      onSpeakingChange: (v) => listener.current?.setSpeaking(v),
      onDegraded: setDegraded,
    });
    engine.current = voice;

    try {
      await voice.prime((done, total) => setProgress({ done, total }));
    } catch (err) {
      await teardown();
      void context.close();
      setPhase("idle");
      setFatal({
        message: err instanceof Error ? err.message : "Stay couldn't prepare your voice.",
        hint: "Check the voice still exists in ElevenLabs and that you have credits left.",
      });
      return;
    }

    try {
      listener.current = await startListening(
        (frame) => {
          strip.current?.push(
            frame.db,
            frame.deaf ? MODE.holding : MODE[dogStateRef.current],
          );
        },
        (event) => {
          switch (event.type) {
            case "upset":
              setDog("upset");
              session.push({ kind: "upset", peakDb: event.peakDb });
              break;
            case "settling":
              setDog("settling");
              break;
            case "speak":
              void speak(event.trigger);
              break;
            case "episode-end":
              setDog("quiet");
              session.push({
                kind: "settled",
                peakDb: event.peakDb,
                durationMs: event.durationMs,
              });
              break;
            case "held":
              session.push({ kind: "held", peakDb: event.peakDb });
              break;
          }
        },
        sensitivity,
      );
    } catch (err) {
      await teardown();
      void context.close();
      setPhase("idle");
      if (err instanceof MicrophoneDenied) {
        setFatal(MIC_MESSAGE[err.reason]);
      } else {
        setFatal({ message: "Stay couldn't start listening." });
      }
      return;
    }

    session.begin();
    setDog("quiet");
    setPhase("live");
  }, [profile, elKey, voiceId, geminiKey, sensitivity, session, speak, setDog, teardown]);

  const end = useCallback(async () => {
    await teardown();
    session.end();
    setPhase("ended");
    setDog("quiet");
  }, [teardown, session, setDog]);

  if (!ready) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <div className="column flex max-w-md flex-col gap-6 text-center">
          <h1 className="display text-[32px]">Stay needs setting up first.</h1>
          <p className="text-dim">
            A voice and your dog&apos;s name, and it&apos;s ready. Takes about five minutes.
          </p>
          <div className="flex justify-center gap-4">
            <Button onClick={() => router.push("/setup")}>Set Stay up</Button>
            <Button kind="secondary" onClick={() => router.push("/demo")}>
              Try the demo
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col py-8">
      <div className="column flex items-center justify-between">
        {phase === "live" ? (
          <button onClick={end} className="label transition-colors hover:text-bone">
            ← End session
          </button>
        ) : (
          <Link href="/" className="label transition-colors hover:text-bone">
            ← Stay
          </Link>
        )}

        <div className="flex items-center gap-5">
          {phase === "live" && (
            <>
              <span className="mono text-dim">{formatClock(elapsed)}</span>
              <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.09em] text-dim">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-moss" aria-hidden />
                live
              </span>
            </>
          )}
        </div>
      </div>

      <div className="column mt-16 mb-10 flex flex-col gap-6">
        <h1
          className={`display text-[clamp(30px,6vw,48px)] ${STATE_COLOUR[dogState]}`}
          aria-live="polite"
        >
          {stateLine(phase, dogState, profile!.name, progress)}
        </h1>

        {fatal && (
          <Notice tone="warn">
            <strong>{fatal.message}</strong>
            {fatal.hint && <> {fatal.hint}</>}
          </Notice>
        )}

        {degraded && phase === "live" && (
          <Notice tone="warn">
            Gemini is unavailable, so Stay is using its backup lines. The session carries
            on exactly as normal.
          </Notice>
        )}
      </div>

      <div className="bleed">
        <Strip ref={strip} height={96} />
      </div>

      <div className="column mt-12 flex flex-1 flex-col gap-10">
        {phase === "idle" && (
          <div className="flex flex-col gap-6">
            <p className="max-w-prose text-dim">
              Stay will listen through this device&apos;s microphone. When{" "}
              {profile!.name} gets upset it waits for a pause, then speaks in{" "}
              <span className="text-bone">{voiceName || "your voice"}</span>. Leave this
              tab open and the screen on.
            </p>
            <Notice>
              The microphone audio never leaves this browser. Stay measures how loud it is
              and which frequencies are in it — nothing is recorded, stored or uploaded.
            </Notice>
            <div className="flex flex-wrap items-center gap-4">
              <Button onClick={begin}>Start listening</Button>
              <Link
                href="/setup"
                className="text-[13px] text-dim underline underline-offset-4 hover:text-bone"
              >
                Change voice or dog
              </Link>
            </div>
          </div>
        )}

        {phase === "priming" && (
          <div className="flex flex-col gap-4">
            <div className="h-px w-full bg-line">
              <div
                className="h-px bg-bone transition-[width] duration-300"
                style={{
                  width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="mono text-dim">
              rendering {progress.done} of {progress.total} lines
            </p>
            <p className="max-w-prose text-[13px] text-dim">
              Stay writes and records every line before the session starts, so when{" "}
              {profile!.name} settles the answer is instant instead of four seconds late.
            </p>
          </div>
        )}

        {(phase === "live" || phase === "ended") && (
          <>
            <Timeline events={session.events} />

            {phase === "live" && (
              <div className="flex flex-col gap-8 border-t border-line pt-8">
                <Slider
                  label="Sensitivity"
                  value={sensitivity}
                  onChange={(v) => {
                    setSensitivity(v);
                    listener.current?.setSensitivity(v);
                  }}
                  format={(v) =>
                    `${Math.round(-25 + (1 - v) * -25)} dB · ${
                      v < 0.34 ? "quiet room" : v < 0.67 ? "normal" : "noisy room"
                    }`
                  }
                />
                <div className="flex flex-wrap items-center gap-4">
                  <Button
                    kind="secondary"
                    onClick={() => {
                      void speak("manual");
                      listener.current?.markSpoke();
                      setToast("Stay said something now, without waiting.");
                    }}
                  >
                    Say something now
                  </Button>
                  <Button kind="quiet" onClick={end}>
                    End session
                  </Button>
                </div>
              </div>
            )}

            {phase === "ended" && (
              <div className="flex flex-wrap items-center gap-4 border-t border-line pt-8">
                <Button onClick={begin}>Start another session</Button>
                <Link
                  href="/review"
                  className="text-[13px] text-dim underline underline-offset-4 hover:text-bone"
                >
                  Score a clip of your dog →
                </Link>
              </div>
            )}
          </>
        )}
      </div>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </main>
  );
}

const STATE_COLOUR: Record<DogState, string> = {
  quiet: "text-bone",
  upset: "text-clay",
  settling: "text-moss",
  holding: "text-dim",
};

const MIC_MESSAGE: Record<string, { message: string; hint?: string }> = {
  denied: {
    message: "Stay needs the microphone to hear your dog.",
    hint: "Allow microphone access for this site in your browser's address bar, then start again.",
  },
  missing: {
    message: "No microphone found on this device.",
    hint: "Plug one in, or try the demo — it needs no microphone at all.",
  },
  insecure: {
    message: "Browsers only allow microphone access over HTTPS.",
    hint: "Open Stay on its https address.",
  },
  unknown: {
    message: "Stay couldn't open the microphone.",
    hint: "Close any other tab or app that might be using it, then try again.",
  },
};

function stateLine(
  phase: Phase,
  dog: DogState,
  name: string,
  progress: { done: number; total: number },
): string {
  if (phase === "idle") return `Ready when you are.`;
  if (phase === "priming") {
    return progress.total && progress.done < progress.total
      ? "Getting your voice ready."
      : "Almost there.";
  }
  if (phase === "ended") return "Session ended.";

  switch (dog) {
    case "upset":
      return `${name} is upset.`;
    case "settling":
      return `${name} is settling.`;
    case "holding":
      return "Waiting before speaking again.";
    default:
      return "Stay is listening.";
  }
}

function formatClock(total: number) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
