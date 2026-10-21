import type { ModelContextOption, ServerProviderModel } from "@t3tools/contracts";
import { BrainIcon, ZapIcon } from "lucide-react";

const EFFORT_OPTION = /effort|reasoning|thinking/i;
const FAST_OPTION = /fast/i;
const CONTEXT_OPTION = /context/i;

export function formatModelContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`;
  return `${Math.round(tokens / 1_000)}k`;
}

/** What a model lets you set, as the composer footer draws it: effort and fast mode. */
export function ModelTraitGlyphs(props: { model: ServerProviderModel | null }) {
  const descriptors = props.model?.capabilities?.optionDescriptors ?? [];
  const effort = descriptors.some((d) => d.type === "select" && EFFORT_OPTION.test(d.id));
  const fast = descriptors.some((d) => d.type === "boolean" && FAST_OPTION.test(d.id));
  return (
    <span className="flex items-center gap-1">
      {effort ? <BrainIcon aria-label="Effort levels" className="size-3" /> : null}
      {fast ? <ZapIcon aria-label="Fast mode" className="size-3 fill-current" /> : null}
    </span>
  );
}

/** "Extra High" → "XH", "High" → "H", "1M" stays. */
function abbreviateValue(label: string): string {
  if (label.length <= 3) return label;
  return label
    .split(/[\s_-]+/)
    .map((word) => (/^extra$/i.test(word) ? "X" : (word[0] ?? "").toUpperCase()))
    .join("");
}

/**
 * The chip's trailing glyphs for the traits the user set: effort as a brain and its initial,
 * fast mode as a filled bolt, and the context size. Traits left unset show nothing.
 */
export function ModelChipTraits(props: { options: ReadonlyArray<ModelContextOption> }) {
  const effort = props.options.find((option) => EFFORT_OPTION.test(option.id));
  const fast = props.options.find((option) => FAST_OPTION.test(option.id) && option.value === true);
  const context = props.options.find((option) => CONTEXT_OPTION.test(option.id));
  if (!effort && !fast && !context) return null;
  return (
    <span className="flex items-center gap-0.5 font-normal opacity-70">
      {effort ? (
        <>
          <BrainIcon aria-hidden="true" className="size-[0.95em]!" />
          <span>{abbreviateValue(effort.valueLabel)}</span>
        </>
      ) : null}
      {fast ? <ZapIcon aria-hidden="true" className="size-[0.95em]! fill-current" /> : null}
      {context ? <span>{context.valueLabel}</span> : null}
    </span>
  );
}

export function modelOptionKind(option: ModelContextOption): "effort" | "fast" | "context" | null {
  if (EFFORT_OPTION.test(option.id)) return "effort";
  if (FAST_OPTION.test(option.id)) return "fast";
  if (CONTEXT_OPTION.test(option.id)) return "context";
  return null;
}
