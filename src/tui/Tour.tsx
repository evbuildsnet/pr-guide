import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";

import type { Guide } from "../model.ts";
import { railLines, stopLines, type Line } from "./lines.ts";

const RAIL_WIDTH = 34;
/** Below this the rail hides, as t3code drops it on narrow panes. */
const RAIL_MIN_COLUMNS = 100;

export function Lines({ lines }: { lines: ReadonlyArray<Line> }) {
  return (
    <>
      {lines.map((line, index) => (
        <Text key={index} wrap="truncate-end">
          {line.length === 0
            ? " "
            : line.map((span, spanIndex) => (
                <Text key={spanIndex} color={span.color} backgroundColor={span.bg} bold={span.bold} dimColor={span.dim}>
                  {span.text}
                </Text>
              ))}
        </Text>
      ))}
    </>
  );
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
  const paneRows = Math.max(rows - 1, 1);
  const paneWidth = Math.max(columns - (showRail ? RAIL_WIDTH + 2 : 0) - 3, 20);

  const lines = useMemo(
    () =>
      stop === undefined
        ? [[{ text: "This change has no files to tour.", dim: true }]]
        : stopLines(
            { stop, index: position, count: stopCount, nextTitle: guide.stops[position + 1]?.title ?? null, files, showFileDiffs },
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
      else if (input === "f") setShowFileDiffs((current) => !current);
      else if (/^[1-9]$/.test(input)) goTo(Number(input) - 1);
    },
    { isActive: active },
  );

  const progress = maxScroll === 0 ? "" : top === 0 ? "top" : top >= maxScroll ? "end" : `${Math.round((top / maxScroll) * 100)}%`;
  const hints = "j/k stops · ↑↓ space scroll · 1-9 jump · f files · o open PR · r rewrite · s settings · q quit";

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" height={paneRows}>
        {showRail ? (
          <>
            <Box flexDirection="column" width={RAIL_WIDTH} paddingLeft={1} overflow="hidden">
              <Lines lines={railLines({ stops: guide.stops, position, seen }, RAIL_WIDTH - 1).slice(0, paneRows)} />
            </Box>
            <Box width={1} marginRight={1} flexDirection="column" overflow="hidden">
              <Text dimColor>{"│\n".repeat(paneRows).trimEnd()}</Text>
            </Box>
          </>
        ) : null}
        <Box flexDirection="column" width={paneWidth + 1} paddingLeft={1} overflow="hidden">
          <Lines lines={lines.slice(top, top + paneRows)} />
        </Box>
      </Box>
      <Box paddingX={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor wrap="truncate-end">{hints}</Text>
        </Box>
        <Box flexShrink={0} marginLeft={2}>
          <Text dimColor>{progress}</Text>
        </Box>
      </Box>
    </Box>
  );
}
