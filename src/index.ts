/**
 * Public API for subtidy.
 *
 * `subtidy` tidies, shifts, and converts subtitle files. It is fully offline:
 * it parses `.srt` / `.vtt` text and never calls any network service. Every
 * transform is a pure function over a list of {@link Cue} objects.
 */

export { parseTimeMs, formatTimeSrt, formatTimeVtt } from "./time.js";

export type { Cue, CueIssue } from "./cue.js";
export {
  sortCues,
  shiftCues,
  shiftCuesFrom,
  rescaleCues,
  dropEmpty,
  fixOverlaps,
  snapGaps,
  validateCues,
} from "./cue.js";

export { parseCues } from "./parse.js";
export { parseSrt, serializeSrt } from "./srt.js";
export { parseVtt, serializeVtt } from "./vtt.js";

export type { SubFormat } from "./format.js";
export { formatFromPath, parseByFormat, serializeByFormat } from "./format.js";
