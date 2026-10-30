export const EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type Effort = (typeof EFFORTS)[number];

export const EFFORT_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
} as const satisfies Record<Effort, string>;

export const TIERS = ["standard", "fast", "ultrafast"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABELS = {
  standard: "Standard",
  fast: "Fast",
  ultrafast: "Ultrafast",
} as const satisfies Record<Tier, string>;

interface ModelSpec {
  readonly slug: string;
  readonly label: string;
  readonly tiers: ReadonlyArray<Tier>;
}

interface ProviderSpec {
  readonly label: string;
  readonly models: ReadonlyArray<ModelSpec>;
  readonly defaults: { readonly model: string; readonly effort: Effort; readonly tier: Tier };
}

export const PROVIDERS = {
  claude: {
    label: "Claude",
    models: [
      { slug: "claude-opus-5-5", label: "Opus 5.5", tiers: ["standard", "fast"] },
      { slug: "claude-sonnet-5-5", label: "Sonnet 5.5", tiers: ["standard"] },
      { slug: "claude-fable-5-1", label: "Fable 5.1", tiers: ["standard"] },
      { slug: "claude-haiku-5-5", label: "Haiku 5.5", tiers: ["standard"] },
    ],
    defaults: { model: "claude-opus-5-5", effort: "high", tier: "standard" },
  },
  codex: {
    label: "Codex",
    models: [
      { slug: "gpt-6.1-sol", label: "GPT-6.1 Sol", tiers: ["standard", "fast", "ultrafast"] },
      { slug: "gpt-6-astra", label: "GPT-6 Astra", tiers: ["standard", "fast", "ultrafast"] },
      { slug: "gpt-6-luna", label: "GPT-6 Luna", tiers: ["standard", "fast"] },
    ],
    defaults: { model: "gpt-6.1-sol", effort: "high", tier: "standard" },
  },
} as const satisfies Record<string, ProviderSpec>;

export type ProviderId = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ReadonlyArray<ProviderId>;

export interface ModelChoice {
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: Effort;
  readonly tier: Tier;
}

export function findModel(provider: ProviderId, slug: string): ModelSpec | undefined {
  return PROVIDERS[provider].models.find((model) => model.slug === slug);
}

/** A tier the model does not offer falls back to standard. */
export function tiersFor(choice: Pick<ModelChoice, "provider" | "model">): ReadonlyArray<Tier> {
  return findModel(choice.provider, choice.model)?.tiers ?? ["standard"];
}

export function describeChoice(choice: ModelChoice): string {
  const model = findModel(choice.provider, choice.model)?.label ?? choice.model;
  const tier = choice.tier === "standard" ? "" : ` · ${TIER_LABELS[choice.tier]}`;
  return `${model} · ${EFFORT_LABELS[choice.effort]}${tier}`;
}
