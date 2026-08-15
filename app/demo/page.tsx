"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { Strip, type StripHandle } from "@/components/Strip";
import { Timeline } from "@/components/Timeline";
import { playThrough, type PlayThroughHandle } from "@/lib/audio/offline";
import { PrerenderedVoiceEngine } from "@/lib/audio/voice";
import type { StayEvent } from "@/lib/types";

/**
 * Demo mode.
 *
 * Not a mock-up and not a scripted animation. A recording of a distressed dog
 * is played through the same detector a live session uses, and the answer comes
 * out of the same state machine — it just comes from audio rendered ahead of
 * time instead of ElevenLabs, so this page needs no key, no microphone and no
 * network beyond the static files.
 */

type Phase = "idle" | "loading" | "ready" | "running" | "done" | "failed";
type DogState = "quiet" | "upset" | "settling" | "holding";

const MODE: Record<DogState, 0 | 1 | 2 | 3> = {
  quiet: 0,
  upset: 1,
  settling: 2,
  holding: 3,
};

const DOG_CLIP = "/test-audio/dog/perro-hembra-ladrando.mp3";
const DOG_NAME = "Biscuit";

let seq = 0;

export default function DemoPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [dogState, setDogState] = useState<DogState>("quiet");
  const [events, setEvents] = useState<StayEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState({ done: 0, total: 0 });

  const strip = useRef<StripHandle | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const engine = useRef<PrerenderedVoiceEngine | null>(null);
  const clip = useRef<AudioBuffer | null>(null);
  const play = useRef<PlayThroughHandle | null>(null);
  const dogStateRef = useRef<DogState>("quiet");
  const speaking = useRef(false);

  const log = useCallback((e: Omit<StayEvent, "id" | "at">) => {
    setEvents((prev) => [...prev, { id: `d${++seq}`, at: Date.now(), ...e } as StayEvent]);
  }, []);

  const setDog = useCallback((s: DogState) => {
    dogStateRef.current = s;
    setDogState(s);
  }, []);

  /* Everything loads on the first click, because a browser will not let a page
     create an AudioContext until someone has interacted with it. */
  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const context = new AudioContext({ latencyHint: "interactive" });
      if (context.state === "suspended") await context.resume();
      ctx.current = context;

      const manifestRes = await fetch("/demo/manifest.json");
      if (!manifestRes.ok) throw new Error("Demo audio is missing from this deployment.");
      const manifest = (await manifestRes.json()) as { text: string; file: string }[];

      const voice = new PrerenderedVoiceEngine(context, (v) => {
        play.current?.setSpeaking(v);
      });
      await voice.prime(manifest, (done, total) => setLoaded({ done, total }));
      engine.current = voice;

      const clipRes = await fetch(DOG_CLIP);
      if (!clipRes.ok) throw new Error("The demo recording is missing.");
      clip.current = await context.decodeAudioData(await clipRes.arrayBuffer());

      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo mode failed to load.");
      setPhase("failed");
    }
  }, []);

  const speak = useCallback(
    async (trigger: "settled" | "ceiling") => {
      const voice = engine.current;
      if (!voice || speaking.current) return;
      speaking.current = true;
      try {
        const line = await voice.speak();
        strip.current?.mark(line.text, trigger);
        log({ kind: "spoke", line: line.text, trigger });
        setDog("holding");
      } finally {
        speaking.current = false;
      }
    },
    [log, setDog],
  );

  const run = useCallback(async () => {
    const context = ctx.current;
    const buffer = clip.current;
    if (!context || !buffer) return;

    setEvents([]);
    strip.current?.clear();
    setDog("quiet");
    setPhase("running");
    log({ kind: "session-start" });

    const handle = await playThrough(
      context,
      buffer,
      0.5,
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
            log({ kind: "upset", peakDb: event.peakDb });
            break;
          case "settling":
            setDog("settling");
            break;
          case "speak":
            void speak(event.trigger);
            break;
          case "episode-end":
            setDog("quiet");
            log({
              kind: "settled",
              peakDb: event.peakDb,
              durationMs: event.durationMs,
            });
            break;
          case "held":
            log({ kind: "held", peakDb: event.peakDb });
            break;
        }
      },
    );
    play.current = handle;

    await handle.done;
    // Let a response that started near the end of the clip finish speaking.
    await new Promise((r) => setTimeout(r, 1200));
    log({ kind: "session-end" });
    setDog("quiet");
    setPhase("done");
  }, [log, setDog, speak]);

  useEffect(() => {
    return () => {
      play.current?.stop();
      engine.current?.dispose();
      void ctx.current?.close();
    };
  }, []);

  return (
    <main className="flex min-h-dvh flex-col py-8">
      <div className="column flex items-center justify-between">
        <Link href="/" className="label transition-colors hover:text-bone">
          ← Stay
        </Link>
        <span className="label">Demo · no key, no microphone</span>
      </div>

      <div className="column mt-16 mb-10 flex flex-col gap-6">
        <h1
          className={`display text-[clamp(30px,6vw,48px)] ${STATE_COLOUR[dogState]}`}
          aria-live="polite"
        >
          {headline(phase, dogState, loaded)}
        </h1>

        {phase === "failed" && error && (
          <Notice tone="warn">
            <strong>{error}</strong> Everything else on Stay still works — this page needs
            its audio files to be present.
          </Notice>
        )}
      </div>

      <div className="bleed">
        <Strip ref={strip} height={96} />
      </div>

      <div className="column mt-12 flex flex-1 flex-col gap-10">
        {(phase === "idle" || phase === "loading" || phase === "ready") && (
          <div className="flex flex-col gap-6">
            <p className="max-w-prose text-dim">
              This plays a real recording of a barking dog through the same detector a live
              session uses. Nothing here is faked or on a timer — the strip is drawn from
              the actual signal, and the response is released by the same rule that runs
              when a microphone is listening.
            </p>

            <Notice>
              Watch for the gap. Stay does <strong>not</strong> answer while the dog is
              barking. It waits until the barking stops, then speaks into the quiet —
              answering a bark would teach a dog that barking works.
            </Notice>

            <p className="text-[13px] text-dim">
              Sound on. The voice you&apos;ll hear was made with ElevenLabs Voice Design;
              in a real session it&apos;s your own.
            </p>

            {phase === "loading" && loaded.total > 0 && (
              <p className="mono text-dim">
                loading {loaded.done} of {loaded.total} lines
              </p>
            )}

            <div className="flex flex-wrap items-center gap-4">
              {phase === "ready" ? (
                <Button onClick={run}>Play the demo</Button>
              ) : (
                <Button onClick={load} busy={phase === "loading"}>
                  Load the demo
                </Button>
              )}
              <Link
                href="/setup"
                className="text-[13px] text-dim underline underline-offset-4 hover:text-bone"
              >
                Set it up with my own voice →
              </Link>
            </div>
          </div>
        )}

        {phase === "failed" && (
          <Button onClick={load}>Try loading again</Button>
        )}

        {(phase === "running" || phase === "done") && (
          <>
            <Timeline events={events} />
            {phase === "done" && (
              <div className="flex flex-wrap items-center gap-4 border-t border-line pt-8">
                <Button onClick={run}>Play it again</Button>
                <Link
                  href="/setup"
                  className="text-[13px] text-dim underline underline-offset-4 hover:text-bone"
                >
                  Set it up with my own voice →
                </Link>
                <Link
                  href="/test"
                  className="text-[13px] text-dim underline underline-offset-4 hover:text-bone"
                >
                  How often does the detector get it right? →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

const STATE_COLOUR: Record<DogState, string> = {
  quiet: "text-bone",
  upset: "text-clay",
  settling: "text-moss",
  holding: "text-dim",
};

function headline(
  phase: Phase,
  dog: DogState,
  loaded: { done: number; total: number },
): string {
  if (phase === "idle") return "Ready when you are.";
  if (phase === "loading") return "Loading the demo.";
  if (phase === "ready") return "Loaded. Sound on.";
  if (phase === "failed") return "The demo couldn't load.";
  if (phase === "done") return "That's the whole loop.";

  switch (dog) {
    case "upset":
      return `${DOG_NAME} is upset.`;
    case "settling":
      return `${DOG_NAME} is settling.`;
    case "holding":
      return "Waiting before speaking again.";
    default:
      return "Stay is listening.";
  }
}
