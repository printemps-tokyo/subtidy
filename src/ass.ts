/**
 * Advanced SubStation Alpha (.ass) and SubStation Alpha (.ssa) reader and
 * .ass writer.
 *
 * A cue's `text` is what the other formats hold: lines split by `\n`, and
 * italic, bold and underline as `<i>`, `<b>`, `<u>`. Every other override tag
 * (`{\pos(...)}`, `{\fad(...)}`, ...) is dropped from `text`, but a cue keeps
 * its ASS fields and raw text (`ass`), so ASS in, ASS out keeps styles,
 * positioning and effects of every cue whose text was not changed. The
 * sections around [Events] ([Script Info], styles, fonts) are kept as they
 * were when the input is .ass.
 */

import type { Cue } from "./cue.js";

/** The fields of a Dialogue line besides its times, as read. */
export interface AssFields {
  layer: string;
  style: string;
  name: string;
  marginL: string;
  marginR: string;
  marginV: string;
  effect: string;
  /** The Text field exactly as read. */
  raw: string;
  /** The `text` it decoded to; a cue whose text differs was edited. */
  decoded: string;
}

const EVENTS_FORMAT = "Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";

/** The header written when the input was not .ass: one Default style. */
export const DEFAULT_ASS_HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,60,60,50,1
`;

/** H:MM:SS.cc (hundredths) to milliseconds. */
export function parseAssTime(value: string): number {
  const m = /^\s*(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?\s*$/.exec(value);
  if (!m) throw new Error(`invalid ASS timestamp "${value}"`);
  const frac = (m[4] ?? "0").padEnd(3, "0");
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(frac.slice(0, 3));
}

/** Milliseconds to H:MM:SS.cc, rounded to the nearest hundredth. */
export function formatAssTime(totalMs: number): string {
  const cs = Math.max(0, Math.round(totalMs / 10));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** ASS text to cue text: line breaks, italic/bold/underline as tags, other overrides dropped. */
export function decodeAssText(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; ) {
    const ch = raw[i] as string;
    if (ch === "{") {
      const end = raw.indexOf("}", i);
      if (end === -1) {
        out += raw.slice(i);
        break;
      }
      const block = raw.slice(i + 1, end);
      for (const tag of block.split("\\").slice(1)) {
        const t = /^([ibu])(\d+)$/.exec(tag.trim());
        if (t) out += Number(t[2]) > 0 ? `<${t[1]}>` : `</${t[1]}>`;
      }
      i = end + 1;
      continue;
    }
    if (ch === "\\" && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === "N" || next === "n") {
        out += "\n";
        i += 2;
        continue;
      }
      if (next === "h") {
        out += "\u00a0";
        i += 2;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/** Cue text to ASS text: newlines as \N, <i>/<b>/<u> as overrides, other markup dropped. */
export function encodeAssText(text: string): string {
  return text
    .replace(/\r?\n/g, "\\N")
    .replace(/<(\/?)([ibu])>/gi, (_m, close: string, tag: string) => `{\\${tag.toLowerCase()}${close ? 0 : 1}}`)
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\u00a0/g, "\\h");
}

/** Split an ASS file into the text before [Events], the events section, and what follows. */
export function splitAssSections(text: string): { before: string; events: string[]; after: string } {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^\s*\[events\]\s*$/i.test(l));
  if (start === -1) return { before: lines.join("\n"), events: [], after: "" };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i] as string)) {
      end = i;
      break;
    }
  }
  return {
    before: lines.slice(0, start).join("\n"),
    events: lines.slice(start + 1, end),
    after: lines.slice(end).join("\n"),
  };
}

/** Parse ASS or SSA text into cues (Dialogue lines; Comment lines are not cues). */
export function parseAss(text: string): Cue[] {
  const { events } = splitAssSections(text);
  if (events.length === 0 && !/^\s*\[events\]/im.test(text)) {
    throw new Error("no [Events] section (is this an ASS/SSA file?)");
  }
  let fields: string[] | undefined;
  const cues: Cue[] = [];
  for (const line of events) {
    const fm = /^\s*Format\s*:(.*)$/i.exec(line);
    if (fm) {
      fields = (fm[1] as string).split(",").map((f) => f.trim().toLowerCase());
      continue;
    }
    const dm = /^\s*Dialogue\s*:(.*)$/i.exec(line);
    if (!dm) continue;
    if (!fields) throw new Error("a Dialogue line comes before the Format line in [Events]");
    const values = splitFields(dm[1] as string, fields.length);
    const get = (name: string): string => {
      const i = fields!.indexOf(name);
      return i === -1 ? "" : (values[i] ?? "").trim();
    };
    const raw = (() => {
      const i = fields!.indexOf("text");
      return i === -1 ? "" : (values[i] ?? "");
    })();
    const decoded = decodeAssText(raw);
    cues.push({
      startMs: parseAssTime(get("start")),
      endMs: parseAssTime(get("end")),
      text: decoded,
      ass: {
        // SSA has Marked where ASS has Layer; a Marked value is not a layer.
        layer: fields.includes("layer") ? get("layer") || "0" : "0",
        style: get("style") || "Default",
        name: get("name") || get("actor"),
        marginL: get("marginl") || "0",
        marginR: get("marginr") || "0",
        marginV: get("marginv") || "0",
        effect: get("effect"),
        raw,
        decoded,
      },
    });
  }
  return cues;
}

/** Split the value part of a Dialogue line into `n` fields; the last (Text) keeps its commas. */
function splitFields(value: string, n: number): string[] {
  const out: string[] = [];
  let rest = value.replace(/^ /, "");
  for (let i = 0; i < n - 1; i++) {
    const comma = rest.indexOf(",");
    if (comma === -1) {
      out.push(rest);
      rest = "";
      continue;
    }
    out.push(rest.slice(0, comma));
    rest = rest.slice(comma + 1);
  }
  out.push(rest);
  return out;
}

/**
 * Serialize cues as ASS. `source` is the .ass text the cues came from, whose
 * other sections are kept; without it, a header with one Default style is
 * written.
 */
export function serializeAss(cues: Cue[], source?: string): string {
  const sections = source ? splitAssSections(source) : undefined;
  const before = sections ? sections.before.replace(/\n*$/, "\n") : DEFAULT_ASS_HEADER;
  const lines = cues.map((c) => {
    const a = c.ass;
    const text = a && a.decoded === c.text ? a.raw : encodeAssText(c.text);
    const f = a ?? { layer: "0", style: "Default", name: "", marginL: "0", marginR: "0", marginV: "0", effect: "" };
    return `Dialogue: ${[f.layer, formatAssTime(c.startMs), formatAssTime(c.endMs), f.style, f.name, f.marginL, f.marginR, f.marginV, f.effect, text].join(",")}`;
  });
  const after = sections?.after ? `\n${sections.after.replace(/^\n*/, "").replace(/\n*$/, "\n")}` : "";
  return `${before}\n[Events]\nFormat: ${EVENTS_FORMAT}\n${lines.join("\n")}\n${after}`;
}
