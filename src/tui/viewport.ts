import { isContinuation, THEME, type Block, type Line } from "./lines.ts";

/** A stop's rows and the code blocks among them, seen through a pane this many rows tall. */
export interface Pane {
  readonly lines: ReadonlyArray<Line>;
  readonly blocks: ReadonlyArray<Block>;
  readonly rows: number;
}

export const maxScroll = ({ lines, rows }: Pane) => Math.max(lines.length - rows, 0);

/**
 * What the pane shows with `top` as its first row. Once a code block's band starts scrolling away, its
 * caption's first row and its path stay pinned over the rows beneath them, as long as some of the block's
 * rows are still under them. A row continuing the one above (wrapped code, a note's body) never opens the
 * view: it backs up to the row it continues. At the very bottom it steps past instead, so Next stays in view.
 */
export function layout(pane: Pane, top: number) {
  const { lines, blocks, rows } = pane;
  // Up to two caption rows pin, so a two-line caption stays a whole sentence.
  const captionRows = (block: Block) => (block.caption === null ? [] : [block.caption, block.caption + 1].filter((index) => index < block.header));
  const rowsOf = (block: Block) => [...captionRows(block), block.header];
  const block = blocks.find((candidate) => (candidate.caption ?? candidate.header) < top && top + rowsOf(candidate).length < candidate.end);
  const pinned = block ? rowsOf(block) : [];
  // Pinned rows sit on a raised tint, the usual cue for a sticky header.
  // A longer caption ends its second pinned row on an ellipsis.
  const cut = block !== undefined && block.caption !== null && block.header - block.caption > 2;
  const pins = pinned.map((index, i) => {
    const line = index === block?.header ? (block.pinned ?? lines[index] ?? []) : (lines[index] ?? []);
    const raised = line.map((span) => ({ ...span, bg: THEME.pinnedBg }));
    if (!(cut && i === 1)) return raised;
    const full = raised.map((span) => span.text).join("");
    const text = `${full.trimEnd().slice(0, -1)}…`;
    const style = raised.find((span) => span.color !== undefined) ?? raised[0];
    return [{ ...style, text: text.padEnd(full.length) }];
  });
  let from = top + pins.length;
  if (top < maxScroll(pane)) while (from > 0 && isContinuation(lines[from] ?? [])) from--;
  else while (from < lines.length - 1 && isContinuation(lines[from] ?? [])) from++;
  const shown = lines.slice(from, from + rows - pins.length);
  return { pins, pinned, from, shown, last: from + shown.length - 1 };
}

/**
 * Where a move from `top` towards `target` lands. Moving down within a few rows of the bottom lands on the
 * bottom itself, rather than leave a sliver of blank, rule and Next below, but only if that skips nothing.
 */
export function settle(pane: Pane, top: number, target: number): number {
  const max = maxScroll(pane);
  const next = Math.max(Math.min(target, max), 0);
  if (next <= top || max - next > 3) return next;
  return layout(pane, max).from <= layout(pane, top).last + 1 ? max : next;
}

/** A page down starts with the last row this page showed, whatever ends up pinned above it. */
export function pageDown(pane: Pane, top: number): number {
  const { last } = layout(pane, top);
  const target = [2, 1, 0].map((back) => last - back).find((at) => at > top && layout(pane, at).from <= last) ?? last;
  return settle(pane, top, target);
}
