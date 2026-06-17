#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import {
  parseTimeMs,
  parseByFormat,
  serializeByFormat,
  formatFromPath,
  shiftCues,
  shiftCuesFrom,
  rescaleCues,
  dropEmpty,
  fixOverlaps,
  snapGaps,
  validateCues,
  sortCues,
  type Cue,
  type SubFormat,
} from "./index.js";

const HELP = `subtidy - tidy, shift, and convert subtitle files (.srt / .vtt)

Usage:
  subtidy <command> [options] <file>

Commands:
  shift    Move every cue by a number of seconds (sync correction)
  retime   Scale every timestamp by a factor (frame-rate mismatch)
  convert  Convert between .srt and .vtt
  clean    Sort, drop empty cues, fix overlaps, and renumber
  check    Report timing problems (non-zero exit if any are found)

Common options:
  -o, --output <file>   Write here; the extension picks the output format
                        (default: write to stdout in the input's format)
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

Examples:
  subtidy shift --by +2.5 -o out.srt in.srt
  subtidy retime --scale 23.976/25 -o out.srt in.srt
  subtidy convert -o out.vtt in.srt
  subtidy clean --snap-gaps 120 -o out.srt in.srt
  subtidy check in.vtt
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

interface Values {
  output?: string;
  by?: string;
  from?: string;
  scale?: string;
  "snap-gaps"?: string;
  "keep-overlaps"?: boolean;
  "keep-empty"?: boolean;
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

async function runCheck(path: string, inFormat: SubFormat): Promise<number> {
  const text = await readFile(path, "utf8");
  const cues = parseByFormat(text, inFormat);
  const issues = validateCues(cues);
  if (issues.length === 0) {
    process.stdout.write(`ok: ${cues.length} cue(s), no issues\n`);
    return 0;
  }
  for (const issue of issues) {
    process.stderr.write(`cue ${issue.index + 1}: ${issue.kind} - ${issue.message}\n`);
  }
  process.stderr.write(`found ${issues.length} issue(s)\n`);
  return 1;
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
        scale: { type: "string" },
        "snap-gaps": { type: "string" },
        "keep-overlaps": { type: "boolean", default: false },
        "keep-empty": { type: "boolean", default: false },
      },
    });
    values = parsed.values as Values;
    positionals = parsed.positionals;
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 1;
  }

  if (positionals.length !== 1) {
    process.stderr.write("error: expected exactly one input file\n\n" + HELP);
    return 1;
  }
  const inputPath = positionals[0] as string;

  let inFormat: SubFormat;
  let outFormat: SubFormat;
  try {
    inFormat = formatFromPath(inputPath);
    outFormat = values.output ? formatFromPath(values.output) : inFormat;
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 1;
  }

  if (command === "check") {
    try {
      return await runCheck(inputPath, inFormat);
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`);
      return 1;
    }
  }

  let text: string;
  try {
    text = await readFile(inputPath, "utf8");
  } catch {
    process.stderr.write(`error: cannot read "${inputPath}"\n`);
    return 1;
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
