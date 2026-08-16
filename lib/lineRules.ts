/**
 * The rules every generated line must survive before a dog can hear it.
 *
 * This lives on its own, away from the Gemini client, for two reasons. It is
 * the only thing standing between a language model and an animal, so it should
 * be readable in one sitting by anyone who wants to check it. And `gemini.ts`
 * carries `import "server-only"`, which correctly refuses to load outside a
 * server context — including under a test runner. Rules that cannot be tested
 * are rules you are trusting rather than enforcing.
 */

/**
 * How long a spoken line may be, in words.
 *
 * These live here rather than in the shared limits, beside the other rules
 * they belong to. It also keeps this file free of runtime imports, which is
 * what lets a test runner load it directly.
 */
export const MIN_WORDS = 3;
export const MAX_WORDS = 14;

/** Never allowed, whatever the owner's own list says. */
export const ALWAYS_BANNED = [
  "walk", "walkies", "leash", "lead", "bye", "goodbye", "outside",
  "door", "car", "vet", "treat", "dinner", "food", "park", "ball",
] as const;

/**
 * Endings a banned word is still banned with.
 *
 * The first version of this matched whole words only — `\bwalk\b` — while the
 * prompt told the model "never use any word from the banned list, in any form".
 * Those two are not the same rule, and the gap was not theoretical: "we are
 * going walking soon" passed every check and would have been spoken aloud.
 * Walk is the single most reactive word in the list.
 *
 * Matching a bare prefix instead would be worse: "car" would swallow "carpet"
 * and "careful". Attaching a short set of real inflections catches walking,
 * walked, walks, treats, parking without touching the words around them.
 */
const ENDINGS = "(?:s|es|ing|ed|in')?";

export type Violation =
  | "too short"
  | "too long"
  | "question or exclamation"
  | "quotation marks"
  | "emoji"
  | `banned word "${string}"`;

/**
 * Returns why a line is unusable, or null if it is fine.
 *
 * Deliberately conservative. A rejected line costs nothing — another is
 * generated, and twenty hand-written ones sit underneath as a floor. A line
 * that should have been rejected costs the thing the app exists to prevent.
 */
export function violates(line: string, banned: readonly string[]): Violation | null {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) return "too short";
  if (words.length > MAX_WORDS) return "too long";
  if (/[?!]/.test(line)) return "question or exclamation";
  // A question mark is the obvious tell, but not the only one — "are you
  // alright in there" is still a question, and a question makes a dog get up
  // and expect something. Catching the opening word costs nothing, and a
  // rejected line is simply replaced.
  if (/^\s*(?:are|is|was|do|does|did|can|could|will|would|shall|should|have|has|who|what|where|when|why|how)\b/i.test(line)) {
    return "question or exclamation";
  }
  if (/["“”]/.test(line)) return "quotation marks";
  if (/\p{Extended_Pictographic}/u.test(line)) return "emoji";

  const lower = line.toLowerCase();
  for (const w of banned) {
    const term = w.trim().toLowerCase();
    if (!term) continue;
    // Escaped, because this list includes whatever the owner typed into the
    // profile. A dog called "R2-D2" or a stray "*" must not become a pattern.
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${safe}${ENDINGS}\\b`).test(lower)) {
      return `banned word "${term}"`;
    }
  }
  return null;
}

/** The owner's list, folded into the permanent one, deduplicated and cleaned. */
export function bannedList(ownWords: readonly string[]): string[] {
  return [
    ...new Set([
      ...ALWAYS_BANNED,
      ...ownWords.map((w) => w.trim().toLowerCase()).filter(Boolean),
    ]),
  ];
}
