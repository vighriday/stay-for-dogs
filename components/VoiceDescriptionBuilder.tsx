"use client";

import { useMemo, useState } from "react";
import { Button, Notice } from "@/components/ui";

/**
 * The free-tier path.
 *
 * ElevenLabs will not create a voice through the API on a free plan, but it
 * will in the dashboard. Rather than dumping the user at an empty description
 * box, Stay assembles the description for them — the wording matters more than
 * people expect, and "speaking slowly and gently, as if calming an animal"
 * makes a visible difference to what comes back.
 */

const AXES = [
  { key: "age", label: "Age", options: ["early twenties", "thirties", "forties", "fifties"] },
  { key: "gender", label: "Voice", options: ["male", "female", "neutral"] },
  { key: "pitch", label: "Pitch", options: ["low", "medium", "high"] },
  { key: "texture", label: "Texture", options: ["warm", "smooth", "slightly raspy", "soft"] },
] as const;

type AxisKey = (typeof AXES)[number]["key"];

const TAIL = "speaking slowly and gently, as if calming an animal";

export function VoiceDescriptionBuilder() {
  const [picked, setPicked] = useState<Record<AxisKey, string>>({
    age: "thirties",
    gender: "male",
    pitch: "low",
    texture: "warm",
  });
  const [accent, setAccent] = useState("");
  const [copied, setCopied] = useState(false);

  const description = useMemo(() => {
    const bits = [
      `A ${picked.texture}, ${picked.pitch}-pitched ${picked.gender} voice`,
      `in their ${picked.age}`,
      accent.trim() ? `with a ${accent.trim()} accent` : null,
      TAIL,
    ].filter(Boolean);
    return `${bits.join(", ")}.`;
  }, [picked, accent]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(description);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-6">
        {AXES.map((axis) => (
          <div key={axis.key} className="flex flex-col gap-3">
            <span className="label">{axis.label}</span>
            <div className="flex flex-wrap gap-2">
              {axis.options.map((option) => {
                const active = picked[axis.key] === option;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPicked((p) => ({ ...p, [axis.key]: option }))}
                    className={`rounded-xs border px-3 py-2 text-[13px] transition-colors duration-[120ms] ${
                      active
                        ? "border-bone bg-bone text-ink"
                        : "border-line text-dim hover:border-line-bright hover:text-bone"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex flex-col gap-2">
          <label htmlFor="accent" className="label">
            Accent (optional)
          </label>
          <input
            id="accent"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            placeholder="Indian English, Scottish, Midwestern American…"
            className="rounded-xs"
          />
        </div>
      </div>

      <div className="flex flex-col gap-4 border border-line bg-ink-raised p-5">
        <span className="label">Your description</span>
        <p className="said text-[19px] text-bone">{description}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button kind="secondary" type="button" onClick={copy}>
            {copied ? "Copied" : "Copy description"}
          </Button>
          <a
            href="https://elevenlabs.io/app/voice-lab"
            target="_blank"
            rel="noreferrer noopener"
            className="text-[13px] text-dim underline decoration-line underline-offset-4 hover:text-bone"
          >
            Open ElevenLabs Voice Lab ↗
          </a>
        </div>
      </div>

      <Notice>
        In Voice Lab, choose <strong>Voice Design</strong>, paste this description, and
        generate. Pick the take that sounds most like you, save it as{" "}
        <strong>Stay</strong>, then copy its voice ID and paste it below.
      </Notice>
    </div>
  );
}
