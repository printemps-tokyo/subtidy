#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import {
  parseTimeMs,
  parseByFormat,
  serializeByFormat,
  resolveInputFormat,
  resolveOutputFormat,
  shiftCues,
  shiftCuesFrom,
  rescaleCues,
  dropEmpty,
  fixOverlaps,
  snapGaps,
  sortCues,
  buildCheckIssues,
  checkExitCode,
  type Cue,
  type SubFormat,
  type LintOptions,
} from "./index.js";
import { usageError } from "./usage.js";

const COMMANDS = new Set(["shift", "retime", "convert", "clean", "check"]);

const HELP = `subtidy - tidy, shift, and convert subtitle files (.srt / .vtt)

Usage:
  subtidy <command> [options] <file | ->

Commands:
  shift    Move every cue by a number of seconds (sync correction)
  retime   Scale every timestamp by a factor (frame-rate mismatch)
  convert  Convert between .srt and .vtt
  clean    Sort, drop empty cues, fix overlaps, and renumber
  check    Report timing errors and readability warnings (non-zero exit on
           timing errors; add --strict to fail on warnings too)

Pass "-" as the input file to read the subtitle text from stdin. Without
--output the result is written to stdout, so subtidy composes in a pipe.

Common options:
  -o, --output <file>   Write here; the extension picks the output format
                        (default: write to stdout in the input's format)
  --input <srt|vtt>     Input format, for when it cannot be inferred from the
                        input extension. Stdin defaults to auto-detect: a
                        leading WEBVTT header means vtt, anything else is
                        treated as srt.
  --to <srt|vtt>        Output format, regardless of the output extension
  -h, --help            Show this help
  -v, --version         Show version

shift options:
  --by <seconds>        Shift amount, e.g. 2.5 or -1.25 (required)
  --from <timestamp>    Only shift cues at/after this time (e.g. 00:10:00)

retime options:
  --scale <factor>      A ratio like 23.976/25 or a number like 0.959 (required)

clean options:
  --snap-gaps <ms>      Close gaps up to this many ms by extending the earlier cue
  --keep-overlaps       Do not truncate overlapping cues
  --keep-empty          Do not drop empty cues

check options:
  --cps <n>             Warn when a cue reads faster than n characters per
                        second, newlines excluded (default 20; CJK is read
                        slower per character, so consider a lower value)
  --min-duration <ms>   Warn when a cue is shown for less than this (default 700)
  --max-line <chars>    Warn when a line is longer than this (default 42)
  --strict              Readability warnings also make the exit code non-zero
  --json                Print issues as JSON to stdout, for CI

Examples:
  subtidy shift --by +2.5 -o out.srt in.srt
  subtidy retime --scale 23.976/25 -o out.srt in.srt
  subtidy convert -o out.vtt in.srt
  subtidy clean --snap-gaps 120 -o out.srt in.srt
  subtidy check in.vtt
  subtidy check --strict --json captions.srt
  cat raw.srt | subtidy clean - > tidy.srt
  cat headerless.vtt | subtidy clean --input vtt - > tidy.vtt
  curl -s https://example.com/captions.vtt | subtidy convert --to srt - > out.srt
`;

/** Parse a signed seconds value (e.g. "+2.5", "-1.25") into milliseconds. */
function parseSeconds(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`--by must be a number of seconds (got "${value}")`);
  }
  return Math.round(n * 1000);
}

/** Parse a scale factor: a plain number or an "a/b" ratio. Must be > 0. */
function parseScale(value: string): number {
  let factor: number;
  if (value.includes("/")) {
    const [a, b] = value.split("/");
    const num = Number(a);
    const den = Number(b);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
      throw new Error(`--scale ratio is invalid (got "${value}")`);
    }
    factor = num / den;
  } else {
    factor = Number(value);
  }
  if (!(factor > 0) || !Number.isFinite(factor)) {
    throw new Error(`--scale must be greater than zero (got "${value}")`);
  }
  return factor;
}

/** Parse a positive integer (milliseconds). */
function parseMs(name: string, value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`--${name} must be a non-negative integer (got "${value}")`);
  }
  return n;
}

/** Parse a positive number, integer or not (e.g. a CPS threshold like 12.5). */
function parsePositiveNumber(name: string, value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--${name} must be a positive number (got "${value}")`);
  }
  return n;
}

/** Parse a positive integer (a character count). */
function parsePositiveInt(name: string, value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--${name} must be a positive integer (got "${value}")`);
  }
  return n;
}

interface Values {
  output?: string;
  by?: string;
  from?: string;
  input?: string;
  to?: string;
  scale?: string;
  "snap-gaps"?: string;
  "keep-overlaps"?: boolean;
  "keep-empty"?: boolean;
  cps?: string;
  "min-duration"?: string;
  "max-line"?: string;
  strict?: boolean;
  json?: boolean;
}

/** Narrow an --input/--to value to a subtitle format, or return undefined. */
function asFormat(value: string | undefined): SubFormat | undefined {
  return value === "srt" || value === "vtt" ? value : undefined;
}

/** Read all of stdin as UTF-8 text. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Run `clean`'s default tidy pass, honoring the keep-* opt-outs. */
function cleanCues(cues: Cue[], values: Values): Cue[] {
  let out = sortCues(cues);
  if (!values["keep-empty"]) out = dropEmpty(out);
  if (!values["keep-overlaps"]) out = fixOverlaps(out);
  if (values["snap-gaps"] !== undefined) {
    out = snapGaps(out, parseMs("snap-gaps", values["snap-gaps"]));
  }
  return out;
}

