import { excerptRows } from "../diff.ts";
import type { DiffFile, DiffRow, Excerpt, Note, Stop } from "../model.ts";
import { ATTENTION_LABELS, letterStopNotes, otherFiles, stopSubline } from "../tour.ts";
import { tokenize, type Open, type Token } from "./syntax.ts";

/** A styled run of text. A stop is drawn as an array of lines so the pane can scroll it. */
export interface Span {
  readonly text: string;
  readonly color?: string;
  readonly bg?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
}
export type Line = ReadonlyArray<Span>;
type Style = Omit<Span, "text">;

/**
 * Explicit colors tuned for dark terminals like Ghostty's default (#282c34). Nothing uses faint
 * text, which terminals render at half opacity: three text levels carry the hierarchy instead.
 */
export const THEME = {
  background: "#282c34",
  strong: "#ffffff",
  text: "#d7dae0",
  muted: "#9da5b4",
  faint: "#8b93a1",
  disabled: "#5c6370",
  accent: "#61afef",
  /** Rail titles that aren't selected: quieter than body text so the rail doesn't compete with it. */
  soft: "#abb2bf",
  /** Captions and the PR title: a step under body text, a step over secondary. */
  caption: "#c8ccd4",
  thumb: "#737d8c",
  code: "#e6e8ec",
  codeChip: "#3e4451",
  attention: "#e5c07b",
  success: "#98c379",
  danger: "#e06c75",
  border: "#3e4451",
  rule: "#4b5263",
  selection: "#323844",
  chip: "#3e4451",
  codeBg: "#21252b",
  headerBg: "#2c313a",
  noteBg: "#2c313a",
  // Removed lines keep their old-file number, dimmer so it reads as another coordinate, not a miscount.
  addition: { sign: "#98c379", number: "#98c379", bg: "#263229" },
  deletion: { sign: "#e06c75", number: "#cf8993", bg: "#36272b" },
  syntax: { comment: "#8f98a6", string: "#98c379", number: "#d19a66", keyword: "#c678dd", plain: undefined },
} as const satisfies Record<string, unknown> & { syntax: Record<Token, string | undefined> };

/** Prose wraps at a comfortable reading measure; code takes the full width. */
export const MEASURE = 80;

const BLANK: Line = [];
/** Drawn in the gutter of a wrapped code row's continuation. */
export const CONTINUATION = " ↪";
export const isContinuation = (line: Line) => line.some((span) => span.text === CONTINUATION);
const width = (line: Line) => line.reduce((sum, span) => sum + span.text.length, 0);
const pad = (line: Line, to: number, bg?: string): Line => [...line, { text: " ".repeat(Math.max(to - width(line), 0)), bg }];
const withBg = (line: Line, bg: string): Line => line.map((span) => ({ ...span, bg: span.bg ?? bg }));

/** A key drawn as a keycap. */
export const chip = (key: string): Span => ({ text: ` ${key} `, color: THEME.strong, bg: THEME.chip, bold: true });

/** Splits text into spans, painting `inline code` as a code chip. */
export function inline(text: string, base: Style = {}): Array<Span> {
  return text
    .split("`")
    .flatMap((chunk, index) =>
      chunk === "" ? [] : [{ ...base, ...(index % 2 === 1 && { color: THEME.code, bg: THEME.codeChip }), text: chunk }],
    );
}

