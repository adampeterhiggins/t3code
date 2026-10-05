import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { loadFullThreadSnapshot } from "@t3tools/client-runtime/state/threads";
import type {
  OrchestrationV2ThreadProjection,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { CopyIcon, DownloadIcon } from "lucide-react";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { runtime } from "~/lib/runtime";
import { saveMarkdownFile, showSavedFileInFolder } from "~/lib/saveTextFile";
import {
  buildThreadTranscript,
  transcriptFileName,
  type TranscriptDetail,
} from "~/lib/threadTranscript";
import { isMacPlatform, isWindowsPlatform } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useProject } from "~/state/entities";
import { readPreparedConnection } from "~/state/session";
import { useThreadTabGroup } from "./chat/ThreadTabs";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Spinner } from "./ui/spinner";
import { Switch } from "./ui/switch";
import { toastManager } from "./ui/toast";
import { Toggle, ToggleGroup } from "./ui/toggle-group";

/** Long threads export in full; the preview only needs to show the shape. */
const PREVIEW_MAX_CHARS = 20_000;

const transcriptExportThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("transcript-export:thread"),
);

/** Opens the export dialog for a thread, from any menu, palette, or tab. */
export function openTranscriptExportDialog(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(transcriptExportThreadAtom, threadRef);
}

function closeTranscriptExportDialog() {
  appAtomRegistry.set(transcriptExportThreadAtom, null);
}

// The last choices, so repeat exports skip the setup.
let lastOptions: { detail: TranscriptDetail; includeHeader: boolean } = {
  detail: "concise",
  includeHeader: true,
};

export function TranscriptExportDialogHost() {
  const threadRef = useAtomValue(transcriptExportThreadAtom);
  if (threadRef === null) return null;
  return (
    <TranscriptExportDialog
      key={`${threadRef.environmentId}:${threadRef.threadId}`}
      threadRef={threadRef}
    />
  );
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly projection: OrchestrationV2ThreadProjection }
  | { readonly status: "failed"; readonly message: string };

/** Full snapshots by thread, loaded on first view so switching tabs back is instant. */
function useFullThread(threadRef: ScopedThreadRef): LoadState {
  const [loaded, setLoaded] = useState<ReadonlyMap<ThreadId, LoadState>>(() => new Map());
  const requested = useRef(new Set<ThreadId>());
  const connected = readPreparedConnection(threadRef.environmentId) !== null;
  useEffect(() => {
    const prepared = readPreparedConnection(threadRef.environmentId);
    const { threadId } = threadRef;
    if (prepared === null || requested.current.has(threadId)) return;
    requested.current.add(threadId);
    const settle = (state: LoadState) =>
      setLoaded((previous) => new Map(previous).set(threadId, state));
    void runtime.runPromise(loadFullThreadSnapshot(prepared, threadId)).then(
      (snapshot) => settle({ status: "ready", projection: snapshot.projection }),
      (error: unknown) =>
        settle({
          status: "failed",
          message: error instanceof Error ? error.message : "Could not load this thread.",
        }),
    );
  }, [threadRef]);
  if (!connected) {
    return { status: "failed", message: "This thread's environment is not connected." };
  }
  return loaded.get(threadRef.threadId) ?? { status: "loading" };
}

function revealLabel(): string {
  if (isMacPlatform(navigator.platform)) return "Reveal in Finder";
  if (isWindowsPlatform(navigator.platform)) return "Reveal in File Explorer";
  return "Reveal in Files";
}

function formatTokenEstimate(characters: number): string {
  // ~4 characters per token is close enough to size a paste.
  const tokens = Math.round(characters / 4);
  return tokens < 1000 ? `~${tokens} tokens` : `~${(tokens / 1000).toFixed(1)}k tokens`;
}

