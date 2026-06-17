/** SubRip (.srt) reader and writer. */

import type { Cue } from "./cue.js";
import { parseCues } from "./parse.js";
import { formatTimeSrt } from "./time.js";

/** Parse SubRip text into cues. */
export function parseSrt(text: string): Cue[] {
  return parseCues(text);
}

/** Serialize cues as SubRip text. Cues are numbered from 1 in array order. */
export function serializeSrt(cues: Cue[]): string {
  const blocks = cues.map((c, i) => {
    const timing = `${formatTimeSrt(c.startMs)} --> ${formatTimeSrt(c.endMs)}`;
    return `${i + 1}\n${timing}\n${c.text}`;
  });
  return blocks.join("\n\n") + "\n";
}