/** Word-wraps text with inline code. Words are split on whitespace only, so `code`, stays glued to its comma. */
export function prose(text: string, wrapAt: number, base: Style = { color: THEME.text }, indent = ""): Array<Line> {
  const lines: Array<Line> = [];
  for (const paragraph of text.trim().split("\n")) {
    // Each word is the spans between two whitespace runs. A word that continues an inline code span
    // keeps that span's background on the space before it, so `a = b` stays one chip.
    const words: Array<{ spans: Array<Span>; joinBg?: string }> = [{ spans: [] }];
    for (const span of inline(paragraph, base)) {
      span.text.split(/(\s+)/).forEach((piece) => {
        if (/^\s+$/.test(piece)) words.push({ spans: [], joinBg: span.bg });
        else if (piece !== "") words.at(-1)!.spans.push({ ...span, text: piece });
      });
    }
    // A token longer than the line is cut where it must be, rather than clipped off the edge.
    const room = Math.max(wrapAt - indent.length, 1);
    const fitted = words.flatMap(({ spans, joinBg }) => {
      const length = width(spans);
      if (length <= room) return [{ spans, joinBg }];
      return Array.from({ length: Math.ceil(length / room) }, (_, i) => ({ spans: sliceSpans(spans, i * room, (i + 1) * room), joinBg }));
    });
    let line: Array<Span> = indent ? [{ text: indent }] : [];
    let length = indent.length;
    for (const { spans: word, joinBg } of fitted.filter(({ spans }) => spans.length > 0)) {
      const wordLength = width(word);
      if (length > indent.length) {
        if (length + 1 + wordLength > wrapAt) {
          lines.push(line);
          line = indent ? [{ text: indent }] : [];
          length = indent.length;
        } else {
          line.push({ text: " ", bg: joinBg });
          length += 1;
        }
      }
      line.push(...word);
      length += wordLength;
    }
    lines.push(line);
  }
  return lines;
}

const sliceSpans = (spans: ReadonlyArray<Span>, start: number, end: number): Array<Span> => {
  const out: Array<Span> = [];
  let at = 0;
  for (const span of spans) {
    const from = Math.max(start - at, 0);
    const to = Math.min(end - at, span.text.length);
    if (from < to) out.push({ ...span, text: span.text.slice(from, to) });
    at += span.text.length;
  }
  return out;
};

/**
 * Wraps a code line at spaces or punctuation, so identifiers stay whole. Continuations hang
 * two columns past the line's own indent. A word longer than the row is cut where it must be.
 */
function wrapCode(spans: ReadonlyArray<Span>, size: number): Array<Array<Span>> {
  const text = spans.map((span) => span.text).join("");
  if (text.length <= size) return [[...spans]];
  const hang = Math.min(text.length - text.trimStart().length + 2, Math.floor(size / 2));
  const rows: Array<Array<Span>> = [];
  let start = 0;
  while (start < text.length) {
    const room = rows.length === 0 ? size : size - hang;
    let end = Math.min(start + room, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      const space = window.lastIndexOf(" ");
      const punctuation = Math.max(...[...",;.()[]{}/=&|:"].map((char) => window.lastIndexOf(char)));
      const cut = space > room / 3 ? space + 1 : punctuation > room / 3 ? punctuation + 1 : room;
      end = start + cut;
      // Never strand a stub like `||` on its own row: break one word earlier.
      const earlier = window.lastIndexOf(" ", cut - 2);
      if (end < text.length && text.length - end <= room && text.slice(end).trim().length < 3 && earlier > room / 3) end = start + earlier + 1;
    }
    rows.push([...(rows.length > 0 ? [{ text: " ".repeat(hang) }] : []), ...sliceSpans(spans, start, end)]);
    start = end;
    while (text[start] === " ") start++;
  }
  return rows;
}

function pathSpans(path: string, style: Style = {}): Array<Span> {
  const slash = path.lastIndexOf("/") + 1;
  return [
    ...(slash > 0 ? [{ ...style, text: path.slice(0, slash), color: THEME.muted }] : []),
    { ...style, text: path.slice(slash), color: THEME.strong },
  ];
}

const countRows = (rows: ReadonlyArray<DiffRow>) => ({
  additions: rows.filter((row) => row.kind === "addition").length,
  deletions: rows.filter((row) => row.kind === "deletion").length,
});

const stats = ({ additions, deletions }: { additions: number; deletions: number }): Array<Span> => [
  ...(deletions > 0 ? [{ text: `−${deletions}`, color: THEME.deletion.sign }] : []),
  ...(additions > 0 && deletions > 0 ? [{ text: " " }] : []),
  ...(additions > 0 ? [{ text: `+${additions}`, color: THEME.addition.sign }] : []),
];

interface CodeBlock {
  readonly path: string;
  readonly segments: ReadonlyArray<ReadonlyArray<DiffRow>>;
  readonly side: Excerpt["side"];
  /** Line-number width, shared by every block in a stop so code starts in one column. */
  readonly gutter: number;
  /** Note markers by line on `side`, with the notes to draw under that line. */
  readonly notesAt?: ReadonlyMap<number, ReadonlyArray<{ marker: string; note: Note }>>;
}

