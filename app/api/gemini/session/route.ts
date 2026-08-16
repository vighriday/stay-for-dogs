import { readSession } from "@/lib/gemini";
import { fail, geminiKey, handleError, rateLimit } from "@/lib/api-utils";
import { describeSession, hasTrend } from "@/lib/sessionStats";
import { NextResponse } from "next/server";
import type { SessionStats } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reads a finished session back in plain language.
 *
 * The client sends numbers it already measured — never audio, never the raw
 * frame stream. Whether a trend may be described at all is decided here, on
 * the server, from the episode count. The prompt is told the answer rather
 * than asked to judge it, because "is three data points enough" is not a
 * question to leave to a model that wants to be helpful.
 */
export async function POST(req: Request) {
  try {
    rateLimit(req, "session");

    const body = (await req.json()) as {
      stats?: Partial<SessionStats>;
      dogName?: string;
    };

    const s = body.stats;
    if (!s || typeof s.episodes !== "number") {
      return fail(400, "no_stats", "No session to read.");
    }
    if (s.episodes === 0) {
      return fail(
        422,
        "nothing_happened",
        "Nothing happened in that session.",
        "That is the good outcome — there is nothing to summarise.",
      );
    }

    const nums = (v: unknown, cap: number): number[] =>
      Array.isArray(v) ? v.slice(0, cap).map((n) => Number(n) || 0) : [];

    const stats: SessionStats = {
      minutes: Number(s.minutes) || 0,
      episodes: Math.min(500, Math.max(0, Math.round(s.episodes))),
      responses: Math.max(0, Math.round(Number(s.responses) || 0)),
      holds: Math.max(0, Math.round(Number(s.holds) || 0)),
      episodeSeconds: nums(s.episodeSeconds, 60),
      episodePeaks: nums(s.episodePeaks, 60),
      longestQuietMinutes: Number(s.longestQuietMinutes) || 0,
      linesSpoken: Array.isArray(s.linesSpoken)
        ? s.linesSpoken.slice(0, 30).map((l) => String(l).slice(0, 120))
        : [],
      usedBank: Boolean(s.usedBank),
    };

    const dogName = (body.dogName ?? "").trim().slice(0, 40) || "the dog";

    // The model is handed these sentences and nothing else. Whether a trend may
    // be described is settled here, in code, before the prompt is built.
    const facts = describeSession(stats, hasTrend(stats));

    const reading = await readSession(geminiKey(req), facts, dogName);
    return NextResponse.json({ reading, facts });
  } catch (err) {
    return handleError(err);
  }
}
