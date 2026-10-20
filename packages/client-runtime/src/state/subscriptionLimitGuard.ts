import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import { getModelSelectionBooleanOptionValue } from "@t3tools/shared/model";

const SUBSCRIPTION_LIMIT_OPTION_ID = "stopAtSubscriptionLimit";

export interface ThreadSubscriptionLimitGuard {
  readonly enabled: boolean;
  /** The environment's setting stops every thread, whatever this thread's option says. */
  readonly enforcedByApp: boolean;
}

/** A thread's Stop at subscription limit state, or null where its provider does not offer it. */
export function resolveThreadSubscriptionLimitGuard(input: {
  readonly provider: ServerProvider | undefined;
  readonly selection: ModelSelection;
  readonly appSettingEnabled: boolean;
}): ThreadSubscriptionLimitGuard | null {
  const offered =
    input.provider?.models.some((model) =>
      model.capabilities?.optionDescriptors?.some(
        (option) => option.id === SUBSCRIPTION_LIMIT_OPTION_ID,
      ),
    ) === true;
  if (!offered) return null;
  return {
    enabled:
      getModelSelectionBooleanOptionValue(input.selection, SUBSCRIPTION_LIMIT_OPTION_ID) === true,
    enforcedByApp: input.appSettingEnabled,
  };
}

export function withSubscriptionLimitOption(
  selection: ModelSelection,
  enabled: boolean,
): ModelSelection {
  return {
    ...selection,
    options: [
      ...(selection.options ?? []).filter((option) => option.id !== SUBSCRIPTION_LIMIT_OPTION_ID),
      { id: SUBSCRIPTION_LIMIT_OPTION_ID, value: enabled },
    ],
  };
}
