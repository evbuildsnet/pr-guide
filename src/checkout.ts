import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { PullRequest } from "./host.ts";
import { run, runOk } from "./proc.ts";

/** Saved guides and cached clones are disposable, so they live in the system temp folder. */
export const cacheDir = join(tmpdir(), "pr-guide");

export interface Checkout {
  readonly path: string;
  readonly headSha: string;
  readonly baseSha: string;
  dispose(): Promise<void>;
}

interface Repo {
  readonly gitDir: string;
  readonly remote: string;
}

/** git@host:a/b.git, ssh://git@host/a/b, https://host/a/b.git → host/a/b */
function remoteKey(url: string): string {
  const scp = /^[^@/]+@([^:/]+):(.+)$/.exec(url);
  const [host, path] = scp ? [scp[1], scp[2]] : URL.canParse(url) ? [new URL(url).hostname, new URL(url).pathname] : [url, ""];
  return `${host}/${path}`.toLowerCase().replace(/\.git$/, "").replace(/\/+/g, "/").replace(/\/$/, "");
}

/** The user's own clone, when the current directory is one, so no objects are downloaded twice. */
async function localRepo(pr: PullRequest, cwd: string): Promise<Repo | null> {
  const remotes = await run("git", ["remote", "-v"], { cwd }).catch(() => null);
  if (remotes === null || remotes.code !== 0) return null;
  const wanted = `${pr.hostname}/${pr.repo}`.toLowerCase();
  for (const line of remotes.stdout.split("\n")) {
    const [remote, url] = line.split(/\s+/);
    if (remote && url && remoteKey(url) === wanted) {
      const gitDir = (await runOk("git", ["rev-parse", "--absolute-git-dir"], { cwd })).trim();
      return { gitDir, remote };
    }
  }
  return null;
}

/** Otherwise a cached blobless bare clone, made through gh or glab so their auth applies. */
const cachedRepoDir = (pr: PullRequest) => join(cacheDir, "repos", pr.hostname, `${pr.repo}.git`);

async function cachedRepo(pr: PullRequest, signal: AbortSignal): Promise<Repo> {
  const gitDir = cachedRepoDir(pr);
  if (!existsSync(gitDir)) {
    await mkdir(dirname(gitDir), { recursive: true });
    const [cli, source] = pr.host === "github" ? ["gh", `${pr.hostname}/${pr.repo}`] : ["glab", `https://${pr.hostname}/${pr.repo}`];
    await runOk(cli, ["repo", "clone", source, gitDir, "--", "--bare", "--filter=blob:none", "--quiet"], { signal });
  }
  return { gitDir, remote: "origin" };
}

async function fetchRef(repo: Repo, ref: string, signal: AbortSignal): Promise<string> {
  const git = ["--git-dir", repo.gitDir];
  await runOk("git", [...git, "fetch", "--no-tags", "--quiet", repo.remote, ref], { signal, timeoutMs: 5 * 60_000 });
  return (await runOk("git", [...git, "rev-parse", "FETCH_HEAD"])).trim();
}

// Older than any live run (a 15 minute agent timeout plus checkout).
const STALE_CHECKOUT_MS = 60 * 60_000;

/** Removes checkouts left by runs that were killed outright, so they never pile up. */
async function sweepStaleCheckouts(repo: Repo): Promise<void> {
  const git = ["--git-dir", repo.gitDir];
  const list = await run("git", [...git, "worktree", "list", "--porcelain"]);
  const paths = list.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((path) => basename(path) === "checkout" && basename(dirname(path)).startsWith("pr-guide-"));
  for (const path of paths) {
    const created = await stat(path).then((info) => info.mtimeMs, () => null);
    if (created !== null && Date.now() - created < STALE_CHECKOUT_MS) continue;
    await run("git", [...git, "worktree", "remove", "--force", path]);
    await rm(dirname(path), { recursive: true, force: true });
  }
  await run("git", [...git, "worktree", "prune"]);
}

/**
 * A detached worktree at the PR head in a temp directory, so the agent reads the change
 * without touching the user's checkout. Dispose removes it.
 */
export async function checkoutPullRequest(pr: PullRequest, cwd: string, signal: AbortSignal): Promise<Checkout> {
  const local = await localRepo(pr, cwd);
  if (local !== null) return checkoutFrom(local, pr, signal);
  try {
    return await checkoutFrom(await cachedRepo(pr, signal), pr, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    // The system purges temp files it hasn't seen used in days, which can break a cached clone; clone it again once.
    await rm(cachedRepoDir(pr), { recursive: true, force: true });
    return checkoutFrom(await cachedRepo(pr, signal), pr, signal);
  }
}

async function checkoutFrom(repo: Repo, pr: PullRequest, signal: AbortSignal): Promise<Checkout> {
  await sweepStaleCheckouts(repo);
  const headSha = await fetchRef(repo, pr.headRef, signal);
  const baseTip = await fetchRef(repo, `refs/heads/${pr.baseBranch}`, signal);

  const dir = await mkdtemp(join(tmpdir(), "pr-guide-"));
  const path = join(dir, "checkout");
  const dispose = async () => {
    await run("git", ["--git-dir", repo.gitDir, "worktree", "remove", "--force", path]).catch(() => {});
    await rm(dir, { recursive: true, force: true });
    await run("git", ["--git-dir", repo.gitDir, "worktree", "prune"]).catch(() => {});
  };
  try {
    await runOk("git", ["--git-dir", repo.gitDir, "worktree", "add", "--detach", "--quiet", path, headSha], {
      signal,
      timeoutMs: 5 * 60_000,
    });
    const baseSha = (await runOk("git", ["merge-base", baseTip, "HEAD"], { cwd: path })).trim();
    return { path, headSha, baseSha, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
