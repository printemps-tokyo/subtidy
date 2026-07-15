/**
 * Building the `check` report: timing errors from {@link validateCues} merged
 * with readability warnings from {@link lintCues} into one issue list whose
 * rows serialize directly to the CLI's `--json` output.
 */

import { validateCues, lintCues, type Cue, type LintOptions } from "./cue.js";
import { formatTimeVtt } from "./time.js";

/** Timing errors always fail `check`; warnings only do so under `--strict`. */
export type CheckSeverity = "error" | "warning";

/** One row of a check report; the `--json` output is `{ issues: CheckIssue[] }`. */
export interface CheckIssue {
  /** The issue kind, e.g. "overlap" or "cps". */
  type: string;
  /** 1-based cue number, matching the CLI's text output. */
  cue: number;
  /** Cue start as `HH:MM:SS.mmm`. */
  start: string;
  /** Cue end as `HH:MM:SS.mmm`. */
  end: string;
  /** Measured value for readability warnings; null for timing errors. */
  value: number | null;
  /** Violated threshold for readability warnings; null for timing errors. */
  limit: number | null;
  message: string;
  severity: CheckSeverity;
}

const stamps = (c: Cue): { start: string; end: string } => ({
  start: formatTimeVtt(c.startMs),
  end: formatTimeVtt(c.endMs),
});

/**
 * Validate and lint `cues`, returning both kinds of finding as one list
 * ordered by cue number (timing errors before warnings on the same cue).
 */
export function buildCheckIssues(cues: Cue[], options: Partial<LintOptions> = {}): CheckIssue[] {
  const errors = validateCues(cues).map(
    (issue): CheckIssue => ({
      type: issue.kind,
      cue: issue.index + 1,
      ...stamps(cues[issue.index] as Cue),
      value: null,
      limit: null,
      message: issue.message,
      severity: "error",
    }),
  );
  const warnings = lintCues(cues, options).map(
    (issue): CheckIssue => ({
      type: issue.kind,
      cue: issue.index + 1,
      ...stamps(cues[issue.index] as Cue),
      value: issue.value,
      limit: issue.limit,
      message: issue.message,
      severity: "warning",
    }),
  );
  // Stable sort: errors stay ahead of warnings for the same cue.
  return [...errors, ...warnings].sort((a, b) => a.cue - b.cue);
}

/**
 * The exit code `check` should return: 1 when any timing error is present,
 * 1 when `strict` and any issue at all is present, otherwise 0.
 */
export function checkExitCode(issues: CheckIssue[], strict: boolean): number {
  if (issues.some((i) => i.severity === "error")) return 1;
  return strict && issues.length > 0 ? 1 : 0;
}
