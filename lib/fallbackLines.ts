/**
 * The offline bank.
 *
 * These are synthesised once at session start and kept for the whole session.
 * They play whenever Gemini is unavailable — rate-limited, offline, or having
 * a bad minute. Stay must never go quiet because a network call failed.
 *
 * Every line here is safe against any banned-word list: none of them mention
 * leaving, returning, doors, food, or anything a dog reacts to. Twenty is
 * enough that a full-fallback session still never sounds looped.
 */
export const FALLBACK_LINES = [
  "Easy, {name}. You're alright.",
  "That's it. Settle down now.",
  "Good {name}. Nice and quiet.",
  "You're safe. Everything's fine.",
  "Shhh. It's alright, buddy.",
  "Lie down. Good {name}.",
  "Nothing to worry about here.",
  "You're doing so well.",
  "Quiet now. That's a good one.",
  "Rest your head, {name}.",
  "It's all okay. It's all okay.",
  "Steady, {name}. Steady.",
  "Good. Just like that.",
  "You're such a good one.",
  "Nice and calm now.",
  "Nothing's wrong, {name}.",
  "Soft and slow. That's it.",
  "You're alright, sweetheart.",
  "Settle. Good {name}.",
  "That's my good one.",
] as const;

export function fillBank(name: string): string[] {
  const safe = name.trim() || "buddy";
  return FALLBACK_LINES.map((l) => l.replaceAll("{name}", safe));
}
