/**
 * Timestamp parsing and formatting for SubRip (.srt) and WebVTT (.vtt).
 *
 * SRT uses `HH:MM:SS,mmm` (comma before milliseconds); VTT uses
 * `HH:MM:SS.mmm` or `MM:SS.mmm` (dot, hours optional). The parser accepts
 * either separator and optional hours so the same code reads both formats.
 */

/** Matches `[HH:]MM:SS[.,]mmm` with either separator and optional hours. */
const TIME_RE = /^(?:(\d+):)?([0-5]?\d):([0-5]\d)[.,](\d{1,3})$/;

/**
 * Parse a subtitle timestamp into whole milliseconds. Accepts both `,` and `.`
 * as the millisecond separator and an optional hours field. Throws on input
 * that is not a valid timestamp.
 */
export function parseTimeMs(input: string): number {
  const m = TIME_RE.exec(input.trim());
  if (!m) {
    throw new Error(`invalid timestamp: ${JSON.stringify(input)}`);
  }
  const hours = m[1] ? Number(m[1]) : 0;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  // Fractional part is right-padded so "5" means 500ms, not 5ms.
  const millis = Number((m[4] + "000").slice(0, 3));
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

function parts(totalMs: number): { h: number; m: number; s: number; ms: number } {
  const ms = Math.max(0, Math.round(totalMs));
  return {
    h: Math.floor(ms / 3_600_000),
    m: Math.floor(ms / 60_000) % 60,
    s: Math.floor(ms / 1000) % 60,
    ms: ms % 1000,
  };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");
const pad3 = (n: number): string => String(n).padStart(3, "0");

/** Format milliseconds as an SRT timestamp: `HH:MM:SS,mmm`. */
export function formatTimeSrt(totalMs: number): string {
  const { h, m, s, ms } = parts(totalMs);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

/** Format milliseconds as a VTT timestamp: `HH:MM:SS.mmm`. */
export function formatTimeVtt(totalMs: number): string {
  const { h, m, s, ms } = parts(totalMs);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
}
