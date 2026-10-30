import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import {
  EFFORTS,
  PROVIDERS,
  PROVIDER_IDS,
  TIERS,
  findModel,
  tiersFor,
  type ModelChoice,
  type ProviderId,
} from "./catalog.ts";

const ProviderChoice = z.object({
  model: z.string(),
  effort: z.enum(EFFORTS),
  tier: z.enum(TIERS),
});
type ProviderChoice = z.infer<typeof ProviderChoice>;

const Settings = z.object({
  provider: z.enum(PROVIDER_IDS),
  claude: ProviderChoice,
  codex: ProviderChoice,
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  provider: "claude",
  claude: PROVIDERS.claude.defaults,
  codex: PROVIDERS.codex.defaults,
};

const configDir = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "pr-guide");
export const settingsPath = join(configDir, "settings.json");

export function loadSettings(): Settings {
  try {
    const parsed = Settings.safeParse(JSON.parse(readFileSync(settingsPath, "utf8")));
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Keeps a choice inside the catalog: unknown models reset to the provider default, tiers to standard. */
export function sanitizeChoice(provider: ProviderId, choice: ProviderChoice): ModelChoice {
  const model = findModel(provider, choice.model) ? choice.model : PROVIDERS[provider].defaults.model;
  const tier = tiersFor({ provider, model }).includes(choice.tier) ? choice.tier : "standard";
  return { provider, model, effort: choice.effort, tier };
}

export function activeChoice(settings: Settings): ModelChoice {
  return sanitizeChoice(settings.provider, settings[settings.provider]);
}
