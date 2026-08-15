/**
 * Renders the demo-mode audio once, so demo mode makes no network calls at all.
 *
 *   node scripts/build-demo-audio.mjs
 *
 * Reads ELEVENLABS_API_KEY and STAY_DEMO_VOICE_ID from .env.local.
 * Writes mp3s plus a manifest into public/demo/.
 *
 * This runs by hand, not on every build: the output is committed, and demo
 * mode has to keep working on a deployment that has no keys configured.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "demo");

function loadEnv() {
  const env = {};
  for (const file of [".env.local", ".env"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = loadEnv();
const KEY = env.ELEVENLABS_API_KEY;
const VOICE = env.STAY_DEMO_VOICE_ID || process.argv[2];

if (!KEY) {
  console.error("ELEVENLABS_API_KEY missing from .env.local");
  process.exit(1);
}
if (!VOICE) {
  console.error(
    "No voice id. Set STAY_DEMO_VOICE_ID in .env.local or pass it as an argument.",
  );
  process.exit(1);
}

/** The scripted demo session. Ordinary, unremarkable, exactly the point. */
const LINES = [
  "Easy, Biscuit. You're alright.",
  "That's it. Settle down now.",
  "Good boy. Nice and quiet.",
  "You're safe. Everything's fine.",
  "Lie down, Biscuit. Good boy.",
  "Nothing to worry about here.",
  "Steady now. Steady.",
  "You're doing so well.",
];

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

mkdirSync(outDir, { recursive: true });

const manifest = [];
let credits = 0;

for (const [i, text] of LINES.entries()) {
  process.stdout.write(`[${i + 1}/${LINES.length}] ${text} … `);

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_flash_v2_5",
        voice_settings: { stability: 0.65, similarity_boost: 0.8, speed: 0.9 },
      }),
    },
  );

  if (!res.ok) {
    console.error(`\nFailed (${res.status}): ${await res.text()}`);
    process.exit(1);
  }

  const name = `${String(i + 1).padStart(2, "0")}-${slug(text)}.mp3`;
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(outDir, name), bytes);

  manifest.push({ text, file: `/demo/${name}` });
  credits += text.length;
  console.log(`${(bytes.length / 1024).toFixed(0)} KB`);
}

writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`\nWrote ${manifest.length} clips and a manifest to public/demo/`);
console.log(`Roughly ${Math.round(credits / 2)} ElevenLabs credits used.`);
