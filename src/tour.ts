import type { Attention, Guide, Note, Stop } from "./model.ts";

export const ATTENTION_LABELS = {
  tradeoff: "A tradeoff to weigh",
  contract: "A contract to check",
  product: "A product call",
  risk: "A risk to judge",
  accessibility: "An accessibility call",
} as const satisfies Record<Attention["kind"], string>;

export function stopFilePaths(stop: Stop): ReadonlyArray<string> {
  return [...new Set([...stop.excerpts.map((excerpt) => excerpt.path), ...stop.files.map((file) => file.path)])];
}

export function stopSubline(stop: Stop): string {
  const count = stopFilePaths(stop).length;
  if (count === 0) return "Context, no code";
  return count === 1 ? "1 file" : `${count} files`;
}

/** Files the stop owns that it does not excerpt. */
export function otherFiles(stop: Stop): Stop["files"] {
  const excerpted = new Set(stop.excerpts.map((excerpt) => excerpt.path));
  return stop.files.filter((file) => !excerpted.has(file.path));
}

export interface LetteredNote {
  readonly marker: string;
  readonly note: Note;
}

/** Notes get letters A, B, C; each excerpt maps its lines to the markers on them. */
export function letterStopNotes(stop: Stop) {
  const lettered: Array<LetteredNote> = stop.notes.map((note, index) => ({
    marker: index < 26 ? String.fromCharCode(65 + index) : String(index + 1),
    note,
  }));
  const byExcerpt = stop.excerpts.map((excerpt) => {
    const lines = new Map<number, Array<string>>();
    for (const { marker, note } of lettered) {
      if (note.path !== excerpt.path || note.line < excerpt.start || note.line > excerpt.end) continue;
      lines.set(note.line, [...(lines.get(note.line) ?? []), marker]);
    }
    return lines;
  });
  return { lettered, byExcerpt };
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** How writing went, as `prepared in 2m 14s` and `48.2K tokens`; null for guides written before stats were kept. */
export function guideStats(guide: Guide): { readonly time: string; readonly tokens: string | null } | null {
  if (guide.stats === undefined) return null;
  const seconds = Math.round(guide.stats.durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return {
    time: `prepared in ${minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`}`,
    // A harness that reports nothing, or zero, shows no count rather than a misleading one.
    tokens: guide.stats.tokens ? `${compact.format(guide.stats.tokens)} tokens` : null,
  };
}
