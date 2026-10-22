import {
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverKind,
  type ModelContextRecord,
} from "@t3tools/contracts";
import { BrainIcon, CpuIcon, ZapIcon } from "lucide-react";
import type { ComponentProps, CSSProperties } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "~/providerInstances";
import { useEnvironmentProviders } from "~/state/environments";
import { formatDayAwareTimestamp } from "~/timestampFormat";

import { ContextChip, ContextChipLabel } from "../ContextChip";
import { Menu, MenuGroup, MenuGroupLabel, MenuPopup, MenuTrigger } from "../ui/menu";
import { useComposerMenuProps } from "./composerEventScope";
import { ModelChipTraits, modelOptionKind } from "./modelChipParts";
import { modelContextOptions } from "./modelReferences";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { TraitsMenuContent } from "./TraitsPicker";

export type ModelChipRecord = Omit<ModelContextRecord, "version" | "kind" | "contextId">;

/** The provider instance a chip names, wherever it is connected now. */
function useModelChipInstance(record: ModelChipRecord): ProviderInstanceEntry | null {
  const providersByEnvironment = useEnvironmentProviders();
  for (const providers of providersByEnvironment.values()) {
    const entry = deriveProviderInstanceEntries(providers).find(
      (candidate) => candidate.instanceId === record.providerInstanceId,
    );
    if (entry) return entry;
  }
  return null;
}

function ModelChipIcon(props: {
  record: ModelChipRecord;
  entry: ProviderInstanceEntry | null;
  className?: string;
}) {
  return (
    <ProviderInstanceIcon
      driverKind={ProviderDriverKind.make(props.record.driver)}
      displayName={props.entry?.displayName ?? props.record.instanceName}
      accentColor={props.entry?.accentColor}
      acpRegistryAgentId={props.entry?.acpRegistryAgentId}
      acpRegistryIconUrl={props.entry?.acpRegistryIconUrl}
      iconClassName={props.className ?? "size-[1.17em]"}
    />
  );
}

/**
 * Fork: inline chip for a model the user named, in the composer and in sent messages. Shows the
 * model and the traits set when it was written; dashed when no connected environment has its
 * provider instance. Its hover is the model preview from the context presentation registry.
 */
export function ModelChipTrigger({
  record,
  copyMarkdown,
  style,
  ...props
}: Omit<ComponentProps<typeof ContextChip>, "kind" | "render" | "children"> & {
  record: ModelChipRecord;
  copyMarkdown?: string | undefined;
}) {
  const entry = useModelChipInstance(record);
  const accent = entry?.accentColor
    ? ({ "--context-chip-accent": entry.accentColor } as CSSProperties)
    : undefined;
  return (
    <ContextChip
      kind="model"
      render={<button type="button" />}
      aria-label={`${modelChipAccessibleLabel(record)}. Show details`}
      data-markdown-copy={copyMarkdown}
      style={{ ...accent, ...style }}
      {...(entry === null ? { state: "unresolved" as const } : {})}
      {...props}
    >
      <ModelChipIcon record={record} entry={entry} />
      <ContextChipLabel className="flex items-center gap-1">
        <span>{record.modelName}</span>
        <ModelChipTraits options={record.options} />
      </ContextChipLabel>
    </ContextChip>
  );
}

/**
 * The composer's model chip: clicking it opens the model's traits menu, and each change rewrites
 * the chip's record. A sent message's chip stays as written.
 */
export function ComposerModelChip({
  record,
  onRecordChange,
  ...props
}: Omit<ComponentProps<typeof ModelChipTrigger>, "record"> & {
  record: ModelContextRecord;
  onRecordChange: (record: ModelContextRecord) => void;
}) {
  const entry = useModelChipInstance(record);
  const composerMenuProps = useComposerMenuProps();
  const model = entry?.models.find((candidate) => candidate.slug === record.model) ?? null;
  const trigger = <ModelChipTrigger record={record} {...props} />;
  if (entry === null || model === null || !model.capabilities?.optionDescriptors?.length) {
    return trigger;
  }
  return (
    <Menu>
      <MenuTrigger render={trigger} />
      <MenuPopup side="bottom" align="start" {...composerMenuProps}>
        <MenuGroup>
          <MenuGroupLabel>
            {record.modelName} · {record.instanceName}
          </MenuGroupLabel>
        </MenuGroup>
        <TraitsMenuContent
          provider={entry.driverKind}
          instanceId={entry.instanceId}
          models={entry.models}
          model={record.model}
          promptUltrathink="none"
          modelOptions={record.options.map((option) => ({ id: option.id, value: option.value }))}
          allowPromptInjectedEffort={false}
          planModeEnabled={false}
          onModelOptionsChange={(next) =>
            onRecordChange({ ...record, options: modelContextOptions(model, next ?? []) })
          }
        />
      </MenuPopup>
    </Menu>
  );
}

export function modelChipAccessibleLabel(record: ModelChipRecord): string {
  const traits = record.options.map((option) => `${option.label} ${option.valueLabel}`);
  return [`Model ${record.modelName} on ${record.instanceName}`, ...traits].join(", ");
}

export interface ModelPreviewProps {
  record: ModelChipRecord;
}

const OPTION_ICONS = { effort: BrainIcon, fast: ZapIcon, context: CpuIcon } as const;

/** What the user asked for when they wrote the chip. It never changes afterwards. */
export function ModelPreview({ record }: ModelPreviewProps) {
  const entry = useModelChipInstance(record);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const driverLabel =
    PROVIDER_DISPLAY_NAMES[ProviderDriverKind.make(record.driver)] ?? record.driver;
  const writtenAt = formatDayAwareTimestamp(record.writtenAt, timestampFormat);
  return (
    <div className="flex w-72 max-w-full flex-col gap-2.5 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
          <ModelChipIcon record={record} entry={entry} className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm">{record.modelName}</p>
          <p className="truncate text-muted-foreground text-xs">
            {record.instanceName === driverLabel
              ? driverLabel
              : `${record.instanceName} · ${driverLabel}`}
          </p>
        </div>
      </div>
      {record.options.length > 0 ? (
        <dl className="grid grid-cols-[1rem_auto_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
          {record.options.map((option) => {
            const kind = modelOptionKind(option);
            const Icon = kind === null ? null : OPTION_ICONS[kind];
            return (
              <div key={option.id} className="contents">
                {Icon ? (
                  <Icon
                    aria-hidden="true"
                    className={
                      kind === "fast"
                        ? "size-3.5 fill-current text-muted-foreground"
                        : "size-3.5 text-muted-foreground"
                    }
                  />
                ) : (
                  <span />
                )}
                <dt className="text-muted-foreground">{option.label}</dt>
                <dd className="min-w-0 truncate">{option.valueLabel}</dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="text-muted-foreground text-xs">No traits set; uses the model's defaults.</p>
      )}
      <p className="border-t border-border/70 pt-2 text-muted-foreground text-xs">
        {writtenAt ? `As written · ${writtenAt}` : "As written"}
        {entry === null ? " · provider not connected" : ""}
      </p>
    </div>
  );
}
