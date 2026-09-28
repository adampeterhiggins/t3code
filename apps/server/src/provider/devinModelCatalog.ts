/**
 * devinModelCatalog — pure parsing/grouping helpers for Devin's model surface.
 *
 * Devin's CLI encodes reasoning effort, speed tier, and context window in the
 * model uid itself (`claude-opus-5-high-fast`, `glm-5-2-max-1m`,
 * `MODEL_GPT_5_2_LOW`). The picker should still present one row per family
 * with option descriptors, matching how Codex/Claude expose effort and fast
 * mode. This module owns both directions:
 *
 * - `devinModelsFromCatalog` groups `devin models list --format json` into
 *   per-family rows with `effort` / `speed` / `context` option descriptors.
 * - `resolveDevinModelUid` turns `{ model: <family>, options }` back into a
 *   concrete advertised uid for `session/set_config_option`.
 *
 * @module devinModelCatalog
 */
import type {
  ModelPricing,
  ProviderOptionChoice,
  ProviderOptionSelection,
  ServerProviderModel,
} from "@t3tools/contracts";

// ── uid suffix grammar ───────────────────────────────────────────────────
//
// Wire order is <base>-<effort>[-<speed>][-<context>]; separators may be `-`
// or `_` (`MODEL_GPT_5_2_LOW`). Suffixes strip right-to-left: context, then
// speed, then effort.

const EFFORT_TOKENS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "thinking",
]);
const SPEED_TOKENS = new Set(["fast", "priority"]);
const CONTEXT_TOKENS = new Set(["1m"]);

export interface DevinModelDims {
  /** Normalized base id (lowercase, `-` separators). */
  readonly base: string;
  readonly effort: string | undefined;
  readonly speed: string | undefined;
  readonly context: string | undefined;
}

export function normalizeDevinModelId(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", "-");
}

export function parseDevinModelUid(uid: string): DevinModelDims {
  const tokens = normalizeDevinModelId(uid).split("-").filter(Boolean);
  let effort: string | undefined;
  let speed: string | undefined;
  let context: string | undefined;
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1]!;
    if (context === undefined && CONTEXT_TOKENS.has(last)) {
      context = last;
      tokens.pop();
      continue;
    }
    if (speed === undefined && SPEED_TOKENS.has(last)) {
      speed = last;
      tokens.pop();
      continue;
    }
    if (effort === undefined && EFFORT_TOKENS.has(last)) {
      effort = last;
      tokens.pop();
      continue;
    }
    break;
  }
  return { base: tokens.join("-"), effort, speed, context };
}

// ── picker rows ──────────────────────────────────────────────────────────

export const DEVIN_EFFORT_OPTION_ID = "effort";
export const DEVIN_SPEED_OPTION_ID = "speed";
export const DEVIN_CONTEXT_OPTION_ID = "context";

/** Selection values that mean "the provider default" for an axis. */
const DEFAULT_EFFORT_VALUE = "default";
const STANDARD_SPEED_VALUE = "standard";
const STANDARD_CONTEXT_VALUE = "200k";

const EFFORT_ORDER = [
  DEFAULT_EFFORT_VALUE,
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "thinking",
] as const;

const EFFORT_LABELS: Record<string, string> = {
  [DEFAULT_EFFORT_VALUE]: "Default",
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
  thinking: "Thinking",
};

const SPEED_LABELS: Record<string, string> = {
  [STANDARD_SPEED_VALUE]: "Standard",
  fast: "Fast",
  priority: "Priority",
};

const CONTEXT_LABELS: Record<string, string> = {
  [STANDARD_CONTEXT_VALUE]: "Standard",
  "1m": "1M",
};

interface DevinModelVariant {
  readonly model_uid: string;
  readonly label?: string;
  readonly is_new?: boolean;
  readonly is_beta?: boolean;
  readonly max_context_tokens?: number;
  readonly max_output_tokens?: number;
  /** e.g. "$5 / 1M Input · $0.5 / 1M Cached input · $25 / 1M Output". */
  readonly cost_summary?: string;
  readonly cost_tier?: string;
}

interface DevinModelFamily {
  readonly family_uid?: string;
  readonly family_label?: string;
  readonly slug?: string;
  readonly aliases?: ReadonlyArray<string>;
  readonly variants?: ReadonlyArray<DevinModelVariant>;
}

