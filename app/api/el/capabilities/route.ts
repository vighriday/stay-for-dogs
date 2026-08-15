import { getCapabilities } from "@/lib/elevenlabs";
import { handleError, requireKey } from "@/lib/api-utils";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What this key can actually do. Decides which voice path the user gets. */
export async function GET(req: Request) {
  try {
    const caps = await getCapabilities(requireKey(req));
    return NextResponse.json(caps);
  } catch (err) {
    return handleError(err);
  }
}
