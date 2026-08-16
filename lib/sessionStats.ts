import type { SessionStats, StayEvent } from "./types";

/**
 * Turns a session's event log into numbers.
 *
 * This is deliberately a pure function with no model anywhere near it. Gemini
 * is given the output and asked to write sentences; it is never asked to work
 * out what happened, because a language model handed a list of timestamps will
 * produce a confident trend out of two data points every single time.
 *
 * The division of labour is the point:
 *   this file  — what happened
 *   Gemini     — how to say it to a worried person
 */
export function summariseSession(events: StayEvent[]): SessionStats {
  const start = events.find((e) => e.kind === "session-start")?.at ?? events[0]?.at ?? 0;
  const last = events[events.length - 1]?.at ?? start;

  const episodeSeconds: number[] = [];
  const episodePeaks: number[] = [];
  const linesSpoken: string[] = [];
  const episodeStarts: number[] = [];

  let openedAt: number | null = null;
  let openPeak = 0;
  let responses = 0;
  let holds = 0;
  let usedBank = false;

  for (const e of events) {
    switch (e.kind) {
      case "upset":
        openedAt = e.at;
        openPeak = e.peakDb ?? 0;
        episodeStarts.push(e.at);
        break;

      // Both of these close an episode: "spoke" because answering ends it,
      // "settled" because the dog got there on its own.
      case "spoke":
      case "settled":
        if (e.kind === "spoke") {
          responses++;
          if (e.line) linesSpoken.push(e.line);
          if (e.fromBank) usedBank = true;
        }
        if (openedAt !== null) {
          episodeSeconds.push(round1((e.at - openedAt) / 1000));
          episodePeaks.push(Math.round(e.peakDb ?? openPeak));
          openedAt = null;
        }
        break;

      case "held":
        holds++;
        break;
    }
  }

  // An episode still open when the session ended still counts — it happened.
  if (openedAt !== null) {
    episodeSeconds.push(round1((last - openedAt) / 1000));
    episodePeaks.push(Math.round(openPeak));
  }

  let longestQuietMs = episodeStarts.length ? episodeStarts[0] - start : last - start;
  for (let i = 1; i < episodeStarts.length; i++) {
    longestQuietMs = Math.max(longestQuietMs, episodeStarts[i] - episodeStarts[i - 1]);
  }
  if (episodeStarts.length) {
    longestQuietMs = Math.max(longestQuietMs, last - episodeStarts[episodeStarts.length - 1]);
  }

  return {
    minutes: round1((last - start) / 60000),
    episodes: episodeSeconds.length,
    responses,
    holds,
    episodeSeconds,
    episodePeaks,
    longestQuietMinutes: round1(longestQuietMs / 60000),
    linesSpoken,
    usedBank,
  };
}

/**
 * Whether the numbers support saying anything about direction at all.
 *
 * Three episodes is the floor, and even that is thin. It is enforced here
 * rather than left to the prompt, because a rule the model can be talked out
 * of is not a rule.
 */
export function hasTrend(stats: SessionStats): boolean {
  return stats.episodes >= 3;
}

/**
 * Turns the numbers into plain statements that are already true.
 *
 * The first version of this feature handed Gemini the raw figures and a prompt
 * telling it not to recite them. It recited them anyway, every time, including
 * the dBFS units — because asking a model to hold a list of numbers and then
 * not mention them is fighting the model instead of designing around it.
 *
 * So the model is never shown a number. It is shown sentences that are already
 * correct, and asked only to make them read like a person wrote them. Nothing
 * it can say is unsupported, because there is nothing else in front of it.
 * The table above the prose is where numbers belong.
 */