export interface DevinModelsListJson {
  readonly families?: ReadonlyArray<DevinModelFamily>;
}

/** `adaptive` is Devin's recommended auto-router and the picker default. */
const DEVIN_DEFAULT_MODEL_SLUG = "adaptive";

const DEVIN_PRICING_SOURCE = "devin-cli models list";

/**
 * Parses `cost_summary` strings like
 * `$5 / 1M Input · $0.5 / 1M Cached input · $25 / 1M Output` into per-million
 * USD rates. Unrecognized segments are skipped; the record is only emitted
 * when both input and output rates are present.
 */
export function parseDevinCostSummary(costSummary: string | undefined): ModelPricing | undefined {
  if (!costSummary) return undefined;
  let input: number | undefined;
  let cachedInput: number | undefined;
  let cacheCreation: number | undefined;
  let output: number | undefined;
  for (const segment of costSummary.split("·")) {
    const match = /\$(\d+(?:\.\d+)?)\s*\/\s*1M\s+(.+)$/i.exec(segment.trim());
    if (!match) continue;
    const rate = Number(match[1]);
    if (!Number.isFinite(rate) || rate < 0) continue;
    const field = match[2]!.trim().toLowerCase();
    if (field === "input") input = rate;
    else if (field === "cached input") cachedInput = rate;
    else if (field === "cache creation" || field === "cache write") cacheCreation = rate;
    else if (field === "output") output = rate;
  }
  if (input === undefined || output === undefined) return undefined;
  return {
    inputPerMillion: input,
    ...(cachedInput !== undefined ? { cachedInputPerMillion: cachedInput } : {}),
    ...(cacheCreation !== undefined ? { cacheCreationPerMillion: cacheCreation } : {}),
    outputPerMillion: output,
    currency: "USD",
    source: DEVIN_PRICING_SOURCE,
  };
}

/**
 * Fallback context sizes used when a catalog omits `max_context_tokens`.
 * Keyed by normalized uid base (`parseDevinModelUid().base`).
 */
const DEVIN_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  adaptive: 1_000_000,
  "claude-opus-5": 1_000_000,
  "claude-5-fable": 1_000_000,
  "claude-fable-5": 1_000_000,
  "claude-sonnet-5": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "claude-opus-4-7": 1_000_000,
  "claude-opus-4-6": 200_000,
  "claude-opus-4-5": 200_000,
  "claude-haiku-4-5": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-sonnet-4-5": 200_000,
  "deepseek-v4-flash": 1_048_576,
  "deepseek-v4-pro": 1_048_576,
  "gemini-3-flash": 1_048_576,
  "gemini-3-1-pro": 1_048_576,
  "gemini-3-5-flash": 1_048_576,
  "gemini-3-6-flash": 1_048_576,
  "gemini-3-7-flash": 1_048_576,
  "glm-5-2": 200_000,
  "gpt-4-1": 1_047_576,
  "gpt-5-1": 272_000,
  "gpt-5-2": 384_000,
  "gpt-5-3-codex": 400_000,
  "gpt-5-4": 272_000,
  "gpt-5-4-mini": 400_000,
  "gpt-5-5": 272_000,
  "gpt-5-6-sol": 1_000_000,
  "gpt-5-6-luna": 1_000_000,
  "gpt-5-6-terra": 1_000_000,
  "grok-4-5": 500_000,
  "grok-4-6": 500_000,
  inkling: 1_048_576,
  "kimi-k2-6": 262_144,
  "kimi-k2-7": 262_144,
  "kimi-k3": 1_048_576,
  "nemotron-3-ultra": 1_000_000,
  "swe-1-6": 200_000,
  "swe-1-6-fast": 200_000,
  "swe-1-7": 262_000,
  "swe-1-7-lightning": 202_752,
};

/**
 * Context-window tokens for a concrete Devin uid. An explicit context suffix
 * wins (`glm-5-2-max-1m` → 1M); otherwise falls back to the per-base map so
 * the composer meter still has a denominator before the first usage update.
 */
