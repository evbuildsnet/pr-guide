import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";

import type { Guide } from "../model.ts";
import { stopSubline } from "../tour.ts";
import { chip, MEASURE, railLines, stopLines, THEME, type Line, type Span } from "./lines.ts";

/** Below this the rail hides, as t3code drops it on narrow panes, so the reading pane keeps ~90 columns. */
const RAIL_MIN_COLUMNS = 120;
/** Code fills the content column up to this width; wider terminals keep the column composed. */
const CONTENT_MAX = 120;
const railWidth = (columns: number) => (columns >= 150 ? 34 : 28);

export function Lines({ lines }: { lines: ReadonlyArray<Line> }) {
  return (
    <>
      {lines.map((line, index) => (
        <Text key={index} wrap="truncate-end">
          {line.length === 0
            ? " "
            : line.map((span, spanIndex) => (
                <Text key={spanIndex} color={span.color} backgroundColor={span.bg} bold={span.bold} italic={span.italic}>
                  {span.text}
                </Text>
              ))}
        </Text>
      ))}
    </>
  );
}

/** A one-column scrollbar: a thumb sized to the visible share of the stop. */
function scrollbar(rows: number, total: number, top: number): string {
  if (total <= rows) return "";
  const size = Math.max(Math.round((rows / total) * rows), 1);
  const start = Math.round((top / (total - rows)) * (rows - size));
  return Array.from({ length: rows }, (_, i) => (i >= start && i < start + size ? "┃" : " ")).join("\n");
}

