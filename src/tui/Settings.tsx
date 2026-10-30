import { Box, Text, useInput } from "ink";
import { useState } from "react";

import { describeChoice, EFFORTS, EFFORT_LABELS, PROVIDERS, PROVIDER_IDS, TIER_LABELS, tiersFor, type ModelChoice } from "../catalog.ts";
import { activeChoice, sanitizeChoice, saveSettings, type Settings as SettingsData } from "../settings.ts";
import { chip, prose, THEME, type Line } from "./lines.ts";
import { Lines } from "./Tour.tsx";

interface Row {
  readonly label: string;
  readonly options: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly current: string;
  readonly apply: (id: string) => SettingsData;
}

const ROW_WIDTH = 40;

const cycle = <T,>(items: ReadonlyArray<T>, current: T, delta: number): T =>
  items[(items.indexOf(current) + delta + items.length) % items.length] ?? current;

/** Provider, model, reasoning and speed, as in t3code's model picker. Saved on every change. */
export function Settings({
  settings,
  written,
  onChange,
  onClose,
  onQuit,
}: {
  settings: SettingsData;
  /** The model the open guide was written with, if any. */
  written: ModelChoice | null;
  onChange: (settings: SettingsData) => void;
  onClose: () => void;
  onQuit: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const choice = activeChoice(settings);
  const provider = choice.provider;
  const update = (patch: Partial<Omit<typeof choice, "provider">>) => {
    const { provider: _, ...next } = sanitizeChoice(provider, { ...choice, ...patch });
    return { ...settings, [provider]: next };
  };

  const rows: ReadonlyArray<Row> = [
    {
      label: "Harness",
      options: PROVIDER_IDS.map((id) => ({ id, label: PROVIDERS[id].label })),
      current: provider,
      apply: (id) => ({ ...settings, provider: PROVIDER_IDS.find((candidate) => candidate === id) ?? provider }),
    },
    {
      label: "Model",
      options: PROVIDERS[provider].models.map((model) => ({ id: model.slug, label: model.label })),
      current: choice.model,
      apply: (model) => update({ model }),
    },
    {
      label: "Reasoning",
      options: EFFORTS.map((id) => ({ id, label: EFFORT_LABELS[id] })),
      current: choice.effort,
      apply: (id) => update({ effort: EFFORTS.find((effort) => effort === id) ?? choice.effort }),
    },
    {
      label: "Speed",
      options: tiersFor(choice).map((id) => ({ id, label: TIER_LABELS[id] })),
      current: choice.tier,
      apply: (id) => update({ tier: tiersFor(choice).find((tier) => tier === id) ?? choice.tier }),
    },
  ];

  useInput((input, key) => {
    if (input === "q") return onQuit();
    if (key.escape || key.return || input === "s") return onClose();
    if (key.upArrow || input === "k") setSelected((current) => (current + rows.length - 1) % rows.length);
    if (key.downArrow || input === "j") setSelected((current) => (current + 1) % rows.length);
    const delta = key.leftArrow || input === "h" ? -1 : key.rightArrow || input === "l" || input === " " ? 1 : 0;
    const row = rows[selected];
    if (delta === 0 || row === undefined || row.options.length < 2) return;
    const ids = row.options.map((option) => option.id);
    const next = row.apply(cycle(ids, row.current, delta));
    saveSettings(next);
    onChange(next);
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <Lines lines={[[{ text: "Settings", color: THEME.strong, bold: true }, { text: " ".repeat(ROW_WIDTH - 8 - 5) }, chip("esc")]]} />
      <Lines
        lines={rows.map((row, index) => {
          const active = index === selected;
          const label = row.options.find((option) => option.id === row.current)?.label ?? row.current;
          const fixed = row.options.length < 2;
          // Like the rail, only the selected row shows its controls.
          const arrow = active && !fixed ? THEME.accent : THEME.background;
          const line: Line = [
            { text: active ? "▌" : " ", color: THEME.accent },
            { text: ` ${row.label.padEnd(12)}`, color: active ? THEME.strong : THEME.text, bold: active },
            { text: fixed ? "  " : "‹ ", color: arrow },
            { text: label, color: fixed ? THEME.muted : THEME.strong, bold: active },
            { text: fixed ? "" : " ›", color: arrow },
          ];
          const width = line.reduce((sum, span) => sum + span.text.length, 0);
          const padded: Line = [...line, { text: " ".repeat(Math.max(ROW_WIDTH - width, 0)) }];
          return active ? padded.map((span) => ({ ...span, bg: THEME.selection })) : padded;
        })}
      />
      <Lines lines={prose(`Uses your ${provider} CLI and its login. Changes save automatically and apply to the next guide.`, 72, { color: THEME.muted })} />
      {written ? <Text color={THEME.muted}>{`This guide was written with ${describeChoice(written)}.`}</Text> : null}
    </Box>
  );
}
