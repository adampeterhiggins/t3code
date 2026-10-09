import type { ModelSelection as CursorSdkModelSelection, ModelParameterValue } from "@cursor/sdk";
import type { ModelSelection, ProviderOptionDescriptor } from "@t3tools/contracts";
import { getProviderOptionCurrentValue } from "@t3tools/shared/model";

const CURSOR_SDK_PARAMETER_TO_PROVIDER_OPTION: Readonly<Record<string, string>> = {
  context: "contextWindow",
  fast: "fastMode",
};

const PROVIDER_OPTION_TO_CURSOR_SDK_PARAMETER: Readonly<Record<string, string>> = {
  contextWindow: "context",
  fastMode: "fast",
};

export function cursorSdkProviderOptionId(parameterId: string): string {
  return CURSOR_SDK_PARAMETER_TO_PROVIDER_OPTION[parameterId] ?? parameterId;
}

function cursorSdkParameterId(providerOptionId: string): string {
  return PROVIDER_OPTION_TO_CURSOR_SDK_PARAMETER[providerOptionId] ?? providerOptionId;
}

export function cursorSdkParameterPriority(parameterId: string): number {
  switch (parameterId) {
    case "effort":
    case "reasoning":
      return 0;
    case "context":
      return 1;
    case "fast":
      return 2;
    case "thinking":
      return 3;
    default:
      return 4;
  }
}

export function cursorSdkModelSelection(modelSelection: ModelSelection): CursorSdkModelSelection {
  return {
    id: modelSelection.model === "auto" ? "default" : modelSelection.model,
    ...(modelSelection.options === undefined || modelSelection.options.length === 0
      ? {}
      : {
          params: modelSelection.options.map((option): ModelParameterValue => ({
            id: cursorSdkParameterId(option.id),
            value: String(option.value),
          })),
        }),
  };
}

/**
 * Fills the parameters a selection leaves out with the defaults the model
 * picker shows. Cursor resolves an omitted parameter to the model's standard
 * tier rather than its default variant, so an untouched composer, a delegated
 * task or a scheduled run would otherwise get a smaller context window than
 * the picker displays. Fast stays off unless chosen, as in the composer.
 */
export function withCursorDefaultParameters(
  selection: CursorSdkModelSelection,
  descriptors: ReadonlyArray<ProviderOptionDescriptor> | undefined,
): CursorSdkModelSelection {
  const params = selection.params ?? [];
  const present = new Set(params.map((parameter) => parameter.id));
  const defaults = (descriptors ?? []).flatMap((descriptor): Array<ModelParameterValue> => {
    const id = cursorSdkParameterId(descriptor.id);
    const value = descriptor.id === "fastMode" ? false : getProviderOptionCurrentValue(descriptor);
    return present.has(id) || value === undefined ? [] : [{ id, value: String(value) }];
  });
  return defaults.length === 0 ? selection : { ...selection, params: [...params, ...defaults] };
}
