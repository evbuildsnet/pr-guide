import { excerptRows } from "../diff.ts";
import type { DiffFile, DiffRow, Stop } from "../model.ts";
import { ATTENTION_LABELS, letterStopNotes, otherFiles, stopSubline } from "../tour.ts";

/** A styled run of text. A stop is drawn as an array of lines so the pane can scroll it. */
export interface Span {
  readonly text: string;
  readonly color?: string;
  readonly bg?: string;
  readonly bold?: boolean;
  readonly dim?: boolean;
}
export type Line = ReadonlyArray<Span>;
type Style = Omit<Span, "text">;

export const THEME = {
  accent: "cyan",
  code: "#8bd5ca",
  attention: "yellow",
  success: "green",
  activeBg: "#2a2f3a",
  addition: { sign: "green", bg: "#12301f" },
  deletion: { sign: "red", bg: "#3a1519" },
} as const;

const BLANK: Line = [];

/** Splits text into spans, painting `inline code` in the code color. */
export function inline(text: string, base: Style = {}): Array<Span> {
  return text
    .split("`")
    .flatMap((chunk, index) => (chunk === "" ? [] : [{ ...base, ...(index % 2 === 1 && { color: THEME.code }), text: chunk }]));
}

/** Word-wraps text with inline code. Words are split on whitespace only, so `code`, stays glued to its comma. */
export function prose(text: string, width: number, base: Style = {}, indent = ""): Array<Line> {
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
      const wordLength = word.reduce((sum, span) => sum + span.text.length, 0);
      if (length > indent.length) {
        if (length + 1 + wordLength > width) {
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

const fit = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, Math.max(width - 1, 0))}…` : text.padEnd(width);

const SIGNS = { context: " ", addition: "+", deletion: "-" } as const;

function codeLine(row: DiffRow, lineNumber: number | null, gutter: number, width: number, markers: ReadonlyArray<string> = []): Line {
  const tone = row.kind === "context" ? null : THEME[row.kind];
  const marker = markers.length > 0 ? ` ${markers.join(",")} ` : "";
  const text = fit(row.text.replaceAll("\t", "    "), Math.max(width - gutter - 4 - marker.length, 1));
  return [
    { text: `${(lineNumber === null ? "" : String(lineNumber)).padStart(gutter)} `, dim: true, ...(tone && { bg: tone.bg }) },
    { text: `${SIGNS[row.kind]} `, ...(tone && { color: tone.sign, bg: tone.bg }) },
    { text, ...(tone && { bg: tone.bg }) },
    ...(marker ? [{ text: marker, color: "black", bg: THEME.attention, bold: true }] : []),
  ];
}

function diffLines(segments: ReadonlyArray<ReadonlyArray<DiffRow>>, side: "new" | "old", width: number, markersAt?: ReadonlyMap<number, ReadonlyArray<string>>): Array<Line> {
  const numberOf = (row: DiffRow) => (side === "new" ? row.newLine : row.oldLine);
  const widest = Math.max(1, ...segments.flat().map((row) => String(numberOf(row) ?? "").length));
  return segments.flatMap((rows, index) => [
    ...(index > 0 ? [[{ text: `${" ".repeat(widest)} ⋯`, dim: true }]] : []),
    ...rows.map((row) => {
      const line = numberOf(row);
      return codeLine(row, line, widest, width, line === null ? [] : markersAt?.get(line));
    }),
  ]);
}

/** A whole file's diff, numbered on the new side with removed lines on the old. */
function fileDiffLines(file: DiffFile, width: number): Array<Line> {
  if (file.hunks.length === 0) return [[{ text: "  No text changes (binary, rename or mode change).", dim: true }]];
  const rows = file.hunks.map((hunk) => hunk.rows);
  const widest = Math.max(1, ...rows.flat().map((row) => String(row.newLine ?? row.oldLine ?? "").length));
  return rows.flatMap((segment, index) => [
    ...(index > 0 ? [[{ text: `${" ".repeat(widest)} ⋯`, dim: true }]] : []),
    ...segment.map((row) => codeLine(row, row.newLine ?? row.oldLine, widest, width)),
  ]);
}

function stat(file: DiffFile | undefined): Array<Span> {
  if (file === undefined) return [];
  return [
    { text: `  +${file.additions}`, color: THEME.addition.sign },
    { text: ` −${file.deletions}`, color: THEME.deletion.sign },
  ];
}

export interface StopView {
  readonly stop: Stop;
  readonly index: number;
  readonly count: number;
  readonly nextTitle: string | null;
  readonly files: ReadonlyMap<string, DiffFile>;
  readonly showFileDiffs: boolean;
}

/** Draws one stop the way t3code's GuideStop lays it out, top to bottom. */
export function stopLines({ stop, index, count, nextTitle, files, showFileDiffs }: StopView, width: number): Array<Line> {
  const { lettered, byExcerpt } = letterStopNotes(stop);
  const out: Array<Line> = [
    [{ text: `Stop ${index + 1} of ${count}`, dim: true }, { text: `  ·  ${stopSubline(stop)}`, dim: true }],
    BLANK,
    ...prose(stop.title, width, { bold: true }),
  ];
  if (stop.summary.trim() !== "") out.push(BLANK, ...prose(stop.summary, width));

  if (stop.attention !== null) {
    const bar = { text: "┃ ", color: THEME.attention };
    out.push(
      BLANK,
      [bar, { text: `◆ ${ATTENTION_LABELS[stop.attention.kind]}`, color: THEME.attention, bold: true }],
      ...prose(stop.attention.note, width - 2).map((line) => [bar, ...line]),
    );
  }

  stop.excerpts.forEach((excerpt, excerptIndex) => {
    const file = files.get(excerpt.path);
    out.push(BLANK, [
      { text: excerpt.path, bold: true, color: THEME.accent },
      { text: `  L${excerpt.start}–${excerpt.end}${excerpt.side === "old" ? " (removed)" : ""}`, dim: true },
      ...(excerpt.caption.trim() ? inline(`  ${excerpt.caption}`, { dim: true }) : []),
    ]);
    out.push(
      ...(file === undefined
        ? [[{ text: "  This file is not in the diff.", dim: true }]]
        : diffLines(excerptRows(file, excerpt), excerpt.side, width, byExcerpt[excerptIndex])),
    );
  });

  if (lettered.length > 0) {
    out.push(BLANK, [{ text: "Notes on this stop", bold: true }, { text: `  ${lettered.length === 1 ? "1 note" : `${lettered.length} notes`}`, dim: true }]);
    for (const { marker, note } of lettered) {
      out.push(BLANK, [
        { text: ` ${marker} `, color: "black", bg: THEME.attention, bold: true },
        { text: ` ${note.title}`, bold: true },
        { text: `  ${note.path.split("/").at(-1)}:${note.line}`, dim: true },
      ]);
      if (note.body.trim() !== "") out.push(...prose(note.body, width, {}, "    "));
    }
  }

  const others = otherFiles(stop);
  if (others.length > 0) {
    out.push(BLANK, [
      { text: stop.excerpts.length > 0 ? "Also in this stop" : "Files in this stop", bold: true },
      { text: `  f ${showFileDiffs ? "hides" : "shows"} diffs`, dim: true },
    ]);
    for (const other of others) {
      const file = files.get(other.path);
      out.push([{ text: showFileDiffs ? "▾ " : "▸ ", dim: true }, { text: other.path }, ...stat(file)]);
      if (other.note.trim() !== "") out.push(...prose(other.note, width, { dim: true }, "  "));
      if (showFileDiffs) out.push(...(file ? fileDiffLines(file, width) : [[{ text: "  This file is not in the diff.", dim: true }]]), BLANK);
    }
  }

  if (stop.questions.length > 0) {
    out.push(BLANK, [{ text: "Questions you might ask", bold: true }]);
    for (const question of stop.questions) {
      out.push(...prose(question, width - 2).map((line, i) => [{ text: i === 0 ? "? " : "  ", color: THEME.accent }, ...line]));
    }
  }

  out.push(BLANK, [{ text: "─".repeat(width), dim: true }]);
  out.push(
    nextTitle !== null
      ? [{ text: "Next  ", dim: true }, { text: nextTitle, bold: true }, { text: "  j →", color: THEME.accent }]
      : [{ text: "That's the tour. ", bold: true }, { text: "o opens the PR to leave your review.", dim: true }],
  );
  return out;
}

export interface RailView {
  readonly stops: ReadonlyArray<Stop>;
  readonly position: number;
  readonly seen: ReadonlySet<number>;
}

/** The numbered stop list with read checkmarks, as in t3code's GuideRail. */
export function railLines({ stops, position, seen }: RailView, width: number): Array<Line> {
  const out: Array<Line> = [[{ text: `${seen.size} of ${stops.length} read`, dim: true }], BLANK];
  stops.forEach((stop, index) => {
    const active = index === position;
    const paint = (line: Array<Span>): Line => {
      const length = line.reduce((sum, span) => sum + span.text.length, 0);
      const padded = [...line, { text: " ".repeat(Math.max(width - length, 0)) }];
      return active ? padded.map((span) => ({ ...span, bg: THEME.activeBg })) : padded;
    };
    const bullet: Span = seen.has(index)
      ? { text: " ✓ ", color: THEME.success }
      : { text: `${String(index + 1).padStart(2)} `, dim: !active };
    const wrapped = prose(stop.title, width - 4);
    const title = wrapped.length > 3 ? [...wrapped.slice(0, 2), [...(wrapped[2] ?? []), { text: "…" }]] : wrapped;
    title.forEach((line, i) => out.push(paint([i === 0 ? bullet : { text: "   " }, { text: " " }, ...line.map((span) => ({ ...span, bold: active }))])));
    out.push(
      paint([
        { text: "    " },
        ...(stop.attention !== null ? [{ text: "Look closely ", color: THEME.attention }] : []),
        { text: stopSubline(stop), dim: true },
      ]),
    );
    out.push(BLANK);
  });
  return out;
}
