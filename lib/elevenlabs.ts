import "server-only";
import type { VoiceCapabilities } from "./types";

const BASE = "https://api.elevenlabs.io";

/**
 * Everything here runs server-side only. A key arrives per-request in the
 * `x-el-key` header, gets used once, and is never stored or logged.
 */

export class ElevenLabsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

function headers(key: string, json = true): HeadersInit {
  const h: Record<string, string> = { "xi-api-key": key };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

/** Turns ElevenLabs' error shapes into something the UI can actually render. */
async function explode(res: Response): Promise<never> {
  let detail: unknown;
  try {
    detail = await res.json();
  } catch {
    detail = null;
  }

  const d = (detail as { detail?: { code?: string; message?: string } } | null)?.detail;
  const code = d?.code ?? `http_${res.status}`;
  const raw = d?.message ?? `ElevenLabs returned ${res.status}.`;

  if (res.status === 401) {
    throw new ElevenLabsError(
      401,
      "bad_key",
      "ElevenLabs rejected that key.",
      "Check it's copied in full, with no spaces at either end.",
    );
  }
  if (code === "paid_plan_required" || code === "feature_not_available") {
    throw new ElevenLabsError(
      402,
      "needs_paid_plan",
      raw,
      "Free plans can't use library voices or create voices over the API. Make a voice in the ElevenLabs dashboard and paste its ID instead.",
    );
  }
  if (res.status === 429) {
    throw new ElevenLabsError(
      429,
      "rate_limited",
      "ElevenLabs is rate-limiting this key.",
      "Wait a few seconds and try again.",
    );
  }
  throw new ElevenLabsError(res.status, code, raw);
}

export async function getCapabilities(key: string): Promise<VoiceCapabilities> {
  const res = await fetch(`${BASE}/v1/user/subscription`, {
    headers: headers(key, false),
    cache: "no-store",
  });
  if (!res.ok) await explode(res);

  const s = (await res.json()) as {
    tier: string;
    character_count: number;
    character_limit: number;
    can_use_instant_voice_cloning: boolean;
    voice_slots_used: number;
    voice_limit: number;
  };

  return {
    tier: s.tier,
    canCreateVoice: s.can_use_instant_voice_cloning,
    charactersLeft: Math.max(0, s.character_limit - s.character_count),
    characterLimit: s.character_limit,
    voiceSlotsUsed: s.voice_slots_used,
    voiceSlotLimit: s.voice_limit,
  };
}

/**
 * Confirms a voice ID belongs to this account and is usable.
 * Free plans can read the whole library but can only *speak* with their own
 * voices, so a successful lookup is not enough — the caller follows this with
 * a real one-word synthesis to prove it.
 */
export async function getVoice(
  key: string,
  voiceId: string,
): Promise<{ voiceId: string; name: string; category: string }> {
  const res = await fetch(`${BASE}/v1/voices/${voiceId}`, {
    headers: headers(key, false),
    cache: "no-store",
  });
  if (res.status === 404) {
    throw new ElevenLabsError(
      404,
      "no_such_voice",
      "No voice with that ID on this account.",
      "Open the voice in ElevenLabs, then use the ⋮ menu → Copy voice ID.",
    );
  }
  if (!res.ok) await explode(res);

  const v = (await res.json()) as { voice_id: string; name: string; category: string };
  return { voiceId: v.voice_id, name: v.name, category: v.category };
}

export async function speak(
  key: string,
  voiceId: string,
  text: string,
): Promise<ArrayBuffer> {
  const res = await fetch(
    `${BASE}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: headers(key),
      cache: "no-store",
      body: JSON.stringify({
        text,
        model_id: "eleven_flash_v2_5",
        // Slightly slow and steady. A calm voice is the entire point.
        voice_settings: { stability: 0.65, similarity_boost: 0.8, speed: 0.9 },
      }),
    },
  );
  if (!res.ok) await explode(res);
  return res.arrayBuffer();
}

/** Instant Voice Cloning. Paid plans only — the UI gates this before we get here. */
export async function cloneVoice(
  key: string,
  name: string,
  sample: File,
): Promise<{ voiceId: string }> {
  const form = new FormData();
  form.append("name", name);
  form.append("files", sample, sample.name || "sample.webm");
  form.append("remove_background_noise", "true");

  const res = await fetch(`${BASE}/v1/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": key },
    cache: "no-store",
    body: form,
  });
  if (!res.ok) await explode(res);

  const v = (await res.json()) as { voice_id: string };
  return { voiceId: v.voice_id };
}
