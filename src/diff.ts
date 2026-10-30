import type { DiffFile, DiffHunk, DiffRow, Excerpt } from "./model.ts";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses `git diff` output into per-file hunks. `paths` (from `--name-only -z`) is the
 * authoritative file list, so binary or rename-only files still appear, without hunks.
 */
export function parseDiff(paths: ReadonlyArray<string>, patch: string): Array<DiffFile> {
  const hunksByPath = new Map<string, Array<DiffHunk>>();
  let oldPath: string | null = null;
  let hunks: Array<DiffHunk> | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  // Inside a file's hunks a `--- ` or `+++ ` line is a removed or added source line, not a header.
  let inHunks = false;

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      oldPath = null;
      hunks = null;
      hunk = null;
      inHunks = false;
    } else if (!inHunks && line.startsWith("--- ")) {
      oldPath = line.startsWith("--- a/") ? line.slice(6) : null;
    } else if (!inHunks && line.startsWith("+++ ")) {
      const path = line.startsWith("+++ b/") ? line.slice(6) : oldPath;
      if (path === null) continue;
      hunks = hunksByPath.get(path) ?? [];
      hunksByPath.set(path, hunks);
    } else if (hunks !== null) {
      const header = HUNK_HEADER.exec(line);
      if (header !== null) {
        inHunks = true;
        oldLine = Number(header[1]);
        newLine = Number(header[3]);
        hunk = {
          oldStart: oldLine,
          oldCount: header[2] === undefined ? 1 : Number(header[2]),
          newStart: newLine,
          newCount: header[4] === undefined ? 1 : Number(header[4]),
          rows: [],
        };
        hunks.push(hunk);
        continue;
      }
      if (hunk === null) continue;
      const text = line.slice(1);
      if (line.startsWith("+")) {
        hunk.rows.push({ kind: "addition", oldLine: null, newLine: newLine++, text });
      } else if (line.startsWith("-")) {
        hunk.rows.push({ kind: "deletion", oldLine: oldLine++, newLine: null, text });
      } else if (line.startsWith(" ")) {
        hunk.rows.push({ kind: "context", oldLine: oldLine++, newLine: newLine++, text });
      }
    }
  }

  return paths.map((path) => {
    const fileHunks = hunksByPath.get(path) ?? [];
    const rows = fileHunks.flatMap((h) => h.rows);
    return {
      path,
      additions: rows.filter((row) => row.kind === "addition").length,
      deletions: rows.filter((row) => row.kind === "deletion").length,
      hunks: fileHunks,
    };
  });
}

/** The line range a hunk covers on one side, or null when that side is empty. */
export function hunkRange(hunk: DiffHunk, side: Excerpt["side"]) {
  const [start, count] = side === "new" ? [hunk.newStart, hunk.newCount] : [hunk.oldStart, hunk.oldCount];
  return count === 0 ? null : { start, end: start + count - 1 };
}

const lineOn = (row: DiffRow, side: Excerpt["side"]) => (side === "new" ? row.newLine : row.oldLine);

/**
 * The rows an excerpt shows, one segment per hunk it touches. Rows from the other side
 * that sit between shown lines stay, so a replacement reads as removed-then-added.
 */
export function excerptRows(
  file: DiffFile,
  excerpt: Pick<Excerpt, "side" | "start" | "end">,
): Array<Array<DiffRow>> {
  return file.hunks.flatMap((hunk) => {
    const inRange = (row: DiffRow) => {
      const line = lineOn(row, excerpt.side);
      return line !== null && excerpt.start <= line && line <= excerpt.end;
    };
    const first = hunk.rows.findIndex(inRange);
    if (first === -1) return [];
    const last = hunk.rows.findLastIndex(inRange);
    return [hunk.rows.slice(first, last + 1)];
  });
}
