import { SourceTabs } from "./SourceTabs";
import { LinkedObjectLinkPreview } from "./LinkedObjectLinkPreview";
import { GoogleIcon, GoogleSourceIcon } from "../Icons";
import { useAtomValue } from "@effect/atom-react";
import { googleFileContextRecord } from "@t3tools/client-runtime/state/google";
import type { ScopedThreadRef, GoogleFileSummary } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useState } from "react";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useIssueContextStore } from "~/issueContextStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { googleEnvironment } from "~/state/google";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { toastManager } from "../ui/toast";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { Button } from "../ui/button";
import {
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";
import { useComposerAttachRedirect } from "./composerAttachRedirect";
type GoogleFilePickerMode = "attach" | "link";
/** The thread the picker acts on, and whether picking attaches the page or links it. */
const pickerThread = Atom.make<{
  readonly threadRef: ScopedThreadRef;
  readonly mode: GoogleFilePickerMode;
} | null>(null).pipe(Atom.keepAlive, Atom.withLabel("google:page-picker-thread"));
export function openGoogleFilePicker(
  threadRef: ScopedThreadRef,
  mode: GoogleFilePickerMode = "attach",
) {
  appAtomRegistry.set(pickerThread, { threadRef, mode });
}
const closePicker = () => appAtomRegistry.set(pickerThread, null);
export function useAttachGoogleFile() {
  const getFile = useAtomCommand(googleEnvironment.getFile);
  return async (threadRef: ScopedThreadRef, id: string) => {
    const result = await getFile({ environmentId: threadRef.environmentId, input: { id } });
    if (result._tag === "Failure") return false;
    const record = googleFileContextRecord(result.value);
    useIssueContextStore.getState().upsert(threadRef.threadId, record);
    useComposerDraftStore.getState().insertContextReference(threadRef, {
      kind: record.kind,
      contextId: record.contextId,
      label: record.label,
    });
    return true;
  };
}
/** Links a page to the thread's tab group, replacing the one it had. */
function useLinkGoogleFile() {
  const linkThread = useAtomCommand(googleEnvironment.linkThread, { reportFailure: false });
  return async (threadRef: ScopedThreadRef, fileId: string): Promise<boolean> => {
    const result = await linkThread({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, fileId },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not link the Google file or event",
          description: failure instanceof Error ? failure.message : undefined,
        });
      }
      return false;
    }
    return true;
  };
}
export function GoogleFilePickerHost() {
  const target = useAtomValue(pickerThread);
  return target === null ? null : (
    <GoogleFilePickerDialog threadRef={target.threadRef} mode={target.mode} />
  );
}
function GoogleFilePickerDialog({
  threadRef,
  mode,
}: {
  threadRef: ScopedThreadRef;
  mode: GoogleFilePickerMode;
}) {
  const googleEnabled = useEnvironmentSettings(
    threadRef.environmentId,
    (s) => s.enableGoogleIntegration,
  );
  const navigate = useNavigate();
  const attachPage = useAttachGoogleFile();
  const redirect = useComposerAttachRedirect();
  const linkPage = useLinkGoogleFile();
  const [source, setSource] = useState<"drive" | "calendar">("drive");
  const [query, setQuery] = useState("");
  const [attaching, setAttaching] = useState(false);
  const settled = useDebouncedValue(query.trim(), 400);
  const connection = useEnvironmentQuery(
    googleEnabled
      ? googleEnvironment.connection({ environmentId: threadRef.environmentId, input: {} })
      : null,
  );
  const connected = connection.data?.phase === "connected";
  const result = useEnvironmentQuery(
    connected
      ? googleEnvironment.files({
          environmentId: threadRef.environmentId,
          input: { query: settled, source },
        })
      : null,
  );
  const files = result.data?.files ?? [];
  const status =
    connection.error ??
    result.error ??
    (connection.data === null
      ? "Reading Google status…"
      : result.isPending || settled !== query.trim()
        ? "Searching Google…"
        : files.length === 0
          ? "No matching files or events. Search by title or paste a Google link."
          : null);
  if (!googleEnabled) return null;
  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) closePicker();
      }}
    >
      <CommandDialogPopup
        aria-label={mode === "link" ? "Link Google file or event" : "Attach Google file or event"}
        className="overflow-hidden"
      >
        {connected || connection.data === null ? (
          <CommandPaletteContent
            inputProps={{
              placeholder: "Search Google Drive files and Calendar events or paste a document link",
              startAddon: <GoogleIcon />,
            }}
            footerActionLabel={
              mode === "link"
                ? attaching
                  ? "Linking…"
                  : "Link document"
                : attaching
                  ? "Attaching…"
                  : "Attach document"
            }
            mode="none"
            value={query}
            onValueChange={setQuery}
          >
            <SourceTabs
              className="flex gap-1 px-3 py-2"
              options={[
                { id: "drive", label: "Drive" },
                { id: "calendar", label: "Calendar" },
              ]}
              activeId={source}
              onSelect={setSource}
            />
            {status ? (
              <div className="py-10 text-center text-muted-foreground text-sm">{status}</div>
            ) : (
              <CommandList>
                <CommandGroup items={[...files]}>
                  <CommandCollection>
                    {(page: GoogleFileSummary) => (
                      <CommandItem
                        key={page.id}
                        value={page.id}
                        disabled={attaching}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={async () => {
                          if (attaching) return;
                          if (redirect) {
                            redirect({ type: "google-file", fileId: page.url, label: page.title });
                            closePicker();
                            return;
                          }
                          setAttaching(true);
                          const pick = mode === "link" ? linkPage : attachPage;
                          const picked = await settlePromise(() => pick(threadRef, page.url));
                          setAttaching(false);
                          if (picked._tag === "Success" && picked.value) closePicker();
                        }}
                      >
                        <GoogleSourceIcon
                          fileType={page.fileType}
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <LinkedObjectLinkPreview
                          environmentId={threadRef.environmentId}
                          threadRef={threadRef}
                          objectLink={{ kind: "google-file", fileId: page.id, url: page.url }}
                          link={<span className="min-w-0 flex-1 truncate">{page.title}</span>}
                        />
                      </CommandItem>
                    )}
                  </CommandCollection>
                </CommandGroup>
              </CommandList>
            )}
            {result.data?.hasMore ? (
              <p className="px-4 py-2 text-xs text-muted-foreground">
                Showing the first 30 files. Search by title to narrow the results.
              </p>
            ) : null}
          </CommandPaletteContent>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm">
            <p className="text-muted-foreground">
              {mode === "link"
                ? "Connect Google to link a Drive file or Calendar event."
                : "Connect Google to attach Drive files and Calendar events."}
            </p>
            <Button
              size="sm"
              onClick={() => {
                closePicker();
                void navigate({ to: "/settings/integrations" });
              }}
            >
              Connect Google
            </Button>
          </div>
        )}
      </CommandDialogPopup>
    </CommandDialog>
  );
}
