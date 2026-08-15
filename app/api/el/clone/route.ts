import { cloneVoice, getCapabilities } from "@/lib/elevenlabs";
import { fail, handleError, requireKey } from "@/lib/api-utils";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SAMPLE_BYTES = 25 * 1024 * 1024;

/**
 * Instant Voice Cloning. Paid plans only.
 *
 * The UI never shows this path to a free key, but we re-check here rather than
 * trusting the client — and we check before uploading, so nobody waits through
 * a 20 MB upload only to be told no.
 */
export async function POST(req: Request) {
  try {
    const key = requireKey(req);

    const caps = await getCapabilities(key);
    if (!caps.canCreateVoice) {
      return fail(
        402,
        "needs_paid_plan",
        "Cloning needs a paid ElevenLabs plan.",
        "On the free plan, make a voice in the ElevenLabs dashboard and paste its ID instead — Stay works exactly the same either way.",
      );
    }
    if (caps.voiceSlotsUsed >= caps.voiceSlotLimit) {
      return fail(
        409,
        "no_voice_slots",
        `This account is using all ${caps.voiceSlotLimit} of its voice slots.`,
        "Delete a voice in the ElevenLabs dashboard, then try again.",
      );
    }

    const form = await req.formData();
    const sample = form.get("sample");
    const name = String(form.get("name") ?? "Stay").slice(0, 60);

    if (!(sample instanceof File)) {
      return fail(400, "no_sample", "No recording was attached.");
    }
    if (sample.size === 0) {
      return fail(400, "empty_sample", "That recording is empty.");
    }
    if (sample.size > MAX_SAMPLE_BYTES) {
      return fail(
        413,
        "sample_too_large",
        `That recording is ${(sample.size / 1024 / 1024).toFixed(1)} MB. The limit is 25 MB.`,
      );
    }

    const { voiceId } = await cloneVoice(key, name, sample);
    return NextResponse.json({ voiceId });
  } catch (err) {
    return handleError(err);
  }
}
