import { speak } from "@/lib/elevenlabs";
import { fail, handleError, requireKey } from "@/lib/api-utils";
import type { Mood } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MOODS: Mood[] = ["calm", "reassure", "settle"];

export async function POST(req: Request) {
  try {
    const key = requireKey(req);
    const { voiceId, text, mood } = (await req.json()) as {
      voiceId?: string;
      text?: string;
      mood?: Mood;
    };

    if (!voiceId?.trim()) return fail(400, "no_voice_id", "No voice selected.");

    const line = text?.trim();
    if (!line) return fail(400, "no_text", "Nothing to say.");
    if (line.length > 300) {
      return fail(400, "too_long", "Lines are capped at 300 characters.");
    }

    const audio = await speak(
      key,
      voiceId.trim(),
      line,
      MOODS.includes(mood as Mood) ? (mood as Mood) : "settle",
    );

    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