/**
 * Diff rows on a dark code surface: a colored sign and line number mark changes, notes sit under their line.
 * A block that only adds lines skips the row tint, so a new file doesn't turn into a wall of green.
 */
function codeLines({ path, segments, side, gutter, notesAt }: CodeBlock, total: number, measure: number): Array<Line> {
  const numberOf = (row: DiffRow) =>
    row.kind === "addition" ? row.newLine : row.kind === "deletion" ? row.oldLine : side === "new" ? row.newLine : row.oldLine;
  const tinted = segments.flat().some((row) => row.kind !== "addition");
  // The marker lane is always there, so gutters line up from block to block.
  const lane = Math.max(4, ...[...(notesAt?.values() ?? [])].map((notes) => notes.length + 3));
  const lead = lane + gutter + 1 + 2;
  const room = Math.max(total - lead, 8);
  const out: Array<Line> = [];
  segments.forEach((rows, index) => {
    // Template strings and block comments carry their color across rows.
    let open: Open = null;
    if (index > 0) out.push(pad(withBg([{ text: `${" ".repeat(lane + gutter)}⋯`, color: THEME.faint }], THEME.codeBg), total, THEME.codeBg));
    for (const row of rows) {
      const tone = row.kind === "context" ? null : THEME[row.kind];
      const bg = tone && tinted ? tone.bg : THEME.codeBg;
      const anchor = side === "new" ? row.newLine : row.oldLine;
      const notes = anchor === null ? undefined : notesAt?.get(anchor);
      const lexed = tokenize(row.text.replaceAll("\t", "    "), path, open);
      open = lexed.open;
      const code = lexed.tokens.map(({ text, token }) => ({ text, color: THEME.syntax[token] ?? THEME.text }));
      wrapCode(code, room).forEach((piece, pieceIndex) => {
        const first = pieceIndex === 0;
        const markers = first && notes ? notes.map((n) => n.marker).join("") : "";
        // The sign sits against its number, so "+95" and "+1632" read the same way.
        const number = first ? String(numberOf(row) ?? "") : "";
        const sign = first && tone ? (row.kind === "addition" ? "+" : "−") : "";
        out.push(
          pad(
            withBg(
              [
                ...(markers
                  ? [{ text: ` ${markers} `, color: "#1d1f21", bg: THEME.accent, bold: true }, { text: " ".repeat(lane - markers.length - 2) }]
                  : [{ text: " ".repeat(lane) }]),
                { text: " ".repeat(gutter + 1 - number.length - sign.length) },
                { text: sign, color: tone?.sign },
                { text: number, color: tone ? tone.number : THEME.faint },
                { text: first ? "  " : CONTINUATION, color: THEME.faint },
                ...piece,
              ],
              bg,
            ),
            total,
            bg,
          ),
        );
      });
      for (const { marker, note } of notes ?? []) out.push(...noteCard(marker, note, lead, total, measure));
    }
  });
  return out;
}

/** A filled card with a colored rule: amber asks for the reader's judgment, blue explains. */
export function card(rows: ReadonlyArray<Line>, cardWidth: number, rule: string = THEME.attention): Array<Line> {
  return rows.map((line) => pad(withBg([{ text: "┃ ", color: rule }, ...line], THEME.noteBg), cardWidth, THEME.noteBg));
}

/** A note drawn under the line it is about, like an inline review comment. */
function noteCard(marker: string, note: Note, indent: number, total: number, measure: number): Array<Line> {
  const cardWidth = Math.min(measure, total - indent + 2);
  const body = note.body.trim() === "" ? [] : prose(note.body, cardWidth - 3);
  const rows = card([...markedTitle(marker, note.title, cardWidth - 3), ...body], cardWidth, THEME.accent);
  return rows.map((line) => pad(withBg([{ text: " ".repeat(indent - 2) }, ...line], THEME.codeBg), total, THEME.codeBg));
}

/** A note's letter chip and title, the title wrapping under itself. */
function markedTitle(marker: string, title: string, wrapAt: number): Array<Line> {
  const chipText = ` ${marker} `;
  const indent = " ".repeat(chipText.length + 1);
  return prose(title, wrapAt, { color: THEME.strong, bold: true }, indent).map((line, i) =>
    i === 0 ? [{ text: chipText, color: "#1d1f21", bg: THEME.accent, bold: true }, { text: " " }, ...line.slice(1)] : line,
  );
}

