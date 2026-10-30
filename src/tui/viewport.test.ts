import assert from "node:assert/strict";
import { test } from "node:test";

import { CONTINUATION, type Block, type Line } from "./lines.ts";
import { layout, maxScroll, pageDown, type Pane } from "./viewport.ts";

/** A stop of prose, then code blocks whose rows sometimes wrap, so pins and continuations interact. */
function stop(): Pane {
  const lines: Array<Line> = [];
  const blocks: Array<Block> = [];
  const push = (text: string, continues = false) => lines.push([{ text, ...(continues && { cont: true }) }, ...(continues ? [{ text: CONTINUATION }] : [])]);
  for (let i = 0; i < 7; i++) push(`prose ${i}`);
  for (let b = 0; b < 4; b++) {
    push("");
    const caption = lines.length;
    push(`caption ${b}`);
    const header = lines.length;
    push(`path ${b}`);
    for (let row = 0; row < 9 + b * 5; row++) {
      push(`code ${b}.${row}`);
      if ((row + b) % 3 === 0) push(`wrapped ${b}.${row}`, true);
      if (row % 7 === 4) push(`more ${b}.${row}`, true);
    }
    blocks.push({ caption, header, end: lines.length });
  }
  push("");
  push("rule");
  push("next");
  return { lines, blocks, rows: 0 };
}

test("paging down shows every row, pinned or not, at any pane height", () => {
  const base = stop();
  for (const rows of [8, 11, 17, 24, 38]) {
    const pane = { ...base, rows };
    const seen = new Set<number>();
    let top = 0;
    for (let page = 0; page < 200; page++) {
      const { pinned, from, shown } = layout(pane, top);
      pinned.forEach((index) => seen.add(index));
      shown.forEach((_, i) => seen.add(from + i));
      if (top === maxScroll(pane)) break;
      const next = pageDown(pane, top);
      assert.ok(next > top, `page down from ${top} moves on (rows ${rows})`);
      top = next;
    }
    const missing = pane.lines.map((_, index) => index).filter((index) => !seen.has(index));
    assert.deepEqual(missing, [], `rows ${rows}`);
  }
});

test("the bottom of a stop keeps Next in view", () => {
  for (const rows of [8, 11, 17]) {
    const pane = { ...stop(), rows };
    const { from, shown } = layout(pane, maxScroll(pane));
    assert.equal(from + shown.length, pane.lines.length, `rows ${rows}`);
  }
});
