import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { MessageSquareIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useProjects, useServerConfigs, useThreadShells } from "~/state/entities";
import { deriveProviderInstanceEntries } from "~/providerInstances";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { ThreadTabSummaryDetails } from "../contextChipParts";
import {
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";
import { toastManager } from "../ui/toast";
import {
  composerThreadReferenceItems,
  DEFAULT_THREAD_ATTACH_PICKER_VIEW,
} from "./composerThreadReferences";
import { CursorPreviewCard } from "./CursorPreviewCard";
import { ThreadAttachPickerFilterBar } from "./ThreadAttachPickerFilters";
import { createThreadAttachSummaryLoader } from "./threadAttachPickerSummary";
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
  const serverConfigs = useServerConfigs();
  const captureContext = useCaptureThreadTabContext(threadRef.environmentId, threadRef.threadId);
  const loadSummary = useMemo(
    () =>
      captureContext === null ? null : createThreadAttachSummaryLoader(captureContext.fetchSummary),
    [captureContext],
  );
  const [query, setQuery] = useState("");
  const [view, setView] = useState(DEFAULT_THREAD_ATTACH_PICKER_VIEW);
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
        view,
      }),
    [threads, projects, threadRef, query, view],
  );
  const filterOptions = useMemo(() => {
    const availableThreads = threads.filter(
      (thread) =>
        thread.environmentId === threadRef.environmentId &&
        thread.archivedAt === null &&
        thread.id !== threadRef.threadId,
    );
    const projectIds = new Set(availableThreads.map((thread) => thread.projectId));
    const providerLabels = new Map(
      deriveProviderInstanceEntries(
        serverConfigs.get(threadRef.environmentId)?.providers ?? [],
      ).map((provider) => [provider.instanceId, provider.displayName]),
    );
    const providers = new Map(
      availableThreads.map((thread) => [
        thread.modelSelection.instanceId,
        providerLabels.get(thread.modelSelection.instanceId) ??
          thread.session?.providerName ??
          thread.modelSelection.instanceId,
      ]),
    );
    return {
      projects: projects
        .filter(
          (project) =>
            project.environmentId === threadRef.environmentId && projectIds.has(project.id),
        )
        .map((project) => ({ value: project.id, label: project.title }))
        .toSorted((left, right) => left.label.localeCompare(right.label)),
      providers: [...providers]
        .map(([value, label]) => ({ value, label }))
        .toSorted((left, right) => left.label.localeCompare(right.label)),
    };
  }, [threads, projects, threadRef, serverConfigs]);

  async function select(entry: (typeof entries)[number]) {
    if (attachInFlight.current || captureContext === null || loadSummary === null) return;
    attachInFlight.current = true;
    setAttaching(true);
    try {
      const summary = await loadSummary(entry.threadId);
      const reference = await captureContext.capture(entry.threadId, entry.label, summary);
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
          inputAccessory={
            <ThreadAttachPickerFilterBar {...filterOptions} view={view} onChange={setView} />
          }
          mode="none"
          value={query}
          onValueChange={setQuery}
        >
          {entries.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              {query.trim() || view.projectIds.length > 0 || view.providerInstanceIds.length > 0
                ? "No threads match these filters."
                : "No other threads to attach."}
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
                      <CursorPreviewCard
                        trigger={
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate text-sm">{entry.label}</span>
                            <span className="max-w-40 shrink-0 truncate text-muted-foreground text-xs">
                              {entry.description}
                            </span>
                          </span>
                        }
                      >
                        <ThreadSummaryPreview
                          threadId={entry.threadId}
                          title={entry.label}
                          loadSummary={loadSummary}
                        />
                      </CursorPreviewCard>
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

function ThreadSummaryPreview(props: {
  threadId: ThreadId;
  title: string;
  loadSummary: ReturnType<typeof createThreadAttachSummaryLoader> | null;
}) {
  const { threadId, loadSummary } = props;
  const [preview, setPreview] = useState<{ summary: string } | { error: string } | null>(null);
  useEffect(() => {
    if (loadSummary === null) return;
    let active = true;
    loadSummary(threadId).then(
      (summary) => {
        if (active) setPreview({ summary });
      },
      (cause: unknown) => {
        if (active)
          setPreview({
            error: cause instanceof Error ? cause.message : "Could not summarize that thread.",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [threadId, loadSummary]);
  return (
    <div className="flex flex-col gap-2">
      <p className="truncate font-medium">{props.title}</p>
      {preview && "summary" in preview ? (
        <ThreadTabSummaryDetails summary={preview.summary} />
      ) : (
        <p className="text-muted-foreground">
          {preview && "error" in preview
            ? preview.error
            : loadSummary === null
              ? "Connect to preview this thread."
              : "Summarizing…"}
        </p>
      )}
    </div>
  );
}