/** Shortens a path from the left, keeping the file name, so a header never clips what it names. */
function fitPath(path: string, room: number): string {
  if (path.length <= room) return path;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dir = path.slice(0, path.length - name.length);
  const keep = room - name.length - 2;
  if (keep > 0) return `…/${dir.slice(dir.length - keep).replace(/^[^/]*\//, "")}${name}`;
  // Even the name doesn't fit: cut its middle, keeping the extension.
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  return name.length <= room ? name : `${name.slice(0, Math.max(room - ext.length - 1, 1))}…${ext}`;
}

interface Header {
  readonly path: string;
  readonly detail?: string;
  readonly counts: { additions: number; deletions: number } | null;
  /** What the block shows, as the first rows of the band, so caption, path and code read as one card. */
  readonly caption?: string;
  readonly lead?: string;
  /** Right-aligned on the path row, e.g. the key that collapses it. */
  readonly trailing?: Line;
}

/** A file's band: an optional caption, then the path, range and counts. The path row is last. */
function blockHeader({ path, detail = "", counts, caption = "", lead = " ", trailing = [] }: Header, total: number, measure: number): Array<Line> {
  const band = (line: Line) => pad(withBg(line, THEME.headerBg), total, THEME.headerBg);
  const tail: Line = [...(detail ? [{ text: `  ${detail}`, color: THEME.muted }] : []), ...(counts ? [{ text: "  " }, ...stats(counts)] : [])];
  const right = width(trailing) > 0 ? width(trailing) + 1 : 0;
  const left: Line = [{ text: lead, color: THEME.muted }, ...pathSpans(fitPath(path, total - lead.length - width(tail) - right - 1)), ...tail];
  return [
    ...(caption.trim() ? prose(caption, measure, { color: THEME.caption }, " ").map(band) : []),
    band(right > 0 ? [...left, { text: " ".repeat(Math.max(total - width(left) - right, 1)) }, ...trailing] : left),
  ];
}

/** Expanded files show this many rows, then point at the PR for the rest. */
const FILE_ROWS = 40;

function capRows(segments: ReadonlyArray<ReadonlyArray<DiffRow>>, limit: number) {
  const kept: Array<ReadonlyArray<DiffRow>> = [];
  let room = limit;
  for (const rows of segments) {
    if (room <= 0) break;
    kept.push(rows.slice(0, room));
    room -= rows.length;
  }
  return { kept, hidden: Math.max(-room, 0) + segments.slice(kept.length).flat().length };
}

// Section labels sit a level below the stop title.
const heading = (text: string, detail = ""): Line => [
  { text, color: THEME.muted, bold: true },
  ...(detail ? [{ text: `  ${detail}`, color: THEME.muted }] : []),
];

function fileCode(file: DiffFile, gutter: number, total: number, measure: number): Array<Line> {
  const { kept, hidden } = capRows(file.hunks.map((hunk) => hunk.rows), FILE_ROWS);
  return [
    ...codeLines({ path: file.path, segments: kept, side: "new", gutter }, total, measure),
    ...(hidden > 0 ? [pad(withBg([{ text: `${" ".repeat(gutter + 3)}⋯ ${hidden} more lines in the PR`, color: THEME.faint }], THEME.codeBg), total, THEME.codeBg)] : []),
  ];
}

/** Where → takes the reader from this stop. */
export type Onward =
  | { readonly kind: "next"; readonly title: string; readonly label: "Next" | "Next unread" }
  | { readonly kind: "finish" }
  | { readonly kind: "done" };

export interface Block {
  /** The first caption row, if the block has one. */
  readonly caption: number | null;
  /** The path row. */
  readonly header: number;
  readonly end: number;
  /** What to pin instead of the path row, when it differs. */
  readonly pinned?: Line;
}

export interface StopView {
  readonly stop: Stop;
  readonly onward: Onward;
  readonly files: ReadonlyMap<string, DiffFile>;
  readonly showFileDiffs: boolean;
}

