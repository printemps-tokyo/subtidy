import { describe, expect, it } from "vitest";
import {
  decodeAssText,
  encodeAssText,
  formatAssTime,
  parseAss,
  parseAssTime,
  serializeAss,
} from "../src/ass.js";
import { lintCues, visibleText } from "../src/cue.js";
import { parseByFormat, resolveOutputFormat, serializeByFormat, sniffFormat } from "../src/format.js";
import { shiftCues } from "../src/cue.js";

const ASS = [
  "[Script Info]",
  "Title: sample",
  "ScriptType: v4.00+",
  "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  "Style: Sign,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1",
  "",
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  "Dialogue: 0,0:00:01.00,0:00:03.50,Default,Ann,0,0,0,,{\\i1}Hello{\\i0}, world\\Nsecond line",
  "Comment: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,not a cue",
  "Dialogue: 1,0:00:04.00,0:00:05.00,Sign,,0,0,0,,{\\pos(960,100)\\fad(200,200)}EXIT",
  "",
  "[Fonts]",
  "fontname: x.ttf",
  "",
].join("\r\n");

describe("ASS times", () => {
  it("reads hundredths and writes them rounded", () => {
    expect(parseAssTime("0:00:03.50")).toBe(3500);
    expect(parseAssTime("1:02:03.04")).toBe(3_723_040);
    expect(formatAssTime(3_723_045)).toBe("1:02:03.05");
    expect(formatAssTime(0)).toBe("0:00:00.00");
    expect(() => parseAssTime("3.5")).toThrow(/ASS timestamp/);
  });
});

describe("ASS text", () => {
  it("decodes line breaks and italic/bold/underline, and drops other overrides", () => {
    expect(decodeAssText("{\\i1}Hi{\\i0}\\Nthere\\nnow")).toBe("<i>Hi</i>\nthere\nnow");
    expect(decodeAssText("{\\b700\\pos(1,2)}B{\\b0}")).toBe("<b>B</b>");
    expect(decodeAssText("a\\hb{note to self}")).toBe(`a${String.fromCharCode(0xa0)}b`);
  });

  it("encodes the other way, dropping markup ASS has no form for", () => {
    expect(encodeAssText("<i>Hi</i>\nthere")).toBe("{\\i1}Hi{\\i0}\\Nthere");
    expect(encodeAssText('<font color="red">x</font> <v Bob>y')).toBe("x y");
  });
});

describe("parseAss", () => {
  it("reads Dialogue lines with their fields, commas in the text included", () => {
    const cues = parseAss(ASS);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ startMs: 1000, endMs: 3500, text: "<i>Hello</i>, world\nsecond line" });
    expect(cues[0]?.ass).toMatchObject({ style: "Default", name: "Ann", layer: "0" });
    expect(cues[1]?.text).toBe("EXIT");
    expect(cues[1]?.ass).toMatchObject({ style: "Sign", layer: "1" });
  });

  it("reads SubStation Alpha v4 (Marked instead of Layer)", () => {
    const ssa = [
      "[Script Info]",
      "ScriptType: v4.00",
      "[Events]",
      "Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: Marked=0,0:00:01.00,0:00:02.00,*Default,NTP,0000,0000,0000,,Hi",
    ].join("\n");
    const [cue] = parseAss(ssa);
    expect(cue).toMatchObject({ startMs: 1000, endMs: 2000, text: "Hi" });
    expect(cue?.ass?.layer).toBe("0");
  });

  it("refuses a file without [Events]", () => {
    expect(() => parseAss("1\n00:00:01,000 --> 00:00:02,000\nhi\n")).toThrow(/\[Events\]/);
  });
});

describe("writing ASS", () => {
  it("keeps the other sections, fields and raw text when only times change", () => {
    const out = serializeAss(shiftCues(parseAss(ASS), 1000), ASS);
    expect(out).toContain("[V4+ Styles]\n");
    expect(out).toContain("Style: Sign,Arial,40");
    expect(out).toContain("Dialogue: 0,0:00:02.00,0:00:04.50,Default,Ann,0,0,0,,{\\i1}Hello{\\i0}, world\\Nsecond line");
    expect(out).toContain("Dialogue: 1,0:00:05.00,0:00:06.00,Sign,,0,0,0,,{\\pos(960,100)\\fad(200,200)}EXIT");
    expect(out).toMatch(/\n\[Fonts\]\nfontname: x\.ttf\n$/);
    // Read back, it is the same cues.
    expect(parseAss(out).map((c) => c.text)).toEqual(parseAss(ASS).map((c) => c.text));
  });

  it("re-encodes a cue whose text was edited", () => {
    const [first] = parseAss(ASS);
    const out = serializeAss([{ ...first!, text: "<b>new</b>\nline" }], ASS);
    expect(out).toContain(",Default,Ann,0,0,0,,{\\b1}new{\\b0}\\Nline");
  });

  it("writes a default header when the cues come from another format", () => {
    const cues = parseByFormat("1\n00:00:01,000 --> 00:00:02,500\n<i>Hi</i>\nthere\n", "srt");
    const out = serializeByFormat(cues, "ass");
    expect(out).toMatch(/^\[Script Info\]\nScriptType: v4\.00\+/);
    expect(out).toContain("Style: Default,");
    expect(out).toContain("Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\i1}Hi{\\i0}\\Nthere");
  });

  it("converts to SRT with the text the viewer reads", () => {
    const srt = serializeByFormat(parseByFormat(ASS, "ass"), "srt");
    expect(srt).toContain("00:00:01,000 --> 00:00:03,500\n<i>Hello</i>, world\nsecond line");
  });

  it("reads .ssa but writes .ass", () => {
    expect(resolveOutputFormat(undefined, undefined, "ssa")).toBe("ass");
    expect(() => serializeByFormat([], "ssa")).toThrow(/read only/);
    expect(sniffFormat(`${String.fromCharCode(0xfeff)}${ASS}`)).toBe("ass");
  });
});

describe("readability with markup", () => {
  it("counts only what is shown, and flags too many lines", () => {
    expect(visibleText("<i>Hi</i> {\\pos(1,2)}there")).toBe("Hi there");
    // 10 visible characters over 1 s: under 20 cps even though the markup makes 17.
    const cues = [{ startMs: 0, endMs: 1000, text: "<i>abcde</i>fghij\nk\nl" }];
    const issues = lintCues(cues);
    expect(issues.map((i) => i.kind)).toEqual(["line-count"]);
    expect(issues[0]?.message).toBe("3 lines (limit 2)");
    expect(lintCues(cues, { maxLines: 3 })).toEqual([]);
  });
});
