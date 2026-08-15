import "server-only";
import type { BehaviourScores, DogProfile, Mood, VocalReading } from "./types";
import { LIMITS } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = "gemini-2.5-flash";

export class GeminiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

interface GenPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

async function generate(
  key: string,
  parts: GenPart[],
  systemInstruction: string,
  schema: object,
  temperature: number,
): Promise<unknown> {
  const res = await fetch(`${BASE}/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      contents: [{ parts }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: {
        temperature,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    }),
  });

  if (res.status === 429) {
    throw new GeminiError(
      429,
      "busy",
      "Stay's shared AI quota is busy right now.",
      "Stay is using its backup lines. Add your own Gemini key in settings to skip the queue.",
    );
  }
  if (!res.ok) {
    let msg = `Gemini returned ${res.status}.`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) msg = body.error.message;
    } catch {
      /* keep the default */
    }
    throw new GeminiError(res.status, "gemini_failed", msg);
  }

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new GeminiError(502, "empty_response", "Gemini returned nothing usable.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiError(502, "bad_json", "Gemini returned malformed JSON.");
  }
}

/* ── Calming lines ─────────────────────────────────────────── */

const LINE_SYSTEM = `You write single spoken sentences for a dog to hear while its owner is out of the house.
The sentence will be spoken aloud in the owner's own voice.

Hard rules:
- 4 to 12 words. Never longer.
- Warm, low, slow. The way someone speaks to a dog they love.
- Use the dog's name or nickname in roughly half the lines, not all of them.
- Never use any word from the banned list, in any form, including inside other words.
- No questions. A question makes a dog expect something to happen.
- Never reference leaving, returning at a specific time, doors, or going out.
- Never use exclamation marks. Excitement is the opposite of what is needed.
- Never repeat a sentence you have already produced in this request.
- Plain words only. No emoji, no markdown, no quotation marks.

Good: "Easy, Biscuit. You're alright."
Good: "That's it. Settle down now."
Good: "Good boy. Nice and quiet."
Bad:  "Want to go for a walk?"        (question, banned word)
Bad:  "I'll be home at six!"          (references return, exclamation)
Bad:  "Don't worry, I'm coming back!" (references leaving, exclamation)`;

const MOOD_NOTE: Record<Mood, string> = {
  calm: "gentle presence, nothing is happening, everything is normal",
  reassure: "the dog is upset, steady and grounding",
  settle: "the dog is starting to calm, encourage the quiet",
};

const LINE_SCHEMA = {
  type: "object",
  properties: {
    lines: { type: "array", items: { type: "string" } },
  },
  required: ["lines"],
};

/** Words we never allow through, whatever the profile says. */
const ALWAYS_BANNED = [
  "walk", "walkies", "leash", "lead", "bye", "goodbye", "outside",
  "door", "car", "vet", "treat", "dinner", "food", "park", "ball",
];

function violates(line: string, banned: string[]): string | null {
  const words = line.trim().split(/\s+/);
  if (words.length < LIMITS.minLineWords) return "too short";
  if (words.length > LIMITS.maxLineWords) return "too long";
  if (/[?!]/.test(line)) return "question or exclamation";
  if (/["“”]/.test(line)) return "quotation marks";
  if (/\p{Extended_Pictographic}/u.test(line)) return "emoji";

  const lower = line.toLowerCase();
  for (const w of banned) {
    const t = w.trim().toLowerCase();
    if (!t) continue;
    if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)) {
      return `banned word "${t}"`;
    }
  }
  return null;
}

export interface LineResult {
  lines: string[];
  /** How many the model produced that broke the rules. Shown in the build log. */
  rejected: number;
}

export async function generateLines(
  key: string,
  profile: DogProfile,
  mood: Mood,
  count: number,
  alreadyUsed: string[],
): Promise<LineResult> {
  const banned = [
    ...new Set([...ALWAYS_BANNED, ...profile.bannedWords.map((w) => w.toLowerCase())]),
  ];

  const prompt = `Dog name: ${profile.name}
Nickname: ${profile.nickname || "none"}
Things this dog likes: ${profile.likes.length ? profile.likes.join(", ") : "unknown"}
Banned words, never use these: ${banned.join(", ")}
Mood needed: ${mood}

Mood meanings:
- calm    : ${MOOD_NOTE.calm}
- reassure: ${MOOD_NOTE.reassure}
- settle  : ${MOOD_NOTE.settle}

Write ${count + 4} different sentences.`;

  const raw = (await generate(key, [{ text: prompt }], LINE_SYSTEM, LINE_SCHEMA, 1.0)) as {
    lines?: unknown;
  };

  const candidates = Array.isArray(raw.lines)
    ? raw.lines.filter((l): l is string => typeof l === "string")
    : [];

  const seen = new Set(alreadyUsed.map((l) => l.toLowerCase()));
  const kept: string[] = [];
  let rejected = 0;

  for (const line of candidates) {
    const clean = line.trim().replace(/\s+/g, " ");
    if (violates(clean, banned) || seen.has(clean.toLowerCase())) {
      rejected++;
      continue;
    }
    seen.add(clean.toLowerCase());
    kept.push(clean);
    if (kept.length >= count) break;
  }

  return { lines: kept, rejected };
}

/* ── Behaviour scoring from video ──────────────────────────── */

const SCORE_SYSTEM = `You are scoring a short video of a dog that has been left alone in a room.
Report only what is visibly present in the footage. Do not diagnose. Do not speculate
about how the dog feels. If something is not visible, use 0 or null rather than guessing.

Definitions you must use exactly:
- pacingPercent: the percentage of the clip's duration in which the dog is walking
  or moving around without settling into a resting position.
- doorFixations: the number of separate times the dog orients toward, approaches,
  or touches a door or exit.
- vocalEvents: the number of separate barks, whines, or howls. A rapid burst of
  barking counts as one event.
- settleLatencySec: seconds from the start of the clip until the dog first lies
  down and stays down for at least five continuous seconds. Use null if this
  never happens in the clip.
- notes: one plain sentence describing what you actually saw. No advice.`;

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    pacingPercent: { type: "number" },
    doorFixations: { type: "integer" },
    vocalEvents: { type: "integer" },
    settleLatencySec: { type: "number", nullable: true },
    notes: { type: "string" },
  },
  required: ["pacingPercent", "doorFixations", "vocalEvents", "settleLatencySec", "notes"],
};

export async function scoreClip(
  key: string,
  base64: string,
  mimeType: string,
): Promise<BehaviourScores> {
  const raw = (await generate(
    key,
    [
      { inline_data: { mime_type: mimeType, data: base64 } },
      { text: "Score this clip using the definitions exactly." },
    ],
    SCORE_SYSTEM,
    SCORE_SCHEMA,
    0.2,
  )) as BehaviourScores;

  return {
    pacingPercent: clamp(Number(raw.pacingPercent) || 0, 0, 100),
    doorFixations: Math.max(0, Math.round(Number(raw.doorFixations) || 0)),
    vocalEvents: Math.max(0, Math.round(Number(raw.vocalEvents) || 0)),
    settleLatencySec:
      raw.settleLatencySec === null || raw.settleLatencySec === undefined
        ? null
        : Math.max(0, Number(raw.settleLatencySec)),
    notes: String(raw.notes ?? "").slice(0, 300),
  };
}

/* ── Vocalisation classification from audio ────────────────── */

const VOCAL_SYSTEM = `You are listening to a short audio clip that may contain a dog vocalising.
Classify the primary vocalisation using exactly one of these labels:

- whine       : high, sustained, rising and falling. Distress or seeking contact.
- separation-bark : repetitive, evenly spaced, monotone barking with no obvious trigger.
  Often alternates with whining. Associated with being left alone.
- alert-bark  : sharp, clustered bursts, usually 2-4 barks then a pause. A reaction to
  something outside — a passer-by, a vehicle, another dog.
- howl        : long, tonal, sustained on one pitch.
- other       : no dog vocalisation present, or it cannot be told apart from background noise.

Report confidence as 0 to 1. Be conservative: if the clip is mostly background noise,
say "other" with low confidence rather than guessing.
The note is one plain sentence about what you heard. No advice, no diagnosis.`;

const VOCAL_SCHEMA = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["whine", "separation-bark", "alert-bark", "howl", "other"],
    },
    confidence: { type: "number" },
    note: { type: "string" },
  },
  required: ["kind", "confidence", "note"],
};

export async function classifyVocal(
  key: string,
  base64: string,
  mimeType: string,
): Promise<VocalReading> {
  const raw = (await generate(
    key,
    [
      { inline_data: { mime_type: mimeType, data: base64 } },
      { text: "Classify the primary vocalisation in this clip." },
    ],
    VOCAL_SYSTEM,
    VOCAL_SCHEMA,
    0.2,
  )) as VocalReading;

  return {
    kind: raw.kind ?? "other",
    confidence: clamp(Number(raw.confidence) || 0, 0, 1),
    note: String(raw.note ?? "").slice(0, 240),
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}
