import { describe, expect, it } from "vitest";
import {
  sortCues,
  shiftCues,
  shiftCuesFrom,
  rescaleCues,
  dropEmpty,
  fixOverlaps,
  snapGaps,
  validateCues,
  lintCues,
  type Cue,
} from "../src/cue.js";

const cue = (startMs: number, endMs: number, text = "x"): Cue => ({ startMs, endMs, text });

describe("sortCues", () => {
  it("orders by start time, stable for ties", () => {
    const out = sortCues([cue(200, 300, "b"), cue(100, 150, "a"), cue(200, 250, "c")]);
    expect(out.map((c) => c.text)).toEqual(["a", "b", "c"]);
  });
});

describe("shiftCues", () => {
  it("shifts forward", () => {
    expect(shiftCues([cue(1000, 2000)], 500)).toEqual([cue(1500, 2500)]);
  });

  it("clamps start to zero and drops cues pushed before zero", () => {
    expect(shiftCues([cue(1000, 2000)], -1500)).toEqual([cue(0, 500)]);
    expect(shiftCues([cue(1000, 2000)], -2000)).toEqual([]);
  });
});

describe("shiftCuesFrom", () => {
  it("only shifts cues at or after the anchor", () => {
    const cues = [cue(1000, 2000, "early"), cue(5000, 6000, "late")];
    const out = shiftCuesFrom(cues, 5000, 1000);
    expect(out).toEqual([cue(1000, 2000, "early"), cue(6000, 7000, "late")]);
  });
});

describe("rescaleCues", () => {
  it("multiplies and rounds timestamps", () => {
    expect(rescaleCues([cue(1000, 2000)], 0.5)).toEqual([cue(500, 1000)]);
  });

  it("rejects non-positive factors", () => {
    expect(() => rescaleCues([cue(0, 1)], 0)).toThrow();
  });
});

describe("dropEmpty", () => {
  it("removes whitespace-only cues", () => {
    expect(dropEmpty([cue(0, 1, "  "), cue(2, 3, "hi")])).toEqual([cue(2, 3, "hi")]);
  });
});

describe("fixOverlaps", () => {
  it("truncates an overlapping cue to the next start", () => {
    const out = fixOverlaps([cue(0, 1200, "a"), cue(1000, 2000, "b")]);
    expect(out).toEqual([cue(0, 1000, "a"), cue(1000, 2000, "b")]);
  });

  it("drops a cue fully swallowed by the next", () => {
    const out = fixOverlaps([cue(1000, 1100, "a"), cue(1000, 2000, "b")]);
    expect(out).toEqual([cue(1000, 2000, "b")]);
  });
});

describe("snapGaps", () => {
  it("closes small gaps but leaves large ones", () => {
    const out = snapGaps([cue(0, 1000, "a"), cue(1100, 2000, "b"), cue(5000, 6000, "c")], 200);
    expect(out[0]?.endMs).toBe(1100);
    expect(out[1]?.endMs).toBe(2000);
  });
});

describe("validateCues", () => {
  it("flags non-positive duration, out-of-order, and empty", () => {
    // cue 0 ends before it starts and has no text; cue 1 starts before cue 0.
    const kinds = validateCues([cue(1000, 900, ""), cue(500, 800, "x")]).map((i) => i.kind);
    expect(kinds).toContain("non-positive-duration");
    expect(kinds).toContain("empty-text");
    expect(kinds).toContain("out-of-order");
  });

  it("flags overlap when a cue runs into the next", () => {
    const kinds = validateCues([cue(0, 1200, "a"), cue(1000, 2000, "b")]).map((i) => i.kind);
    expect(kinds).toEqual(["overlap"]);
  });

  it("returns no issues for clean input", () => {
    expect(validateCues([cue(0, 1000), cue(1000, 2000)])).toEqual([]);
  });
});

