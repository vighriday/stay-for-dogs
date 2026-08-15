import { getVoice, speak } from "@/lib/elevenlabs";
import { fail, handleError, requireKey } from "@/lib/api-utils";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Confirms a voice ID is not just present but genuinely usable.
 *
 * Looking the voice up isn't enough: a free plan can read every voice in the
 * library and still get 402 when it tries to speak with one. So we synthesise
 * two real words and return them. If that works, the session will work.
 */
export async function POST(req: Request) {
  try {
    const key = requireKey(req);
    const { voiceId } = (await req.json()) as { voiceId?: string };

    const id = voiceId?.trim();
    if (!id) {
      return fail(400, "no_voice_id", "Paste a voice ID first.");
    }
    if (!/^[A-Za-z0-9]{16,32}$/.test(id)) {
      return fail(
        400,
        "malformed_voice_id",
        "That doesn't look like a voice ID.",
        "It's around 20 letters and numbers, with no spaces or dashes.",
      );
    }

    const voice = await getVoice(key, id);
    const audio = await speak(key, id, "Easy now.");

    return NextResponse.json({
      voiceId: voice.voiceId,
      name: voice.name,
      category: voice.category,
      sample: Buffer.from(audio).toString("base64"),
    });
  } catch (err) {
    return handleError(err);
  }
}