export function Tour({
  guide,
  columns,
  rows,
  active,
}: {
  guide: Guide;
  columns: number;
  rows: number;
  active: boolean;
}) {
  const [position, setPosition] = useState(0);
  const [seen, setSeen] = useState<ReadonlySet<number>>(new Set());
  const [scroll, setScroll] = useState(0);
  const [showFileDiffs, setShowFileDiffs] = useState(false);

  const files = useMemo(() => new Map(guide.files.map((file) => [file.path, file])), [guide]);
  const stopCount = guide.stops.length;
  const stop = guide.stops[position];
  const showRail = columns >= RAIL_MIN_COLUMNS;
  const rail = showRail ? railWidth(columns) : 0;
  // The stop counter stays pinned above the scrolling pane.
  const paneRows = Math.max(rows - 2, 1);
  // Rail, divider and its margin, pane padding, scrollbar.
  const paneWidth = Math.min(Math.max(columns - (showRail ? rail + 2 : 0) - 3, 20), CONTENT_MAX);

  const { lines, filesAt, blocks } = useMemo(
    () =>
      stop === undefined
        ? { lines: [[{ text: "This change has no files to tour.", color: THEME.muted }]], filesAt: null, blocks: [] }
        : stopLines(
            { stop, isLast: position === stopCount - 1, nextTitle: guide.stops[position + 1]?.title ?? null, files, showFileDiffs },
            paneWidth,
          ),
    [stop, position, stopCount, guide, files, showFileDiffs, paneWidth],
  );
  const maxScroll = Math.max(lines.length - paneRows, 0);
  const top = Math.min(scroll, maxScroll);

  const goTo = (next: number) => {
    const clamped = Math.max(Math.min(next, stopCount - 1), 0);
    if (clamped === position) return;
    if (clamped > position) setSeen((current) => new Set(current).add(position));
    setPosition(clamped);
    setScroll(0);
    setShowFileDiffs(false);
  };
  const scrollBy = (delta: number) => setScroll(Math.max(Math.min(top + delta, maxScroll), 0));

  useInput(
    (input, key) => {
      if (input === "j" || input === "n" || key.rightArrow || key.return) {
        // On the last stop, moving on finishes the tour.
        if (position === stopCount - 1) setSeen((current) => new Set(current).add(position));
        else goTo(position + 1);
      } else if (input === "k" || input === "p" || key.leftArrow) goTo(position - 1);
      else if (key.downArrow) scrollBy(1);
      else if (key.upArrow) scrollBy(-1);
      else if (input === " " || key.pageDown) scrollBy(paneRows - 2);
      else if (input === "b" || key.pageUp) scrollBy(-(paneRows - 2));
      else if (input === "g" || key.home) setScroll(0);
      else if (input === "G" || key.end) setScroll(maxScroll);
      else if (input === "f" && filesAt !== null) {
        // Expanding brings the file list into view so the toggle visibly does something.
        if (!showFileDiffs) setScroll(filesAt);
        setShowFileDiffs(!showFileDiffs);
      } else if (/^[1-9]$/.test(input)) goTo(Number(input) - 1);
    },
    { isActive: active },
  );

  const railView = useMemo(() => railLines({ stops: guide.stops, position, seen }, rail - 1), [guide, position, seen, rail]);
  // Keeps the active stop in view on short terminals.
  const railTop = Math.max(Math.min(railView.activeStart, railView.activeEnd + 2 - (rows - 1)), 0);

  const first = position === 0;
  const last = position === stopCount - 1;
  const key = (glyph: string, enabled: boolean): Span => (enabled ? chip(glyph) : { ...chip(glyph), color: THEME.faint, bg: THEME.headerBg, bold: false });
  const keys: Line = [key("←", !first), { text: " " }, key("→", !last), { text: "  " }, chip("?")];
  // Keys line up with the prose's right edge; without the rail, the stop title fills the gap.
  const keysAt = Math.min(MEASURE, paneWidth);
  const counter: Line =
    stop === undefined
      ? []
      : [
          { text: "Stop ", color: THEME.muted },
          { text: String(position + 1), color: THEME.strong, bold: true },
          { text: ` of ${stopCount}  ·  ${stopSubline(stop)}`, color: THEME.muted },
          ...(showRail ? [] : [{ text: `  ·  ${stop.title}`, color: THEME.text }]),
        ];
  const counterRoom = keysAt - 13 - 2;
  const fitted = counter.reduce<{ spans: Array<Span>; used: number }>(
    ({ spans, used }, span) => {
      const room = counterRoom - used;
      if (room <= 0) return { spans, used };
      const text = span.text.length > room ? `${span.text.slice(0, room - 1)}…` : span.text;
      return { spans: [...spans, { ...span, text }], used: used + text.length };
    },
    { spans: [], used: 0 },
  );
  const pinned: Line = [...fitted.spans, { text: " ".repeat(Math.max(keysAt - 13 - fitted.used, 2)) }, ...keys];

  // A code block scrolled partly out of view keeps its file header on the first row.
  const block = blocks.find(({ header, end }) => header < top && top < end);
  const visible = block ? [lines[block.header] ?? [], ...lines.slice(top + 1, top + paneRows)] : lines.slice(top, top + paneRows);

  return (
    <Box flexDirection="row" height={rows}>
      {showRail ? (
        <>
          <Box flexDirection="column" width={rail} paddingLeft={1} overflow="hidden">
            <Lines lines={railView.lines.slice(railTop, railTop + rows)} />
          </Box>
          <Box width={1} marginRight={1} flexDirection="column" overflow="hidden">
            <Text color={THEME.border}>{"│\n".repeat(rows).trimEnd()}</Text>
          </Box>
        </>
      ) : null}
      <Box flexDirection="column" paddingLeft={1}>
        <Box width={paneWidth + 1} overflow="hidden">
          <Lines lines={[pinned]} />
        </Box>
        <Box height={1} />
        <Box flexDirection="row" height={paneRows}>
          <Box flexDirection="column" width={paneWidth} overflow="hidden">
            <Lines lines={visible} />
          </Box>
          <Box width={1} flexDirection="column" overflow="hidden">
            <Text color={THEME.faint}>{scrollbar(paneRows, lines.length, top)}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