/** Apply the command's transform to the parsed cues. */
function transform(command: string, cues: Cue[], values: Values): Cue[] {
  switch (command) {
    case "shift": {
      if (values.by === undefined) throw new Error("shift requires --by <seconds>");
      const deltaMs = parseSeconds(values.by);
      return values.from === undefined
        ? shiftCues(cues, deltaMs)
        : shiftCuesFrom(cues, parseTimeMs(values.from), deltaMs);
    }
    case "retime": {
      if (values.scale === undefined) throw new Error("retime requires --scale <factor>");
      return rescaleCues(cues, parseScale(values.scale));
    }
    case "convert":
      return cues;
    case "clean":
      return cleanCues(cues, values);
    default:
      throw new Error(`unknown command "${command}" (try: shift, retime, convert, clean, check)`);
  }
}

async function readVersion(): Promise<string> {
  const { fileURLToPath } = await import("node:url");
  const { join, dirname } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const raw = await readFile(join(here, "..", "package.json"), "utf8");
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

function runCheck(text: string, inFormat: SubFormat, values: Values): number {
  const lintOptions: Partial<LintOptions> = {};
  if (values.cps !== undefined) {
    lintOptions.maxCps = parsePositiveNumber("cps", values.cps);
  }
  if (values["min-duration"] !== undefined) {
    lintOptions.minDurationMs = parseMs("min-duration", values["min-duration"]);
  }
  if (values["max-line"] !== undefined) {
    lintOptions.maxLineLength = parsePositiveInt("max-line", values["max-line"]);
  }

  const cues = parseByFormat(text, inFormat);
  const issues = buildCheckIssues(cues, lintOptions);
  const exit = checkExitCode(issues, values.strict === true);

  if (values.json) {
    process.stdout.write(JSON.stringify({ issues }, null, 2) + "\n");
    return exit;
  }
  if (issues.length === 0) {
    process.stdout.write(`ok: ${cues.length} cue(s), no issues\n`);
    return exit;
  }
  let errors = 0;
  let warnings = 0;
  for (const issue of issues) {
    if (issue.severity === "error") errors++;
    else warnings++;
    const label = issue.severity === "warning" ? "warning: " : "";
    process.stderr.write(
      `cue ${issue.cue} (${issue.start} --> ${issue.end}): ${label}${issue.type} - ${issue.message}\n`,
    );
  }
  process.stderr.write(`found ${errors} error(s), ${warnings} warning(s)\n`);
  return exit;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    return argv.length === 0 ? 1 : 0;
  }
  if (argv.includes("-v") || argv.includes("--version")) {
    process.stdout.write((await readVersion()) + "\n");
    return 0;
  }

  const command = argv[0] as string;
  const rest = argv.slice(1);

  let values: Values;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        output: { type: "string", short: "o" },
        by: { type: "string" },
        from: { type: "string" },
        input: { type: "string" },
        to: { type: "string" },
        scale: { type: "string" },
        "snap-gaps": { type: "string" },
        "keep-overlaps": { type: "boolean", default: false },
        "keep-empty": { type: "boolean", default: false },
        cps: { type: "string" },
        "min-duration": { type: "string" },
        "max-line": { type: "string" },
        strict: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
      },
    });
    values = parsed.values as Values;
    positionals = parsed.positionals;
  } catch (err) {
    process.stderr.write(usageError(err, COMMANDS.has(command) ? `subtidy ${command}` : "subtidy"));
    return 1;
  }

  if (positionals.length !== 1) {
    process.stderr.write("error: expected exactly one input file (or - for stdin)\n\n" + HELP);
    return 1;
  }
  const inputPath = positionals[0] as string;
  const isStdin = inputPath === "-";

  const inputFormat = asFormat(values.input);
  if (values.input !== undefined && inputFormat === undefined) {
    process.stderr.write(`error: --input must be "srt" or "vtt" (got "${values.input}")\n`);
    return 1;
  }
  if (values.from !== undefined && command !== "shift") {
    process.stderr.write("error: --from is only valid with shift (a timestamp like 00:10:00)\n");
    return 1;
  }
  if (command !== "check") {
    const checkFlags: string[] = [];
    if (values.cps !== undefined) checkFlags.push("--cps");
    if (values["min-duration"] !== undefined) checkFlags.push("--min-duration");
    if (values["max-line"] !== undefined) checkFlags.push("--max-line");
    if (values.strict) checkFlags.push("--strict");
    if (values.json) checkFlags.push("--json");
    if (checkFlags.length > 0) {
      process.stderr.write(`error: ${checkFlags.join(", ")} only valid with check\n`);
      return 1;
    }
  }
  const toFormat = asFormat(values.to);
  if (values.to !== undefined && toFormat === undefined) {
    process.stderr.write(`error: --to must be "srt" or "vtt" (got "${values.to}")\n`);
    return 1;
  }

  let text: string;
  try {
    text = isStdin ? await readStdin() : await readFile(inputPath, "utf8");
  } catch {
    process.stderr.write(`error: cannot read "${isStdin ? "stdin" : inputPath}"\n`);
    return 1;
  }

  let inFormat: SubFormat;
  let outFormat: SubFormat;
  try {
    inFormat = resolveInputFormat(inputPath, inputFormat, text);
    outFormat = resolveOutputFormat(values.output, toFormat, inFormat);
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 1;
  }

  if (command === "check") {
    try {
      return runCheck(text, inFormat, values);
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`);
      return 1;
    }
  }

  let output: string;
  try {
    const cues = parseByFormat(text, inFormat);
    const result = transform(command, cues, values);
    output = serializeByFormat(result, outFormat);
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 1;
  }

  if (values.output) {
    try {
      await writeFile(values.output, output, "utf8");
    } catch (err) {
      process.stderr.write(`error: cannot write "${values.output}": ${(err as Error).message}\n`);
      return 1;
    }
    process.stderr.write(`wrote ${values.output}\n`);
  } else {
    process.stdout.write(output);
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
