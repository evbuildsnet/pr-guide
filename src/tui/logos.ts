import type { ProviderId } from "../catalog.ts";
import { THEME, type Line } from "./lines.ts";

interface Logo {
  /** Gradient stops, running from the top left corner to the bottom right. */
  readonly colors: ReadonlyArray<string>;
  /** The mark as braille: each character is two dots wide and four tall, so the dots form one even grid. */
  readonly rows: ReadonlyArray<string>;
}

/** Each harness's mark on a grid of 16 by 16 dots: Clawd, Claude Code's mascot, and the other two traced from their logos. */
const LOGOS = {
  claude: {
    colors: ["#d97757"],
    rows: [" ⣤⣤⣤⣤⣤⣤ ", "⣀⣿⣀⣿⣿⣀⣿⣀", "⠉⢿⢿⠿⠿⡿⡿⠉", " ⠘⠘  ⠃⠃ "],
  },
  codex: {
    colors: ["#ffffff"],
    rows: [" ⢀⠖⣉⠶⠒⢄ ", "⡜⢹⢸⠔⠪⣍⠲⡇", "⢸⠦⣙⡢⠔⡇⣇⡜", " ⠑⠤⠶⣉⠴⠁ "],
  },
  antigravity: {
    colors: ["#4796e3", "#9177c7", "#d96570"],
    rows: ["   ⣸⣇   ", "⣀⣠⣴⣿⣿⣦⣄⣀", "⠉⠙⠻⣿⣿⠟⠋⠉", "   ⢹⡏   "],
  },
} as const satisfies Record<ProviderId, Logo>;

const channels = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

function gradient(stops: ReadonlyArray<string>, share: number): string {
  const at = share * (stops.length - 1);
  const index = Math.max(Math.min(Math.floor(at), stops.length - 2), 0);
  const from = channels(stops[index] ?? THEME.text);
  const to = channels(stops[index + 1] ?? stops[index] ?? THEME.text);
  return `#${from.map((channel, i) => Math.round(channel + ((to[i] ?? channel) - channel) * (at - index)).toString(16).padStart(2, "0")).join("")}`;
}

/** A harness's mark in its own colors, or in gray when the harness can't be used. */
export function logo(provider: ProviderId, dimmed: boolean): Array<Line> {
  const { colors, rows } = LOGOS[provider];
  const stops = dimmed ? [THEME.disabled] : colors;
  return rows.map((row, y) =>
    [...row].map((text, x) => ({ text, color: gradient(stops, (x / (row.length - 1) + y / (rows.length - 1)) / 2) })),
  );
}
