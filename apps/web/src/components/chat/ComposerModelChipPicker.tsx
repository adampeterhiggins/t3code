import { useRef } from "react";
import type {
  EnvironmentId,
  ProviderInstanceId,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";

import type { ModelEsque } from "./providerIconUtils";
import type { ProviderInstanceEntry } from "~/providerInstances";

import { Popover, PopoverPopup } from "../ui/popover";
import { useComposerMenuProps } from "./composerEventScope";
import { ModelPickerContent } from "./ModelPickerContent";

/**
 * Fork: the attach menu's model picker. The composer's own model picker panel, anchored to the
 * attach button; picking a model inserts a chip for it instead of switching the thread's model.
 */
export function ComposerModelChipPicker(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: Element | null;
  environmentId: EnvironmentId;
  activeInstanceId: ProviderInstanceId;
  model: string;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  keybindings: ResolvedKeybindingsConfig;
  terminalOpen: boolean;
  onPick: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const composerMenuProps = useComposerMenuProps();
  if (!props.open) return null;
  return (
    <Popover open onOpenChange={props.onOpenChange}>
      <PopoverPopup
        {...composerMenuProps}
        anchor={props.anchor}
        side="top"
        align="end"
        className="before:hidden"
        padding="none"
        initialFocus={searchInputRef}
        touchBackdrop
      >
        <ModelPickerContent
          searchInputRef={searchInputRef}
          environmentId={props.environmentId}
          activeInstanceId={props.activeInstanceId}
          model={props.model}
          lockedProvider={null}
          instanceEntries={props.instanceEntries}
          keybindings={props.keybindings}
          modelOptionsByInstance={props.modelOptionsByInstance}
          terminalOpen={props.terminalOpen}
          onRequestClose={() => props.onOpenChange(false)}
          onInstanceModelChange={(instanceId, model) => {
            props.onOpenChange(false);
            props.onPick(instanceId, model);
          }}
        />
      </PopoverPopup>
    </Popover>
  );
}