export function describeSession(stats: SessionStats, trendAllowed: boolean): string[] {
  const facts: string[] = [];

  facts.push(`The session lasted ${humanDuration(stats.minutes)}.`);
  facts.push(`The dog got upset ${count(stats.episodes)}.`);

  if (trendAllowed) {
    const d = direction(stats.episodeSeconds);
    if (d === "down") facts.push("Each upset was shorter than the one before it.");
    else if (d === "mostly-down") facts.push("The upsets got shorter overall, though not every single one.");
    else if (d === "up") facts.push("Each upset lasted longer than the one before it.");
    else if (d === "mostly-up") facts.push("The upsets got longer overall, though not every single one.");
    else facts.push("The upsets were all roughly the same length as each other.");

    const loud = loudnessDirection(stats.episodePeaks);
    if (loud === "quieter") facts.push("The upsets also got quieter as the session went on.");
    else if (loud === "louder") facts.push("The upsets got louder as the session went on.");
  } else {
    facts.push(
      "This is too few upsets to say anything at all about whether things are getting better or worse.",
    );
  }

  if (stats.longestQuietMinutes >= 4) {
    facts.push(
      `There was one long stretch of ${humanDuration(stats.longestQuietMinutes)} with nothing at all.`,
    );
  }

  if (stats.responses === 0) {
    facts.push("Stay never spoke — the dog settled on its own each time.");
  } else if (stats.responses >= stats.episodes) {
    facts.push("Stay answered every upset.");
  } else {
    facts.push(`Stay answered ${count(stats.responses)}.`);
  }

  if (stats.responses > 0) {
    facts.push("Every answer came after the noise had already stopped, never during it.");
  }

  if (stats.holds > 0) {
    facts.push(
      `${count(stats.holds, true)}, Stay heard the dog and deliberately stayed quiet, because it had spoken recently.`,
    );
  }

  if (stats.usedBank) {
    facts.push("Some of what it said came from its offline backup lines rather than newly written ones.");
  }

  return facts;
}

/**
 * Which way loudness moved, in decibels.
 *
 * Peaks are dBFS: negative, and closer to zero means louder. They cannot be
 * compared by ratio the way durations can — decibels are logarithmic, so
 * -28/-19 is not "1.5 times" anything, and an earlier version of this file
 * used that ratio and confidently reported a quietening dog as a worsening
 * one. Differences are the only meaningful comparison, and 4 dB is about the
 * smallest change worth mentioning to a person.
 */
function loudnessDirection(peaks: number[]): "louder" | "quieter" | "flat" {
  if (peaks.length < 3) return "flat";
  const change = peaks[peaks.length - 1] - peaks[0];
  if (change <= -4) return "quieter";
  if (change >= 4) return "louder";
  return "flat";
}

/** Which way a positive, linear series moves, if it moves at all. */
function direction(xs: number[]): "down" | "mostly-down" | "up" | "mostly-up" | "flat" {
  if (xs.length < 3) return "flat";
  const first = xs[0];
  const last = xs[xs.length - 1];
  if (first === 0) return "flat";

  const ratio = last / first;
  const monotonic = (cmp: (a: number, b: number) => boolean) =>
    xs.every((x, i) => i === 0 || cmp(x, xs[i - 1]));

  if (ratio <= 0.75) return monotonic((a, b) => a <= b) ? "down" : "mostly-down";
  if (ratio >= 1.33) return monotonic((a, b) => a >= b) ? "up" : "mostly-up";
  return "flat";
}

function humanDuration(minutes: number): string {
  if (minutes < 1) return "well under a minute";
  if (minutes < 2) return "about a minute";
  if (minutes < 10) return `about ${Math.round(minutes)} minutes`;
  if (minutes < 50) return `about ${Math.round(minutes / 5) * 5} minutes`;
  if (minutes < 75) return "about an hour";
  if (minutes < 105) return "about an hour and a half";
  return `about ${Math.round(minutes / 60)} hours`;
}

const WORDS = [
  "no times", "once", "twice", "three times", "four times", "five times",
  "six times", "seven times", "eight times", "nine times", "ten times",
];

function count(n: number, capitalised = false): string {
  const s = n < WORDS.length ? WORDS[n] : `${n} times`;
  return capitalised ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