describe("lintCues", () => {
  it("passes a cue exactly at the CPS threshold", () => {
    // 20 chars over 1000ms is exactly 20 chars/s: at the limit, not over it.
    expect(lintCues([cue(0, 1000, "a".repeat(20))])).toEqual([]);
  });

  it("flags a cue just over the CPS threshold", () => {
    const issues = lintCues([cue(0, 1000, "a".repeat(21))]);
    expect(issues).toEqual([
      {
        index: 0,
        kind: "cps",
        value: 21,
        limit: 20,
        message: "reads at 21 chars/s (limit 20)",
      },
    ]);
  });

  it("prints a value visibly above the limit for a barely-over cue", () => {
    // 501 chars over 25s is 20.04 chars/s: over the limit of 20. The message
    // must not round this down to "20", which would look like an at-limit
    // value being flagged.
    const issues = lintCues([cue(0, 25000, "a".repeat(501))], { maxLineLength: 1000 });
    expect(issues).toEqual([
      {
        index: 0,
        kind: "cps",
        value: 20.04,
        limit: 20,
        message: "reads at 20.04 chars/s (limit 20)",
      },
    ]);
    expect(issues[0]!.value).toBeGreaterThan(issues[0]!.limit);
  });

  it("rounds the printed value up when rounding down would hide the violation", () => {
    // 4001 chars over 200s is 20.005 chars/s. Plain rounding to two decimals
    // would print 20 chars/s, so the value is rounded up to 20.01 instead.
    const issues = lintCues([cue(0, 200000, "a".repeat(4001))], { maxLineLength: 5000 });
    expect(issues.map((i) => i.kind)).toEqual(["cps"]);
    const cps = issues[0]!;
    expect(cps.value).toBe(20.01);
    expect(cps.value).toBeGreaterThan(cps.limit);
    expect(cps.message).toBe("reads at 20.01 chars/s (limit 20)");
  });

  it("excludes newlines from the CPS character count", () => {
    // 20 visible chars split over two lines: the \n must not push CPS to 21.
    expect(lintCues([cue(0, 1000, "a".repeat(10) + "\n" + "a".repeat(10))])).toEqual([]);
  });

  it("honors a custom CPS threshold (e.g. lower for CJK)", () => {
    const slow = lintCues([cue(0, 1000, "あ".repeat(13))], { maxCps: 12 });
    expect(slow.map((i) => i.kind)).toEqual(["cps"]);
    expect(slow[0]?.value).toBe(13);
    expect(slow[0]?.limit).toBe(12);
  });

  it("passes a cue displayed exactly for the minimum duration", () => {
    expect(lintCues([cue(0, 700, "hi")])).toEqual([]);
  });

  it("flags a cue displayed just under the minimum duration", () => {
    const issues = lintCues([cue(0, 699, "hi")]);
    expect(issues).toEqual([
      {
        index: 0,
        kind: "min-duration",
        value: 699,
        limit: 700,
        message: "displayed for 699ms (minimum 700ms)",
      },
    ]);
  });

  it("honors a custom minimum duration", () => {
    expect(lintCues([cue(0, 699, "hi")], { minDurationMs: 500 })).toEqual([]);
  });

  it("skips CPS and duration checks for non-positive durations", () => {
    // validateCues owns non-positive durations; lint must not double-report.
    expect(lintCues([cue(1000, 1000, "a".repeat(50))]).map((i) => i.kind)).toEqual([
      "line-length",
    ]);
    expect(lintCues([cue(1000, 900, "hi")])).toEqual([]);
  });

  it("passes lines exactly at the length limit, per line of a multi-line cue", () => {
    const text = "a".repeat(42) + "\n" + "b".repeat(42);
    expect(lintCues([cue(0, 10_000, text)])).toEqual([]);
  });

  it("flags the longest line of a multi-line cue once", () => {
    const text = "short line\n" + "b".repeat(43);
    const issues = lintCues([cue(0, 10_000, text)]);
    expect(issues).toEqual([
      {
        index: 0,
        kind: "line-length",
        value: 43,
        limit: 42,
        message: "line is 43 chars (limit 42)",
      },
    ]);
  });

  it("counts characters as code points, not UTF-16 units", () => {
    // 22 astral emoji are 44 UTF-16 units but only 22 characters.
    expect(lintCues([cue(0, 10_000, "𝄞".repeat(22))])).toEqual([]);
  });

  it("reports every violated check for the same cue with a rounded CPS value", () => {
    const issues = lintCues([cue(0, 500, "a".repeat(43))]);
    expect(issues.map((i) => i.kind)).toEqual(["cps", "min-duration", "line-length"]);
    expect(issues[0]?.value).toBe(86); // 43 chars / 0.5s
    expect(lintCues([cue(0, 900, "a".repeat(20))])[0]?.value).toBe(22.22);
  });

  it("counts a decomposed character the same as its precomposed form", () => {
    // "café" precomposed is 4 code points; decomposed ("cafe" + combining
    // acute) is 5. NFC normalization collapses the decomposed form so both
    // count as 4 and are treated identically. At maxCps 4 over 1000ms the
    // precomposed form is exactly at the limit; without NFC the decomposed
    // form would over-count to 5 chars/s and be flagged.
    const precomposed = "café"; // é as U+00E9
    const decomposed = "café"; // e + U+0301 combining acute
    expect(decomposed).not.toBe(precomposed); // different code point sequences
    const opts = { maxCps: 4, maxLineLength: 1000 };
    expect(lintCues([cue(0, 1000, decomposed)], opts)).toEqual(
      lintCues([cue(0, 1000, precomposed)], opts),
    );
    expect(lintCues([cue(0, 1000, decomposed)], opts)).toEqual([]);
  });

  it("leaves an ordinary CJK string's character count unaffected by NFC", () => {
    // Hiragana has no canonical decomposition, so NFC is a no-op here: the
    // count stays 13, matching the raw code point count.
    const issues = lintCues([cue(0, 1000, "あ".repeat(13))], { maxCps: 12 });
    expect(issues.map((i) => i.kind)).toEqual(["cps"]);
    expect(issues[0]?.value).toBe(13);
  });

  it("flips the CPS decision for a borderline previously over-counted string", () => {
    // 20 acute-e over 1000ms. Precomposed that is 20 code points = exactly the
    // default limit of 20, so it passes. Written decomposed it is 40 code
    // points and, before NFC normalization, over-counted to 40 chars/s and was
    // flagged. NFC collapses it back to 20 chars/s, so it now passes too.
    const precomposed = "é".repeat(20); // 20 code points -> 20 chars/s
    const decomposed = "é".repeat(20); // 40 code points raw -> 20 after NFC
    expect(Array.from(decomposed).length).toBe(40); // over-counted before the fix
    expect(lintCues([cue(0, 1000, decomposed)], { maxLineLength: 1000 })).toEqual([]);
    expect(lintCues([cue(0, 1000, decomposed)], { maxLineLength: 1000 })).toEqual(
      lintCues([cue(0, 1000, precomposed)], { maxLineLength: 1000 }),
    );
  });

  it("measures line length after NFC normalization too", () => {
    // 42 decomposed acute-e is 84 raw code points but 42 after NFC, so the
    // line sits exactly at the default limit and passes; a 43rd pushes it over.
    expect(lintCues([cue(0, 10_000, "é".repeat(42))])).toEqual([]);
    const over = lintCues([cue(0, 10_000, "é".repeat(43))], { maxCps: 1000 });
    expect(over.map((i) => i.kind)).toEqual(["line-length"]);
    expect(over[0]?.value).toBe(43);
  });
});
