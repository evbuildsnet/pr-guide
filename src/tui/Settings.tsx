import { Box, useInput } from "ink";
import { useEffect, useState } from "react";

import { describeChoice, EFFORT_LABELS, effortsFor, PROVIDERS, PROVIDER_IDS, TIER_LABELS, tiersFor, type ModelChoice, type ProviderId } from "../catalog.ts";
import { onPath } from "../proc.ts";
import { availableModels } from "../runners.ts";
import { activeChoice, sanitizeChoice, saveSettings, type Settings as SettingsData } from "../settings.ts";
import { chip, pad, prose, THEME, width, type Line } from "./lines.ts";
import { logo } from "./logos.ts";
import { Lines } from "./Tour.tsx";

interface Row {
  readonly label: string;
  readonly options: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly current: string;
  readonly apply: (id: string) => SettingsData;
}

/** Rows, the title's esc and the description share one edge. */
const ROW_WIDTH = 72;
const COLUMN_WIDTH = ROW_WIDTH / PROVIDER_IDS.length;

const cycle = <T,>(items: ReadonlyArray<T>, current: T, delta: number): T =>
  items[(items.indexOf(current) + delta + items.length) % items.length] ?? current;

/**
 * Every harness and its models at once, as in t3code's model picker, above reasoning and speed.
 * A harness without its CLI and a model the account can't use are grayed out. Saved on every change.
 */
