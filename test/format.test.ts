import { describe, expect, it } from "vitest";
import { parseSrt, serializeSrt } from "../src/srt.js";
import { parseVtt, serializeVtt } from "../src/vtt.js";
import {
  formatFromPath,
  sniffFormat,
  resolveInputFormat,
  resolveOutputFormat,
} from "../src/format.js";

const SRT = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,000 --> 00:00:06,500
Second
line
`;

const VTT = `WEBVTT

NOTE this is a comment

00:00:01.000 --> 00:00:04.000 align:start position:50%
Hello world

caption-2
00:00:05.000 --> 00:00:06.500
Second
line
`;

describe("parseSrt", () => {
  it("reads cues and multi-line text", () => {
    const cues = parseSrt(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ startMs: 1000, endMs: 4000, text: "Hello world" });
    expect(cues[1]?.text).toBe("Second\nline");
  });
});

describe("parseVtt", () => {
  it("skips the header and NOTE block, drops cue settings and ids", () => {
    const cues = parseVtt(VTT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ startMs: 1000, endMs: 4000, text: "Hello world" });
    expect(cues[1]?.text).toBe("Second\nline");
  });
});

describe("serialize", () => {
  it("renumbers SRT from 1", () => {
    const out = serializeSrt([
      { startMs: 1000, endMs: 2000, text: "a" },
      { startMs: 3000, endMs: 4000, text: "b" },
    ]);
    expect(out).toBe("1\n00:00:01,000 --> 00:00:02,000\na\n\n2\n00:00:03,000 --> 00:00:04,000\nb\n");
  });

  it("writes the WEBVTT header", () => {
    const out = serializeVtt([{ startMs: 1000, endMs: 2000, text: "a" }]);
    expect(out).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\na\n");
  });
});

describe("conversion round-trip", () => {
  it("srt -> vtt -> srt preserves cues", () => {
    const original = parseSrt(SRT);
    const back = parseVtt(serializeVtt(original));
    expect(back).toEqual(original);
  });
});

describe("formatFromPath", () => {
  it("detects by extension and rejects others", () => {
    expect(formatFromPath("a.srt")).toBe("srt");
    expect(formatFromPath("dir/B.VTT")).toBe("vtt");
    expect(() => formatFromPath("a.txt")).toThrow();
  });
});

describe("sniffFormat", () => {
  it("detects a WEBVTT header", () => {
    expect(sniffFormat(VTT)).toBe("vtt");
    expect(sniffFormat("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\na\n")).toBe("vtt");
  });

  it("accepts a BOM and header text after WEBVTT", () => {
    expect(sniffFormat("\uFEFFWEBVTT\n\n")).toBe("vtt");
    expect(sniffFormat("WEBVTT - my captions\n\n")).toBe("vtt");
    expect(sniffFormat("WEBVTT")).toBe("vtt");
  });

  it("treats anything else as srt", () => {
    expect(sniffFormat(SRT)).toBe("srt");
    expect(sniffFormat("WEBVTTX\n")).toBe("srt");
    expect(sniffFormat("1\n00:00:01,000 --> 00:00:02,000\na\n")).toBe("srt");
    expect(sniffFormat("")).toBe("srt");
  });
});

describe("resolveInputFormat", () => {
  it("prefers the explicit format over path and content", () => {
    expect(resolveInputFormat("a.srt", "vtt", SRT)).toBe("vtt");
    expect(resolveInputFormat("-", "srt", VTT)).toBe("srt");
  });

  it("sniffs the text when reading from stdin", () => {
    expect(resolveInputFormat("-", undefined, VTT)).toBe("vtt");
    expect(resolveInputFormat("-", undefined, SRT)).toBe("srt");
  });

  it("falls back to the file extension", () => {
    expect(resolveInputFormat("a.vtt", undefined, SRT)).toBe("vtt");
    expect(() => resolveInputFormat("a.txt", undefined, SRT)).toThrow();
  });
});

describe("resolveOutputFormat", () => {
  it("prefers the explicit format over the output extension", () => {
    expect(resolveOutputFormat("out.srt", "vtt", "srt")).toBe("vtt");
    expect(resolveOutputFormat(undefined, "vtt", "srt")).toBe("vtt");
  });

  it("uses the output extension, then the input format", () => {
    expect(resolveOutputFormat("out.vtt", undefined, "srt")).toBe("vtt");
    expect(resolveOutputFormat(undefined, undefined, "srt")).toBe("srt");
    expect(() => resolveOutputFormat("out.txt", undefined, "srt")).toThrow();
  });
});
