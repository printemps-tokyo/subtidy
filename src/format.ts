/** Subtitle format detection and format-dispatched parse/serialize. */

import type { Cue } from "./cue.js";
import { parseSrt, serializeSrt } from "./srt.js";
import { parseVtt, serializeVtt } from "./vtt.js";

export type SubFormat = "srt" | "vtt";

/** Infer the subtitle format from a file path's extension. */
export function formatFromPath(path: string): SubFormat {
  const lower = path.toLowerCase();
  if (lower.endsWith(".vtt")) return "vtt";
  if (lower.endsWith(".srt")) return "srt";
  throw new Error(`cannot determine subtitle format from "${path}" (use .srt or .vtt)`);
}

/** Parse subtitle text using the reader for `format`. */
export function parseByFormat(text: string, format: SubFormat): Cue[] {
  return format === "vtt" ? parseVtt(text) : parseSrt(text);
}

/** Serialize cues using the writer for `format`. */
export function serializeByFormat(cues: Cue[], format: SubFormat): string {
  return format === "vtt" ? serializeVtt(cues) : serializeSrt(cues);
}
