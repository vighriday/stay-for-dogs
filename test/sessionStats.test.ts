import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { describeSession, hasTrend, summariseSession } from "../lib/sessionStats.ts";
import type { StayEvent } from "../lib/types.ts";

let n = 0;
const ev = (kind: StayEvent["kind"], at: number, extra: Partial<StayEvent> = {}): StayEvent =>
  ({ id: `e${++n}`, at, kind, ...extra }) as StayEvent;

/** A session where each upset is shorter and quieter than the last. */
const improving: StayEvent[] = [
  ev("session-start", 0),
  ev("upset", 60_000, { peakDb: -19 }),
  ev("spoke", 74_200, { peakDb: -19, line: "Easy now" }),
  ev("upset", 900_000, { peakDb: -23 }),
  ev("spoke", 909_600, { peakDb: -23, line: "That's it" }),
  ev("held", 950_000, { peakDb: -25 }),
  ev("upset", 2_000_000, { peakDb: -28 }),
  ev("spoke", 2_004_800, { peakDb: -28, line: "Good boy" }),
  ev("session-end", 2_550_000),
];

describe("summariseSession", () => {
  test("counts episodes, responses and holds", () => {
    const s = summariseSession(improving);
    assert.equal(s.episodes, 3);
    assert.equal(s.responses, 3);
    assert.equal(s.holds, 1);
    assert.deepEqual(s.linesSpoken, ["Easy now", "That's it", "Good boy"]);
  });

  test("measures each episode from upset to the event that closed it", () => {
    const s = summariseSession(improving);
    assert.deepEqual(s.episodeSeconds, [14.2, 9.6, 4.8]);
  });

  test("an episode closed by settling counts too — the dog got there alone", () => {
    const s = summariseSession([
      ev("session-start", 0),
      ev("upset", 1_000, { peakDb: -20 }),
      ev("settled", 11_000, { peakDb: -20 }),
      ev("session-end", 20_000),
    ]);
    assert.equal(s.episodes, 1);
    assert.equal(s.responses, 0);
  });

  test("an episode still open when the session ends still happened", () => {
    const s = summariseSession([
      ev("session-start", 0),
      ev("upset", 10_000, { peakDb: -20 }),
      ev("session-end", 25_000),
    ]);
    assert.equal(s.episodes, 1);
    assert.deepEqual(s.episodeSeconds, [15]);
  });

  test("an empty session is empty rather than an error", () => {
    const s = summariseSession([]);
    assert.equal(s.episodes, 0);
    assert.equal(s.responses, 0);
    assert.equal(s.minutes, 0);
  });

  test("a session where nothing happened reports the whole thing as quiet", () => {
    const s = summariseSession([ev("session-start", 0), ev("session-end", 600_000)]);
    assert.equal(s.episodes, 0);
    assert.equal(s.longestQuietMinutes, 10);
  });

  test("notices when a line came from the offline bank", () => {
    const s = summariseSession([
      ev("session-start", 0),
      ev("upset", 1_000, { peakDb: -20 }),
      ev("spoke", 5_000, { peakDb: -20, line: "Easy now", fromBank: true }),
      ev("session-end", 9_000),
    ]);
    assert.equal(s.usedBank, true);
  });
});

describe("the trend guard", () => {
  test("two episodes is not enough", () => {
    assert.equal(hasTrend({ ...summariseSession(improving), episodes: 2 }), false);
  });
  test("three is the floor", () => {
    assert.equal(hasTrend(summariseSession(improving)), true);
  });
});

describe("describeSession", () => {
  /**
   * The regression this file exists for.
   *
   * Peaks are dBFS: negative, and closer to zero means louder. Direction was
   * first computed as a ratio, so -28 / -19 came out as 1.47 and a dog that
   * was getting steadily quieter was reported as getting louder. Decibels are
   * logarithmic; only differences mean anything.
   */
  test("falling peaks are described as quieter, not louder", () => {
    const facts = describeSession(summariseSession(improving), true).join(" ");
    assert.match(facts, /quieter/);
    assert.doesNotMatch(facts, /louder/);
  });

  test("rising peaks are described as louder", () => {
    const worse = summariseSession(improving);
    worse.episodePeaks = [-34, -26, -18];
    const facts = describeSession(worse, true).join(" ");
    assert.match(facts, /louder/);
    assert.doesNotMatch(facts, /quieter/);
  });

  test("a change under 4 dB is not called a change at all", () => {
    const flat = summariseSession(improving);
    flat.episodePeaks = [-22, -21, -20];
    const facts = describeSession(flat, true).join(" ");
    assert.doesNotMatch(facts, /louder|quieter/);
  });

  test("shortening episodes are described as shortening", () => {
    const facts = describeSession(summariseSession(improving), true).join(" ");
    assert.match(facts, /shorter/);
  });

  /**
   * Whether a direction may be described is decided here, in code, before the
   * prompt is built — not asked of a model that wants to be helpful.
   */
  test("with too little data, no direction is described anywhere", () => {
    const thin = summariseSession(improving);
    thin.episodes = 2;
    thin.episodeSeconds = [14.2, 9.6];
    thin.episodePeaks = [-19, -28];
    const facts = describeSession(thin, false).join(" ");
    assert.match(facts, /too few/);
    assert.doesNotMatch(facts, /shorter|longer|quieter|louder/);
  });

  test("always records that answers came after the noise stopped", () => {
    const facts = describeSession(summariseSession(improving), true).join(" ");
    assert.match(facts, /after the noise had already stopped/);
  });

  test("says so plainly when Stay never spoke", () => {
    const quiet = summariseSession([
      ev("session-start", 0),
      ev("upset", 1_000, { peakDb: -20 }),
      ev("settled", 11_000, { peakDb: -20 }),
      ev("session-end", 20_000),
    ]);
    assert.match(describeSession(quiet, false).join(" "), /never spoke/);
  });

  /**
   * The model is handed these sentences and nothing else, so no measurement
   * may leak through them. A rounded duration in words is the one exception —
   * "about 45 minutes" is how a person says it.
   */
  test("no decibels, no units and no precise figures reach the model", () => {
    const facts = describeSession(summariseSession(improving), true).join(" ");
    assert.doesNotMatch(facts, /dB|dBFS|decibel/i);
    assert.doesNotMatch(facts, /\d+\.\d/, "no decimals — those are table values");
    assert.doesNotMatch(facts, /-\d/, "no negative numbers — those are peak levels");
  });

  test("every fact is a complete sentence", () => {
    for (const f of describeSession(summariseSession(improving), true)) {
      assert.match(f, /^[A-Z].*\.$/, `not a sentence: ${f}`);
    }
  });
});
