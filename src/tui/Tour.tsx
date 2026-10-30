import { Box, Text, useInput } from "ink";
import { useMemo, useState, type ReactNode } from "react";

import type { Guide } from "../model.ts";
import { stopSubline } from "../tour.ts";
import { chip, railLines, stopLines, THEME, type Line, type Onward, type Span } from "./lines.ts";
import { layout, pageDown, settle } from "./viewport.ts";

/** The rail hides, as t3code drops it on narrow panes, when keeping it would leave code less than this. */
const CODE_MIN_COLUMNS = 96;
/** Code fills the content column up to this width; prose keeps its own 80-column measure inside it. */
const CONTENT_MAX = 160;
const railWidth = (columns: number) => (columns >= 180 ? 40 : columns >= 150 ? 34 : 28);

export function Lines({ lines }: { lines: ReadonlyArray<Line> }) {
  return (
    <Box flexDirection="column">
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
    </Box>
  );
}

/** A one-column scrollbar: arrows at the ends while there is more that way, a thumb sized to the visible share. */
function scrollbar(rows: number, total: number, top: number): ReadonlyArray<Line> {
  if (total <= rows || rows < 3) return [];
  const track = rows - 2;
  const size = Math.max(Math.round((rows / total) * track), 1);
  const start = Math.round((top / (total - rows)) * (track - size));
  const end = (more: boolean, glyph: string): Line => [{ text: more ? glyph : " ", color: THEME.faint }];
  return [
    end(top > 0, "↑"),
    ...Array.from({ length: track }, (_, i): Line => [{ text: i >= start && i < start + size ? "┃" : " ", color: THEME.thumb }]),
    end(top < total - rows, "↓"),
  ];
}

