import "server-only";
import type {
  BehaviourScores,
  DogProfile,
  Mood,
  SessionReading,
  VocalReading,
} from "./types";
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

/* ── Reading a session back ────────────────────────────────── */

const SESSION_SYSTEM = `Someone left their dog alone for a while. They are back, they are worried, and they
are reading what happened. You write the few sentences that tell them.

You will be given a short list of plain statements about the session. Every one of them
is already true. Your only job is to say them the way a person would say them, joined
up and in a sensible order.

Absolute rules:
- Use ONLY what is in the list. Never add a fact, a number, a cause or a reassurance
  that is not there. If the list does not say it, it did not happen.
- Never invent a number. There are no numbers in the list; there should be none in your
  answer either. The reader has a table of figures directly above your words — repeating
  figures at them is the one thing that makes this useless.
- Never say or imply that Stay caused anything. A single session cannot show that.
- If the list says there is not enough data to judge a direction, say so plainly, and do
  not describe a direction anywhere in your answer.
- Never diagnose. Never call separation anxiety something the dog "has".
- No advice — not about training, vets, medication, routines, or leaving things out.
- No exclamation marks, no cheerleading, no "doing great".

Voice: calm, plain, specific, a little warm. A good vet nurse telling you what she saw.
Short sentences. Ordinary words.

Fields:
- headline: ONE sentence under 10 words. The shape of the session.
- reading: 2 to 3 sentences joining the statements into something readable.
- observation: ONE sentence — the most honest thing that can be said, including its
  limit. A handful of upsets is still only a handful.
- watchFor: ONE sentence. Something concrete to notice next time. Never an instruction
  to do anything to the dog.

Example. Given these statements:
  The session lasted about 45 minutes.
  The dog got upset three times.
  Each upset was shorter than the one before it.
  There was one long stretch of about 20 minutes with nothing at all.
  Stay answered every upset.
  Every answer came after the noise had already stopped, never during it.

Good reading: "Biscuit got upset three times across the three quarters of an hour, and
each one passed quicker than the last. The middle of the session was completely quiet for
a long stretch. Stay answered each time, always waiting until the noise had stopped first."

Good observation: "The upsets did get shorter, but three of them is a thin basis for
believing that means very much yet."

Bad observation: "The upsets became shorter and quieter." (true, but no limit attached)
Bad observation: "Biscuit is improving." (a claim the data cannot carry)
Bad watchFor: "Try leaving a worn t-shirt out." (advice, and not from the list)`;

const SESSION_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    reading: { type: "string" },
    observation: { type: "string" },
    watchFor: { type: "string" },
  },
  required: ["headline", "reading", "observation", "watchFor"],
};

/**
 * `facts` comes from describeSession() — plain statements computed in code.
 * The raw figures never reach this function, which is deliberate: see the note
 * on describeSession for why instructing a model not to recite numbers does
 * not work, and removing the numbers does.
 */
export async function readSession(
  key: string,
  facts: string[],
  dogName: string,
): Promise<SessionReading> {
  const prompt = `The dog's name is ${dogName}.

What happened:
${facts.map((f) => `  ${f}`).join("\n")}

Write the closing summary.`;

  const raw = (await generate(
    key,
    [{ text: prompt }],
    SESSION_SYSTEM,
    SESSION_SCHEMA,
    0.5,
  )) as SessionReading;

  return {
    headline: String(raw.headline ?? "").slice(0, 120),
    reading: String(raw.reading ?? "").slice(0, 500),
    observation: String(raw.observation ?? "").slice(0, 300),
    watchFor: String(raw.watchFor ?? "").slice(0, 300),
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}
