import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "pr-guide-settings-"));
const { activeChoice, loadSettings, sanitizeChoice, settingsPath } = await import("./settings.ts");

test("a reasoning level the model lacks becomes the highest one it offers", () => {
  const choice = { model: "gemini-3.1-pro", effort: "medium", tier: "standard" } as const;
  assert.equal(sanitizeChoice("antigravity", choice).effort, "high");
  assert.equal(sanitizeChoice("antigravity", { ...choice, model: "gemini-3.8-flash", effort: "xhigh" }).effort, "high");
  assert.equal(sanitizeChoice("antigravity", { ...choice, model: "gemini-3.8-flash" }).effort, "medium");
  assert.equal(sanitizeChoice("codex", { ...choice, model: "gpt-6.1-sol", effort: "xhigh" }).effort, "xhigh");
});

test("settings saved before Antigravity existed keep their choices", () => {
  const saved = {
    provider: "codex",
    claude: { model: "claude-haiku-5-5", effort: "low", tier: "standard" },
    codex: { model: "gpt-6-luna", effort: "medium", tier: "fast" },
  };
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(saved));

  const settings = loadSettings();
  assert.deepEqual(activeChoice(settings), { provider: "codex", ...saved.codex });
  assert.deepEqual(settings.claude, saved.claude);
  assert.equal(settings.antigravity.model, "gemini-3.1-pro");
});
