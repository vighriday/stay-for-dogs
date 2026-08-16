"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { Button, ChipInput, Field, Notice, Section } from "@/components/ui";
import { useStay } from "@/lib/store";
import type { VoiceCapabilities } from "@/lib/types";
import { VoiceDescriptionBuilder } from "@/components/VoiceDescriptionBuilder";
import { VoiceRecorder } from "@/components/VoiceRecorder";

type Step = "key" | "voice" | "dog";

interface FieldError {
  message: string;
  hint?: string;
}

async function readError(res: Response): Promise<FieldError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string; hint?: string };
  } | null;
  return {
    message: body?.error?.message ?? `Request failed (${res.status}).`,
    hint: body?.error?.hint,
  };
}

export default function SetupPage() {
  const router = useRouter();
  const store = useStay();

  const [step, setStep] = useState<Step>("key");
  const [caps, setCaps] = useState<VoiceCapabilities | null>(null);

  return (
    <main className="min-h-dvh py-16">
      <div className="column flex flex-col gap-14">
        <header className="flex items-center justify-between">
          <Link href="/" className="label transition-colors hover:text-bone">
            ← Stay
          </Link>
          <StepDots step={step} />
        </header>

        {step === "key" && (
          <KeyStep
            onDone={(c) => {
              setCaps(c);
              setStep("voice");
            }}
          />
        )}

        {step === "voice" && caps && (
          <VoiceStep caps={caps} onBack={() => setStep("key")} onDone={() => setStep("dog")} />
        )}

        {step === "dog" && (
          <DogStep
            onBack={() => setStep("voice")}
            onDone={() => {
              store.setSensitivity(store.sensitivity);
              router.push("/session");
            }}
          />
        )}
      </div>
    </main>
  );
}

function StepDots({ step }: { step: Step }) {
  const steps: Step[] = ["key", "voice", "dog"];
  const index = steps.indexOf(step);
  return (
    <div
      className="flex items-center gap-2"
      role="img"
      aria-label={`Step ${index + 1} of 3`}
    >
      {steps.map((s, i) => (
        <span
          key={s}
          className={`h-1 w-6 ${i <= index ? "bg-bone" : "bg-line"}`}
          aria-hidden
        />
      ))}
    </div>
  );
}

/* ── Step 1 · the key ──────────────────────────────────────── */

