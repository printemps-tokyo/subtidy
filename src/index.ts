/**
 * Public API for subtidy.
 *
 * `subtidy` tidies, shifts, and converts subtitle files. It is fully offline:
 * it parses `.srt` / `.vtt` text and never calls any network service. Every
 * transform is a pure function over a list of {@link Cue} objects.
 */

export { parseTimeMs, formatTimeSrt, formatTimeVtt } from "./time.js";

export type { Cue, CueIssue, LintIssue, LintOptions } from "./cue.js";
export {
  sortCues,
  shiftCues,
  shiftCuesFrom,
  rescaleCues,
  dropEmpty,
  fixOverlaps,
  snapGaps,
  validateCues,
  lintCues,
  DEFAULT_LINT_OPTIONS,
} from "./cue.js";

export type { CheckIssue, CheckSeverity } from "./check.js";
export { buildCheckIssues, checkExitCode } from "./check.js";

export { parseCues } from "./parse.js";
export { parseSrt, serializeSrt } from "./srt.js";
export { parseVtt, serializeVtt } from "./vtt.js";

export type { SubFormat } from "./format.js";
export {
  formatFromPath,
  sniffFormat,
  resolveInputFormat,
  resolveOutputFormat,
  parseByFormat,
  serializeByFormat,
} from "./format.js";