export function inferDevinContextWindowTokens(
  modelUid: string | null | undefined,
): number | undefined {
  const trimmed = modelUid?.trim();
  if (!trimmed) return undefined;
  const parsed = parseDevinModelUid(trimmed);
  if (parsed.context === "1m") return 1_000_000;
  return DEVIN_CONTEXT_WINDOWS[parsed.base];
}

interface ParsedVariant {
  readonly uid: string;
  readonly label: string | undefined;
  readonly dims: DevinModelDims;
  readonly isNew: boolean;
  readonly pricing: ModelPricing | undefined;
  readonly contextWindowTokens: number | undefined;
}

function effortRank(effort: string): number {
  const index = EFFORT_ORDER.indexOf(effort as (typeof EFFORT_ORDER)[number]);
  return index === -1 ? EFFORT_ORDER.length : index;
}

/**
 * Label-derived dims for families whose variant uids are opaque
 * (`MODEL_PRIVATE_*`): the variant label minus the family label carries the
 * effort words — "GPT-5.1 Low Thinking" → `low`, "… No Thinking" → `none`,
 * "… Thinking" → `thinking`. Returns `undefined` when the label does not
 * extend the family label so callers fall back to uid parsing.
 */
export function parseDevinVariantLabel(
  familyLabel: string | undefined,
  variantLabel: string | undefined,
): DevinModelDims | undefined {
  if (!familyLabel || !variantLabel) return undefined;
  const trimmedFamily = familyLabel.trim();
  const trimmedVariant = variantLabel.trim();
  if (
    !trimmedVariant.toLowerCase().startsWith(trimmedFamily.toLowerCase()) ||
    trimmedVariant.length === trimmedFamily.length
  ) {
    return undefined;
  }
  let rest = trimmedVariant.slice(trimmedFamily.length).trim().toLowerCase();

  let context: string | undefined;
  let speed: string | undefined;
  for (const token of rest.split(/\s+/).reverse()) {
    if (context === undefined && CONTEXT_TOKENS.has(token)) {
      context = token;
      rest = rest.slice(0, rest.length - token.length).trim();
      continue;
    }
    if (speed === undefined && SPEED_TOKENS.has(token)) {
      speed = token;
      rest = rest.slice(0, rest.length - token.length).trim();
      continue;
    }
    break;
  }

  let effort: string | undefined;
  if (rest === "no thinking") {
    effort = "none";
  } else if (rest === "thinking") {
    effort = "thinking";
  } else {
    const stripped = rest.replace(/\s*thinking$/, "");
    if (stripped !== rest && EFFORT_TOKENS.has(stripped)) {
      effort = stripped;
    } else if (EFFORT_TOKENS.has(rest)) {
      effort = rest;
    }
  }
  return { base: "", effort, speed, context };
}

function effortChoice(effort: string, isDefault: boolean): ProviderOptionChoice {
  return {
    id: effort,
    label: EFFORT_LABELS[effort] ?? effort,
    ...(isDefault ? { isDefault: true } : {}),
  };
}

// ── Fusion (lead + sidekick pairs) ───────────────────────────────────────
//
// Fusion uids pair a lead and a sidekick model:
// `fusion-<lead uid>-sidekick-<sidekick uid>`. `models list` enumerates every
// effort/speed permutation (hundreds), but an ACP session only accepts a
// small advertised subset: each lead at one Devin-chosen effort. The picker
// therefore offers Lead and Sidekick by family plus the sidekick's effort as
// its own select (like any other model row), and resolution picks whichever
// advertised uid matches.

export const DEVIN_FUSION_SLUG = "fusion";
export const DEVIN_FUSION_LEAD_OPTION_ID = "lead";
export const DEVIN_FUSION_SIDEKICK_OPTION_ID = "sidekick";
export const DEVIN_FUSION_SIDEKICK_EFFORT_OPTION_ID = "sidekickEffort";

const FUSION_UID_PATTERN = /^fusion-(.+)-sidekick-(.+)$/;

interface FusionPair {
  /** Lead family base, e.g. `claude-fable-5-1`. */
  readonly lead: string;
  /** Sidekick family base, e.g. `swe-2`. */
  readonly sidekick: string;
  /** Sidekick effort, e.g. `medium`; `undefined` for effortless uids (`glm-5-2`). */
  readonly sidekickEffort: string | undefined;
  /** Whether the sidekick uid carried a speed tier (`-priority`). */
  readonly sidekickHasSpeed: boolean;
}

