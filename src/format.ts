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

/**
 * Detect the format of subtitle text by content: a leading WEBVTT header
 * (optionally after a BOM) means vtt, anything else is treated as srt.
 */
export function sniffFormat(text: string): SubFormat {
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
  return /^WEBVTT($|[ \t\r\n])/.test(body) ? "vtt" : "srt";
}

/**
 * Resolve the input format: an explicit format wins, stdin ("-") is sniffed
 * from the text, and a file path falls back to its extension.
 */
export function resolveInputFormat(
  inputPath: string,
  explicit: SubFormat | undefined,
  text: string,
): SubFormat {
  if (explicit !== undefined) return explicit;
  if (inputPath === "-") return sniffFormat(text);
  return formatFromPath(inputPath);
}

/**
 * Resolve the output format: an explicit format wins, then the output path's
 * extension, then the input format.
 */
export function resolveOutputFormat(
  outputPath: string | undefined,
  explicit: SubFormat | undefined,
  inputFormat: SubFormat,
): SubFormat {
  if (explicit !== undefined) return explicit;
  if (outputPath !== undefined) return formatFromPath(outputPath);
  return inputFormat;
}

/** Parse subtitle text using the reader for `format`. */
export function parseByFormat(text: string, format: SubFormat): Cue[] {
  return format === "vtt" ? parseVtt(text) : parseSrt(text);
}

/** Serialize cues using the writer for `format`. */
export function serializeByFormat(cues: Cue[], format: SubFormat): string {
  return format === "vtt" ? serializeVtt(cues) : serializeSrt(cues);
}