function KeyStep({ onDone }: { onDone: (c: VoiceCapabilities) => void }) {
  const { elKey, setElKey, geminiKey, setGeminiKey } = useStay();
  const [draft, setDraft] = useState(elKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);

  const check = useCallback(async () => {
    const key = draft.trim();
    if (!key) {
      setError({ message: "Paste your ElevenLabs key first." });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/el/capabilities", { headers: { "x-el-key": key } });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const caps = (await res.json()) as VoiceCapabilities;
      setElKey(key);
      onDone(caps);
    } catch {
      setError({
        message: "Couldn't reach ElevenLabs.",
        hint: "Check your connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  }, [draft, setElKey, onDone]);

  return (
    <Section step="Step one" title="Your ElevenLabs key">
      <p className="max-w-prose text-dim">
        Stay speaks in your voice, and that runs on your own ElevenLabs account. The key
        stays in this browser and is sent to nothing except Stay&apos;s own server, once
        per request. It is never stored.
      </p>

      <Field
        label="ElevenLabs API key"
        mono
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="sk_…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && check()}
        error={error?.message}
        hint={
          <>
            Free account is fine.{" "}
            <a
              href="https://elevenlabs.io/app/settings/api-keys"
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-line underline-offset-4 hover:text-bone"
            >
              Get one here
            </a>{" "}
            — no card needed.
          </>
        }
      />

      {error?.hint && <Notice tone="warn">{error.hint}</Notice>}

      <details className="border border-line bg-ink-raised">
        <summary className="cursor-pointer px-4 py-3 text-[13px] text-dim hover:text-bone">
          Bringing your own Gemini key (optional)
        </summary>
        <div className="flex flex-col gap-3 border-t border-line px-4 py-4">
          <p className="text-[13px] text-dim">
            Stay writes its lines with Gemini on a shared key. If it&apos;s busy, add your
            own free key and you&apos;ll skip the queue.
          </p>
          <Field
            label="Gemini API key"
            mono
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Leave empty to use Stay's"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
          />
        </div>
      </details>

      <div className="flex items-center gap-4">
        <Button onClick={check} busy={busy}>
          Check this key
        </Button>
        <Link href="/demo" className="text-[13px] text-dim underline underline-offset-4 hover:text-bone">
          Or try the demo without a key
        </Link>
      </div>
    </Section>
  );
}

/* ── Step 2 · the voice ────────────────────────────────────── */

function VoiceStep({
  caps,
  onBack,
  onDone,
}: {
  caps: VoiceCapabilities;
  onBack: () => void;
  onDone: () => void;
}) {
  const { elKey, setVoice } = useStay();
  const [voiceIdDraft, setVoiceIdDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);
  const [confirmed, setConfirmed] = useState<{ name: string; id: string } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const verify = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/el/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-el-key": elKey },
          body: JSON.stringify({ voiceId: id }),
        });
        if (!res.ok) {
          setError(await readError(res));
          return;
        }
        const data = (await res.json()) as { voiceId: string; name: string; sample: string };
        setConfirmed({ name: data.name, id: data.voiceId });
        setVoice(data.voiceId, data.name, caps.canCreateVoice ? "clone" : "byov");

        const audio = new Audio(`data:audio/mpeg;base64,${data.sample}`);
        audioRef.current = audio;
        void audio.play().catch(() => {
          /* the user can press play on the sample themselves */
        });
      } catch {
        setError({ message: "Couldn't reach ElevenLabs.", hint: "Try again in a moment." });
      } finally {
        setBusy(false);
      }
    },
    [elKey, setVoice, caps.canCreateVoice],
  );

  return (
    <Section step="Step two" title="Get your voice into Stay">
      <Notice tone={caps.canCreateVoice ? "good" : "neutral"}>
        <strong>{caps.tier} plan</strong> · {caps.charactersLeft.toLocaleString()} of{" "}
        {caps.characterLimit.toLocaleString()} credits left · {caps.voiceSlotsUsed} of{" "}
        {caps.voiceSlotLimit} voice slots used.
        {caps.canCreateVoice
          ? " This plan can clone your voice directly from a recording."
          : " Free plans can't create voices over the API, so you'll make one in the ElevenLabs dashboard and paste its ID. Stay works exactly the same either way."}
      </Notice>

      {caps.canCreateVoice ? (
        <VoiceRecorder
          elKey={elKey}
          onCloned={(id) => {
            setVoiceIdDraft(id);
            void verify(id);
          }}
          onError={setError}
        />
      ) : (
        <VoiceDescriptionBuilder />
      )}

      <div className="flex flex-col gap-4 border-t border-line pt-8">
        <Field
          label="Voice ID"
          mono
          placeholder="e.g. Vn7AbS1LriYk7BcEFDrA"
          spellCheck={false}
          value={voiceIdDraft}
          onChange={(e) => setVoiceIdDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && verify(voiceIdDraft.trim())}
          error={error?.message}
          hint="Open the voice in ElevenLabs, then use the ⋮ menu → Copy voice ID."
        />
        {error?.hint && <Notice tone="warn">{error.hint}</Notice>}

        {confirmed && (
          <Notice tone="good">
            <strong>{confirmed.name}</strong> is working. That was it speaking just now —
            play it again if you missed it.{" "}
            <button
              type="button"
              onClick={() => void audioRef.current?.play()}
              className="underline decoration-line underline-offset-4 hover:text-bone"
            >
              Play again
            </button>
          </Notice>
        )}
      </div>

      <div className="flex items-center gap-4">
        <Button kind="secondary" onClick={onBack}>
          Back
        </Button>
        {confirmed ? (
          <Button onClick={onDone}>Next — tell Stay about your dog</Button>
        ) : (
          <Button onClick={() => verify(voiceIdDraft.trim())} busy={busy} disabled={!voiceIdDraft.trim()}>
            Test this voice
          </Button>
        )}
      </div>
    </Section>
  );
}

/* ── Step 3 · the dog ──────────────────────────────────────── */

function DogStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { profile, setProfile } = useStay();
  const [name, setName] = useState(profile?.name ?? "");
  const [nickname, setNickname] = useState(profile?.nickname ?? "");
  const [likes, setLikes] = useState<string[]>(profile?.likes ?? []);
  const [banned, setBanned] = useState<string[]>(profile?.bannedWords ?? []);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!name.trim()) {
      setError("Stay needs a name to use.");
      return;
    }
    setProfile({
      name: name.trim(),
      nickname: nickname.trim(),
      likes,
      bannedWords: banned,
    });
    onDone();
  };

  return (
    <Section step="Step three" title="About your dog">
      <Field
        label="Name"
        placeholder="Biscuit"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        error={error}
      />

      <Field
        label="Nickname (optional)"
        placeholder="Bisky"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        hint="Stay mixes this in so it doesn't say the same name every time."
      />

      <ChipInput
        label="Things your dog likes"
        values={likes}
        onChange={setLikes}
        placeholder="the blue blanket"
        hint="Optional. Gives Stay something specific and familiar to mention."
      />

      <ChipInput
        label="Words Stay must never say"
        values={banned}
        onChange={setBanned}
        placeholder="walk"
        tone="warn"
        hint="Most dogs spike at walk, leash, or their owner's goodbye word. Stay already blocks a common list — add anything specific to your dog."
      />

      <div className="flex items-center gap-4">
        <Button kind="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={save}>Start a session</Button>
      </div>
    </Section>
  );
}