/** Draws one stop the way t3code's GuideStop lays it out, top to bottom. `filesAt` is the row of the file list. */
export function stopLines({ stop, onward, files, showFileDiffs }: StopView, total: number) {
  // Code blocks by line range, so a block scrolled partly away can pin its caption and path.
  const blocks: Array<Block> = [];
  const measure = Math.min(total, MEASURE);
  const { lettered, byExcerpt } = letterStopNotes(stop);
  const others = otherFiles(stop);
  const gutter = Math.max(
    2,
    ...[...stop.excerpts, ...(showFileDiffs ? others : [])]
      .flatMap(({ path }) => files.get(path)?.hunks.flatMap((hunk) => hunk.rows) ?? [])
      .map((row) => String(row.newLine ?? row.oldLine ?? "").length),
  );
  const out: Array<Line> = [...prose(stop.title, measure, { color: THEME.strong, bold: true })];
  if (stop.summary.trim() !== "") out.push(BLANK, ...prose(stop.summary, measure));

  if (stop.attention !== null) {
    out.push(
      BLANK,
      ...card(
        // Amber but not bold, so the stop title stays the loudest line.
        [[{ text: ATTENTION_LABELS[stop.attention.kind], color: THEME.attention }], ...prose(stop.attention.note, measure - 4)],
        measure,
      ),
    );
  }

  const inlined = new Set<string>();
  stop.excerpts.forEach((excerpt, excerptIndex) => {
    const file = files.get(excerpt.path);
    out.push(BLANK);
    const segments = file ? excerptRows(file, excerpt) : [];
    const caption = excerpt.caption.trim() ? out.length : null;
    out.push(
      ...blockHeader(
        {
          path: excerpt.path,
          detail: `L${excerpt.start}–${excerpt.end}${excerpt.side === "old" ? " · removed" : ""}`,
          counts: file ? countRows(segments.flat()) : null,
          caption: excerpt.caption,
        },
        total,
        measure,
      ),
    );
    const header = out.length - 1;
    if (file === undefined) {
      out.push(pad([{ text: "  This file is not in the diff.", color: THEME.muted }], total, THEME.codeBg));
      return;
    }
    const markers = byExcerpt[excerptIndex] ?? new Map<number, ReadonlyArray<string>>();
    const notesAt = new Map(
      [...markers].map(([line, letters]) => {
        letters.forEach((letter) => inlined.add(letter));
        return [line, lettered.filter(({ marker }) => letters.includes(marker))] as const;
      }),
    );
    out.push(...codeLines({ path: excerpt.path, segments, side: excerpt.side, gutter, notesAt }, total, measure));
    blocks.push({ caption, header, end: out.length });
  });

  // Notes on lines no excerpt shows.
  const loose = lettered.filter(({ marker }) => !inlined.has(marker));
  if (loose.length > 0) {
    out.push(BLANK, heading("Notes"));
    for (const { marker, note } of loose) {
      out.push(BLANK, ...markedTitle(marker, note.title, measure), [{ text: `    ${note.path.split("/").at(-1)}:${note.line}`, color: THEME.muted }]);
      if (note.body.trim() !== "") out.push(...prose(note.body, measure, undefined, "    "));
    }
  }

  let filesAt: number | null = null;
  if (others.length > 0) {
    out.push(BLANK);
    filesAt = out.length;
    out.push([...heading(stop.excerpts.length > 0 ? "Also in this stop" : "Files in this stop"), { text: "  " }, chip(`f ${showFileDiffs ? "▾" : "▸"}`)]);
    others.forEach((other, otherIndex) => {
      const file = files.get(other.path);
      const header = out.length;
      const counts = file ? [{ text: "  " }, ...stats(file)] : [];
      out.push(
        ...(showFileDiffs
          ? blockHeader({ path: other.path, counts: file ?? null }, total, measure)
          : [[...pathSpans(fitPath(other.path, total - width(counts))), ...counts]]),
      );
      if (other.note.trim() !== "") out.push(...prose(other.note, measure, { color: THEME.muted }, "  "));
      if (!showFileDiffs && otherIndex < others.length - 1) out.push(BLANK);
      if (showFileDiffs) {
        out.push(
          ...(file === undefined
            ? [[{ text: "  This file is not in the diff.", color: THEME.muted }]]
            : file.hunks.length === 0
              ? [[{ text: "  No text changes (binary, rename or mode change).", color: THEME.muted }]]
              : fileCode(file, gutter, total, measure)),
        );
        // Pinned, the header carries the collapse key, since the section's own key has scrolled away.
        const pinned = blockHeader({ path: other.path, counts: file ?? null, trailing: [chip("f ▾")] }, total, measure).at(-1);
        blocks.push({ caption: null, header, end: out.length, ...(pinned && { pinned }) });
        out.push(BLANK);
      }
    });
  }

  if (stop.questions.length > 0) {
    out.push(BLANK, heading("Questions you might ask"));
    for (const question of stop.questions) {
      out.push(...prose(question, measure - 2).map((line, i) => [{ text: i === 0 ? "? " : "  ", color: THEME.accent }, ...line]));
    }
  }

  // A stop with no code keeps its rule and keys at the prose edge.
  const wide = blocks.length > 0 || stop.excerpts.length > 0;
  out.push(BLANK);
  const ruleAt = out.length;
  out.push([{ text: "─".repeat(wide ? total : measure), color: THEME.rule }]);
  if (onward.kind === "next") {
    const lead = `  ${onward.label}  `;
    out.push(
      ...prose(onward.title, Math.min(total, MEASURE + 3 + lead.length), { color: THEME.text, bold: true }, " ".repeat(3 + lead.length)).map((line, i) =>
        i === 0 ? [chip("→"), { text: lead, color: THEME.muted }, ...line.slice(1)] : line,
      ),
    );
  } else if (onward.kind === "finish") {
    out.push([chip("→"), { text: "  Finish the tour", color: THEME.text, bold: true }]);
  } else {
    out.push([{ text: "That's the tour", color: THEME.strong, bold: true }, { text: "   " }, chip("o"), { text: "  Open the PR", color: THEME.text }]);
  }
  return { lines: out, filesAt, blocks, ruleAt, wide };
}

