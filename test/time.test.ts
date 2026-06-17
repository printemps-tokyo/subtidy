import { describe, expect, it } from "vitest";
import { parseTimeMs, formatTimeSrt, formatTimeVtt } from "../src/time.js";

describe("parseTimeMs", () => {
  it("parses SRT timestamps (comma)", () => {
    expect(parseTimeMs("00:00:01,000")).toBe(1000);
    expect(parseTimeMs("01:02:03,500")).toBe(((1 * 60 + 2) * 60 + 3) * 1000 + 500);
  });

  it("parses VTT timestamps (dot, optional hours)", () => {
    expect(parseTimeMs("00:01.000")).toBe(1000);
    expect(parseTimeMs("00:00:01.250")).toBe(1250);
  });

  it("right-pads short fractional parts", () => {
    expect(parseTimeMs("00:00:01.5")).toBe(1500);
    expect(parseTimeMs("00:00:01.05")).toBe(1050);
  });

  it("rejects invalid input", () => {
    expect(() => parseTimeMs("nope")).toThrow();
    expect(() => parseTimeMs("00:99:00,000")).toThrow();
    expect(() => parseTimeMs("1:2:3")).toThrow();
  });
});

describe("formatTime", () => {
  it("formats SRT and VTT with the right separator", () => {
    expect(formatTimeSrt(3_661_500)).toBe("01:01:01,500");
    expect(formatTimeVtt(3_661_500)).toBe("01:01:01.500");
  });

  it("clamps negatives to zero and rounds", () => {
    expect(formatTimeSrt(-5)).toBe("00:00:00,000");
    expect(formatTimeVtt(1499.6)).toBe("00:00:01.500");
  });

  it("round-trips through parse", () => {
    const ms = 5_025_375;
    expect(parseTimeMs(formatTimeSrt(ms))).toBe(ms);
    expect(parseTimeMs(formatTimeVtt(ms))).toBe(ms);
  });
});
