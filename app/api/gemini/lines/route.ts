import { generateLines } from "@/lib/gemini";
import { fail, geminiKey, handleError, rateLimit } from "@/lib/api-utils";
import { NextResponse } from "next/server";
import type { DogProfile, Mood } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MOODS: Mood[] = ["calm", "reassure", "settle"];

export async function POST(req: Request) {
  try {
    rateLimit(req, "lines");

    const body = (await req.json()) as {
      profile?: Partial<DogProfile>;
      mood?: Mood;
      count?: number;
      used?: string[];
    };

    const name = body.profile?.name?.trim();
    if (!name) return fail(400, "no_dog_name", "Stay needs the dog's name first.");

    const mood: Mood = MOODS.includes(body.mood as Mood) ? (body.mood as Mood) : "calm";
    const count = Math.min(12, Math.max(1, Math.round(body.count ?? 10)));

    const profile: DogProfile = {
      name: name.slice(0, 40),
      nickname: (body.profile?.nickname ?? "").trim().slice(0, 40),
      likes: (body.profile?.likes ?? []).slice(0, 8).map((s) => String(s).slice(0, 40)),
      bannedWords: (body.profile?.bannedWords ?? [])
        .slice(0, 20)
        .map((s) => String(s).slice(0, 30)),
    };

    const used = (body.used ?? []).slice(-60).map(String);

    const result = await generateLines(geminiKey(req), profile, mood, count, used);

    if (result.lines.length === 0) {
      return fail(
        502,
        "no_usable_lines",
        "Every line came back breaking the rules.",
        "Stay is using its backup lines instead.",
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    return handleError(err);
  }
}
