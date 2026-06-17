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
