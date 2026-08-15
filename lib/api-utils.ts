import "server-only";
import { NextResponse } from "next/server";
import { ElevenLabsError } from "./elevenlabs";
import { GeminiError } from "./gemini";

/** Every failure the UI sees comes through here. No bare 500s, ever. */
export function fail(
  status: number,
  code: string,
  message: string,
  hint?: string,
): NextResponse {
  return NextResponse.json({ error: { code, message, hint } }, { status });
}

export function handleError(err: unknown): NextResponse {
  if (err instanceof ElevenLabsError) {
    return fail(err.status, err.code, err.message, err.hint);
  }
  if (err instanceof GeminiError) {
    return fail(err.status, err.code, err.message, err.hint);
  }
  if (err instanceof SyntaxError) {
    return fail(400, "bad_request", "That request wasn't valid JSON.");
  }
  // Nothing sensitive: the message is ours, the stack stays on the server.
  console.error("[stay] unhandled route error:", err);
  return fail(
    500,
    "unexpected",
    "Something on Stay's side failed.",
    "Try again. If it keeps happening, demo mode always works.",
  );
}

/** Pulls the user's ElevenLabs key out of the request. Never logged. */
export function requireKey(req: Request): string {
  const key = req.headers.get("x-el-key")?.trim();
  if (!key) {
    throw new ElevenLabsError(
      401,
      "no_key",
      "No ElevenLabs key on this request.",
      "Add your key in setup, or use demo mode.",
    );
  }
  return key;
}

/** Our Gemini key, unless the visitor brought their own. */
export function geminiKey(req: Request): string {
  const own = req.headers.get("x-gemini-key")?.trim();
  if (own) return own;

  const shared = process.env.GEMINI_API_KEY;
  if (!shared) {
    throw new GeminiError(
      503,
      "not_configured",
      "Stay's Gemini key isn't configured on this deployment.",
      "Add your own Gemini key in settings.",
    );
  }
  return shared;
}

/**
 * Sliding-window limiter on our shared Gemini key so a burst of traffic
 * can't drain it. Per-instance and in-memory, which is the right size for
 * this: it costs nothing and the client treats 429 as non-fatal anyway.
 */
const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60_000;
const MAX_HITS = 10;

export function rateLimit(req: Request, bucket: string): void {
  // A visitor using their own key isn't spending our quota.
  if (req.headers.get("x-gemini-key")?.trim()) return;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local";
  const id = `${bucket}:${ip}`;
  const now = Date.now();

  const recent = (hits.get(id) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_HITS) {
    throw new GeminiError(
      429,
      "busy",
      "Stay's shared AI quota is busy right now.",
      "Stay is using its backup lines. Add your own free Gemini key in settings to skip the queue.",
    );
  }
  recent.push(now);
  hits.set(id, recent);

  // Keep the map from growing without bound on a long-lived instance.
  if (hits.size > 2000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
}

export async function readUpload(
  req: Request,
  field: string,
  maxBytes: number,
): Promise<{ base64: string; mimeType: string; name: string }> {
  const form = await req.formData();
  const file = form.get(field);

  if (!(file instanceof File)) {
    throw new GeminiError(400, "no_file", `No ${field} was attached.`);
  }
  if (file.size === 0) {
    throw new GeminiError(400, "empty_file", "That file is empty.");
  }
  if (file.size > maxBytes) {
    const mb = (maxBytes / 1024 / 1024).toFixed(0);
    throw new GeminiError(
      413,
      "too_large",
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${mb} MB.`,
      "Trim the clip and try again.",
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  return {
    base64: buf.toString("base64"),
    mimeType: file.type || "application/octet-stream",
    name: file.name,
  };
}
