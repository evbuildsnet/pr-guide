import { z } from "zod";

import type { PullRequestRef } from "./model.ts";
import { run, runOk } from "./proc.ts";

export interface PullRequest extends PullRequestRef {
  readonly description: string;
  readonly baseBranch: string;
  readonly headSha: string;
  /** Review threads already resolved or outdated, one line each. */
  readonly settledReview: string;
  /** The ref that holds the head, fetched from the repo's remote. */
  readonly headRef: string;
}

const SETTLED_REMARK_CHARS = 200;

function oneLine(text: string): string {
  const flat = text.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim();
  return flat.length > SETTLED_REMARK_CHARS ? `${flat.slice(0, SETTLED_REMARK_CHARS)}…` : flat;
}

function parseJson<T>(schema: z.ZodType<T>, text: string, what: string): T {
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`Unexpected ${what}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** github.com/owner/repo/pull/1 → github; a /-/merge_requests/ URL or a non-GitHub remote → gitlab. */
async function detectHost(target: string | undefined, cwd: string): Promise<PullRequestRef["host"]> {
  if (target !== undefined && URL.canParse(target)) {
    const url = new URL(target);
    if (url.pathname.includes("/-/merge_requests/")) return "gitlab";
    return url.hostname === "github.com" || url.pathname.includes("/pull/") ? "github" : "gitlab";
  }
  const remote = await run("git", ["remote", "get-url", "origin"], { cwd }).catch(() => null);
  if (remote === null || remote.code !== 0) return "github";
  return remote.stdout.includes("github") ? "github" : "gitlab";
}

// --- GitHub -----------------------------------------------------------------

const GhPullRequest = z.object({
  number: z.int(),
  title: z.string(),
  body: z.string(),
  baseRefName: z.string(),
  headRefOid: z.string(),
  url: z.string(),
});

const GhReviewThreads = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        reviewThreads: z.object({
          nodes: z.array(
            z.object({
              isResolved: z.boolean(),
              isOutdated: z.boolean(),
              path: z.string(),
              comments: z.object({
                nodes: z.array(z.object({ body: z.string(), author: z.nullable(z.object({ login: z.string() })) })),
              }),
            }),
          ),
        }),
      }),
    }),
  }),
});

const REVIEW_THREADS_QUERY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved isOutdated path comments(first:1){nodes{body author{login}}}}}}}}`;

async function githubSettledReview(hostname: string, repo: string, number: number, cwd: string) {
  const [owner, name] = repo.split("/");
  const result = await run(
    "gh",
    ["api", "graphql", "--hostname", hostname, "-f", `query=${REVIEW_THREADS_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${number}`],
    { cwd },
  );
  if (result.code !== 0) return "";
  const threads = GhReviewThreads.safeParse(JSON.parse(result.stdout));
  if (!threads.success) return "";
  return threads.data.data.repository.pullRequest.reviewThreads.nodes
    .filter((thread) => thread.isResolved || thread.isOutdated)
    .flatMap((thread) => {
      const opener = thread.comments.nodes[0];
      if (opener === undefined) return [];
      const state = thread.isResolved ? "resolved" : "outdated";
      return [`- ${thread.path} (${state}, ${opener.author?.login ?? "ghost"}): ${oneLine(opener.body)}`];
    })
    .join("\n");
}

async function loadGithub(target: string | undefined, cwd: string): Promise<PullRequest> {
  const fields = "number,title,body,baseRefName,headRefOid,url";
  const pr = parseJson(
    GhPullRequest,
    await runOk("gh", ["pr", "view", ...(target === undefined ? [] : [target]), "--json", fields], { cwd }),
    "gh pr view output",
  );
  const url = new URL(pr.url);
  const repo = url.pathname.split("/").slice(1, 3).join("/");
  return {
    host: "github",
    hostname: url.hostname,
    repo,
    number: pr.number,
    url: pr.url,
    title: pr.title,
    description: pr.body,
    baseBranch: pr.baseRefName,
    headSha: pr.headRefOid,
    headRef: `refs/pull/${pr.number}/head`,
    settledReview: await githubSettledReview(url.hostname, repo, pr.number, cwd),
  };
}

// --- GitLab -----------------------------------------------------------------

const GlabMergeRequest = z.object({
  iid: z.int(),
  project_id: z.int(),
  title: z.string(),
  description: z.nullable(z.string()),
  target_branch: z.string(),
  sha: z.string(),
  web_url: z.string(),
});

const GlabDiscussions = z.array(
  z.object({
    notes: z.array(
      z.object({
        body: z.string(),
        author: z.object({ username: z.string() }),
        resolvable: z.boolean().optional(),
        resolved: z.boolean().optional(),
        position: z.nullable(z.object({ new_path: z.nullable(z.string()) })).optional(),
      }),
    ),
  }),
);

async function gitlabSettledReview(hostname: string, projectId: number, iid: number, cwd: string) {
  const result = await run(
    "glab",
    ["api", "--hostname", hostname, `projects/${projectId}/merge_requests/${iid}/discussions?per_page=100`],
    { cwd },
  );
  if (result.code !== 0) return "";
  const discussions = GlabDiscussions.safeParse(JSON.parse(result.stdout));
  if (!discussions.success) return "";
  return discussions.data
    .flatMap(({ notes: [opener] }) =>
      opener?.resolvable && opener.resolved
        ? [`- ${opener.position?.new_path ?? "(general)"} (resolved, ${opener.author.username}): ${oneLine(opener.body)}`]
        : [],
    )
    .join("\n");
}

async function loadGitlab(target: string | undefined, cwd: string): Promise<PullRequest> {
  // glab takes an id or branch, so a URL becomes `<iid> -R <project URL>`.
  const fromUrl =
    target !== undefined && URL.canParse(target)
      ? /^(.*)\/-\/merge_requests\/(\d+)/.exec(target)
      : null;
  const args = fromUrl ? [fromUrl[2]!, "-R", fromUrl[1]!] : target === undefined ? [] : [target];
  const mr = parseJson(
    GlabMergeRequest,
    await runOk("glab", ["mr", "view", ...args, "-F", "json"], { cwd }),
    "glab mr view output",
  );
  const url = new URL(mr.web_url);
  const repo = url.pathname.slice(1).split("/-/")[0]!;
  return {
    host: "gitlab",
    hostname: url.hostname,
    repo,
    number: mr.iid,
    url: mr.web_url,
    title: mr.title,
    description: mr.description ?? "",
    baseBranch: mr.target_branch,
    headSha: mr.sha,
    headRef: `refs/merge-requests/${mr.iid}/head`,
    settledReview: await gitlabSettledReview(url.hostname, mr.project_id, mr.iid, cwd),
  };
}

/** Resolves a PR number, URL or branch (or the current branch's PR) through gh or glab. */
export async function loadPullRequest(target: string | undefined, cwd: string): Promise<PullRequest> {
  return (await detectHost(target, cwd)) === "github" ? loadGithub(target, cwd) : loadGitlab(target, cwd);
}

/** The bits of a PullRequest worth keeping with a written guide. */
export function pullRequestRef(pr: PullRequest): PullRequestRef {
  const { host, hostname, repo, number, url, title } = pr;
  return { host, hostname, repo, number, url, title };
}
