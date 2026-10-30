import { describeChoice } from "./catalog.ts";
import { excerptRows } from "./diff.ts";
import type { Guide } from "./model.ts";
import { ATTENTION_LABELS, letterStopNotes, otherFiles } from "./tour.ts";

const SIGNS = { context: " ", addition: "+", deletion: "-" } as const;

export function guideToMarkdown(guide: Guide): string {
  const files = new Map(guide.files.map((file) => [file.path, file]));
  const out: Array<string> = [
    `# ${guide.pr.title} (#${guide.pr.number})`,
    "",
    `${guide.pr.url} · head \`${guide.headSha.slice(0, 7)}\` · ${describeChoice(guide.choice)}`,
  ];

  guide.stops.forEach((stop, index) => {
    const { lettered, byExcerpt } = letterStopNotes(stop);
    out.push("", `## ${index + 1}. ${stop.title}`, "", stop.summary);
    if (stop.attention !== null) {
      out.push("", `> **${ATTENTION_LABELS[stop.attention.kind]}.** ${stop.attention.note}`);
    }
    stop.excerpts.forEach((excerpt, excerptIndex) => {
      const markers = byExcerpt[excerptIndex];
      const file = files.get(excerpt.path);
      out.push("", `**\`${excerpt.path}\`** L${excerpt.start}–${excerpt.end}${excerpt.caption ? ` · ${excerpt.caption}` : ""}`, "", "```diff");
      for (const [segmentIndex, segment] of (file ? excerptRows(file, excerpt) : []).entries()) {
        if (segmentIndex > 0) out.push("@@");
        for (const row of segment) {
          const line = excerpt.side === "new" ? row.newLine : row.oldLine;
          const marks = line === null ? undefined : markers?.get(line);
          out.push(`${SIGNS[row.kind]}${row.text}${marks ? `  // [${marks.join(",")}]` : ""}`);
        }
      }
      out.push("```");
    });
    if (lettered.length > 0) {
      out.push("", "Notes:");
      for (const { marker, note } of lettered) {
        out.push(`- **[${marker}] ${note.title}** (\`${note.path}:${note.line}\`)${note.body.trim() ? ` ${note.body}` : ""}`);
      }
    }
    const others = otherFiles(stop);
    if (others.length > 0) {
      out.push("", stop.excerpts.length > 0 ? "Also in this stop:" : "Files in this stop:");
      for (const file of others) out.push(`- \`${file.path}\`${file.note.trim() ? ` ${file.note}` : ""}`);
    }
    if (stop.questions.length > 0) {
      out.push("", "Questions:");
      for (const question of stop.questions) out.push(`- ${question}`);
    }
  });
  return `${out.join("\n")}\n`;
}
