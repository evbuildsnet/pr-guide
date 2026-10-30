import { spawn } from "node:child_process";
import { Box, Text, useAnimation, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useRef, useState } from "react";

import { PROVIDERS, describeChoice, type ModelChoice } from "../catalog.ts";
import { readGuide, STAGES, writeGuide, type Stage } from "../guide.ts";
import { loadPullRequest, type PullRequest } from "../host.ts";
import type { Guide } from "../model.ts";
import { activeChoice, loadSettings } from "../settings.ts";
import { card, chip, MEASURE, THEME, type Line } from "./lines.ts";
import { Settings } from "./Settings.tsx";
import { Lines, Tour } from "./Tour.tsx";

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
  const [helpOpen, setHelpOpen] = useState(false);
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
      if (helpOpen) return input === "q" ? exit() : setHelpOpen(false);
      if (screen.kind === "writing" && key.escape) {
        abort.current?.abort();
        setScreen(screen.previous ? { kind: "tour", pr: screen.pr, guide: screen.previous } : { kind: "intro", pr: screen.pr });
        return;
      }
      if (input === "?") return setHelpOpen(true);
      // Esc only ever closes things; quitting takes q.
      if (input === "q") return exit();
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
      <Text wrap="truncate-end">
        {pr ? (
          <>
            <Text color={THEME.faint}>{`${pr.repo} #${pr.number}  `}</Text>
            <Text color={THEME.soft}>{pr.title}</Text>
          </>
        ) : (
          <Text color={THEME.muted}>pr-guide</Text>
        )}
      </Text>
    </Box>
  );

  const bodyRows = rows - 2 - (stale ? 1 : 0);
  const overlay = settingsOpen || helpOpen;

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {header}
      <Text color={THEME.border}>{"─".repeat(columns)}</Text>
      {stale && !overlay ? (
        <Box paddingX={1}>
          <Lines
            lines={[
              [
                { text: "◆ ", color: THEME.attention },
                { text: `The PR moved on since this guide was written (${screen.guide.headSha.slice(0, 7)} → ${screen.pr.headSha.slice(0, 7)})  `, color: THEME.attention },
                chip("r"),
                { text: " rewrite", color: THEME.muted },
              ],
            ]}
          />
        </Box>
      ) : null}
      {screen.kind === "tour" ? (
        <Box display={overlay ? "none" : "flex"}>
          <Tour key={screen.guide.generatedAt} guide={screen.guide} columns={columns} rows={bodyRows} active={!overlay} />
        </Box>
      ) : null}
      {helpOpen ? (
        <Help />
      ) : settingsOpen ? (
        <Settings
          settings={settings}
          written={screen.kind === "tour" ? screen.guide.choice : null}
          onChange={(next) => {
            setSettings(next);
            setRunOverride(null);
          }}
          onClose={() => setSettingsOpen(false)}
          onQuit={exit}
        />
      ) : screen.kind === "tour" ? null : (
        <Box flexDirection="column" paddingX={2} paddingY={1} gap={1} width={Math.min(columns, MEASURE + 4)}>
          <Body screen={screen} choice={choice} />
        </Box>
      )}
    </Box>
  );
}

const action = (key: string, label: string): Line => [chip(key), { text: `  ${label}`, color: THEME.text }];

const HELP: ReadonlyArray<readonly [string, string]> = [
  ["→  j  enter", "Next stop"],
  ["←  k", "Previous stop"],
  ["1–9", "Jump to a stop"],
  ["↑  ↓", "Scroll"],
  ["space  b", "Page down / up"],
  ["g  G", "Top / bottom of the stop"],
  ["f", "Show or hide the other files' diffs"],
  ["o", "Open the PR in your browser"],
  ["r", "Rewrite the guide"],
  ["s", "Settings"],
  ["q", "Quit"],
];

/** The key list, as a card in the main pane. */
function Help() {
  const rows: Array<Line> = [
    [{ text: "Keys", color: THEME.strong, bold: true }, { text: " ".repeat(48) }, chip("esc")],
    [],
    ...HELP.map(([keys, label]): Line => {
      const caps = keys.split("  ").flatMap((key, i) => [...(i > 0 ? [{ text: " " }] : []), chip(key)]);
      const used = caps.reduce((sum, span) => sum + span.text.length, 0);
      return [...caps, { text: " ".repeat(Math.max(18 - used, 1)) }, { text: label, color: THEME.text }];
    }),
  ];
  return (
    <Box paddingX={2} paddingY={1}>
      <Lines lines={card([[], ...rows, []], 60, THEME.border)} />
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
          <Text color={THEME.strong} bold>
            A guided tour of this change
          </Text>
          <Text color={THEME.text}>
            {`${PROVIDERS[choice.provider].label} reads the diff in a separate read-only checkout and walks you through it in a few numbered stops: what changed, how it fits together, and where to look closely. It usually takes a few minutes.`}
          </Text>
          <Lines lines={[[...action("enter", "Write the guide"), { text: `  with ${describeChoice(choice)}`, color: THEME.muted }], [], action("s", "Change the model")]} />
        </>
      );
    case "writing":
      return <Writing stage={screen.stage} />;
    case "error":
      return (
        <>
          <Text color={THEME.danger} bold>
            Something went wrong
          </Text>
          <Text color={THEME.text}>{screen.message}</Text>
          <Lines lines={[action("r", "Try again")]} />
        </>
      );
  }
}

function Spinner({ label }: { label: string }) {
  const { frame } = useAnimation({ interval: 80 });
  return (
    <Text>
      <Text color={THEME.accent}>{SPINNER[frame % SPINNER.length]}</Text>
      <Text color={THEME.text}>{` ${label}`}</Text>
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
      <Text color={THEME.strong} bold>
        Writing the guide
      </Text>
      <Box flexDirection="column">
        {stages.map((id, index) =>
          index < current ? (
            <Text key={id}>
              <Text color={THEME.success}>✓</Text>
              <Text color={THEME.text}>{` ${STAGES[id]}`}</Text>
            </Text>
          ) : index === current ? (
            <Spinner key={id} label={STAGES[id]} />
          ) : (
            <Text key={id} color={THEME.muted}>{`  ${STAGES[id]}`}</Text>
          ),
        )}
      </Box>
      <Text color={THEME.muted}>{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} · usually a few minutes`}</Text>
      <Lines lines={[action("esc", "Cancel")]} />
    </>
  );
}
