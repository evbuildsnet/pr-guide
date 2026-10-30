import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ModelChoice } from "./catalog.ts";
import { cacheDir, checkoutPullRequest } from "./checkout.ts";
import { parseDiff } from "./diff.ts";
import { pullRequestRef, type PullRequest } from "./host.ts";
import { Guide, GuideOutput, type PullRequestRef } from "./model.ts";
import { normalizeGuide } from "./normalize.ts";
import { runOk } from "./proc.ts";
import { buildGuidePrompt } from "./prompt.ts";
import { RUNNERS } from "./runners.ts";

export const STAGES = {
  checkout: "Checking out the change",
  writing: "Reading the change and writing the tour",
} as const;
export type Stage = keyof typeof STAGES;

const GUIDE_TIMEOUT_MS = 15 * 60_000;

interface WriteOptions {
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly onStage: (stage: Stage) => void;
}

// Guides being written, so quitting can stop them and wait until their checkouts are removed.
const shutdown = new AbortController();
const writing = new Set<Promise<Guide>>();

/** Cancels every guide being written and resolves once their checkouts are gone. */
export async function stopWriting(): Promise<void> {
  shutdown.abort();
  await Promise.allSettled(writing);
}

export function writeGuide(pr: PullRequest, choice: ModelChoice, options: WriteOptions): Promise<Guide> {
  const signal = options.signal ? AbortSignal.any([options.signal, shutdown.signal]) : shutdown.signal;
  const run = write(pr, choice, { ...options, signal });
  writing.add(run);
  const forget = () => writing.delete(run);
  run.then(forget, forget);
  return run;
}

async function write(pr: PullRequest, choice: ModelChoice, options: WriteOptions & { signal: AbortSignal }): Promise<Guide> {
  options.onStage("checkout");
  const checkout = await checkoutPullRequest(pr, options.cwd, options.signal);
  try {
    const range = [`${checkout.baseSha}...HEAD`];
    const git = (args: ReadonlyArray<string>) =>
      runOk("git", ["-c", "core.quotepath=off", ...args], { cwd: checkout.path, signal: options.signal });
    const [names, patch] = await Promise.all([
      git(["diff", "--no-ext-diff", "--name-only", "-z", ...range]),
      git(["diff", "--no-ext-diff", "--no-color", ...range]),
    ]);
    const files = parseDiff(names.split("\0").filter((path) => path !== ""), patch);

    options.onStage("writing");
    const output = await RUNNERS[choice.provider]({
      cwd: checkout.path,
      prompt: buildGuidePrompt({
        number: pr.number,
        title: pr.title,
        description: pr.description,
        baseBranch: pr.baseBranch,
        baseCommit: checkout.baseSha,
        settledReview: pr.settledReview,
      }),
      schema: GuideOutput,
      choice,
      signal: options.signal,
      timeoutMs: GUIDE_TIMEOUT_MS,
    });

    const guide: Guide = {
      version: 1,
      pr: pullRequestRef(pr),
      headSha: checkout.headSha,
      baseSha: checkout.baseSha,
      generatedAt: new Date().toISOString(),
      choice,
      stops: normalizeGuide(output, files),
      files,
    };
    saveGuide(guide);
    return guide;
  } finally {
    await checkout.dispose();
  }
}

// One guide per PR: the latest one written, whatever head it was written for.
const guidePath = (pr: Pick<PullRequestRef, "hostname" | "repo" | "number">) =>
  join(cacheDir, "guides", pr.hostname, pr.repo, `${pr.number}.json`);

export function readGuide(pr: Pick<PullRequestRef, "hostname" | "repo" | "number">): Guide | null {
  try {
    const parsed = Guide.safeParse(JSON.parse(readFileSync(guidePath(pr), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function saveGuide(guide: Guide): void {
  const path = guidePath(guide.pr);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(guide));
}
