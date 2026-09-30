import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { MessageSquareIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useProjects, useThreadShells } from "~/state/entities";
import { CommandPaletteContent } from "../CommandPaletteContent";
import {
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";
import { toastManager } from "../ui/toast";
import { composerThreadReferenceItems } from "./composerThreadReferences";
import { useCaptureThreadTabContext } from "./ThreadTabs";

const THREAD_PICKER_LIMIT = 50;

/** Keeps the destination draft stable while the attach menu or command palette closes. */
const threadAttachPickerTargetAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("chat:thread-attach-picker-target"),
);

export function openThreadAttachPicker(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(threadAttachPickerTargetAtom, threadRef);
}

function closeThreadAttachPicker(): void {
  appAtomRegistry.set(threadAttachPickerTargetAtom, null);
}

/** Mounted once by the chat view; summaries use the same capture path as `@` mentions. */
export function ThreadAttachPickerHost() {
  const threadRef = useAtomValue(threadAttachPickerTargetAtom);
  if (threadRef === null) return null;
  return (
    <ThreadAttachPickerDialog
      key={`${threadRef.environmentId}:${threadRef.threadId}`}
      threadRef={threadRef}
    />
  );
}

function ThreadAttachPickerDialog({ threadRef }: { threadRef: ScopedThreadRef }) {
  const threads = useThreadShells();
  const projects = useProjects();
  const captureContext = useCaptureThreadTabContext(threadRef.environmentId, threadRef.threadId);
  const [query, setQuery] = useState("");
  const [attaching, setAttaching] = useState(false);
  const attachInFlight = useRef(false);
  const entries = useMemo(
    () =>
      composerThreadReferenceItems({
        threads,
        projects,
        environmentId: threadRef.environmentId,
        excludeThreadIds: new Set([threadRef.threadId]),
        query,
        limit: THREAD_PICKER_LIMIT,
      }),
    [threads, projects, threadRef, query],
  );

  async function select(entry: (typeof entries)[number]) {
    if (attachInFlight.current || captureContext === null) return;
    attachInFlight.current = true;
    setAttaching(true);
    try {
      const reference = await captureContext.capture(entry.threadId, entry.label);
      useComposerDraftStore.getState().insertContextReference(threadRef, reference);
      // A dismissed picker may have been reopened for a different draft during capture.
      if (appAtomRegistry.get(threadAttachPickerTargetAtom) === threadRef) {
        closeThreadAttachPicker();
      }
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not attach that thread",
        description: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      attachInFlight.current = false;
      setAttaching(false);
    }
  }

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) closeThreadAttachPicker();
      }}
    >
      <CommandDialogPopup aria-label="Attach thread" className="overflow-hidden">
        <CommandPaletteContent
          inputProps={{ placeholder: "Search threads by title", startAddon: <MessageSquareIcon /> }}
          footerActionLabel={attaching ? "Attaching…" : "Attach"}
          mode="none"
          value={query}
          onValueChange={setQuery}
        >
          {entries.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              {query.trim() ? "No threads match this search." : "No other threads to attach."}
            </div>
          ) : (
            <CommandList>
              <CommandGroup items={entries}>
                <CommandCollection>
                  {(entry: (typeof entries)[number]) => (
                    <CommandItem
                      key={entry.id}
                      value={entry.id}
                      disabled={attaching || captureContext === null}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void select(entry)}
                    >
                      <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">{entry.label}</span>
                      <span className="max-w-40 shrink-0 truncate text-muted-foreground text-xs">
                        {entry.description}
                      </span>
                    </CommandItem>
                  )}
                </CommandCollection>
              </CommandGroup>
            </CommandList>
          )}
        </CommandPaletteContent>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
