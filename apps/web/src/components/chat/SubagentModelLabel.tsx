import { resolveSubagentMetadata } from "@t3tools/client-runtime/state/subagent-display";
import { REASONING_EFFORT_OPTION_IDS } from "@t3tools/client-runtime/state/thread-execution";
import type {
  OrchestrationV2Subagent,
  OrchestrationV2ThreadShell,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue, resolveSelectableModel } from "@t3tools/shared/model";

import { getTraitsSpeedDisplay, TraitsSpeedIcon } from "./TraitsSpeed";

/**
 * An agent's model as the catalog names it, with the effort and speed it was started with.
 * Those come from the agent's own selection, or its thread's for an app-owned agent, and only
 * when that selection is for the model it reports running.
 */
export function SubagentModelLabel(props: {
  model: string | null;
  providerInstanceId: ProviderInstanceId;
  origin: OrchestrationV2Subagent["origin"] | null;
  modelSelection: OrchestrationV2Subagent["modelSelection"] | undefined;
  childThread: Pick<OrchestrationV2ThreadShell, "modelSelection"> | null;
  provider: ServerProvider | undefined;
}) {
  const { provider } = props;
  const { modelLabel } = resolveSubagentMetadata({ model: props.model, provider });
  const model = props.model?.trim();
  const modelSlug = provider
    ? resolveSelectableModel(provider.driver, model, provider.models)
    : model;
  const providerModel = provider?.models.find((candidate) => candidate.slug === modelSlug);
  const childSelection =
    props.modelSelection ??
    (props.origin === "app_owned" ? props.childThread?.modelSelection : undefined);
  const childModel = provider
    ? (resolveSelectableModel(provider.driver, childSelection?.model, provider.models) ??
      childSelection?.model.trim())
    : childSelection?.model.trim();
  const matchingSelection =
    childModel === (modelSlug ?? model) && childSelection?.instanceId === props.providerInstanceId
      ? childSelection
      : undefined;
  const effort = REASONING_EFFORT_OPTION_IDS.map((id) =>
    getModelSelectionStringOptionValue(matchingSelection, id),
  ).find(Boolean);
  const speed = provider
    ? providerModel?.capabilities?.optionDescriptors
        ?.map((descriptor) => {
          const saved = matchingSelection?.options?.find((option) => option.id === descriptor.id);
          if (
            descriptor.id === "fastMode" &&
            descriptor.type === "boolean" &&
            typeof saved?.value === "boolean"
          ) {
            return getTraitsSpeedDisplay(provider.driver, {
              ...descriptor,
              currentValue: saved.value,
            });
          }
          if (
            provider.driver === "codex" &&
            descriptor.id === "serviceTier" &&
            descriptor.type === "select" &&
            typeof saved?.value === "string" &&
            descriptor.options.some((option) => option.id === saved.value)
          ) {
            return getTraitsSpeedDisplay(provider.driver, {
              ...descriptor,
              currentValue: saved.value,
            });
          }
          return null;
        })
        .find(Boolean)
    : undefined;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="min-w-0 truncate">{modelLabel}</span>
      {effort || speed?.speedIcon ? (
        <span className="inline-flex shrink-0 items-center gap-1">
          {effort ? " · " : null}
          {speed?.speedIcon && provider ? (
            <TraitsSpeedIcon provider={provider.driver} speedIcon={speed.speedIcon} size="xs" />
          ) : null}
          {effort}
        </span>
      ) : null}
    </span>
  );
}