function TranscriptExportDialog({ threadRef: openedRef }: { threadRef: ScopedThreadRef }) {
  const { environmentId } = openedRef;
  // A thread with sibling chat tabs can export any of them; it starts on the one it was opened from.
  const tabGroup = useThreadTabGroup(environmentId, openedRef.threadId);
  const tabs = tabGroup && tabGroup.tabs.length > 1 ? tabGroup.tabs : null;
  const [selectedThreadId, setSelectedThreadId] = useState(openedRef.threadId);
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, selectedThreadId),
    [environmentId, selectedThreadId],
  );
  const load = useFullThread(threadRef);
  const projection = load.status === "ready" ? load.projection : null;
  const thread = projection?.thread ?? null;
  const project = useProject(
    thread ? scopeProjectRef(threadRef.environmentId, thread.projectId) : null,
  );
  const [detail, setDetail] = useState(lastOptions.detail);
  const [includeHeader, setIncludeHeader] = useState(lastOptions.includeHeader);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    lastOptions = { detail, includeHeader };
  }, [detail, includeHeader]);

  const transcript = useMemo(
    () =>
      projection
        ? buildThreadTranscript({
            projection,
            projectTitle: project?.title ?? null,
            detail,
            includeHeader,
            exportedAt: new Date(),
          })
        : null,
    [projection, project?.title, detail, includeHeader],
  );
  const title =
    thread?.title ?? tabs?.find((tab) => tab.threadId === selectedThreadId)?.title ?? null;
  const fileName = thread ? transcriptFileName(thread.title) : null;

  const { copyToClipboard } = useCopyToClipboard({
    target: "transcript",
    onCopy: () => {
      closeTranscriptExportDialog();
      toastManager.add({ type: "success", title: "Transcript copied" });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not copy transcript",
        description: error.message,
      });
    },
  });

  const save = async () => {
    if (!transcript || !fileName || saving) return;
    setSaving(true);
    try {
      const saved = await saveMarkdownFile(fileName, transcript.markdown);
      if (saved === null) return;
      closeTranscriptExportDialog();
      toastManager.add(
        saved.kind === "path"
          ? {
              type: "success",
              title: "Transcript saved",
              description: saved.path,
              actionProps: {
                children: revealLabel(),
                onClick: () => showSavedFileInFolder(saved.path),
              },
            }
          : { type: "success", title: "Transcript saved", description: saved.fileName },
      );
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not save transcript",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setSaving(false);
    }
  };

  const stats = transcript
    ? [
        `${transcript.messageCount} ${transcript.messageCount === 1 ? "message" : "messages"}`,
        ...(detail === "full"
          ? [
              `${transcript.toolCallCount} ${transcript.toolCallCount === 1 ? "tool call" : "tool calls"}`,
            ]
          : []),
        formatTokenEstimate(transcript.markdown.length),
      ].join(" · ")
    : null;
  const preview =
    transcript && transcript.markdown.length > PREVIEW_MAX_CHARS
      ? `${transcript.markdown.slice(0, PREVIEW_MAX_CHARS)}…`
      : transcript?.markdown;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeTranscriptExportDialog();
      }}
    >
      <DialogPopup className="sm:max-w-2xl">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>Export transcript</DialogTitle>
            <DialogDescription>
              <span className="block truncate">
                {[title, project?.title].filter(Boolean).join(" · ") || "Loading thread…"}
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="overflow-hidden rounded-xl border bg-background">
              <div className="flex items-center gap-3 border-b p-2">
                {tabs ? (
                  <Select
                    value={selectedThreadId}
                    items={Object.fromEntries(tabs.map((tab) => [tab.threadId, tab.title]))}
                    onValueChange={(value) => {
                      const tab = tabs.find((candidate) => candidate.threadId === value);
                      if (tab) setSelectedThreadId(tab.threadId);
                    }}
                  >
                    <SelectTrigger
                      size="compact"
                      aria-label="Tab to export"
                      className="w-auto min-w-0 max-w-56"
                    >
                      <span className="min-w-0 truncate">
                        <SelectValue />
                      </span>
                    </SelectTrigger>
                    <SelectPopup>
                      {tabs.map((tab) => (
                        <SelectItem key={tab.threadId} value={tab.threadId}>
                          {tab.title}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                ) : null}
                <ToggleGroup
                  aria-label="Transcript detail"
                  value={[detail]}
                  onValueChange={(next) => {
                    const value = next[0];
                    if (value === "concise" || value === "full") setDetail(value);
                  }}
                >
                  <Toggle value="concise">Concise</Toggle>
                  <Toggle value="full">Full</Toggle>
                </ToggleGroup>
                <label className="ms-auto flex cursor-pointer items-center gap-2 px-1 text-muted-foreground text-xs">
                  Header
                  <Switch size="sm" checked={includeHeader} onCheckedChange={setIncludeHeader} />
                </label>
              </div>
              {load.status === "ready" ? (
                <pre className="h-72 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-foreground/80 text-xs leading-relaxed">
                  {preview}
                </pre>
              ) : (
                <div className="flex h-72 items-center justify-center px-6 text-center text-muted-foreground text-sm">
                  {load.status === "loading" ? <Spinner size="md" tone="muted" /> : load.message}
                </div>
              )}
              <div className="flex items-center gap-3 border-t px-3 py-2 text-muted-foreground text-xs">
                <span className="min-w-0 truncate font-mono">{fileName}</span>
                <span className="ms-auto shrink-0">{stats}</span>
              </div>
            </div>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button
              type="button"
              variant="outline"
              disabled={!transcript}
              onClick={() => {
                if (transcript) copyToClipboard(transcript.markdown, undefined);
              }}
            >
              <CopyIcon />
              Copy
            </Button>
            <Button type="submit" disabled={!transcript || saving}>
              <DownloadIcon />
              Save…
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
