import type { ProviderId } from "../catalog.ts";
import { THEME, type Line, type Span } from "./lines.ts";

interface Logo {
  /** Gradient stops, running from the top left corner to the bottom right. */
  readonly colors: ReadonlyArray<string>;
  /** How much of each pixel the mark covers, 0 to f, on a square grid. */
  readonly pixels: ReadonlyArray<string>;
}

/** Each harness's mark, rasterized from its logo to 16 pixels a side. */
const LOGOS = {
  claude: {
    colors: ["#e89474", "#d97757"],
    pixels: [
      "0000fc001a000000",
      "0004ff10df100000",
      "0000ffc0ff06ff00",
      "0bf64ff0ff3ffd00",
      "09ffcffdfffff000",
      "006fffffffff2000",
      "0000fffffffe9dfc",
      "dffdcffffffffff7",
      "6deffffffffffc90",
      "00008fffffffffff",
      "003fffffffff1171",
      "02ff9ffffffff300",
      "0080af6ff4ffef10",
      "0004fc0fe0df6500",
      "0003b01fc00c2000",
      "0000000f40000000",
    ],
  },
  codex: {
    colors: ["#3fe0b0", "#10a37f"],
    pixels: [
      "00000affa0000000",
      "0000ff98ffff7000",
      "000df00bff8afe00",
      "00df45ff40500f70",
      "0fff1fc0afff3af0",
      "af0f1feffd0cfff0",
      "f90f1ff99ff21ff0",
      "f90f4f8008ffc0fa",
      "af0cff8008f4f09f",
      "0ff12ff99ff1f09f",
      "0fffb0dffef1f0fa",
      "0fa3fffa0cf1fff0",
      "07f00504ff54fd00",
      "00efa8ffb00fd000",
      "0007ffff89ff0000",
      "0000000affa00000",
    ],
  },
  antigravity: {
    colors: ["#4796e3", "#9177c7", "#d96570"],
    pixels: [
      "0000000990000000",
      "0000000dd0000000",
      "0000000ff0000000",
      "0000007ff7000000",
      "000001ffff100000",
      "00001ffffff10000",
      "0007ffffffff7000",
      "9dffffffffffffd9",
      "9dffffffffffffd9",
      "0007ffffffff7000",
      "00001ffffff10000",
      "000001ffff100000",
      "0000007ff7000000",
      "0000000ff0000000",
      "0000000dd0000000",
      "0000000990000000",
    ],
  },
} as const satisfies Record<ProviderId, Logo>;

const SIZE = 16;
/** Text rows a logo takes: a half block draws two pixel rows in one. */
export const LOGO_ROWS = SIZE / 2;

const channels = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
const mix = (from: ReadonlyArray<number>, to: ReadonlyArray<number>, share: number) =>
  from.map((channel, index) => channel + ((to[index] ?? channel) - channel) * share);
const hex = (color: ReadonlyArray<number>) => `#${color.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;

function gradient(stops: ReadonlyArray<ReadonlyArray<number>>, share: number): ReadonlyArray<number> {
  const at = share * (stops.length - 1);
  const index = Math.max(Math.min(Math.floor(at), stops.length - 2), 0);
  const from = stops[index] ?? [];
  return mix(from, stops[index + 1] ?? from, at - index);
}

/** A harness's mark in its own colors, or in gray when the harness can't be used. */
export function logo(provider: ProviderId, dimmed: boolean): Array<Line> {
  const { colors, pixels } = LOGOS[provider];
  const stops = (dimmed ? [THEME.disabled] : colors).map(channels);
  const background = channels(THEME.background);
  const pixel = (x: number, y: number): string | undefined => {
    const cover = Number.parseInt(pixels[y]?.[x] ?? "0", 16) / 15;
    return cover === 0 ? undefined : hex(mix(background, gradient(stops, (x + y) / (2 * (SIZE - 1))), cover));
  };
  return Array.from({ length: LOGO_ROWS }, (_, row) =>
    Array.from({ length: SIZE }, (_, x): Span => {
      const top = pixel(x, row * 2);
      const bottom = pixel(x, row * 2 + 1);
      // A half block paints the upper pixel as text and the lower one as its background.
      if (top === undefined && bottom === undefined) return { text: " " };
      return top === undefined ? { text: "▄", color: bottom } : { text: "▀", color: top, bg: bottom };
    }),
  );
}
