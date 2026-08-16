import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ALWAYS_BANNED, bannedList, violates } from "../lib/lineRules.ts";

/**
 * These are the rules standing between a language model and a distressed
 * animal. Everything here is a case that either did go wrong, or would be
 * expensive if it did.
 */

const BANNED = bannedList([]);

describe("banned words", () => {
  test("blocks the plain word", () => {
    assert.match(String(violates("Time for a walk now", BANNED)), /banned word/);
  });

  /**
   * The regression that started this file.
   *
   * The prompt tells the model "never use any word from the banned list, in
   * any form, including inside other words". The validator only matched whole
   * words, so every inflection passed — and "we are going walking soon" is
   * about the worst sentence this app could say out loud.
   */
  for (const line of [
    "We are going walking soon",
    "She walked away quietly",
    "Two walks today already",
    "Sitting by the door waiting",
    "The doors are all shut",
  ]) {
    test(`blocks an inflected form: "${line}"`, () => {
      assert.match(String(violates(line, BANNED)), /banned word/);
    });
  }

  /**
   * The reason this is an ending list rather than a prefix match. A bare
   * prefix on "car" would swallow every one of these.
   */
  for (const line of [
    "Lie down on the carpet",
    "Careful now, easy does it",
    "You are such a good one",
    "Nice and calm now",
  ]) {
    test(`allows an innocent word that merely starts the same: "${line}"`, () => {
      assert.equal(violates(line, BANNED), null);
    });
  }

  test("matches case-insensitively", () => {
    assert.match(String(violates("Time for a WALK now", BANNED)), /banned word/);
  });

  test("honours a word the owner added themselves", () => {
    const list = bannedList(["sofa"]);
    assert.equal(violates("Get off the sofa now", list), 'banned word "sofa"');
    assert.equal(violates("Get off the sofa now", BANNED), null);
  });

  test("owner words are inflected too", () => {
    assert.match(String(violates("Stop the barking please", bannedList(["bark"]))), /banned/);
  });

  /**
   * The owner types this list by hand. A stray regex metacharacter must be a
   * harmless string, not a pattern that matches everything or throws.
   */
  test("treats owner input as literal text, not a pattern", () => {
    const list = bannedList([".*", "(", "[a-z]"]);
    assert.doesNotThrow(() => violates("You are alright now", list));
    assert.equal(violates("You are alright now", list), null);
  });

  test("ignores blank entries in the owner's list", () => {
    const list = bannedList(["", "   "]);
    assert.equal(violates("You are alright now", list), null);
  });
});

describe("shape rules", () => {
  test("rejects a line that is too short", () => {
    assert.equal(violates("Easy", BANNED), "too short");
  });

  test("rejects a line that is too long", () => {
    assert.equal(violates("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen", BANNED), "too long");
  });

  test("rejects a punctuated question — they make a dog expect something", () => {
    assert.equal(violates("You are alright in there?", BANNED), "question or exclamation");
  });

  /**
   * Writing the test above revealed that only the punctuation was checked, so
   * an unpunctuated question walked straight through. A question is a question
   * to a dog whether or not it ends in a mark.
   */
  test("rejects an unpunctuated question by its opening word", () => {
    assert.equal(violates("Are you alright in there", BANNED), "question or exclamation");
    assert.equal(violates("Where have you been hiding", BANNED), "question or exclamation");
  });

  test("does not mistake an ordinary calming line for a question", () => {
    assert.equal(violates("You are alright now", BANNED), null);
    assert.equal(violates("That's it, settle down now", BANNED), null);
    assert.equal(violates("Nothing to worry about here", BANNED), null);
  });

  test("rejects exclamations — excitement is the opposite of the goal", () => {
    assert.equal(violates("Good boy, settle down now!", BANNED), "question or exclamation");
  });

  test("rejects quotation marks, straight and curly", () => {
    assert.equal(violates('He said "settle down now"', BANNED), "quotation marks");
    assert.equal(violates("He said “settle down now”", BANNED), "quotation marks");
  });

  test("rejects emoji", () => {
    assert.equal(violates("Good boy, settle down \u{1F415}", BANNED), "emoji");
  });

  test("counts words rather than characters, so extra spacing is harmless", () => {
    assert.equal(violates("  Easy   now,   you're   alright  ", BANNED), null);
  });
});

describe("the bank obeys its own rules", () => {
  test("every permanent banned word is lowercase and non-empty", () => {
    for (const w of ALWAYS_BANNED) {
      assert.equal(w, w.toLowerCase());
      assert.ok(w.length > 0);
    }
  });
});
