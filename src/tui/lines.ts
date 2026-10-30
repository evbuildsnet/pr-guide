import { excerptRows } from "../diff.ts";
import type { DiffFile, DiffRow, Excerpt, Note, Stop } from "../model.ts";
import { ATTENTION_LABELS, letterStopNotes, otherFiles, stopSubline } from "../tour.ts";
import { tokenize, type Token } from "./syntax.ts";

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
  strong: "#ffffff",
  text: "#d7dae0",
  muted: "#9da5b4",
  faint: "#8b93a1",
  disabled: "#5c6370",
  accent: "#61afef",
  code: "#8bd5ca",
  codeChip: "#323844",
  attention: "#e5c07b",
  success: "#98c379",
  danger: "#e06c75",
  border: "#3e4451",
  selection: "#323844",
  chip: "#3e4451",
  codeBg: "#21252b",
  headerBg: "#2c313a",
  noteBg: "#2c313a",
  addition: { sign: "#98c379", bg: "#263229" },
  deletion: { sign: "#e06c75", bg: "#36272b" },
  syntax: { comment: "#8f98a6", string: "#98c379", number: "#d19a66", keyword: "#c678dd", plain: undefined },
} as const satisfies Record<string, unknown> & { syntax: Record<Token, string | undefined> };

/** Prose wraps at a comfortable reading measure; code takes the full width. */
export const MEASURE = 80;

