import { z } from "zod";

import { EFFORTS, PROVIDER_IDS, TIERS } from "./catalog.ts";

export const ATTENTION_KINDS = ["tradeoff", "contract", "product", "risk", "accessibility"] as const;

export const Excerpt = z.strictObject({
  path: z.string(),
  side: z.enum(["new", "old"]),
  start: z.int(),
  end: z.int(),
  caption: z.string(),
});
export type Excerpt = z.infer<typeof Excerpt>;

export const Note = z.strictObject({
  path: z.string(),
  line: z.int(),
  title: z.string(),
  body: z.string(),
});
export type Note = z.infer<typeof Note>;

export const Stop = z.strictObject({
  title: z.string(),
  summary: z.string(),
  attention: z.nullable(z.strictObject({ kind: z.enum(ATTENTION_KINDS), note: z.string() })),
  excerpts: z.array(Excerpt),
  files: z.array(z.strictObject({ path: z.string(), note: z.string() })),
  notes: z.array(Note),
  questions: z.array(z.string()),
});
export type Stop = z.infer<typeof Stop>;
export type Attention = NonNullable<Stop["attention"]>;

/** What the agent must return. */
export const GuideOutput = z.strictObject({ stops: z.array(Stop) });
export type GuideOutput = z.infer<typeof GuideOutput>;

const DiffRow = z.object({
  kind: z.enum(["context", "addition", "deletion"]),
  oldLine: z.nullable(z.int()),
  newLine: z.nullable(z.int()),
  text: z.string(),
});
export type DiffRow = z.infer<typeof DiffRow>;

const DiffHunk = z.object({
  oldStart: z.int(),
  oldCount: z.int(),
  newStart: z.int(),
  newCount: z.int(),
  rows: z.array(DiffRow),
});
export type DiffHunk = z.infer<typeof DiffHunk>;

export const DiffFile = z.object({
  path: z.string(),
  additions: z.int(),
  deletions: z.int(),
  hunks: z.array(DiffHunk),
});
export type DiffFile = z.infer<typeof DiffFile>;

export const PullRequestRef = z.object({
  host: z.enum(["github", "gitlab"]),
  hostname: z.string(),
  repo: z.string(),
  number: z.int(),
  url: z.string(),
  title: z.string(),
});
export type PullRequestRef = z.infer<typeof PullRequestRef>;

export const Guide = z.object({
  version: z.literal(1),
  pr: PullRequestRef,
  headSha: z.string(),
  baseSha: z.string(),
  generatedAt: z.string(),
  choice: z.object({
    provider: z.enum(PROVIDER_IDS),
    model: z.string(),
    effort: z.enum(EFFORTS),
    tier: z.enum(TIERS),
  }),
  stops: z.array(Stop),
  files: z.array(DiffFile),
});
export type Guide = z.infer<typeof Guide>;