export interface RailView {
  readonly stops: ReadonlyArray<Stop>;
  readonly position: number;
  readonly seen: ReadonlySet<number>;
}

/** The numbered stop list with read checkmarks, as in t3code's GuideRail. Returns where the active stop sits. */
export function railLines(view: RailView, railWidth: number, rows: number) {
  // Titles get a fourth line when the whole list still fits.
  const roomy = railRows(view, railWidth, 4);
  return roomy.lines.length <= rows ? roomy : railRows(view, railWidth, 3);
}

function railRows({ stops, position, seen }: RailView, railWidth: number, maxLines: number) {
  // A mark every stop carries tells the reader nothing.
  const markAttention = stops.some((stop) => stop.attention === null);
  const done = seen.size === stops.length;
  const out: Array<Line> = [
    [done ? { text: `✔ All ${stops.length} read`, color: THEME.success } : { text: `${seen.size} of ${stops.length} read`, color: THEME.muted }],
    BLANK,
  ];
  let activeStart = 0;
  let activeEnd = 0;
  stops.forEach((stop, index) => {
    const active = index === position;
    const read = seen.has(index);
    const paint = (line: Array<Span>): Line => {
      const row: Line = [{ text: active ? "▌" : " ", color: THEME.accent }, ...line];
      return active ? pad(withBg(row, THEME.selection), railWidth, THEME.selection) : row;
    };
    // The number stays, since 1–9 jump to it; a check beside it marks a read stop.
    const bullet: Line = [
      { text: read ? "✔" : " ", color: THEME.success },
      { text: `${String(index + 1).padStart(2)} `, color: active ? THEME.strong : THEME.muted },
    ];
    const titleStyle: Style = { color: active ? THEME.strong : THEME.soft, bold: active };
    const wrapped = prose(stop.title, railWidth - 7, titleStyle);
    const title =
      wrapped.length > maxLines && !active
        ? [...wrapped.slice(0, maxLines - 1), [...(wrapped[maxLines - 1] ?? []), { ...titleStyle, text: "…" }]]
        : wrapped;
    if (active) activeStart = out.length;
    title.forEach((line, i) => out.push(paint([...(i === 0 ? bullet : [{ text: "    " }]), { text: " " }, ...line])));
    out.push(
      paint([
        { text: "     " },
        ...(markAttention && stop.attention !== null ? [{ text: "◆ ", color: THEME.attention }] : []),
        { text: stopSubline(stop), color: active ? THEME.muted : THEME.faint },
      ]),
    );
    if (active) activeEnd = out.length - 1;
    out.push(BLANK);
  });
  return { lines: out, activeStart, activeEnd };
}
