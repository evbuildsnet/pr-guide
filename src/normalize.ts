import { hunkRange } from "./diff.ts";
import type { DiffFile, Excerpt, GuideOutput, Stop } from "./model.ts";

const MAX_EXCERPT_LINES = 25;

const nonEmpty = (value: string) => value.trim() !== "";

function clampExcerpt(excerpt: Excerpt, file: DiffFile): Excerpt | null {
  const start = Math.min(excerpt.start, excerpt.end);
  const end = Math.max(excerpt.start, excerpt.end);
  const overlapping = file.hunks
    .map((hunk) => hunkRange(hunk, excerpt.side))
    .filter((range) => range !== null && range.start <= end && start <= range.end);
  const first = overlapping[0];
  const last = overlapping.at(-1);
  if (!first || !last) return null;
  return { ...excerpt, start: Math.max(start, first.start), end: Math.min(end, last.end) };
}

function mergeExcerpts(excerpts: ReadonlyArray<Excerpt>): Array<Excerpt> {
  const merged: Array<Excerpt> = [];
  for (const excerpt of excerpts) {
    const index = merged.findIndex(
      (other) =>
        other.path === excerpt.path &&
        other.side === excerpt.side &&
        other.start <= excerpt.end + 1 &&
        excerpt.start <= other.end + 1,
    );
    const other = merged[index];
    if (other === undefined) {
      merged.push(excerpt);
      continue;
    }
    merged[index] = {
      ...other,
      start: Math.min(other.start, excerpt.start),
      end: Math.max(other.end, excerpt.end),
      caption: other.caption || excerpt.caption,
    };
  }
  return merged.map((excerpt) => ({
    ...excerpt,
    end: Math.min(excerpt.end, excerpt.start + MAX_EXCERPT_LINES - 1),
  }));
}

/**
 * Makes the agent's tour trustworthy: excerpts land inside real hunks, notes sit on shown
 * lines, every changed file is placed exactly once, and anything unplaced gets its own stop.
 */
export function normalizeGuide(guide: GuideOutput, files: ReadonlyArray<DiffFile>): Array<Stop> {
  const byPath = new Map(files.map((file) => [file.path, file]));

  const shaped = guide.stops
    .filter((stop) => nonEmpty(stop.title))
    .map((stop): Stop => {
      // The rail numbers stops itself; some models number their titles too.
      const title = stop.title.trim().replace(/^\d+[.)]\s+/, "");
      const excerpts = mergeExcerpts(
        stop.excerpts.flatMap((excerpt) => {
          const file = byPath.get(excerpt.path);
          const clamped = file === undefined ? null : clampExcerpt(excerpt, file);
          return clamped === null ? [] : [clamped];
        }),
      );
      return {
        ...stop,
        title,
        attention: stop.attention !== null && nonEmpty(stop.attention.note) ? stop.attention : null,
        excerpts,
        files: stop.files.filter((file) => byPath.has(file.path)),
        notes: stop.notes.filter(
          (note) =>
            nonEmpty(note.title) &&
            excerpts.some(
              (excerpt) =>
                excerpt.path === note.path && excerpt.start <= note.line && note.line <= excerpt.end,
            ),
        ),
        questions: stop.questions.filter(nonEmpty),
      };
    });

  const placed = new Set(shaped.flatMap((stop) => stop.excerpts.map((excerpt) => excerpt.path)));
  const stops = shaped.map((stop) => {
    const stopFiles = stop.files.filter((file) => !placed.has(file.path));
    for (const file of stopFiles) placed.add(file.path);
    return { ...stop, files: stopFiles };
  });
  const unplaced = files.filter((file) => !placed.has(file.path));
  if (unplaced.length > 0) {
    stops.push({
      title: "Other files",
      summary: "Changed files the tour does not otherwise cover.",
      attention: null,
      excerpts: [],
      files: unplaced.map((file) => ({ path: file.path, note: "" })),
      notes: [],
      questions: [],
    });
  }
  return stops;
}
