# subtidy

> Tidy, shift, and convert `.srt` / `.vtt` subtitle files. Zero-dependency CLI.

[![CI](https://github.com/printemps-tokyo/subtidy/actions/workflows/ci.yml/badge.svg)](https://github.com/printemps-tokyo/subtidy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

`subtidy` fixes the small, annoying problems with subtitle files: audio that is
a couple of seconds out of sync, a frame-rate mismatch that makes captions
drift, the wrong container format, and overlapping or empty cues. It reads
SubRip (`.srt`) and WebVTT (`.vtt`), works entirely offline, and has no runtime
dependencies.

## Why

Subtitle fixes usually mean opening a heavy GUI editor or hand-editing
timestamps. `subtidy` turns the common chores into one command each: nudge the
timing, rescale for a frame-rate difference, convert between `.srt` and `.vtt`,
and clean up overlaps. Every transform is a pure function, so the behavior is
predictable and well tested.

## Requirements

- Node.js >= 20

## Install

Not published to npm yet — install from source:

```bash
git clone https://github.com/printemps-tokyo/subtidy
cd subtidy
npm install && npm run build
npm link   # optional: puts the `subtidy` command on your PATH
```

Then run `subtidy …` (after `npm link`), or `node dist/cli.js …` from the clone.

## Commands

```bash
subtidy shift   [options] <file>   # move every cue by N seconds (sync fix)
subtidy retime  [options] <file>   # scale every timestamp (frame-rate fix)
subtidy convert [options] <file>   # convert between .srt and .vtt
subtidy clean   [options] <file>   # sort, drop empty, fix overlaps, renumber
subtidy check            <file>    # report timing problems (non-zero exit)
```

The input format is read from the file extension. By default the result is
written to stdout in the input's format; pass `-o <file>` to write to a file,
whose extension picks the output format (so you can convert and transform in
one step).

Run `subtidy --help` for the full option list.

### shift

Move the whole track, or only the tail, by a number of seconds. Positive values
delay the captions; negative values pull them earlier.

```bash
subtidy shift --by +2.5 -o out.srt in.srt          # everything 2.5s later
subtidy shift --by -1.25 in.srt                     # 1.25s earlier, to stdout
subtidy shift --by 3 --from 00:10:00 -o out.srt in.srt  # only from 10:00 on
```

| Option | Description |
| --- | --- |
| `--by <seconds>` | Shift amount, e.g. `2.5` or `-1.25` (required) |
| `--from <timestamp>` | Only shift cues at/after this time (e.g. `00:10:00`) |
| `-o, --output <file>` | Output path (default: stdout) |

### retime

Multiply every timestamp by a factor to correct a constant frame-rate mismatch.
The factor can be a ratio (`new/old` fps) or a plain number.

```bash
subtidy retime --scale 23.976/25 -o out.srt in.srt  # 25 fps source -> 23.976
subtidy retime --scale 1.0427 in.srt
```

| Option | Description |
| --- | --- |
| `--scale <factor>` | A ratio like `23.976/25` or a number like `0.959` (required) |
| `-o, --output <file>` | Output path (default: stdout) |

### convert

Convert between `.srt` and `.vtt`. The target format comes from the `-o`
extension.

```bash
subtidy convert -o out.vtt in.srt
subtidy convert -o out.srt in.vtt
```

WebVTT headers, `NOTE`/`STYLE`/`REGION` blocks, cue identifiers, and cue
settings (e.g. `align:start`) are read but not carried over; cues are renumbered
on output.

### clean

Tidy a messy file: sort cues by start time, drop empty cues, truncate cues that
overlap the next one, and renumber. Optionally close tiny gaps.

```bash
subtidy clean -o out.srt in.srt
subtidy clean --snap-gaps 120 -o out.srt in.srt   # also close gaps up to 120ms
subtidy clean --keep-overlaps --keep-empty in.srt  # opt out of those steps
```

| Option | Description |
| --- | --- |
| `--snap-gaps <ms>` | Close gaps up to this many ms by extending the earlier cue |
| `--keep-overlaps` | Do not truncate overlapping cues |
| `--keep-empty` | Do not drop empty cues |
| `-o, --output <file>` | Output path (default: stdout) |

### check

Report timing problems without changing the file. Exits non-zero when any issue
is found, so it fits in CI or a pre-commit hook.

```bash
subtidy check captions.srt
#  cue 4: overlap - overlaps the next cue
#  found 1 issue(s)
```

Reported issues: non-positive duration, overlap with the next cue, cues out of
order, and empty text.

## Programmatic API

```ts
import {
  parseSrt,
  serializeVtt,
  shiftCues,
  rescaleCues,
  fixOverlaps,
  validateCues,
} from "@printemps-tokyo/subtidy";

const cues = parseSrt(srtText);
const synced = shiftCues(cues, 2500); // milliseconds
const vtt = serializeVtt(fixOverlaps(synced));
const issues = validateCues(cues);
```

All transforms operate on `Cue` objects (`{ startMs, endMs, text }`) in whole
milliseconds and are pure.

## License

[MIT](./LICENSE) (c) printemps.tokyo
