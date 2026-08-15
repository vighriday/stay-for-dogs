import { classifyVocal } from "@/lib/gemini";
import { fail, geminiKey, handleError, rateLimit, readUpload } from "@/lib/api-utils";
import { NextResponse } from "next/server";
import { LIMITS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Tells apart the kinds of noise a dog makes. Whining and howling mean distress;
 * a short burst of alert barking usually means something walked past the window.
 */
export async function POST(req: Request) {
  try {
    rateLimit(req, "vocal");

    const { base64, mimeType } = await readUpload(req, "clip", LIMITS.maxAudioClipBytes);

    if (!mimeType.startsWith("audio/") && !mimeType.startsWith("video/")) {
      return fail(
        415,
        "not_audio",
        "That isn't an audio file.",
        "MP3, WAV, OGG and WebM all work.",
      );
    }

    const reading = await classifyVocal(geminiKey(req), base64, mimeType);
    return NextResponse.json({ reading });
  } catch (err) {
    return handleError(err);
  }
}
