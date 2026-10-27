import { useRef, useState } from "react";
import type { ComponentProps } from "react";
import type { ChatComposerProps } from "./ChatComposer";
import { ComposerAttachMenu, openComposerAttachPicker } from "./ComposerAttachMenu";
import { ComposerModelChipPicker } from "./ComposerModelChipPicker";
import { attachModelToChat } from "./modelReferences";
import { useComposerCheckoutItems } from "./useComposerCheckoutItems";

export function useComposerAttachControls(
  input: Pick<
    ChatComposerProps,
    | "environmentId"
    | "routeThreadRef"
    | "pullRequestProjectId"
    | "githubIssueCwd"
    | "keybindings"
    | "terminalOpen"
    | "focusComposer"
  > & {
    showComposerAttachAction: boolean;
    addComposerAttachments: (files: File[]) => Promise<boolean>;
    selectedInstanceId: ComponentProps<typeof ComposerModelChipPicker>["activeInstanceId"];
    selectedModelForPickerWithCustomFallback: string;
    providerInstanceEntries: ComponentProps<typeof ComposerModelChipPicker>["instanceEntries"];
    modelOptionsByInstance: ComponentProps<
      typeof ComposerModelChipPicker
    >["modelOptionsByInstance"];
  },
) {
  const {
    environmentId,
    routeThreadRef,
    pullRequestProjectId,
    githubIssueCwd,
    keybindings,
    terminalOpen,
    focusComposer,
    showComposerAttachAction,
    addComposerAttachments,
    selectedInstanceId,
    selectedModelForPickerWithCustomFallback,
    providerInstanceEntries,
    modelOptionsByInstance,
  } = input;
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [isModelChipPickerOpen, setIsModelChipPickerOpen] = useState(false);
  const [attachMenuAnchor, setAttachMenuAnchor] = useState<HTMLSpanElement | null>(null);
  const attachCheckouts = useComposerCheckoutItems(environmentId, { enabled: true, query: "" });
  return showComposerAttachAction ? (
    <>
      <input
        ref={attachmentInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          // Inserting a chip refocuses the editor after the draft renders;
          // focusing synchronously here would report the editor's stale text
          // over the prompt that was just written.
          void addComposerAttachments(files).then((inserted) => {
            if (!inserted) focusComposer();
          });
        }}
      />
      <span ref={setAttachMenuAnchor} className="inline-flex">
        <ComposerAttachMenu
          environmentId={environmentId}
          pullRequestsAvailable={pullRequestProjectId !== null}
          githubIssuesAvailable={githubIssueCwd !== null}
          checkoutsAvailable={attachCheckouts.hasLocalCandidates}
          onAttachFiles={() => attachmentInputRef.current?.click()}
          onPick={(picker) => openComposerAttachPicker(picker, routeThreadRef)}
          onPickModel={() => setIsModelChipPickerOpen(true)}
        />
      </span>
      <ComposerModelChipPicker
        open={isModelChipPickerOpen}
        onOpenChange={setIsModelChipPickerOpen}
        anchor={attachMenuAnchor}
        environmentId={environmentId}
        activeInstanceId={selectedInstanceId}
        model={selectedModelForPickerWithCustomFallback}
        instanceEntries={providerInstanceEntries}
        modelOptionsByInstance={modelOptionsByInstance}
        keybindings={keybindings}
        terminalOpen={terminalOpen}
        onPick={(instanceId, model) => {
          const entry = providerInstanceEntries.find(
            (candidate) => candidate.instanceId === instanceId,
          );
          if (!entry) return;
          const option = modelOptionsByInstance
            .get(instanceId)
            ?.find((candidate) => candidate.slug === model);
          attachModelToChat(routeThreadRef, {
            entry,
            slug: model,
            name: option?.name ?? model,
          });
        }}
      />
    </>
  ) : null;
}
