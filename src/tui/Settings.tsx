import { Box, Text, useInput } from "ink";
import { useState } from "react";

import { EFFORTS, EFFORT_LABELS, PROVIDERS, PROVIDER_IDS, TIER_LABELS, tiersFor } from "../catalog.ts";
import { activeChoice, sanitizeChoice, saveSettings, settingsPath, type Settings as SettingsData } from "../settings.ts";
import { THEME } from "./lines.ts";

interface Row {
  readonly label: string;
  readonly options: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly current: string;
  readonly apply: (id: string) => SettingsData;
}

const cycle = <T,>(items: ReadonlyArray<T>, current: T, delta: number): T =>
  items[(items.indexOf(current) + delta + items.length) % items.length] ?? current;

/** Provider, model, reasoning and speed, as in t3code's model picker. Saved on every change. */
export function Settings({
  settings,
  onChange,
  onClose,
}: {
  settings: SettingsData;
  onChange: (settings: SettingsData) => void;
  onClose: () => void;
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
    if (key.escape || key.return || input === "s" || input === "q") return onClose();
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
      <Text bold>Settings</Text>
      <Box flexDirection="column">
        {rows.map((row, index) => {
          const active = index === selected;
          const label = row.options.find((option) => option.id === row.current)?.label ?? row.current;
          return (
            <Box key={row.label}>
              <Text color={active ? THEME.accent : undefined}>{active ? "› " : "  "}</Text>
              <Box width={12}>
                <Text dimColor={!active}>{row.label}</Text>
              </Box>
              {row.options.length < 2 ? (
                <Text dimColor>
                  {label}  only option for this model
                </Text>
              ) : (
                <Text bold={active}>
                  <Text dimColor>‹ </Text>
                  {label}
                  <Text dimColor> ›</Text>
                </Text>
              )}
            </Box>
          );
        })}
      </Box>
      <Text dimColor>
        Runs your installed `{provider}` CLI with its own login. Saved to {settingsPath}
      </Text>
      <Text dimColor>↑↓ choose · ←→ change · enter done</Text>
    </Box>
  );
}
