import { spawn } from "node:child_process";
import { Box, Text, useAnimation, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useRef, useState } from "react";

import { PROVIDERS, describeChoice, type ModelChoice } from "../catalog.ts";
import { readGuide, STAGES, writeGuide, type Stage } from "../guide.ts";
import { loadPullRequest, type PullRequest } from "../host.ts";
import type { Guide } from "../model.ts";
import { activeChoice, loadSettings } from "../settings.ts";
import { THEME } from "./lines.ts";
import { Settings } from "./Settings.tsx";
import { Tour } from "./Tour.tsx";

type Screen =
  | { readonly kind: "loading" }
  | { readonly kind: "intro"; readonly pr: PullRequest }
  | { readonly kind: "writing"; readonly pr: PullRequest; readonly stage: Stage; readonly previous: Guide | null }
  | { readonly kind: "tour"; readonly pr: PullRequest; readonly guide: Guide }
  | { readonly kind: "error"; readonly pr: PullRequest | null; readonly message: string };

export interface AppProps {
  readonly target: string | undefined;
  readonly cwd: string;
  /** Flags that override the saved settings for this run. */
  readonly override: Partial<ModelChoice> | null;
  readonly rewrite: boolean;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function openUrl(url: string) {
  spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function App({ target, cwd, override, rewrite }: AppProps) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [settings, setSettings] = useState(loadSettings);
  const [runOverride, setRunOverride] = useState(override);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const abort = useRef<AbortController | null>(null);

  const saved = activeChoice(settings);
  const choice: ModelChoice = runOverride ? { ...saved, ...runOverride } : saved;

  const write = (pr: PullRequest, previous: Guide | null) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setScreen({ kind: "writing", pr, stage: "checkout", previous });
    writeGuide(pr, choice, {
      cwd,
      signal: controller.signal,
      onStage: (stage) => !controller.signal.aborted && setScreen({ kind: "writing", pr, stage, previous }),
    }).then(
      (guide) => !controller.signal.aborted && setScreen({ kind: "tour", pr, guide }),
      (error: unknown) => !controller.signal.aborted && setScreen({ kind: "error", pr, message: errorMessage(error) }),
    );
  };

  const load = () => {
    setScreen({ kind: "loading" });
    loadPullRequest(target, cwd).then(
      (pr) => {
        const cached = readGuide(pr);
        if (rewrite || cached === null) {
          if (rewrite) write(pr, cached);
          else setScreen({ kind: "intro", pr });
        } else setScreen({ kind: "tour", pr, guide: cached });
      },
      (error: unknown) => setScreen({ kind: "error", pr: null, message: errorMessage(error) }),
    );
  };

  useEffect(() => {
    load();
    return () => abort.current?.abort();
  }, []);

  useInput(
    (input, key) => {
      const pr = screen.kind === "loading" ? null : screen.pr;
      if (screen.kind === "writing" && key.escape) {
        abort.current?.abort();
        setScreen(screen.previous ? { kind: "tour", pr: screen.pr, guide: screen.previous } : { kind: "intro", pr: screen.pr });
        return;
      }
      if (input === "q" || (key.escape && screen.kind !== "writing")) return exit();
      if (input === "s" && screen.kind !== "writing") return setSettingsOpen(true);
      if (input === "o" && pr) return openUrl(pr.url);
      if (screen.kind === "intro" && key.return) return write(screen.pr, null);
      if (screen.kind === "tour" && input === "r") return write(screen.pr, screen.guide);
      if (screen.kind === "error" && input === "r") return screen.pr ? write(screen.pr, null) : load();
    },
    { isActive: !settingsOpen },
  );

  const pr = screen.kind === "loading" ? null : screen.pr;
  const stale = screen.kind === "tour" && screen.guide.headSha !== screen.pr.headSha;
  const header = (
    <Box paddingX={1}>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">
          <Text bold color={THEME.accent}>pr-guide</Text>
          {pr ? (
            <>
              <Text dimColor>{`  ${pr.repo}#${pr.number}  `}</Text>
              <Text>{pr.title}</Text>
            </>
          ) : null}
        </Text>
      </Box>
      <Box flexShrink={0} marginLeft={2}>
        <Text dimColor>{describeChoice(screen.kind === "tour" && !settingsOpen ? screen.guide.choice : choice)}</Text>
      </Box>
    </Box>
  );

  const bodyRows = rows - 1 - (stale ? 1 : 0);

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {header}
      {stale && !settingsOpen ? (
        <Box paddingX={1}>
          <Text color={THEME.attention} wrap="truncate-end">
            {`The PR moved on since this guide was written (${screen.guide.headSha.slice(0, 7)} → ${screen.pr.headSha.slice(0, 7)}). r rewrites it.`}
          </Text>
        </Box>
      ) : null}
      {screen.kind === "tour" ? (
        <Box display={settingsOpen ? "none" : "flex"}>
          <Tour key={screen.guide.generatedAt} guide={screen.guide} columns={columns} rows={bodyRows} active={!settingsOpen} />
        </Box>
      ) : null}
      {settingsOpen ? (
        <Settings
          settings={settings}
          onChange={(next) => {
            setSettings(next);
            setRunOverride(null);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      ) : screen.kind === "tour" ? null : (
        <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
          <Body screen={screen} choice={choice} />
        </Box>
      )}
    </Box>
  );
}

function Body({ screen, choice }: { screen: Exclude<Screen, { kind: "tour" }>; choice: ModelChoice }) {
  switch (screen.kind) {
    case "loading":
      return <Spinner label="Loading the pull request" />;
    case "intro":
      return (
        <>
          <Text bold>A guided tour of this change</Text>
          <Text>
            {`${PROVIDERS[choice.provider].label} reads the diff in a separate read-only checkout and walks you through it in a few numbered stops: what changed, how it fits together, and where to look closely. It usually takes a few minutes.`}
          </Text>
          <Text>
            <Text color={THEME.accent}>enter</Text>
            <Text>{` write the guide with ${describeChoice(choice)}`}</Text>
          </Text>
          <Text dimColor>s settings · o open PR · q quit</Text>
        </>
      );
    case "writing":
      return <Writing stage={screen.stage} />;
    case "error":
      return (
        <>
          <Text color="red" bold>
            Something went wrong
          </Text>
          <Text>{screen.message}</Text>
          <Text dimColor>r retry · s settings · q quit</Text>
        </>
      );
  }
}

function Spinner({ label }: { label: string }) {
  const { frame } = useAnimation({ interval: 80 });
  return (
    <Text>
      <Text color={THEME.accent}>{SPINNER[frame % SPINNER.length]}</Text>
      {` ${label}`}
    </Text>
  );
}

function Writing({ stage }: { stage: Stage }) {
  const { time } = useAnimation({ interval: 1000 });
  const stages = Object.keys(STAGES) as Array<Stage>;
  const current = stages.indexOf(stage);
  const seconds = Math.floor(time / 1000);
  return (
    <>
      <Text bold>Writing the guide</Text>
      <Box flexDirection="column">
        {stages.map((id, index) =>
          index < current ? (
            <Text key={id}>
              <Text color={THEME.success}>✓</Text>
              {` ${STAGES[id]}`}
            </Text>
          ) : index === current ? (
            <Spinner key={id} label={STAGES[id]} />
          ) : (
            <Text key={id} dimColor>{`  ${STAGES[id]}`}</Text>
          ),
        )}
      </Box>
      <Text dimColor>{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} · usually a few minutes · esc cancels`}</Text>
    </>
  );
}
