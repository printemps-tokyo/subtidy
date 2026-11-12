/** Subtitle format detection and format-dispatched parse/serialize. */

import type { Cue } from "./cue.js";
import { parseSrt, serializeSrt } from "./srt.js";
import { parseVtt, serializeVtt } from "./vtt.js";
import { parseAss, serializeAss } from "./ass.js";

/** ssa is read (SubStation Alpha v4), and written as ass. */
export type SubFormat = "srt" | "vtt" | "ass" | "ssa";

/** Infer the subtitle format from a file path's extension. */
export function formatFromPath(path: string): SubFormat {
  const lower = path.toLowerCase();
  if (lower.endsWith(".vtt")) return "vtt";
  if (lower.endsWith(".srt")) return "srt";
  if (lower.endsWith(".ass")) return "ass";
  if (lower.endsWith(".ssa")) return "ssa";
  throw new Error(`cannot determine subtitle format from "${path}" (use .srt, .vtt, .ass or .ssa)`);
}

/**
 * Detect the format of subtitle text by content: a leading WEBVTT header
 * (optionally after a BOM) means vtt, a leading [Script Info] means ass,
 * anything else is treated as srt.
 */
export function sniffFormat(text: string): SubFormat {
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
  if (/^\s*\[Script Info\]/i.test(body)) return "ass";
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
  // SubStation Alpha v4 is read, and written as its successor.
  return inputFormat === "ssa" ? "ass" : inputFormat;
}

/** Parse subtitle text using the reader for `format`. */
export function parseByFormat(text: string, format: SubFormat): Cue[] {
  if (format === "ass" || format === "ssa") return parseAss(text);
  return format === "vtt" ? parseVtt(text) : parseSrt(text);
}

/**
 * Serialize cues using the writer for `format`. When writing .ass from .ass,
 * pass the input as `source` to keep its other sections (styles, fonts).
 */
export function serializeByFormat(
  cues: Cue[],
  format: SubFormat,
  source?: { format: SubFormat; text: string },
): string {
  if (format === "ssa") throw new Error("SubStation Alpha (.ssa) is read only; write .ass instead");
  if (format === "ass") return serializeAss(cues, source?.format === "ass" ? source.text : undefined);
  return format === "vtt" ? serializeVtt(cues) : serializeSrt(cues);
}