export function parseDevinFusionUid(uid: string): FusionPair | undefined {
  const match = FUSION_UID_PATTERN.exec(normalizeDevinModelId(uid));
  if (!match) return undefined;
  const sidekick = parseDevinModelUid(match[2]!);
  return {
    lead: parseDevinModelUid(match[1]!).base,
    sidekick: sidekick.base,
    sidekickEffort: sidekick.effort,
    sidekickHasSpeed: sidekick.speed !== undefined,
  };
}

/** Splits `Fusion (Claude Fable 5.1 Medium + SWE-2 Medium)` into its halves. */
function fusionLabelParts(
  label: string | undefined,
): { lead: string; sidekick: string } | undefined {
  const match = /^[^(]*\((.+) \+ (.+)\)\s*$/.exec(label ?? "");
  return match ? { lead: match[1]!.trim(), sidekick: match[2]!.trim() } : undefined;
}

function fusionModelFromFamily(
  family: DevinModelFamily,
  familyLabelsByBase: ReadonlyMap<string, string>,
): ServerProviderModel | undefined {
  const leads = new Map<string, string>();
  const sidekicks = new Map<string, string>();
  const sidekickEfforts = new Set<string>();
  let defaultPair: FusionPair | undefined;
  let defaultPricing: ModelPricing | undefined;
  let isNew = false;
  let contextWindowTokens: number | undefined;

  for (const variant of family.variants ?? []) {
    const pair = parseDevinFusionUid(variant.model_uid ?? "");
    if (!pair) continue;
    const labels = fusionLabelParts(variant.label);
    if (!defaultPair) {
      defaultPair = pair;
      defaultPricing = parseDevinCostSummary(variant.cost_summary);
    }
    if (!leads.has(pair.lead)) {
      leads.set(pair.lead, familyLabelsByBase.get(pair.lead) ?? labels?.lead ?? pair.lead);
    }
    if (!sidekicks.has(pair.sidekick)) {
      sidekicks.set(
        pair.sidekick,
        familyLabelsByBase.get(pair.sidekick) ?? labels?.sidekick ?? pair.sidekick,
      );
    }
    if (pair.sidekickEffort) sidekickEfforts.add(pair.sidekickEffort);
    if (variant.is_new === true) isNew = true;
    const tokens = variant.max_context_tokens;
    if (
      typeof tokens === "number" &&
      Number.isFinite(tokens) &&
      tokens >= 1 &&
      (contextWindowTokens === undefined || tokens > contextWindowTokens)
    ) {
      contextWindowTokens = Math.trunc(tokens);
    }
  }
  if (!defaultPair) return undefined;

  const select = (
    id: string,
    label: string,
    choices: Map<string, string>,
    defaultId: string | undefined,
  ) => {
    const resolvedDefault =
      defaultId !== undefined && choices.has(defaultId) ? defaultId : choices.keys().next().value;
    return {
      id,
      label,
      type: "select" as const,
      options: [...choices].map(([choiceId, choiceLabel]) => ({
        id: choiceId,
        label: choiceLabel,
        ...(choiceId === resolvedDefault ? { isDefault: true } : {}),
      })),
    };
  };
  // Efforts are the union across sidekicks; resolution relaxes the effort
  // when the chosen sidekick lacks it (GPT-6 Luna only runs High).
  const effortChoices = new Map(
    EFFORT_ORDER.filter((effort) => sidekickEfforts.has(effort)).map((effort) => [
      effort as string,
      EFFORT_LABELS[effort]!,
    ]),
  );

  return {
    slug: DEVIN_FUSION_SLUG,
    name: family.family_label?.trim() || "Fusion",
    ...(isNew ? { badge: "new" as const } : {}),
    isCustom: false,
    isDefault: false,
    capabilities: {
      optionDescriptors: [
        // Lead and Sidekick pick models, so each gets its own composer control;
        // the sidekick effort stays in the traits menu like any model's effort.
        {
          ...select(DEVIN_FUSION_LEAD_OPTION_ID, "Lead", leads, defaultPair.lead),
          standalone: true,
        },
        {
          ...select(DEVIN_FUSION_SIDEKICK_OPTION_ID, "Sidekick", sidekicks, defaultPair.sidekick),
          standalone: true,
        },
        ...(effortChoices.size > 1
          ? [
              select(
                DEVIN_FUSION_SIDEKICK_EFFORT_OPTION_ID,
                "Sidekick reasoning",
                effortChoices,
                defaultPair.sidekickEffort,
              ),
            ]
          : []),
      ],
    },
    // Sidekick rates vary by pair; the lead rate is what the row advertises.
    ...(defaultPricing ? { pricing: defaultPricing } : {}),
    ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
  };
}

function isFusionFamily(family: DevinModelFamily): boolean {
  const variants = family.variants ?? [];
  return (
    variants.length > 0 &&
    variants.every((variant) => parseDevinFusionUid(variant.model_uid ?? "") !== undefined)
  );
}

/**
 * One row per family. Variants sharing a uid base become `effort`/`speed`/
 * `context` option descriptors (token-valued choices resolved by dims match);
 * families whose uids share no base (`MODEL_PRIVATE_*` under gpt-5.1) emit a
 * single effort select whose choices carry the concrete uid, which
 * `resolveDevinModelUid` passes through. Variant uids land in `aliases` so
 * stored flat selections like `swe-2-high` still resolve to the family row.
 * The Fusion family becomes a single Lead + Sidekick row instead.
 */
export function devinModelsFromCatalog(
  parsed: DevinModelsListJson | undefined,
): ReadonlyArray<ServerProviderModel> {
  const models: ServerProviderModel[] = [];
  const seenSlugs = new Set<string>();

  const familyLabelsByBase = new Map<string, string>();
  for (const family of parsed?.families ?? []) {
    const label = family.family_label?.trim();
    const firstUid = family.variants?.[0]?.model_uid;
    if (label && firstUid) familyLabelsByBase.set(parseDevinModelUid(firstUid).base, label);
  }

  for (const family of parsed?.families ?? []) {
    if (isFusionFamily(family)) {
      const fusion = fusionModelFromFamily(family, familyLabelsByBase);
      if (fusion && !seenSlugs.has(fusion.slug)) {
        seenSlugs.add(fusion.slug);
        models.push(fusion);
      }
      continue;
    }
    const familyLabel =
      typeof family.family_label === "string" && family.family_label.trim()
        ? family.family_label.trim()
        : undefined;
    const familySlug = typeof family.slug === "string" ? family.slug.trim() : "";
    const familyAliases = [
      ...(family.aliases ?? []).filter(
        (alias): alias is string => typeof alias === "string" && alias.trim().length > 0,
      ),
      ...(familySlug ? [familySlug] : []),
    ];

    const variants: Array<ParsedVariant> = [];
    for (const variant of family.variants ?? []) {
      const uid = typeof variant.model_uid === "string" ? variant.model_uid.trim() : "";
      if (!uid) continue;
      const label =
        typeof variant.label === "string" && variant.label.trim()
          ? variant.label.trim()
          : undefined;
      const rawContextTokens =
        typeof variant.max_context_tokens === "number" &&
        Number.isFinite(variant.max_context_tokens) &&
        variant.max_context_tokens >= 1
          ? Math.trunc(variant.max_context_tokens)
          : undefined;
      variants.push({
        uid,
        label,
        dims: parseDevinModelUid(uid),
        isNew: variant.is_new === true,
        pricing: parseDevinCostSummary(variant.cost_summary),
        contextWindowTokens: rawContextTokens,
      });
    }
    if (variants.length === 0) continue;

    const distinctBases = new Set(variants.map((variant) => variant.dims.base));
    const isNew = variants.some((variant) => variant.isNew);
    const optionDescriptors: Array<{
      id: string;
      label: string;
      type: "select";
      options: Array<ProviderOptionChoice>;
    }> = [];
    let slug: string;

    if (distinctBases.size <= 1) {
      // Shared uid base — multi-axis dims from uid suffixes.
      slug = variants[0]!.dims.base;
      const efforts = new Set<string>();
      const speeds = new Set<string>();
      const contexts = new Set<string>();
      for (const variant of variants) {
        if (variant.dims.effort) efforts.add(variant.dims.effort);
        if (variant.dims.speed) speeds.add(variant.dims.speed);
        if (variant.dims.context) contexts.add(variant.dims.context);
      }
      const hasBare = variants.some(
        (variant) =>
          variant.dims.effort === undefined &&
          variant.dims.speed === undefined &&
          variant.dims.context === undefined,
      );

      if (efforts.size > 0 || (hasBare && variants.length > 1)) {
        const options: Array<ProviderOptionChoice> = [];
        if (hasBare) {
          options.push(effortChoice(DEFAULT_EFFORT_VALUE, true));
        }
        for (const effort of EFFORT_ORDER) {
          if (effort === DEFAULT_EFFORT_VALUE || !efforts.has(effort)) continue;
          options.push(effortChoice(effort, false));
        }
        if (options.length > 1) {
          optionDescriptors.push({
            id: DEVIN_EFFORT_OPTION_ID,
            label: "Reasoning",
            type: "select",
            options,
          });
        }
      }

      if (speeds.size > 0) {
        const options: Array<ProviderOptionChoice> = [];
        const hasStandard = variants.some((variant) => variant.dims.speed === undefined);
        if (hasStandard) {
          options.push({
            id: STANDARD_SPEED_VALUE,
            label: SPEED_LABELS[STANDARD_SPEED_VALUE]!,
            isDefault: true,
          });
        }
        for (const speed of ["fast", "priority"]) {
          if (!speeds.has(speed)) continue;
          options.push({
            id: speed,
            label: SPEED_LABELS[speed]!,
            ...(hasStandard ? {} : { isDefault: true }),
          });
        }
        if (options.length > 1) {
          optionDescriptors.push({
            id: DEVIN_SPEED_OPTION_ID,
            label: "Speed",
            type: "select",
            options,
          });
        }
      }

      if (contexts.size > 0) {
        const options: Array<ProviderOptionChoice> = [];
        const hasStandard = variants.some((variant) => variant.dims.context === undefined);
        if (hasStandard) {
          options.push({
            id: STANDARD_CONTEXT_VALUE,
            label: CONTEXT_LABELS[STANDARD_CONTEXT_VALUE]!,
            isDefault: true,
          });
        }
        for (const context of ["1m"]) {
          if (!contexts.has(context)) continue;
          options.push({
            id: context,
            label: CONTEXT_LABELS[context]!,
            ...(hasStandard ? {} : { isDefault: true }),
          });
        }
        if (options.length > 1) {
          optionDescriptors.push({
            id: DEVIN_CONTEXT_OPTION_ID,
            label: "Context",
            type: "select",
            options,
          });
        }
      }
    } else {
      // Opaque uids — one effort select with uid-valued choices, ordered by
      // effort rank. `resolveDevinModelUid` passes a uid-valued selection
      // straight through, so no shared base is needed.
      const byVariant = variants.map((variant) => ({
        ...variant,
        labelDims: parseDevinVariantLabel(familyLabel, variant.label),
      }));
      const isBare = (variant: (typeof byVariant)[number]) =>
        variant.labelDims?.effort === undefined &&
        variant.labelDims?.speed === undefined &&
        variant.labelDims?.context === undefined;
      const defaultVariant =
        byVariant.find(isBare) ??
        byVariant.find((variant) => variant.labelDims?.effort === "medium") ??
        byVariant[0]!;
      slug = defaultVariant.uid;

      const options = byVariant
        .toSorted(
          (left, right) =>
            effortRank(left.labelDims?.effort ?? DEFAULT_EFFORT_VALUE) -
            effortRank(right.labelDims?.effort ?? DEFAULT_EFFORT_VALUE),
        )
        .map((variant) => {
          const suffix =
            familyLabel &&
            variant.label !== undefined &&
            variant.label.toLowerCase().startsWith(familyLabel.toLowerCase())
              ? variant.label.slice(familyLabel.length).trim()
              : "";
          return {
            id: variant.uid,
            label:
              suffix !== ""
                ? suffix
                : EFFORT_LABELS[variant.labelDims?.effort ?? DEFAULT_EFFORT_VALUE]!,
            ...(variant.uid === defaultVariant.uid ? { isDefault: true } : {}),
          };
        });
      if (options.length > 1) {
        optionDescriptors.push({
          id: DEVIN_EFFORT_OPTION_ID,
          label: "Reasoning",
          type: "select",
          options,
        });
      }
    }

    if (seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    const aliases = [...familyAliases, ...variants.map((variant) => variant.uid)].filter(
      (alias) => alias !== slug,
    );
    const pricingByVariant = Object.fromEntries(
      variants
        .filter((variant) => variant.pricing !== undefined)
        .map((variant) => [variant.uid, variant.pricing!]),
    );
    const rowPricing = variants.find((variant) => variant.uid === slug)?.pricing;
    const contextWindowTokens = variants.reduce<number | undefined>(
      (max, variant) =>
        variant.contextWindowTokens !== undefined &&
        (max === undefined || variant.contextWindowTokens > max)
          ? variant.contextWindowTokens
          : max,
      undefined,
    );
    models.push({
      slug,
      name: familyLabel ?? slug,
      ...(aliases.length > 0 ? { aliases } : {}),
      ...(isNew ? { badge: "new" as const } : {}),
      isCustom: false,
      isDefault:
        slug === DEVIN_DEFAULT_MODEL_SLUG ||
        variants.some((v) => v.uid === DEVIN_DEFAULT_MODEL_SLUG),
      capabilities: optionDescriptors.length > 0 ? { optionDescriptors } : null,
      ...(rowPricing ? { pricing: rowPricing } : {}),
      ...(Object.keys(pricingByVariant).length > 0 ? { pricingByVariant } : {}),
      ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
    });
  }
  return models;
}

// ── selection → concrete uid ─────────────────────────────────────────────

const DEVIN_DIM_OPTION_IDS = new Set([
  DEVIN_EFFORT_OPTION_ID,
  DEVIN_SPEED_OPTION_ID,
  DEVIN_CONTEXT_OPTION_ID,
  DEVIN_FUSION_LEAD_OPTION_ID,
  DEVIN_FUSION_SIDEKICK_OPTION_ID,
  DEVIN_FUSION_SIDEKICK_EFFORT_OPTION_ID,
]);

/** Option ids that fold into the model uid rather than a config option. */
export function isDevinModelDimOptionId(id: string): boolean {
  return DEVIN_DIM_OPTION_IDS.has(id);
}

function wantedDims(selections: ReadonlyArray<ProviderOptionSelection> | null | undefined): {
  effort: string | undefined;
  speed: string | undefined;
  context: string | undefined;
  hasAny: boolean;
} {
  let effort: string | undefined;
  let speed: string | undefined;
  let context: string | undefined;
  for (const selection of selections ?? []) {
    if (selection.id === DEVIN_EFFORT_OPTION_ID && typeof selection.value === "string") {
      effort = selection.value === DEFAULT_EFFORT_VALUE ? undefined : selection.value;
    } else if (selection.id === DEVIN_SPEED_OPTION_ID && typeof selection.value === "string") {
      speed = selection.value === STANDARD_SPEED_VALUE ? undefined : selection.value;
    } else if (selection.id === DEVIN_CONTEXT_OPTION_ID && typeof selection.value === "string") {
      context = selection.value === STANDARD_CONTEXT_VALUE ? undefined : selection.value;
    }
  }
  return {
    effort,
    speed,
    context,
    hasAny: effort !== undefined || speed !== undefined || context !== undefined,
  };
}

/**
 * Resolve a grouped selection (`model` = base id + effort/speed/context
 * options) to a concrete advertised uid. Resolution matches on parsed dims
 * rather than string composition so irregular uids (`MODEL_GPT_5_2_LOW`,
 * `claude-5-fable-*`) still land. Exact uid matches and unknown models pass
 * through untouched.
 */
export function resolveDevinModelUid(input: {
  readonly model: string;
  readonly selections?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly advertisedValues: ReadonlyArray<string>;
  readonly currentValue?: string | undefined;
}): string {
  const model = input.model.trim();
  if (!model) return model;
  if (normalizeDevinModelId(model) === DEVIN_FUSION_SLUG) return resolveDevinFusionUid(input);

  // Opaque families (no shared uid base, e.g. `MODEL_PRIVATE_*`) put the
  // concrete uid in the dim choice id — a selection that is itself an
  // advertised value wins outright.
  const direct = (input.selections ?? []).find(
    (selection) =>
      isDevinModelDimOptionId(selection.id) &&
      typeof selection.value === "string" &&
      input.advertisedValues.includes(selection.value),
  );
  if (direct) return direct.value as string;

  const wanted = wantedDims(input.selections);
  // A base id like `swe-1-7` is often *also* an advertised uid (the family's
  // default-effort variant), so the exact-match pass-through only applies
  // when no dims were selected — otherwise the dims must drive resolution.
  if (!wanted.hasAny && input.advertisedValues.includes(model)) return model;

  const wantedBase = normalizeDevinModelId(model);
  const candidates = input.advertisedValues.filter(
    (uid) => parseDevinModelUid(uid).base === wantedBase,
  );
  if (candidates.length === 0) return model;

  if (!wanted.hasAny) {
    // No dims selected: keep the session's current value when it already
    // belongs to this family, else the bare variant, else first advertised.
    if (input.currentValue && candidates.includes(input.currentValue)) {
      return input.currentValue;
    }
    const bare = candidates.find((uid) => {
      const dims = parseDevinModelUid(uid);
      return dims.effort === undefined && dims.speed === undefined && dims.context === undefined;
    });
    return bare ?? candidates[0]!;
  }

  const strict = candidates.find((uid) => {
    const dims = parseDevinModelUid(uid);
    return (
      dims.effort === wanted.effort &&
      dims.speed === wanted.speed &&
      dims.context === wanted.context
    );
  });
  if (strict) return strict;

  // Relax: drop context, then speed, then accept the bare variant, then
  // first advertised — never fail the turn over a missing variant.
  const withoutContext = candidates.find((uid) => {
    const dims = parseDevinModelUid(uid);
    return dims.effort === wanted.effort && dims.speed === wanted.speed;
  });
  if (withoutContext) return withoutContext;
  const effortOnly = candidates.find((uid) => parseDevinModelUid(uid).effort === wanted.effort);
  if (effortOnly) return effortOnly;
  const bare = candidates.find((uid) => {
    const dims = parseDevinModelUid(uid);
    return dims.effort === undefined && dims.speed === undefined && dims.context === undefined;
  });
  return bare ?? candidates[0]!;
}

/**
 * Fusion selections name a lead family, a sidekick family and a sidekick
 * effort; pick the advertised pair that matches, relaxing effort, then
 * sidekick, then lead. Devin fixes the lead's effort per pair, so there is no
 * lead effort to match. A pre-split sidekick selection (`swe-2-medium`) still
 * carries its effort. Returns `fusion` untouched
 * when the session advertises no Fusion uids, letting the set fail loudly.
 */
function resolveDevinFusionUid(input: {
  readonly model: string;
  readonly selections?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly advertisedValues: ReadonlyArray<string>;
  readonly currentValue?: string | undefined;
}): string {
  const selected = (id: string) => {
    const value = input.selections?.find((selection) => selection.id === id)?.value;
    return typeof value === "string" ? value : undefined;
  };
  const lead = selected(DEVIN_FUSION_LEAD_OPTION_ID);
  const sidekickDims = parseDevinModelUid(selected(DEVIN_FUSION_SIDEKICK_OPTION_ID) ?? "");
  const sidekickEffort = selected(DEVIN_FUSION_SIDEKICK_EFFORT_OPTION_ID) ?? sidekickDims.effort;

  let candidates = input.advertisedValues.flatMap((uid) => {
    const pair = parseDevinFusionUid(uid);
    return pair ? [{ uid, pair }] : [];
  });
  if (candidates.length === 0) return input.model;
  // Unselected axes (the client omits untouched options) leave candidates alone.
  for (const [wanted, of] of [
    [lead, (pair: FusionPair) => pair.lead],
    [sidekickDims.base || undefined, (pair: FusionPair) => pair.sidekick],
    [sidekickEffort, (pair: FusionPair) => pair.sidekickEffort],
  ] as const) {
    if (wanted === undefined) continue;
    const narrowed = candidates.filter((candidate) => of(candidate.pair) === wanted);
    if (narrowed.length > 0) candidates = narrowed;
  }
  return (
    candidates.find((candidate) => candidate.uid === input.currentValue)?.uid ??
    candidates.find((candidate) => !candidate.pair.sidekickHasSpeed)?.uid ??
    candidates[0]!.uid
  );
}
