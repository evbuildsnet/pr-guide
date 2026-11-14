import assert from "node:assert/strict";
import { test } from "node:test";

import { antigravityModels, codexTokens } from "./runners.ts";

test("agy's model list becomes catalog slugs, one reasoning level or many", () => {
  const stdout = "Fetching available models...\ngemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.1-pro-low\tGemini 3.1 Pro (Low)\ngemini-4-hydrogen-xhigh\tGemini 4 Hydrogen (XHigh)\n";
  assert.deepEqual([...new Set(antigravityModels(stdout))], ["gemini-3.8-flash", "gemini-3.1-pro", "gemini-4-hydrogen"]);
});

test("Codex's closing token count is read from its log", () => {
  assert.equal(codexTokens("codex\n{\"a\":1}\ntokens used\n16,834\n"), 16834);
  assert.equal(codexTokens("codex\n{\"a\":1}\n"), null);
});