export function Tour({
  guide,
  columns,
  rows,
  active,
  cover,
}: {
  guide: Guide;
  columns: number;
  rows: number;
  active: boolean;
  /** Shown in place of the stop, keeping the rail, e.g. the key list. Told what → does here. */
  cover?: (onward: string) => ReactNode;
}) {
  const [position, setPosition] = useState(0);
  const [seen, setSeen] = useState<ReadonlySet<number>>(new Set());
  const [scroll, setScroll] = useState(0);
  const [showFileDiffs, setShowFileDiffs] = useState(false);
  // Blank rows past the end, so a jump can put its target on the top row of a short stop. Scrolling up drops them.
  const [reach, setReach] = useState(0);

  const files = useMemo(() => new Map(guide.files.map((file) => [file.path, file])), [guide]);
  const stopCount = guide.stops.length;
  const stop = guide.stops[position];
  const showRail = columns - railWidth(columns) - 5 >= CODE_MIN_COLUMNS;
  const rail = showRail ? railWidth(columns) : 0;
  // The stop counter stays pinned above the scrolling pane.
  const paneRows = Math.max(rows - 2, 1);
  // Rail, divider and its margin, pane padding, scrollbar.
  const paneWidth = Math.min(Math.max(columns - (showRail ? rail + 2 : 0) - 3, 20), CONTENT_MAX);

  const last = position === stopCount - 1;
  // From the last stop, → goes to the first stop still unread, then finishes the tour.
  const firstUnread = guide.stops.findIndex((_, index) => index !== position && !seen.has(index));
  const onward: Onward = !last
    ? { kind: "next", title: guide.stops[position + 1]?.title ?? "", label: "Next" }
    : firstUnread !== -1
      ? { kind: "next", title: guide.stops[firstUnread]?.title ?? "", label: "Next unread" }
      : seen.has(position)
        ? { kind: "done" }
        : { kind: "finish" };

  const { lines: content, filesAt, blocks, ruleAt } = useMemo(
    () =>
      stop === undefined
        ? { lines: [[{ text: "This change has no files to tour.", color: THEME.muted }]], filesAt: null, blocks: [], ruleAt: -1, wide: false }
        : stopLines(
            { stop, onward, files, showFileDiffs },
            // A column of air before the scrollbar.
            paneWidth - 1,
          ),
    [stop, JSON.stringify(onward), files, showFileDiffs, paneWidth],
  );
  const lines = reach > content.length ? [...content, ...Array.from({ length: reach - content.length }, (): Line => [])] : content;
  const maxScroll = Math.max(lines.length - paneRows, 0);
  const top = Math.min(scroll, maxScroll);

  const goTo = (next: number, markRead = next > position) => {
    const clamped = Math.max(Math.min(next, stopCount - 1), 0);
    if (clamped === position) return;
    if (markRead) setSeen((current) => new Set(current).add(position));
    setPosition(clamped);
    setScroll(0);
    setReach(0);
    setShowFileDiffs(false);
  };
  const pane = { lines, blocks, rows: paneRows };
  const scrollBy = (delta: number) => {
    if (delta < 0) setReach(0);
    setScroll(settle(pane, top, top + delta));
  };
  useInput(
    (input, key) => {
      if (input === "j" || input === "n" || key.rightArrow || key.return) {
        if (!last) goTo(position + 1);
        else if (firstUnread !== -1) goTo(firstUnread, true);
        else setSeen((current) => new Set(current).add(position));
      } else if (input === "k" || input === "p" || key.leftArrow) goTo(position - 1);
      else if (key.downArrow) scrollBy(1);
      else if (key.upArrow) scrollBy(-1);
      else if (input === " " || key.pageDown) setScroll(pageDown(pane, top));
      else if (input === "b" || key.pageUp) scrollBy(-(paneRows - 2));
      else if (input === "g" || key.home) scrollBy(-top);
      else if (input === "G" || key.end) setScroll(maxScroll);
      else if (input === "f" && filesAt !== null) {
        // Either way the file list comes to the top row, so the toggle visibly does something.
        setReach(filesAt + paneRows);
        setScroll(filesAt);
        setShowFileDiffs(!showFileDiffs);
        // Jumping is looking around, not reading: only → marks a stop read.
      } else if (/^[1-9]$/.test(input)) goTo(Number(input) - 1, false);
    },
    { isActive: active },
  );

  const railView = useMemo(() => railLines({ stops: guide.stops, position, seen }, rail - 1, rows), [guide, position, seen, rail, rows]);
  // Keeps the active stop in view on short terminals.
  const railTop = Math.max(Math.min(railView.activeStart, railView.activeEnd + 2 - (rows - 1)), 0);

  const first = position === 0;
  // A key that does nothing here drops its cap and dims, so it reads as resting, not broken.
  const key = (glyph: string, enabled: boolean): Span => (enabled ? chip(glyph) : { text: ` ${glyph} `, color: THEME.disabled });
  // While the key list covers the stop, ? is the live key and the arrows rest.
  const covered = cover !== undefined;
  const keys: Line = [
    key("←", !first && !covered),
    { text: " " },
    key("→", onward.kind !== "done" && !covered),
    { text: "  " },
    covered ? { ...chip("?"), color: THEME.background, bg: THEME.accent } : chip("?"),
  ];
  // Keys keep one place for the whole tour: the content's right edge.
  const keysAt = paneWidth - 1;
  const counter: Line =
    stop === undefined
      ? []
      : [
          { text: "Stop ", color: THEME.muted },
          { text: String(position + 1), color: THEME.strong, bold: true },
          // Once the heading scrolls away without a rail, the title says more than the file count.
          // With the rail, the file count is already under the active stop.
          // Without the rail, the read count rides along too.
          ...(showRail
            ? [{ text: ` of ${stopCount}`, color: THEME.muted }]
            : top === 0
              ? [{ text: ` of ${stopCount}  ·  ${seen.size} read  ·  ${stopSubline(stop)}`, color: THEME.muted }]
              : [{ text: ` of ${stopCount}  ·  ${seen.size} read  ·  `, color: THEME.muted }, { text: stop.title, color: THEME.text }]),
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

  const { pins, from, shown } = layout(pane, top);
  // The rule above Next never ends the view on its own.
  const ruleLast = from + shown.length - 1 === ruleAt;
  const visible = [...pins, ...(ruleLast ? [...shown.slice(0, -1), []] : shown)];

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
            {cover ? cover(onward.kind === "next" ? (onward.label === "Next" ? "Next stop" : "Next unread stop") : onward.kind === "finish" ? "Finish the tour" : "Nothing next: the tour is done") : <Lines lines={visible} />}
          </Box>
          <Box width={1} flexDirection="column" overflow="hidden">
            <Lines lines={covered ? [] : scrollbar(paneRows, lines.length, top)} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