export function Settings({
  settings,
  written,
  height,
  onChange,
  onClose,
  onQuit,
}: {
  settings: SettingsData;
  /** The model the open guide was written with, if any. */
  written: ModelChoice | null;
  /** Rows the screen has for settings. The logos are left out when they would not fit. */
  height: number;
  onChange: (settings: SettingsData) => void;
  onClose: () => void;
  onQuit: () => void;
}) {
  const choice = activeChoice(settings);
  const provider = choice.provider;
  const [installed] = useState(() => new Set(PROVIDER_IDS.filter((id) => onPath(PROVIDERS[id].cli))));
  /** What each CLI says the account can use. Until it answers, and if it can't, nothing is ruled out. */
  const [offered, setOffered] = useState<Partial<Record<ProviderId, ReadonlySet<string> | null>>>({});
  useEffect(() => {
    let open = true;
    for (const id of installed) void availableModels(id).then((models) => open && setOffered((current) => ({ ...current, [id]: models })));
    return () => void (open = false);
  }, [installed]);
  const usable = (id: ProviderId, slug: string) => installed.has(id) && (offered[id]?.has(slug) ?? true);
  /** 0 is the model picker; the rows below it follow. */
  const [selected, setSelected] = useState(0);
  const [cursor, setCursor] = useState<{ readonly provider: ProviderId; readonly index: number }>(() => ({
    provider,
    index: PROVIDERS[provider].models.findIndex((model) => model.slug === choice.model),
  }));
  const pointed = PROVIDERS[cursor.provider].models[cursor.index];
  const chosen = cursor.provider === provider && pointed?.slug === choice.model;

  const update = (patch: Partial<Omit<typeof choice, "provider">>) => {
    const { provider: _, ...next } = sanitizeChoice(provider, { ...choice, ...patch });
    return { ...settings, [provider]: next };
  };
  const commit = (next: SettingsData) => {
    saveSettings(next);
    onChange(next);
  };

  const rows: ReadonlyArray<Row> = [
    {
      label: "Reasoning",
      options: effortsFor(choice).map((id) => ({ id, label: EFFORT_LABELS[id] })),
      current: choice.effort,
      apply: (id) => update({ effort: effortsFor(choice).find((effort) => effort === id) ?? choice.effort }),
    },
    {
      label: "Speed",
      options: tiersFor(choice).map((id) => ({ id, label: TIER_LABELS[id] })),
      current: choice.tier,
      apply: (id) => update({ tier: tiersFor(choice).find((tier) => tier === id) ?? choice.tier }),
    },
  ];
  const stops = rows.length + 1;

  useInput((input, key) => {
    if (input === "q") return onQuit();
    if (key.escape || input === "s") return onClose();
    const vertical = key.upArrow || input === "k" ? -1 : key.downArrow || input === "j" ? 1 : 0;
    const horizontal = key.leftArrow || input === "h" ? -1 : key.rightArrow || input === "l" ? 1 : 0;

    if (selected === 0) {
      if (key.return || input === " ") {
        // Enter on the model already in use has nothing left to choose, so it closes like esc.
        if (chosen) return key.return ? onClose() : undefined;
        if (pointed === undefined || !usable(cursor.provider, pointed.slug)) return;
        const { provider: _, ...next } = sanitizeChoice(cursor.provider, { ...settings[cursor.provider], model: pointed.slug });
        return commit({ ...settings, provider: cursor.provider, [cursor.provider]: next });
      }
      if (vertical !== 0) {
        const index = cursor.index + vertical;
        if (index < 0) setSelected(stops - 1);
        else if (index >= PROVIDERS[cursor.provider].models.length) setSelected(1);
        else setCursor({ ...cursor, index });
      }
      if (horizontal !== 0) {
        const at = PROVIDER_IDS.indexOf(cursor.provider);
        const beyond = horizontal > 0 ? PROVIDER_IDS.slice(at + 1) : PROVIDER_IDS.slice(0, at).reverse();
        const next = beyond.find((id) => installed.has(id));
        if (next) setCursor({ provider: next, index: Math.min(cursor.index, PROVIDERS[next].models.length - 1) });
      }
      return;
    }

    if (key.return) return onClose();
    if (vertical !== 0) return setSelected((current) => (current + vertical + stops) % stops);
    const delta = horizontal !== 0 ? horizontal : input === " " ? 1 : 0;
    const row = rows[selected - 1];
    if (delta === 0 || row === undefined || row.options.length < 2) return;
    commit(row.apply(cycle(row.options.map((option) => option.id), row.current, delta)));
  });

  const column = (id: ProviderId, logos: boolean): ReadonlyArray<Line> => {
    const present = installed.has(id);
    const { label, cli, models } = PROVIDERS[id];
    return [
      ...(logos ? [...logo(id, !present).map((line): Line => [{ text: "  " }, ...line]), []] : []),
      [{ text: `  ${label}`, color: present ? THEME.strong : THEME.disabled, bold: true }],
      [{ text: `  ${cli}${present ? "" : " not found"}`, color: present ? THEME.faint : THEME.disabled }],
      [],
      ...models.map((model, index): Line => {
        const inUse = id === provider && model.slug === choice.model;
        const active = selected === 0 && id === cursor.provider && index === cursor.index;
        const line: Line = [
          { text: active ? "▌" : " ", color: THEME.accent },
          { text: inUse ? " ● " : "   ", color: THEME.accent },
          { text: model.label, color: !usable(id, model.slug) ? THEME.disabled : inUse ? THEME.strong : active ? THEME.bright : THEME.soft, bold: inUse },
        ];
        return active ? pad(line, COLUMN_WIDTH - 1).map((span) => ({ ...span, bg: THEME.selection })) : line;
      }),
    ].map((line) => pad(line, COLUMN_WIDTH));
  };
  const picker = (logos: boolean): ReadonlyArray<Line> => {
    const columns = PROVIDER_IDS.map((id) => column(id, logos));
    return Array.from({ length: Math.max(...columns.map((lines) => lines.length)) }, (_, index): Line =>
      columns.flatMap((lines) => lines[index] ?? [{ text: " ".repeat(COLUMN_WIDTH) }]),
    );
  };
  const description = prose(`Uses your ${PROVIDERS[provider].cli} CLI and its login. Changes save automatically and apply to the next guide.`, ROW_WIDTH, { color: THEME.muted });
  const note = written ? prose(`This guide was written with ${describeChoice(written)}.`, ROW_WIDTH, { color: THEME.muted }) : [];
  // The top padding, the title, the rows and the text, each a blank line apart.
  const around = 2 + rows.length + description.length + note.length + (note.length > 0 ? 4 : 3);
  const withLogos = picker(true);

  const hint: Line =
    selected !== 0 || chosen || pointed === undefined
      ? []
      : usable(cursor.provider, pointed.slug)
        ? [chip("enter"), { text: " use this model   ", color: THEME.muted }]
        : [{ text: "not available to your account   ", color: THEME.muted }];
  const keys: Line = [...hint, chip("esc")];

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <Lines lines={[[...pad([{ text: "Settings", color: THEME.strong, bold: true }], ROW_WIDTH - width(keys)), ...keys]]} />
      <Lines lines={around + withLogos.length <= height ? withLogos : picker(false)} />
      <Lines
        lines={rows.map((row, index) => {
          const active = index + 1 === selected;
          const label = row.options.find((option) => option.id === row.current)?.label ?? row.current;
          const fixed = row.options.length < 2;
          // Every changeable value shows its arrows; the selected row lights them.
          const arrow = fixed ? THEME.background : active ? THEME.accent : THEME.thumb;
          const line: Line = [
            { text: active ? "▌" : " ", color: THEME.accent },
            { text: ` ${row.label.padEnd(12)}`, color: active ? THEME.strong : THEME.faint, bold: active },
            { text: fixed ? "  " : "‹ ", color: arrow },
            { text: label, color: fixed ? THEME.muted : active ? THEME.bright : THEME.soft, bold: active },
            { text: fixed ? "" : " ›", color: arrow },
          ];
          const padded = pad(line, ROW_WIDTH);
          return active ? padded.map((span) => ({ ...span, bg: THEME.selection })) : padded;
        })}
      />
      <Lines lines={description} />
      {note.length > 0 ? <Lines lines={note} /> : null}
    </Box>
  );
}
