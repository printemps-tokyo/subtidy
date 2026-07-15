import { describe, expect, it } from "vitest";
import { buildCheckIssues, checkExitCode } from "../src/check.js";
import type { Cue } from "../src/cue.js";

const cue = (startMs: number, endMs: number, text = "x"): Cue => ({ startMs, endMs, text });

describe("buildCheckIssues", () => {
  it("returns the --json issue shape with formatted timestamps", () => {
    const issues = buildCheckIssues([cue(1000, 2000, "a".repeat(25))]);
    expect(issues).toEqual([
      {
        type: "cps",
        cue: 1,
        start: "00:00:01.000",
        end: "00:00:02.000",
        value: 25,
        limit: 20,
        message: "reads at 25 chars/s (limit 20)",
        severity: "warning",
      },
    ]);
    // The wire format is exactly { issues: [...] } and survives JSON round-trip.
    const wire = JSON.parse(JSON.stringify({ issues })) as { issues: unknown[] };
    expect(Object.keys(wire)).toEqual(["issues"]);
    expect(wire.issues).toEqual(issues);
  });

  it("marks timing problems as errors with null value and limit", () => {
    const issues = buildCheckIssues([cue(0, 1200, "hello there"), cue(1000, 2000, "again ok")]);
    const overlap = issues.find((i) => i.type === "overlap");
    expect(overlap).toEqual({
      type: "overlap",
      cue: 1,
      start: "00:00:00.000",
      end: "00:00:01.200",
      value: null,
      limit: null,
      message: "overlaps the next cue",
      severity: "error",
    });
  });

  it("orders issues by cue number, errors before warnings on the same cue", () => {
    const issues = buildCheckIssues([
      cue(0, 1000, "a".repeat(25)), // cue 1: cps warning
      cue(900, 900, "hi"), // cue 2: non-positive duration error (and overlap on cue 1)
    ]);
    expect(issues.map((i) => [i.cue, i.severity])).toEqual([
      [1, "error"], // overlap with the next cue
      [1, "warning"], // cps
      [2, "error"], // non-positive duration
    ]);
  });

  it("passes lint thresholds through", () => {
    const issues = buildCheckIssues([cue(0, 600, "hi")], { minDurationMs: 500 });
    expect(issues).toEqual([]);
  });

  it("returns an empty list for a clean file", () => {
    expect(buildCheckIssues([cue(0, 1000, "hello"), cue(1000, 2000, "world")])).toEqual([]);
  });
});

describe("checkExitCode", () => {
  const errorsAndWarnings = buildCheckIssues([cue(1000, 900, "a".repeat(50))]);
  const warningsOnly = buildCheckIssues([cue(0, 1000, "a".repeat(25))]);

  it("fails on timing errors regardless of --strict", () => {
    expect(errorsAndWarnings.some((i) => i.severity === "error")).toBe(true);
    expect(checkExitCode(errorsAndWarnings, false)).toBe(1);
    expect(checkExitCode(errorsAndWarnings, true)).toBe(1);
  });

  it("treats warnings as non-fatal unless --strict", () => {
    expect(warningsOnly.every((i) => i.severity === "warning")).toBe(true);
    expect(checkExitCode(warningsOnly, false)).toBe(0);
    expect(checkExitCode(warningsOnly, true)).toBe(1);
  });

  it("returns 0 for no issues", () => {
    expect(checkExitCode([], false)).toBe(0);
    expect(checkExitCode([], true)).toBe(0);
  });
});
