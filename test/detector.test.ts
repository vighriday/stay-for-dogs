import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  barking,
  concat,
  kinds,
  run,
  silence,
  speech,
  transient,
  voiced,
} from "./harness.ts";

/**
 * The detector, running in CI.
 *
 * These drive `public/stay-detector.worklet.js` itself — the same file the
 * browser loads — with signals built in code. That matters because the
 * detector's worst failure mode is silence: the first version of it detected
 * nothing at all on a real barking dog, and looked perfectly healthy doing it.
 *
 * The clip sweep on /test measures how often it is right. These measure
 * *why* — that each rule does the job it was added for, on a signal shaped
 * to isolate that rule.
 */

describe("the two ways into an episode", () => {
  test("three voiced bursts inside the window start an episode", async () => {
    const events = await run(concat(silence(300), barking(3), silence(4000)));
    assert.ok(kinds(events).includes("upset"), "barking did not register");
  });

  /**
   * The rule the first version got wrong in the other direction. One bang is
   * an event, not a pattern — this is what keeps a door out.
   */
  test("a single burst is not an episode", async () => {
    const events = await run(concat(silence(300), barking(1), silence(3000)));
    assert.ok(!kinds(events).includes("upset"), "one burst should not be enough");
  });

  test("two bursts are still not enough", async () => {
    const events = await run(concat(silence(300), barking(2), silence(3000)));
    assert.ok(!kinds(events).includes("upset"));
  });

  /**
   * Whining is the opposite shape from barking: quiet, but unbroken. One rule
   * cannot catch both, which is why there are two.
   */
  test("an unbroken voiced stretch starts an episode without any repetition", async () => {
    const events = await run(concat(silence(300), voiced(700, 2000), silence(3000)));
    assert.ok(kinds(events).includes("upset"), "a sustained whine was missed");
  });
});

describe("the voicing test", () => {
  /**
   * The measurement that justified this whole gate: four of seven door
   * recordings triggered the detector before it existed. A slam is loud, sits
   * in the same band as a bark, and arrives in several separated transients —
   * it passes every other test.
   */
  test("loud broadband transients do not start an episode, however many", async () => {
    const events = await run(
      concat(
        silence(300),
        transient(120), silence(280),
        transient(120), silence(280),
        transient(120), silence(280),
        transient(120), silence(3000),
      ),
    );
    assert.ok(
      !kinds(events).includes("upset"),
      "four unvoiced transients were mistaken for a dog",
    );
  });

  test("a voiced sound at the same loudness does start one", async () => {
    const events = await run(concat(silence(300), barking(3), silence(4000)));
    assert.ok(kinds(events).includes("upset"));
  });
});

describe("the loudness gate", () => {
  test("silence produces nothing at all", async () => {
    assert.deepEqual(await run(silence(5000)), []);
  });

  test("a voiced sound below the gate is ignored", async () => {
    const quiet = concat(silence(300), barking(4), silence(3000));
    for (let i = 0; i < quiet.length; i++) quiet[i] *= 0.004;
    assert.ok(!kinds(await run(quiet)).includes("upset"));
  });

  test("raising sensitivity lets a quieter dog through", async () => {
    const faint = concat(silence(300), barking(4), silence(3000));
    for (let i = 0; i < faint.length; i++) faint[i] *= 0.03;

    const atNoisyRoom = await run(faint, { sensitivity: 1 });
    const atQuietRoom = await run(faint, { sensitivity: 0 });

    assert.ok(!kinds(atNoisyRoom).includes("upset"), "should be under the noisy-room gate");
    assert.ok(kinds(atQuietRoom).includes("upset"), "should clear the quiet-room gate");
  });
});

describe("answering the quiet", () => {
  test("it does not speak while the dog is still going", async () => {
    // Barking straight through, ending before the quiet rule could ever fire.
    const events = await run(concat(silence(300), barking(6, 200, 250)));
    assert.ok(kinds(events).includes("upset"));
    assert.ok(!kinds(events).includes("speak"), "it answered the noise");
  });

  test("it speaks once the dog has been quiet, and says why", async () => {
    const events = await run(concat(silence(300), barking(4), silence(4000)));
    const speak = events.find((e) => e.type === "speak");
    assert.ok(speak, "never released a response");
    assert.equal(speak.trigger, "settled");
  });

  test("the response comes after the noise stops, not during it", async () => {
    const events = await run(concat(silence(300), barking(4), silence(4000)));
    const order = kinds(events);
    assert.ok(order.indexOf("upset") < order.indexOf("speak"));
  });

  /**
   * A dog that cannot settle must not be ignored for failing to meet a
   * threshold. This is the rule that makes it a comfort device rather than a
   * device that rewards only success.
   */
  test("a dog that never settles is answered anyway, on the ceiling rule", async () => {
    const events = await run(concat(silence(300), voiced(600, 22_000)));
    const speak = events.find((e) => e.type === "speak");
    assert.ok(speak, "an inconsolable dog was ignored");
    assert.equal(speak.trigger, "ceiling");
  });
});

describe("the cooldown", () => {
  test("a second episode inside the window is recorded but not answered", async () => {
    const events = await run(
      concat(
        silence(300),
        barking(4), silence(4000),   // first episode → answered
        barking(4), silence(4000),   // second, well inside the 90s cooldown
      ),
    );
    assert.equal(events.filter((e) => e.type === "speak").length, 1, "spoke twice too soon");
    assert.ok(kinds(events).includes("held"), "the second episode was not logged");
  });

  test("a shorter cooldown allows the second answer", async () => {
    const events = await run(
      concat(silence(300), barking(4), silence(4000), barking(4), silence(4000)),
      { cooldownMs: 1000 },
    );
    assert.equal(events.filter((e) => e.type === "speak").length, 2);
  });
});

/**
 * The documented limitation, asserted.
 *
 * Human speech is voiced and sits inside 300–2500 Hz, so this detector cannot
 * tell a person from a dog and a television will set it off. That is written
 * on the product's own results page, and it is a deliberate trade: raising the
 * pitch floor removes it and costs a whining clip.
 *
 * It is a test so that it cannot be quietly "fixed" without someone noticing
 * that the whining case went with it.
 */
describe("the known limitation", () => {
  test("a speech-like voiced signal still triggers it, as documented", async () => {
    const events = await speechLike();
    assert.ok(
      kinds(events).includes("upset"),
      "if this now passes, the pitch floor moved — check the whining clip on /test",
    );
  });
});

async function speechLike() {
  // 150 Hz fundamental — an adult speaking voice. The energy sits in the
  // formants, inside the dog band, and the period lands inside the lag range
  // the detector scans. Which is exactly the problem.
  const parts = [silence(300)];
  for (let i = 0; i < 4; i++) {
    parts.push(speech(150, 300));
    parts.push(silence(220));
  }
  parts.push(silence(3000));
  return run(concat(...parts));
}
