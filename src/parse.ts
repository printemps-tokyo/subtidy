/**
 * Block parser shared by the SRT and VTT readers.
 *
 * Both formats store cues as blank-line-separated blocks whose timing line
 * contains `-->`. The only differences are the millisecond separator (handled
 * by {@link parseTimeMs}) and VTT's header and NOTE/STYLE/REGION blocks, which
 * are skipped here. A leading index (SRT) or cue identifier (VTT) is ignored
 * because cues are renumbered on output.
 */

import type { Cue } from "./cue.js";
import { parseTimeMs } from "./time.js";

const SKIP_KEYWORDS = ["WEBVTT", "NOTE", "STYLE", "REGION"];

function splitBlocks(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length > 0) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

/** Parse subtitle text (SRT or VTT) into cues, in file order. */
export function parseCues(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of splitBlocks(text)) {
    const first = (block[0] ?? "").trimStart();
    if (SKIP_KEYWORDS.some((k) => first === k || first.startsWith(k + " "))) {
      continue;
    }
    const timingIdx = block.findIndex((l) => l.includes("-->"));
    if (timingIdx === -1) continue;

    const [rawStart, rest] = (block[timingIdx] as string).split("-->");
    if (rest === undefined) continue;
    // VTT may append cue settings after the end time; keep the first token.
    const rawEnd = rest.trim().split(/\s+/)[0] ?? "";
    const startMs = parseTimeMs(rawStart as string);
    const endMs = parseTimeMs(rawEnd);

    const text = block.slice(timingIdx + 1).join("\n");
    cues.push({ startMs, endMs, text });
  }
  return cues;
}
