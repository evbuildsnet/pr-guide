import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

export interface RunOptions {
  readonly cwd?: string;
  readonly input?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export class CommandError extends Error {}

/** Whether a command is installed, judged by PATH alone so nothing is run. */
export function onPath(command: string): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => {
    try {
      const path = join(dir, command);
      accessSync(path, constants.X_OK);
      return statSync(path).isFile();
    } catch {
      return false;
    }
  });
}

export function run(
  command: string,
  args: ReadonlyArray<string>,
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted();
    const child = spawn(command, args, {
      cwd: options.cwd,
      // The tour owns the terminal, so a git credential prompt would hang unseen: fail instead.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let failure: Error | null = null;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));

    const stop = (error: Error) => {
      failure ??= error;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    };
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(
            () => stop(new CommandError(`${command} timed out after ${options.timeoutMs! / 1000}s.`)),
            options.timeoutMs,
          );
    const onAbort = () => stop(new DOMException("Cancelled", "AbortError"));
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error: NodeJS.ErrnoException) => {
      failure ??=
        error.code === "ENOENT"
          ? new CommandError(`\`${command}\` is not installed or not on PATH.`)
          : error;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (failure !== null) reject(failure);
      else resolve({ stdout, stderr, code: code ?? 1 });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
  });
}

/** Runs a command and returns stdout, failing with its stderr when it exits non-zero. */
export async function runOk(
  command: string,
  args: ReadonlyArray<string>,
  options: RunOptions = {},
): Promise<string> {
  const result = await run(command, args, options);
  if (result.code === 0) return result.stdout;
  const detail = result.stderr.trim() || result.stdout.trim();
  throw new CommandError(
    `${command} ${args[0] ?? ""} failed${detail ? `: ${detail}` : ` with code ${result.code}`}`,
  );
}
