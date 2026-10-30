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
  faint: "#6f7683",
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
  addition: { sign: "#98c379", bg: "#233529" },
  deletion: { sign: "#e06c75", bg: "#3b2529" },
  syntax: { comment: "#7f848e", string: "#98c379", number: "#d19a66", keyword: "#c678dd", plain: undefined },
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

/** Cuts styled spans into rows of at most `size` characters. */
function chunk(spans: ReadonlyArray<Span>, size: number): Array<Array<Span>> {
  const rows: Array<Array<Span>> = [[]];
  let room = size;
  for (const span of spans) {
    let rest = span.text;
    while (rest.length > 0) {
      if (room === 0) {
        rows.push([]);
        room = size;
      }
      const take = rest.slice(0, room);
      rows.at(-1)!.push({ ...span, text: take });
      room -= take.length;
      rest = rest.slice(take.length);
    }
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

const stats = (additions: number, deletions: number): Array<Span> => [
  ...(deletions > 0 ? [{ text: `−${deletions}`, color: THEME.deletion.sign }] : []),
  ...(additions > 0 && deletions > 0 ? [{ text: " " }] : []),
  ...(additions > 0 ? [{ text: `+${additions}`, color: THEME.addition.sign }] : []),
];

interface CodeBlock {
  readonly path: string;
  readonly segments: ReadonlyArray<ReadonlyArray<DiffRow>>;
  readonly side: Excerpt["side"];
  /** Note markers by line on `side`, with the notes to draw under that line. */
  readonly notesAt?: ReadonlyMap<number, ReadonlyArray<{ marker: string; note: Note }>>;
}

/** Diff rows on a dark code surface: a colored bar and line number mark changes, notes sit under their line. */
function codeLines({ path, segments, side, notesAt }: CodeBlock, total: number, measure: number): Array<Line> {
  const numberOf = (row: DiffRow) =>
    row.kind === "addition" ? row.newLine : row.kind === "deletion" ? row.oldLine : side === "new" ? row.newLine : row.oldLine;
  const gutter = Math.max(2, ...segments.flat().map((row) => String(numberOf(row) ?? "").length));
  const markerWidth = notesAt && notesAt.size > 0 ? 4 : 0;
  const lead = markerWidth + 1 + gutter + 2;
  const room = Math.max(total - lead - 1, 8);
  const out: Array<Line> = [];
  segments.forEach((rows, index) => {
    if (index > 0) out.push(pad([{ text: `${" ".repeat(markerWidth + 1 + gutter - 1)}⋯`, color: THEME.faint, bg: THEME.codeBg }], total, THEME.codeBg));
    for (const row of rows) {
      const tone = row.kind === "context" ? null : THEME[row.kind];
      const bg = tone?.bg ?? THEME.codeBg;
      const anchor = side === "new" ? row.newLine : row.oldLine;
      const notes = anchor === null ? undefined : notesAt?.get(anchor);
      const code = tokenize(row.text.replaceAll("\t", "    "), path).map(({ text, token }) => ({ text, color: THEME.syntax[token] ?? THEME.text, italic: token === "comment" }));
      chunk(code, room).forEach((piece, pieceIndex) => {
        const first = pieceIndex === 0;
        const marker = first && notes ? ` ${notes.map((n) => n.marker).join("")} `.padEnd(markerWidth - 1) : "";
        out.push(
          pad(
            withBg(
              [
                ...(markerWidth > 0
                  ? marker
                    ? [{ text: marker, color: "#1d1f21", bg: THEME.attention, bold: true }, { text: " " }]
                    : [{ text: " ".repeat(markerWidth) }]
                  : []),
                { text: tone ? "▎" : " ", color: tone?.sign },
                {
                  text: first ? String(numberOf(row) ?? "").padStart(gutter) : "↪".padStart(gutter),
                  color: tone && first ? tone.sign : THEME.faint,
                },
                { text: "  " },
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

/** A note drawn under the line it is about, like an inline review comment. */
function noteCard(marker: string, note: Note, indent: number, total: number, measure: number): Array<Line> {
  const bar: Span = { text: "┃ ", color: THEME.attention };
  const lead: Span = { text: " ".repeat(Math.max(indent - 2, 0)) };
  const body = note.body.trim() === "" ? [] : prose(note.body, Math.min(measure, total - indent - 1));
  const rows: Array<Line> = [
    [lead, bar, { text: ` ${marker} `, color: "#1d1f21", bg: THEME.attention, bold: true }, { text: ` ${note.title}`, color: THEME.strong, bold: true }],
    ...body.map((line) => [lead, bar, ...line]),
  ];
  return [BLANK, ...rows, BLANK].map((line) => pad(withBg(line, THEME.noteBg), total, THEME.noteBg));
}

function blockHeader(path: string, detail: string, file: DiffFile | undefined, total: number): Line {
  const left: Line = [{ text: " " }, ...pathSpans(path, { bold: true }), ...(detail ? [{ text: `  ${detail}`, color: THEME.muted }] : [])];
  const right: Line = file ? [...stats(file.additions, file.deletions), { text: " " }] : [];
  return withBg([...left, { text: " ".repeat(Math.max(total - width(left) - width(right), 1)) }, ...right], THEME.headerBg);
}

/** A bordered card at reading width, like t3code's callouts. */
function card(title: Line, body: ReadonlyArray<Line>, cardWidth: number): Array<Line> {
  const edge = { color: THEME.border };
  const inner = cardWidth - 4;
  const row = (line: Line): Line => [{ ...edge, text: "│ " }, ...pad(line, inner), { ...edge, text: " │" }];
  return [
    [{ ...edge, text: `╭${"─".repeat(cardWidth - 2)}╮` }],
    row(title),
    ...body.map(row),
    [{ ...edge, text: `╰${"─".repeat(cardWidth - 2)}╯` }],
  ];
}

const heading = (text: string, detail = ""): Line => [
  { text, color: THEME.strong, bold: true },
  ...(detail ? [{ text: `  ${detail}`, color: THEME.muted }] : []),
];

export interface StopView {
  readonly stop: Stop;
  readonly isLast: boolean;
  readonly nextTitle: string | null;
  readonly files: ReadonlyMap<string, DiffFile>;
  readonly showFileDiffs: boolean;
}

/** Draws one stop the way t3code's GuideStop lays it out, top to bottom. `filesAt` is the row of the file list. */
export function stopLines({ stop, isLast, nextTitle, files, showFileDiffs }: StopView, total: number) {
  const measure = Math.min(total, MEASURE);
  const { lettered, byExcerpt } = letterStopNotes(stop);
  const out: Array<Line> = [...prose(stop.title, measure, { color: THEME.strong, bold: true })];
  if (stop.summary.trim() !== "") out.push(BLANK, ...prose(stop.summary, measure));

  if (stop.attention !== null) {
    out.push(
      BLANK,
      ...card(
        [{ text: "◆ ", color: THEME.attention }, { text: ATTENTION_LABELS[stop.attention.kind], color: THEME.strong, bold: true }],
        prose(stop.attention.note, measure - 4),
        measure,
      ),
    );
  }

  const inlined = new Set<string>();
  stop.excerpts.forEach((excerpt, excerptIndex) => {
    const file = files.get(excerpt.path);
    out.push(BLANK);
    if (excerpt.caption.trim()) out.push(...prose(excerpt.caption, measure, { color: THEME.muted }));
    out.push(blockHeader(excerpt.path, `L${excerpt.start}–${excerpt.end}${excerpt.side === "old" ? " · removed" : ""}`, file, total));
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
    out.push(...codeLines({ path: excerpt.path, segments: excerptRows(file, excerpt), side: excerpt.side, notesAt }, total, measure));
  });

  // Notes on lines no excerpt shows.
  const loose = lettered.filter(({ marker }) => !inlined.has(marker));
  if (loose.length > 0) {
    out.push(BLANK, heading("Notes"));
    for (const { marker, note } of loose) {
      out.push(BLANK, [
        { text: ` ${marker} `, color: "#1d1f21", bg: THEME.attention, bold: true },
        { text: ` ${note.title}`, color: THEME.strong, bold: true },
        { text: `  ${note.path.split("/").at(-1)}:${note.line}`, color: THEME.muted },
      ]);
      if (note.body.trim() !== "") out.push(...prose(note.body, measure, undefined, "    "));
    }
  }

  let filesAt: number | null = null;
  const others = otherFiles(stop);
  if (others.length > 0) {
    out.push(BLANK);
    filesAt = out.length;
    out.push([
      ...heading(stop.excerpts.length > 0 ? "Also in this stop" : "Files in this stop"),
      { text: "   " },
      chip("f"),
      { text: showFileDiffs ? " hide diffs" : " show diffs", color: THEME.muted },
    ]);
    for (const other of others) {
      const file = files.get(other.path);
      out.push([
        { text: showFileDiffs ? "▾ " : "▸ ", color: THEME.muted },
        ...pathSpans(other.path),
        ...(file ? [{ text: "  " }, ...stats(file.additions, file.deletions)] : []),
      ]);
      if (other.note.trim() !== "") out.push(...prose(other.note, measure, { color: THEME.muted }, "  "));
      if (showFileDiffs) {
        out.push(
          ...(file === undefined
            ? [[{ text: "  This file is not in the diff.", color: THEME.muted }]]
            : file.hunks.length === 0
              ? [[{ text: "  No text changes (binary, rename or mode change).", color: THEME.muted }]]
              : codeLines({ path: file.path, segments: file.hunks.map((hunk) => hunk.rows), side: "new" }, total, measure)),
          BLANK,
        );
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
    nextTitle !== null
      ? [chip("→"), { text: "  Next  ", color: THEME.muted }, { text: nextTitle, color: THEME.strong, bold: true }]
      : isLast
        ? [chip("o"), { text: "  That's the tour. ", color: THEME.strong, bold: true }, { text: "Open the PR to leave your review.", color: THEME.muted }]
        : [],
  );
  return { lines: out, filesAt };
}

export interface RailView {
  readonly stops: ReadonlyArray<Stop>;
  readonly position: number;
  readonly seen: ReadonlySet<number>;
}

/** The numbered stop list with read checkmarks, as in t3code's GuideRail. Returns where the active stop sits. */
export function railLines({ stops, position, seen }: RailView, railWidth: number) {
  const done = seen.size === stops.length;
  const out: Array<Line> = [
    [done ? { text: `✓ All ${stops.length} read`, color: THEME.success } : { text: `${seen.size} of ${stops.length} read`, color: THEME.muted }],
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
      ? { text: " ✓ ", color: THEME.success }
      : { text: `${String(index + 1).padStart(2)} `, color: active ? THEME.strong : THEME.muted };
    const titleStyle: Style = { color: active ? THEME.strong : read ? THEME.muted : THEME.text, bold: active };
    const wrapped = prose(stop.title, railWidth - 5, titleStyle);
    const title = wrapped.length > 3 ? [...wrapped.slice(0, 2), [...(wrapped[2] ?? []), { ...titleStyle, text: "…" }]] : wrapped;
    if (active) activeStart = out.length;
    title.forEach((line, i) => out.push(paint([i === 0 ? bullet : { text: "   " }, { text: " " }, ...line])));
    out.push(
      paint([
        { text: "    " },
        ...(stop.attention !== null ? [{ text: "◆ ", color: THEME.attention }] : []),
        { text: stopSubline(stop), color: THEME.muted },
      ]),
    );
    if (active) activeEnd = out.length - 1;
    out.push(BLANK);
  });
  return { lines: out, activeStart, activeEnd };
}
