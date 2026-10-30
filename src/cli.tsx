#!/usr/bin/env node
import { render } from "ink";
import { parseArgs } from "node:util";

import { EFFORTS, PROVIDERS, PROVIDER_IDS, TIERS, describeChoice, findModel, tiersFor, type ModelChoice } from "./catalog.ts";
import { readGuide, STAGES, stopWriting, writeGuide } from "./guide.ts";
import { loadPullRequest } from "./host.ts";
import { guideToMarkdown } from "./markdown.ts";
import { activeChoice, loadSettings } from "./settings.ts";
import { App } from "./tui/App.tsx";

const HELP = `pr-guide: a guided tour of a pull request, written by your own Claude or Codex.

Usage
  pr-guide [pr]            pr is a number, URL or branch; empty means the current branch's PR

Output
  (default)                fullscreen tour in a terminal
  --md                     print the guide as Markdown (default when stdout is not a terminal)
  --json                   print the guide as JSON

Options
  --rewrite                write a new guide even if one is saved for this PR
  --provider <id>          ${PROVIDER_IDS.join(" | ")}
  --model <slug>           ${PROVIDER_IDS.map((id) => PROVIDERS[id].models.map((model) => model.slug).join(", ")).join("; ")}
  --effort <level>         ${EFFORTS.join(" | ")}
  --tier <speed>           ${TIERS.join(" | ")} (where the model offers it)
  -h, --help

Model flags apply to this run only; press s in the tour to change saved settings.
Needs gh (GitHub) or glab (GitLab) and the claude or codex CLI, each logged in.`;

function fail(message: string): never {
  process.stderr.write(`pr-guide: ${message}\n`);
  process.exit(1);
}

function oneOf<T extends string>(values: ReadonlyArray<T>, value: string, flag: string): T {
  return values.find((candidate) => candidate === value) ?? fail(`--${flag} must be one of: ${values.join(", ")}`);
}

/** Validates model flags against the catalog, inferring the provider from a model slug. */
function resolveOverride(flags: { provider?: string; model?: string; effort?: string; tier?: string }): Partial<ModelChoice> | null {
  if (!flags.provider && !flags.model && !flags.effort && !flags.tier) return null;
  const saved = activeChoice(loadSettings());
  const provider = flags.provider
    ? oneOf(PROVIDER_IDS, flags.provider, "provider")
    : flags.model
      ? (PROVIDER_IDS.find((id) => findModel(id, flags.model!)) ?? fail(`unknown model ${flags.model}`))
      : saved.provider;
  const base = provider === saved.provider ? saved : { ...PROVIDERS[provider].defaults, provider };
  const model = flags.model ?? base.model;
  if (!findModel(provider, model)) fail(`${model} is not a ${PROVIDERS[provider].label} model`);
  const effort = flags.effort ? oneOf(EFFORTS, flags.effort, "effort") : base.effort;
  const tiers = tiersFor({ provider, model });
  const tier = flags.tier ? oneOf(tiers, flags.tier, "tier") : tiers.includes(base.tier) ? base.tier : "standard";
  return { provider, model, effort, tier };
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    md: { type: "boolean" },
    json: { type: "boolean" },
    rewrite: { type: "boolean" },
    provider: { type: "string" },
    model: { type: "string" },
    effort: { type: "string" },
    tier: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  process.stdout.write(`${HELP}\n`);
  process.exit(0);
}
if (positionals.length > 1) fail("expected at most one pull request");

const target = positionals[0];
const cwd = process.cwd();
const override = resolveOverride(values);
const headless = values.md || values.json || !process.stdout.isTTY || !process.stdin.isTTY;

// Signals stop any guide being written and wait for its checkout to be removed before exiting.
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const) {
  process.once(signal, () => void stopWriting().finally(() => process.exit(code)));
}

if (headless) {
  try {
    const pr = await loadPullRequest(target, cwd);
    const cached = values.rewrite ? null : readGuide(pr);
    const choice = { ...activeChoice(loadSettings()), ...override };
    // Headless runs answer for the current head, so a guide for an older one is rewritten.
    const guide =
      cached !== null && cached.headSha === pr.headSha
        ? cached
        : await writeGuide(pr, choice, {
            cwd,
            onStage: (stage) => process.stderr.write(`pr-guide: ${STAGES[stage]} (${describeChoice(choice)})…\n`),
          });
    if (values.json) {
      const { files: _, ...rest } = guide;
      process.stdout.write(`${JSON.stringify(rest, null, 2)}\n`);
    } else {
      process.stdout.write(guideToMarkdown(guide));
    }
  } catch (error) {
    // A signal handler is already waiting for cleanup and will exit.
    if (error instanceof DOMException && error.name === "AbortError") await new Promise(() => {});
    fail(error instanceof Error ? error.message : String(error));
  }
} else {
  // Lets the mouse wheel scroll the tour in terminals that map it to arrow keys.
  process.stdout.write("\x1b[?1007h");
  const app = render(<App target={target} cwd={cwd} override={override} rewrite={values.rewrite ?? false} />, {
    alternateScreen: true,
    incrementalRendering: true,
  });
  await app.waitUntilExit();
  process.stdout.write("\x1b[?1007l");
  // Quitting mid-run leaves the agent stopping; wait for its checkout to be removed.
  await stopWriting();
  process.exit(0);
}
