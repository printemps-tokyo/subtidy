/** WebVTT (.vtt) reader and writer. */

import type { Cue } from "./cue.js";
import { parseCues } from "./parse.js";
import { formatTimeVtt } from "./time.js";

/** Parse WebVTT text into cues (header and NOTE/STYLE blocks are ignored). */
export function parseVtt(text: string): Cue[] {
  return parseCues(text);
}

/** Serialize cues as WebVTT text, including the required `WEBVTT` header. */
export function serializeVtt(cues: Cue[]): string {
  const blocks = cues.map((c) => {
    const timing = `${formatTimeVtt(c.startMs)} --> ${formatTimeVtt(c.endMs)}`;
    return `${timing}\n${c.text}`;
  });
  return ["WEBVTT", "", ...joinWithBlank(blocks)].join("\n") + "\n";
}

function joinWithBlank(blocks: string[]): string[] {
  const out: string[] = [];
  blocks.forEach((b, i) => {
    if (i > 0) out.push("");
    out.push(b);
  });
  return out;
}