const BLANK: Line = [];
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
    // Each word is the spans between two whitespace runs.
    const words: Array<Array<Span>> = [[]];
    for (const span of inline(paragraph, base)) {
      span.text.split(/(\s+)/).forEach((piece) => {
        if (/^\s+$/.test(piece)) words.push([]);
        else if (piece !== "") words.at(-1)!.push({ ...span, text: piece });
      });
    }
    let line: Array<Span> = indent ? [{ text: indent }] : [];
    let length = indent.length;
    for (const word of words.filter((spans) => spans.length > 0)) {
      const wordLength = width(word);
      if (length > indent.length) {
        if (length + 1 + wordLength > wrapAt) {
          lines.push(line);
          line = indent ? [{ text: indent }] : [];
          length = indent.length;
        } else {
          line.push({ text: " " });
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
  const lead = lane + 2 + gutter + 2;
  const room = Math.max(total - lead, 8);
  const out: Array<Line> = [];
  segments.forEach((rows, index) => {
    if (index > 0) out.push(pad(withBg([{ text: `${" ".repeat(lane + 2 + gutter - 1)}⋯`, color: THEME.faint }], THEME.codeBg), total, THEME.codeBg));
    for (const row of rows) {
      const tone = row.kind === "context" ? null : THEME[row.kind];
      const bg = tone && tinted ? tone.bg : THEME.codeBg;
      const anchor = side === "new" ? row.newLine : row.oldLine;
      const notes = anchor === null ? undefined : notesAt?.get(anchor);
      const code = tokenize(row.text.replaceAll("\t", "    "), path).map(({ text, token }) => ({ text, color: THEME.syntax[token] ?? THEME.text }));
      wrapCode(code, room).forEach((piece, pieceIndex) => {
        const first = pieceIndex === 0;
        const markers = first && notes ? notes.map((n) => n.marker).join("") : "";
        out.push(
          pad(
            withBg(
              [
                ...(markers
                  ? [{ text: ` ${markers} `, color: "#1d1f21", bg: THEME.attention, bold: true }, { text: " ".repeat(lane - markers.length - 2) }]
                  : [{ text: " ".repeat(lane) }]),
                { text: first && tone ? (row.kind === "addition" ? "+ " : "− ") : "  ", color: tone?.sign },
                { text: first ? String(numberOf(row) ?? "").padStart(gutter) : " ".repeat(gutter), color: tone ? tone.sign : THEME.faint },
                { text: first ? "  " : " ↪", color: THEME.faint },
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

/** A filled card with an amber rule: the shape of everything that asks for the reader's judgment. */
function card(rows: ReadonlyArray<Line>, cardWidth: number, padded = true): Array<Line> {
  const fill = (line: Line): Line => pad(withBg([{ text: "┃ ", color: THEME.attention }, ...line], THEME.noteBg), cardWidth, THEME.noteBg);
  return [...(padded ? [fill([])] : []), ...rows.map(fill)];
}

/** A note drawn under the line it is about, like an inline review comment. */
function noteCard(marker: string, note: Note, indent: number, total: number, measure: number): Array<Line> {
  const cardWidth = Math.min(measure, total - indent + 2);
  const body = note.body.trim() === "" ? [] : prose(note.body, cardWidth - 3);
  const rows = card([...markedTitle(marker, note.title, cardWidth - 3), ...body], cardWidth, false);
  return rows.map((line) => pad(withBg([{ text: " ".repeat(indent - 2) }, ...line], THEME.codeBg), total, THEME.codeBg));
}

/** A note's letter chip and title, the title wrapping under itself. */
function markedTitle(marker: string, title: string, wrapAt: number): Array<Line> {
  const chipText = ` ${marker} `;
  const indent = " ".repeat(chipText.length + 1);
  return prose(title, wrapAt, { color: THEME.strong, bold: true }, indent).map((line, i) =>
    i === 0 ? [{ text: chipText, color: "#1d1f21", bg: THEME.attention, bold: true }, { text: " " }, ...line.slice(1)] : line,
  );
}

/** Shortens a path from the left, keeping the file name, so a header never clips what it names. */
function fitPath(path: string, room: number): string {
  if (path.length <= room) return path;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dir = path.slice(0, path.length - name.length);
  const keep = room - name.length - 2;
  return keep > 0 ? `…/${dir.slice(dir.length - keep).replace(/^[^/]*\//, "")}${name}` : name;
}

function blockHeader(
  path: string,
  detail: string,
  counts: { additions: number; deletions: number } | null,
  total: number,
  lead = " ",
): Line {
  const tail: Line = [...(detail ? [{ text: `  ${detail}`, color: THEME.muted }] : []), ...(counts ? [{ text: "  " }, ...stats(counts)] : [])];
  const line: Line = [{ text: lead, color: THEME.muted }, ...pathSpans(fitPath(path, total - lead.length - width(tail) - 1), { bold: true }), ...tail];
  return pad(withBg(line, THEME.headerBg), total, THEME.headerBg);
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

const heading = (text: string, detail = ""): Line => [
  { text, color: THEME.strong, bold: true },
  ...(detail ? [{ text: `  ${detail}`, color: THEME.muted }] : []),
];

function fileCode(file: DiffFile, gutter: number, total: number, measure: number): Array<Line> {
  const { kept, hidden } = capRows(file.hunks.map((hunk) => hunk.rows), FILE_ROWS);
  return [
    ...codeLines({ path: file.path, segments: kept, side: "new", gutter }, total, measure),
    ...(hidden > 0 ? [pad(withBg([{ text: `${" ".repeat(gutter + 4)}⋯ ${hidden} more lines in the PR`, color: THEME.faint }], THEME.codeBg), total, THEME.codeBg)] : []),
  ];
}

export interface StopView {
  readonly stop: Stop;
  readonly isLast: boolean;
  readonly nextTitle: string | null;
  readonly files: ReadonlyMap<string, DiffFile>;
  readonly showFileDiffs: boolean;
}

/** Draws one stop the way t3code's GuideStop lays it out, top to bottom. `filesAt` is the row of the file list. */
export function stopLines({ stop, isLast, nextTitle, files, showFileDiffs }: StopView, total: number) {
  // Code blocks by line range, so a block scrolled partly away can pin its header.
  const blocks: Array<{ header: number; end: number }> = [];
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
        [[{ text: ATTENTION_LABELS[stop.attention.kind], color: THEME.attention, bold: true }], ...prose(stop.attention.note, measure - 4)],
        measure,
      ),
    );
  }

  const inlined = new Set<string>();
  stop.excerpts.forEach((excerpt, excerptIndex) => {
    const file = files.get(excerpt.path);
    out.push(BLANK);
    if (excerpt.caption.trim()) out.push(...prose(excerpt.caption, measure));
    const segments = file ? excerptRows(file, excerpt) : [];
    const header = out.length;
    out.push(blockHeader(excerpt.path, `L${excerpt.start}–${excerpt.end}${excerpt.side === "old" ? " · removed" : ""}`, file ? countRows(segments.flat()) : null, total));
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
    blocks.push({ header, end: out.length });
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
    for (const other of others) {
      const file = files.get(other.path);
      const header = out.length;
      out.push(
        showFileDiffs
          ? blockHeader(other.path, "", file ?? null, total, "▾ ")
          : [{ text: "▸ ", color: THEME.muted }, ...pathSpans(other.path), ...(file ? [{ text: "  " }, ...stats(file)] : [])],
      );
      if (other.note.trim() !== "") out.push(...prose(other.note, measure, { color: THEME.muted }, "  "));
      if (showFileDiffs) {
        out.push(
          ...(file === undefined
            ? [[{ text: "  This file is not in the diff.", color: THEME.muted }]]
            : file.hunks.length === 0
              ? [[{ text: "  No text changes (binary, rename or mode change).", color: THEME.muted }]]
              : fileCode(file, gutter, total, measure)),
        );
        blocks.push({ header, end: out.length });
        out.push(BLANK);
      }
    }
  }

  if (stop.questions.length > 0) {
    out.push(BLANK, heading("Questions you might ask"));
    for (const question of stop.questions) {
      out.push(...prose(question, measure - 2).map((line, i) => [{ text: i === 0 ? "? " : "  ", color: THEME.accent }, ...line]));
    }
  }

  out.push(BLANK, [{ text: "─".repeat(total), color: THEME.border }]);
  out.push(
    ...(nextTitle !== null
      ? prose(nextTitle, Math.min(total, MEASURE + 9), { color: THEME.strong, bold: true }, " ".repeat(9)).map((line, i) =>
          i === 0 ? [chip("→"), { text: "  Next  ", color: THEME.muted }, ...line.slice(1)] : line,
        )
      : isLast
        ? [[{ text: "That's the tour.  ", color: THEME.strong, bold: true }, chip("o"), { text: "  Open the PR", color: THEME.text }]]
        : []),
  );
  return { lines: out, filesAt, blocks };
}

export interface RailView {
  readonly stops: ReadonlyArray<Stop>;
  readonly position: number;
  readonly seen: ReadonlySet<number>;
}

/** The numbered stop list with read checkmarks, as in t3code's GuideRail. Returns where the active stop sits. */
export function railLines({ stops, position, seen }: RailView, railWidth: number) {
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
    const bullet: Span = read
      ? { text: " ✔ ", color: THEME.success }
      : { text: `${String(index + 1).padStart(2)} `, color: active ? THEME.strong : THEME.muted };
    const titleStyle: Style = { color: active ? THEME.strong : THEME.text, bold: active };
    const wrapped = prose(stop.title, railWidth - 5, titleStyle);
    const title = wrapped.length > 3 && !active ? [...wrapped.slice(0, 2), [...(wrapped[2] ?? []), { ...titleStyle, text: "…" }]] : wrapped;
    if (active) activeStart = out.length;
    title.forEach((line, i) => out.push(paint([i === 0 ? bullet : { text: "   " }, { text: " " }, ...line])));
    out.push(
      paint([
        { text: "    " },
        ...(markAttention && stop.attention !== null ? [{ text: "◆ ", color: THEME.attention }] : []),
        { text: stopSubline(stop), color: THEME.muted },
      ]),
    );
    if (active) activeEnd = out.length - 1;
    out.push(BLANK);
  });
  return { lines: out, activeStart, activeEnd };
}
