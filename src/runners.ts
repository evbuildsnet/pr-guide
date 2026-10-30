import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import type { ModelChoice, ProviderId } from "./catalog.ts";
import { CommandError, run } from "./proc.ts";

export interface RunRequest<T> {
  readonly cwd: string;
  readonly prompt: string;
  readonly schema: z.ZodType<T>;
  readonly choice: ModelChoice;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

/** One read-only agent run that must answer with JSON matching the schema. */
export type Runner = <T>(request: RunRequest<T>) => Promise<T>;

/** Structured-output APIs reject JSON Schema's integer bounds and the `$schema` key. */
function jsonSchemaFor(schema: z.ZodType): object {
  const { $schema: _, ...document } = z.toJSONSchema(schema, {
    target: "draft-7",
    override: ({ jsonSchema }) => {
      delete jsonSchema.minimum;
      delete jsonSchema.maximum;
    },
  });
  return document;
}

function decodeOutput<T>(provider: string, schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new CommandError(`${provider} returned a guide in an unexpected shape: ${z.prettifyError(parsed.error)}`);
}

// --- Claude -----------------------------------------------------------------

/** `--tools` takes bare names; patterns go in the allow list. */
const CLAUDE_TOOLS = "Read,Grep,Glob,Bash";
/** In dontAsk mode every call outside this list, Bash included, is refused. */
const CLAUDE_ALLOWED = ["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)"].join(",");
// Denies override allows; block git --output/-o because allowed trailing args can otherwise write anywhere.
const CLAUDE_DENIED = ["Bash(git * --output*)", "Bash(git * -o *)"].join(",");
// A managed MCP config already isolates servers, and Claude then rejects --strict-mcp-config.
const CLAUDE_MANAGED_MCP = [
  "/Library/Application Support/ClaudeCode/managed-mcp.json",
  "/etc/claude-code/managed-mcp.json",
];

const ClaudeMessage = z.object({
  type: z.string().optional(),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
});
const ClaudeOutput = z.union([z.array(ClaudeMessage), ClaudeMessage]);

function parseClaudeOutput(stdout: string) {
  try {
    const parsed = ClaudeOutput.safeParse(JSON.parse(stdout));
    if (!parsed.success) return null;
    return Array.isArray(parsed.data)
      ? (parsed.data.findLast((message) => message.type === "result") ?? null)
      : parsed.data;
  } catch {
    return null;
  }
}

const runClaude: Runner = async ({ cwd, prompt, schema, choice, signal, timeoutMs }) => {
  const settings = { disableAllHooks: true, ...(choice.tier === "fast" ? { fastMode: true } : {}) };
  const result = await run(
    "claude",
    [
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(jsonSchemaFor(schema)),
      "--model",
      choice.model,
      "--effort",
      choice.effort,
      "--settings",
      JSON.stringify(settings),
      "--tools",
      CLAUDE_TOOLS,
      "--allowedTools",
      CLAUDE_ALLOWED,
      "--disallowedTools",
      CLAUDE_DENIED,
      "--disable-slash-commands",
      ...(CLAUDE_MANAGED_MCP.some(existsSync) ? [] : ["--strict-mcp-config"]),
      "--permission-mode",
      "dontAsk",
    ],
    { cwd, input: prompt, signal, timeoutMs },
  );
  const message = parseClaudeOutput(result.stdout);
  if (result.code !== 0 || message === null || message.is_error) {
    const detail = (message?.is_error ? message.result : undefined) ?? (result.stderr.trim() || result.stdout.trim());
    throw new CommandError(`Claude failed: ${detail || `exit code ${result.code}`}`);
  }
  return decodeOutput("Claude", schema, message.structured_output);
};

// --- Codex ------------------------------------------------------------------

// A user's plugins or MCP servers could act on the prompt, so the run turns them off.
const CODEX_NO_PLUGINS = ["--config", "features.plugins=false", "--config", "features.apps=false"];
const CODEX_SERVICE_TIERS = { standard: "default", fast: "priority", ultrafast: "ultrafast" } as const;

const CodexMcpServers = z.array(z.object({ name: z.string(), enabled: z.boolean() }));

async function enabledCodexMcpServers(cwd: string, signal: AbortSignal): Promise<Array<string>> {
  try {
    const result = await run("codex", [...CODEX_NO_PLUGINS, "mcp", "list", "--json"], {
      cwd,
      signal,
      timeoutMs: 10_000,
    });
    const servers = CodexMcpServers.safeParse(JSON.parse(result.stdout));
    return servers.success ? servers.data.filter((server) => server.enabled).map((server) => server.name) : [];
  } catch (error) {
    if (signal.aborted) throw error;
    return [];
  }
}

const runCodex: Runner = async ({ cwd, prompt, schema, choice, signal, timeoutMs }) => {
  const mcpServers = await enabledCodexMcpServers(cwd, signal);
  const dir = await mkdtemp(join(tmpdir(), "pr-guide-codex-"));
  try {
    const schemaPath = join(dir, "schema.json");
    const outputPath = join(dir, "output.json");
    await writeFile(schemaPath, JSON.stringify(jsonSchemaFor(schema)));
    const result = await run(
      "codex",
      [
        "exec",
        ...CODEX_NO_PLUGINS,
        // mcp_servers={} merges instead of replacing; disable named entries and quote dotted names.
        ...(mcpServers.length > 0
          ? ["--config", `mcp_servers={${mcpServers.map((name) => `${JSON.stringify(name)}={enabled=false}`).join(",")}}`]
          : []),
        "--ephemeral",
        "--skip-git-repo-check",
        "-s",
        "read-only",
        "--model",
        choice.model,
        "--config",
        `model_reasoning_effort="${choice.effort}"`,
        "--config",
        `service_tier="${CODEX_SERVICE_TIERS[choice.tier]}"`,
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "-",
      ],
      { cwd, input: prompt, signal, timeoutMs },
    );
    if (result.code !== 0) {
      throw new CommandError(`Codex failed: ${result.stderr.trim().split("\n").slice(-5).join("\n") || `exit code ${result.code}`}`);
    }
    const output = await readFile(outputPath, "utf8");
    try {
      return decodeOutput("Codex", schema, JSON.parse(output));
    } catch (error) {
      if (error instanceof SyntaxError) throw new CommandError("Codex did not return JSON.");
      throw error;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

export const RUNNERS: Record<ProviderId, Runner> = { claude: runClaude, codex: runCodex };
