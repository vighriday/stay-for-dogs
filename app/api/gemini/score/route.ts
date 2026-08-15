import { scoreClip } from "@/lib/gemini";
import { fail, geminiKey, handleError, rateLimit, readUpload } from "@/lib/api-utils";
import { NextResponse } from "next/server";
import { LIMITS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Scores one clip of a dog alone. One clip, one reading — never a fabricated comparison. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "score");

    const { base64, mimeType } = await readUpload(req, "clip", LIMITS.maxClipBytes);

    if (!mimeType.startsWith("video/")) {
      return fail(
        415,
        "not_video",
        "That isn't a video file.",
        "MP4, WebM and MOV all work.",
      );
    }

    const scores = await scoreClip(geminiKey(req), base64, mimeType);
    return NextResponse.json({ scores });
  } catch (err) {
    return handleError(err);
  }
}
