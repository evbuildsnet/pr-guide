import assert from "node:assert/strict";
import { test } from "node:test";

import type { Guide } from "../model.ts";
import { headerFacts } from "./lines.ts";

const guide: Guide = {
  version: 1,
  pr: { host: "github", hostname: "github.com", repo: "ev/pr-guide", number: 7, url: "https://github.com/ev/pr-guide/pull/7", title: "A change" },
  headSha: "a1b2c3d4e5f6",
  baseSha: "0000000",
  generatedAt: "2026-11-13T00:00:00.000Z",
  choice: { provider: "claude", model: "claude-opus-5-5", effort: "high", tier: "standard" },
  stats: { durationMs: 134_400, tokens: 48_213 },
  stops: [],
  files: [
    { path: "a.ts", additions: 100, deletions: 30, hunks: [] },
    { path: "b.ts", additions: 40, deletions: 2, hunks: [] },
  ],
};
const text = (facts: ReturnType<typeof headerFacts>) => facts.map((span) => span.text).join("");

test("the header says how the guide was written and which commit it describes", () => {
  assert.equal(text(headerFacts(guide, 200)), "2 files · +140 −32 · prepared in 2m 14s · 48.2K tokens · a1b2c3d");
});

test("narrow headers drop tokens, time, then size, and always keep the commit", () => {
  assert.equal(text(headerFacts(guide, 50)), "2 files · +140 −32 · prepared in 2m 14s · a1b2c3d");
  assert.equal(text(headerFacts(guide, 20)), "+140 −32 · a1b2c3d");
  assert.equal(text(headerFacts(guide, 0)), "a1b2c3d");
});

test("guides without stats, or without a token count, show no made-up numbers", () => {
  const { stats: _, ...older } = guide;
  assert.equal(text(headerFacts(older, 200)), "2 files · +140 −32 · a1b2c3d");
  assert.equal(text(headerFacts({ ...guide, stats: { durationMs: 9_000, tokens: null } }, 200)), "2 files · +140 −32 · prepared in 9s · a1b2c3d");
});
