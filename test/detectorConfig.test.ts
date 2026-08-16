import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DETECTOR_DEFAULTS as D, LIMITS } from "../lib/types.ts";
import { fillBank, FALLBACK_LINES } from "../lib/fallbackLines.ts";
import { bannedList, MAX_WORDS, MIN_WORDS, violates } from "../lib/lineRules.ts";

/**
 * The detector's constants are tuned numbers, not arbitrary ones, and several
 * of them only make sense in relation to each other. These assertions are the
 * relationships — if a future edit breaks one, the detector still runs and
 * silently stops working, which is exactly how the first version failed.
 */
describe("detector constants stay coherent", () => {
  test("the dog band is a real band", () => {
    assert.ok(D.bandLowHz > 0);
    assert.ok(D.bandHighHz > D.bandLowHz);
  });

  test("the pitch range sits inside the band it is measured on", () => {
    assert.ok(D.pitchMinHz >= D.bandLowHz - 200, "fundamental below the filter's reach");
    assert.ok(D.pitchMaxHz <= D.bandHighHz);
  });

  test("autocorrelation lags derived from the pitch range fit inside a frame", () => {
    for (const sampleRate of [44_100, 48_000]) {
      const lagMin = Math.floor(sampleRate / D.pitchMaxHz);
      const lagMax = Math.ceil(sampleRate / D.pitchMinHz);
      assert.ok(lagMin >= 2, `lagMin too small at ${sampleRate}`);
      assert.ok(lagMax < D.frameSize / 2, `lagMax ${lagMax} exceeds half a frame at ${sampleRate}`);
      assert.ok(lagMax > lagMin);
    }
  });

  test("the two routes into an episode are both reachable", () => {
    const frameMs = (D.frameSize / 48_000) * 1000;
    const windowFrames = Math.round(D.onsetWindowMs / frameMs);
    assert.ok(D.onsetCount >= 2, "one onset would fire on any single bang");
    assert.ok(windowFrames > D.onsetCount, "not enough frames in the window to hold the onsets");
    assert.ok(D.refractoryMs * D.onsetCount < D.onsetWindowMs, "refractory gap makes the count impossible");
  });

  test("a response can be released before the ceiling forces one", () => {
    assert.ok(D.quietMs < D.ceilingMs);
  });

  test("an episode cannot end before it has had a chance to release", () => {
    assert.ok(D.episodeEndMs > D.quietMs);
  });

  test("the cooldown is longer than the deaf window it follows", () => {
    assert.ok(D.cooldownMs > D.playbackTailMs);
  });

  test("the voicing threshold is a proportion", () => {
    assert.ok(D.minPeriodicity > 0 && D.minPeriodicity <= 1);
    assert.ok(D.minBandRatio > 0 && D.minBandRatio <= 1);
  });

  test("uploads stay under Vercel's 4.5 MB request body cap", () => {
    const CAP = 4.5 * 1024 * 1024;
    assert.ok(LIMITS.maxClipBytes < CAP);
    assert.ok(LIMITS.maxAudioClipBytes < CAP);
  });

  test("a line can be both long enough and short enough to exist", () => {
    assert.ok(MIN_WORDS < MAX_WORDS);
  });

  test("the buffer refills before it empties", () => {
    assert.ok(LIMITS.lineBufferFloor < LIMITS.lineBufferTarget);
  });
});

/**
 * The bank is the floor under every failure mode. If one of its lines breaks
 * the rules, the safety net is the hazard.
 */
describe("the offline bank is itself safe", () => {
  const banned = bannedList([]);

  for (const line of fillBank("Biscuit")) {
    test(`bank line passes every rule: "${line}"`, () => {
      assert.equal(violates(line, banned), null);
    });
  }

  test("twenty lines, so a full-fallback session never sounds looped", () => {
    assert.ok(FALLBACK_LINES.length >= 20);
  });

  test("no two bank lines are the same", () => {
    assert.equal(new Set(FALLBACK_LINES).size, FALLBACK_LINES.length);
  });

  test("an empty name still produces usable lines", () => {
    for (const line of fillBank("")) {
      assert.doesNotMatch(line, /\{name\}/);
      assert.equal(violates(line, banned), null);
    }
  });

  /**
   * A dog can be called Walker. Its own name must not be censored as a
   * banned word — which is the reason the matcher uses a short ending list
   * rather than a prefix.
   */
  test("a dog whose name contains a banned word is still addressed by it", () => {
    for (const line of fillBank("Walker")) {
      assert.equal(violates(line, banned), null, `censored its own dog: ${line}`);
    }
  });
});
