import { NotionIcon } from "../Icons";
import { useAtomValue } from "@effect/atom-react";
import { notionPageContextRecord } from "@t3tools/client-runtime/state/notion";
import type { ScopedThreadRef, NotionPageSummary } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useCallback, useState } from "react";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useIssueContextStore } from "~/issueContextStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { notionEnvironment } from "~/state/notion";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  isAtomCommandInterrupted,
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
type NotionPagePickerMode = "attach" | "link";
/** The thread the picker acts on, and whether picking attaches the page or links it. */
const pickerThread = Atom.make<{
  readonly threadRef: ScopedThreadRef;
  readonly mode: NotionPagePickerMode;
} | null>(null).pipe(Atom.keepAlive, Atom.withLabel("notion:page-picker-thread"));
export function openNotionPagePicker(
  threadRef: ScopedThreadRef,
  mode: NotionPagePickerMode = "attach",
) {
  appAtomRegistry.set(pickerThread, { threadRef, mode });
}
const closePicker = () => appAtomRegistry.set(pickerThread, null);
export function useAttachNotionPage() {
  const getPage = useAtomCommand(notionEnvironment.getPage);
  return useCallback(
    async (threadRef: ScopedThreadRef, id: string) => {
      const result = await getPage({ environmentId: threadRef.environmentId, input: { id } });
      if (result._tag === "Failure") return false;
      const record = notionPageContextRecord(result.value);
      useIssueContextStore.getState().upsert(threadRef.threadId, record);
      useComposerDraftStore.getState().insertContextReference(threadRef, {
        kind: record.kind,
        contextId: record.contextId,
        label: record.label,
      });
      return true;
    },
    [getPage],
  );
}
/** Links a page to the thread's tab group, replacing the one it had. */
export function useLinkNotionPage() {
  const linkThread = useAtomCommand(notionEnvironment.linkThread, { reportFailure: false });
  return useCallback(
    async (threadRef: ScopedThreadRef, pageId: string): Promise<boolean> => {
      const result = await linkThread({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, pageId },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Could not link the Notion page",
            description: failure instanceof Error ? failure.message : undefined,
          });
        }
        return false;
      }
      return true;
    },
    [linkThread],
  );
}
export function NotionPagePickerHost() {
  const target = useAtomValue(pickerThread);
  return target === null ? null : (
    <NotionPagePickerDialog threadRef={target.threadRef} mode={target.mode} />
  );
}
function NotionPagePickerDialog({
  threadRef,
  mode,
}: {
  threadRef: ScopedThreadRef;
  mode: NotionPagePickerMode;
}) {
  const notionEnabled = useEnvironmentSettings(
    threadRef.environmentId,
    (s) => s.enableNotionIntegration,
  );
  const navigate = useNavigate();
  const attachPage = useAttachNotionPage();
  const linkPage = useLinkNotionPage();
  const [query, setQuery] = useState("");
  const [attaching, setAttaching] = useState(false);
  const settled = useDebouncedValue(query.trim(), 400);
  const connection = useEnvironmentQuery(
    notionEnabled
      ? notionEnvironment.connection({ environmentId: threadRef.environmentId, input: {} })
      : null,
  );
  const connected = connection.data?.phase === "connected";
  const result = useEnvironmentQuery(
    connected
      ? notionEnvironment.pages({
          environmentId: threadRef.environmentId,
          input: { query: settled },
        })
      : null,
  );
  const pages = result.data?.pages ?? [];
  const status =
    connection.error ??
    result.error ??
    (connection.data === null
      ? "Reading Notion status…"
      : result.isPending || settled !== query.trim()
        ? "Searching Notion…"
        : pages.length === 0
          ? "No pages found. Share pages with the Notion connection to see them here."
          : null);
  if (!notionEnabled) return null;
  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) closePicker();
      }}
    >
      <CommandDialogPopup
        aria-label={mode === "link" ? "Link Notion page" : "Attach Notion page"}
        className="overflow-hidden"
      >
        {connected || connection.data === null ? (
          <CommandPaletteContent
            inputProps={{
              placeholder: "Search Notion pages or paste a page link",
              startAddon: <NotionIcon />,
            }}
            footerActionLabel={
              mode === "link"
                ? attaching
                  ? "Linking…"
                  : "Link page"
                : attaching
                  ? "Attaching…"
                  : "Attach page"
            }
            mode="none"
            value={query}
            onValueChange={setQuery}
          >
            {status ? (
              <div className="py-10 text-center text-muted-foreground text-sm">{status}</div>
            ) : (
              <CommandList>
                <CommandGroup items={[...pages]}>
                  <CommandCollection>
                    {(page: NotionPageSummary) => (
                      <CommandItem
                        key={page.id}
                        value={page.id}
                        disabled={attaching}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={async () => {
                          if (attaching) return;
                          setAttaching(true);
                          try {
                            const pick = mode === "link" ? linkPage : attachPage;
                            if (await pick(threadRef, page.id)) closePicker();
                          } finally {
                            setAttaching(false);
                          }
                        }}
                      >
                        {page.title}
                      </CommandItem>
                    )}
                  </CommandCollection>
                </CommandGroup>
              </CommandList>
            )}
            {result.data?.hasMore ? (
              <p className="px-4 py-2 text-xs text-muted-foreground">
                Showing the first 30 pages. Search by title to narrow the results.
              </p>
            ) : null}
          </CommandPaletteContent>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm">
            <p className="text-muted-foreground">
              {mode === "link"
                ? "Connect Notion to link a page selected during sign-in."
                : "Connect Notion to attach pages selected during sign-in."}
            </p>
            <Button
              size="sm"
              onClick={() => {
                closePicker();
                void navigate({ to: "/settings/integrations" });
              }}
            >
              Connect Notion
            </Button>
          </div>
        )}
      </CommandDialogPopup>
    </CommandDialog>
  );
}
