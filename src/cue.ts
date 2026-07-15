/**
 * The subtitle cue model and pure transforms over a list of cues.
 *
 * A `Cue` is a timed block of text in whole milliseconds. Every transform here
 * is pure (no IO) and returns a new array, which keeps them easy to unit test.
 */

export interface Cue {
  /** Start time in milliseconds from the media origin. */
  startMs: number;
  /** End time in milliseconds (exclusive). */
  endMs: number;
  /** Cue text; may contain `\n` for multiple lines. */
  text: string;
}

/** A problem found by {@link validateCues}. `index` is the cue's position. */
export interface CueIssue {
  index: number;
  kind: "non-positive-duration" | "overlap" | "out-of-order" | "empty-text";
  message: string;
}

/** Readability thresholds used by {@link lintCues}. Values at a limit pass. */
export interface LintOptions {
  /** Maximum reading speed in characters per second (newlines excluded). */
  maxCps: number;
  /** Minimum time a cue must stay on screen, in milliseconds. */
  minDurationMs: number;
  /** Maximum number of characters allowed on a single line. */
  maxLineLength: number;
}

/**
 * Default thresholds, tuned for Latin scripts. CJK text carries more meaning
 * per character and is read slower, so consider a lower `maxCps` for it.
 */
export const DEFAULT_LINT_OPTIONS: LintOptions = {
  maxCps: 20,
  minDurationMs: 700,
  maxLineLength: 42,
};

/** A readability problem found by {@link lintCues}. `index` is the cue's position. */
export interface LintIssue {
  index: number;
  kind: "cps" | "min-duration" | "line-length";
  /** The measured value: chars/s, display time in ms, or line length in chars. */
  value: number;
  /** The threshold the value violated. */
  limit: number;
  message: string;
}

/** Return a copy of `cues` sorted by start time (stable for equal starts). */
export function sortCues(cues: Cue[]): Cue[] {
  return cues
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.startMs - b.c.startMs || a.i - b.i)
    .map(({ c }) => c);
}

/**
 * Shift every cue by `deltaMs` (which may be negative). Cues are clamped to a
 * non-negative start, and any cue that ends at or before zero is dropped.
 */
export function shiftCues(cues: Cue[], deltaMs: number): Cue[] {
  return shiftCuesFrom(cues, Number.NEGATIVE_INFINITY, deltaMs);
}

/**
 * Shift only the cues whose original start is at or after `fromMs`. Useful when
 * a recording drifts out of sync partway through. Clamps and drops as
 * {@link shiftCues} does.
 */
export function shiftCuesFrom(cues: Cue[], fromMs: number, deltaMs: number): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    if (c.startMs < fromMs) {
      out.push(c);
      continue;
    }
    const endMs = c.endMs + deltaMs;
    if (endMs <= 0) continue;
    out.push({ ...c, startMs: Math.max(0, c.startMs + deltaMs), endMs });
  }
  return out;
}

/**
 * Multiply every timestamp by `factor`. This corrects a constant frame-rate
 * mismatch (e.g. 25 vs 23.976 fps -> factor 23.976/25). `factor` must be > 0.
 */
export function rescaleCues(cues: Cue[], factor: number): Cue[] {
  if (!(factor > 0)) {
    throw new Error("rescale factor must be greater than zero");
  }
  return cues.map((c) => ({
    ...c,
    startMs: Math.round(c.startMs * factor),
    endMs: Math.round(c.endMs * factor),
  }));
}

/** Drop cues whose text is empty or only whitespace. */
export function dropEmpty(cues: Cue[]): Cue[] {
  return cues.filter((c) => c.text.trim() !== "");
}

/**
 * Truncate each cue that overlaps the next one so its end meets the next start.
 * Assumes the input is sorted; cues left with a non-positive duration are
 * dropped. Returns a new array.
 */
export function fixOverlaps(cues: Cue[]): Cue[] {
  const sorted = sortCues(cues);
  const out: Cue[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = { ...(sorted[i] as Cue) };
    const next = sorted[i + 1];
    if (next && cur.endMs > next.startMs) {
      cur.endMs = next.startMs;
    }
    if (cur.endMs > cur.startMs) out.push(cur);
  }
  return out;
}

/**
 * Close tiny gaps: when the gap between a cue and the next is greater than zero
 * but at most `maxGapMs`, extend the earlier cue's end to the next cue's start.
 * Assumes sorted input. Returns a new array.
 */
export function snapGaps(cues: Cue[], maxGapMs: number): Cue[] {
  const sorted = sortCues(cues);
  return sorted.map((c, i) => {
    const next = sorted[i + 1];
    if (!next) return { ...c };
    const gap = next.startMs - c.endMs;
    return gap > 0 && gap <= maxGapMs ? { ...c, endMs: next.startMs } : { ...c };
  });
}

/** Report timing problems without modifying the cues. Input order is checked. */
export function validateCues(cues: Cue[]): CueIssue[] {
  const issues: CueIssue[] = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i] as Cue;
    if (c.endMs <= c.startMs) {
      issues.push({ index: i, kind: "non-positive-duration", message: "end is not after start" });
    }
    if (c.text.trim() === "") {
      issues.push({ index: i, kind: "empty-text", message: "cue has no text" });
    }
    const next = cues[i + 1];
    if (next) {
      if (next.startMs < c.startMs) {
        issues.push({ index: i + 1, kind: "out-of-order", message: "starts before the previous cue" });
      } else if (next.startMs < c.endMs) {
        issues.push({ index: i, kind: "overlap", message: "overlaps the next cue" });
      }
    }
  }
  return issues;
}

/** Count Unicode code points, so characters outside the BMP count once. */
const countChars = (text: string): number => Array.from(text).length;

/**
 * Report readability problems without modifying the cues: reading speed above
 * `maxCps` (characters per second, newlines excluded), display time below
 * `minDurationMs`, and lines longer than `maxLineLength` characters. Values
 * exactly at a threshold pass. Cues with a non-positive duration are skipped
 * by the speed and duration checks; {@link validateCues} reports those.
 */
export function lintCues(cues: Cue[], options: Partial<LintOptions> = {}): LintIssue[] {
  const { maxCps, minDurationMs, maxLineLength } = { ...DEFAULT_LINT_OPTIONS, ...options };
  const issues: LintIssue[] = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i] as Cue;
    const durationMs = c.endMs - c.startMs;
    if (durationMs > 0) {
      const cps = (countChars(c.text.replace(/\n/g, "")) * 1000) / durationMs;
      if (cps > maxCps) {
        const value = Math.round(cps * 10) / 10;
        issues.push({
          index: i,
          kind: "cps",
          value,
          limit: maxCps,
          message: `reads at ${value} chars/s (limit ${maxCps})`,
        });
      }
      if (durationMs < minDurationMs) {
        issues.push({
          index: i,
          kind: "min-duration",
          value: durationMs,
          limit: minDurationMs,
          message: `displayed for ${durationMs}ms (minimum ${minDurationMs}ms)`,
        });
      }
    }
    const longest = Math.max(...c.text.split("\n").map(countChars));
    if (longest > maxLineLength) {
      issues.push({
        index: i,
        kind: "line-length",
        value: longest,
        limit: maxLineLength,
        message: `line is ${longest} chars (limit ${maxLineLength})`,
      });
    }
  }
  return issues;
}
