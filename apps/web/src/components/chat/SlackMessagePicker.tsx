import { ContextMenu } from "@base-ui/react/context-menu";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { slackThreadContextRecord } from "@t3tools/client-runtime/state/slack";
import type { ScopedThreadRef, SlackGetThreadInput, SlackMessageSummary } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useCallback, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useIssueContextStore } from "~/issueContextStore";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { slackEnvironment } from "~/state/slack";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { SlackIcon } from "../Icons";
import { Button } from "../ui/button";
import {
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";
import { MenuItem, MenuPopup } from "../ui/menu";
import { toastManager } from "../ui/toast";

// Slack search is rate-limited per minute, so typing settles before a search goes out.
const SEARCH_DEBOUNCE_MS = 400;
const EMPTY_MESSAGES: ReadonlyArray<SlackMessageSummary> = [];

/**
 * The thread whose composer the picker attaches to. Set by whichever entry point asked (the
 * attach menu, the command palette) and rendered once by the chat view, so the picker outlives a
 * palette that closes the moment its command runs.
 */
const slackMessagePickerThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("slack:message-picker-thread"),
);

export function openSlackMessagePicker(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(slackMessagePickerThreadAtom, threadRef);
}

function closeSlackMessagePicker(): void {
  appAtomRegistry.set(slackMessagePickerThreadAtom, null);
}

/** What to fetch for a search result: its whole thread, or the message alone. */
export function slackGetThreadInput(
  message: SlackMessageSummary,
  scope: SlackGetThreadInput["scope"],
): SlackGetThreadInput {
  return {
    channelId: message.channelId,
    ts: message.ts,
    ...(message.threadTs === null ? {} : { threadTs: message.threadTs }),
    url: message.url,
    scope,
  };
}

/**
 * Fetches a Slack thread (or one message) and drops its chip into the thread's composer. It is
 * snapshotted now, so the message keeps what the agent saw even if the thread moves on.
 */
export function useAttachSlackMessage() {
  const getThread = useAtomCommand(slackEnvironment.getThread, { reportFailure: false });
  return useCallback(
    async (threadRef: ScopedThreadRef, input: SlackGetThreadInput): Promise<boolean> => {
      const result = await getThread({ environmentId: threadRef.environmentId, input });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Could not attach the Slack message",
            description: failure instanceof Error ? failure.message : undefined,
          });
        }
        return false;
      }
      const record = slackThreadContextRecord(result.value);
      useIssueContextStore.getState().upsert(threadRef.threadId, record);
      useComposerDraftStore.getState().insertContextReference(threadRef, {
        kind: "slack-thread",
        contextId: record.contextId,
        label: record.label,
      });
      return true;
    },
    [getThread],
  );
}

/** A search result row. Fixed widths so channels and times line up down the list. */
export function SlackMessageRow(props: { message: SlackMessageSummary }) {
  const { message } = props;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="w-28 shrink-0 truncate text-muted-foreground text-xs">
        {message.channelLabel}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium text-foreground">{message.authorName}</span>
        <span className="text-muted-foreground"> · {message.text}</span>
      </span>
      {message.threadTs === null ? null : (
        <span className="shrink-0 text-muted-foreground/70 text-xs">in thread</span>
      )}
      <span className="w-16 shrink-0 truncate text-end text-muted-foreground/70 text-xs">
        {formatRelativeTimeLabel(message.postedAt)}
      </span>
    </span>
  );
}

/** Mounted once by the chat view; shows the picker for whichever thread asked for it. */
export function SlackMessagePickerHost() {
  const threadRef = useAtomValue(slackMessagePickerThreadAtom);
  if (threadRef === null) return null;
  return <SlackMessagePickerDialog threadRef={threadRef} />;
}

function SlackMessagePickerDialog(props: { threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const environmentId = threadRef.environmentId;
  const slackEnabled = useEnvironmentSettings(environmentId, (s) => s.enableSlackIntegration);
  const navigate = useNavigate();
  const attachMessage = useAttachSlackMessage();
  const [query, setQuery] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [menuMessage, setMenuMessage] = useState<SlackMessageSummary | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const connection = useEnvironmentQuery(
    slackEnabled ? slackEnvironment.connection({ environmentId, input: {} }) : null,
  );
  const connected = connection.data?.phase === "connected";
  const messagesQuery = useEnvironmentQuery(
    slackEnabled && connected && debouncedQuery.length > 0
      ? slackEnvironment.messages({ environmentId, input: { query: debouncedQuery } })
      : null,
  );
  // A new query starts from an empty atom; keep the last results on screen until it answers.
  const [shownMessages, setShownMessages] = useState(EMPTY_MESSAGES);
  const latestMessages = messagesQuery.data?.messages;
  if (latestMessages !== undefined && latestMessages !== shownMessages) {
    setShownMessages(latestMessages);
  }
  const messages = debouncedQuery.length === 0 ? EMPTY_MESSAGES : (latestMessages ?? shownMessages);
  const searching = messagesQuery.isPending || query.trim() !== debouncedQuery;

  async function select(message: SlackMessageSummary, scope: SlackGetThreadInput["scope"]) {
    if (!slackEnabled) return;
    if (attaching) return;
    setAttaching(true);
    const done = await attachMessage(threadRef, slackGetThreadInput(message, scope));
    setAttaching(false);
    if (done) closeSlackMessagePicker();
  }

  const status =
    connection.data === null
      ? "Reading Slack status…"
      : query.trim().length === 0
        ? "Search Slack. Try in:#channel, from:@name, or a phrase."
        : messagesQuery.error !== null && messages.length === 0
          ? messagesQuery.error
          : messages.length === 0
            ? searching
              ? "Searching Slack…"
              : "No messages match."
            : null;

  if (!slackEnabled) return null;
  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) closeSlackMessagePicker();
      }}
    >
      <CommandDialogPopup aria-label="Attach Slack message" className="overflow-hidden">
        {connected || connection.data === null ? (
          <ContextMenu.Root
            open={menuMessage !== null}
            onOpenChange={(open, details) => {
              // One menu serves every row, so it names whichever row was right-clicked.
              const target = details.event?.target;
              const url =
                open && target instanceof Element
                  ? target.closest("[data-slack-url]")?.getAttribute("data-slack-url")
                  : null;
              setMenuMessage(messages.find((message) => message.url === url) ?? null);
            }}
          >
            <CommandPaletteContent
              inputProps={{
                placeholder: "Search Slack messages",
                startAddon: <SlackIcon />,
              }}
              footerActionLabel={attaching ? "Attaching…" : "Attach thread"}
              mode="none"
              value={query}
              onValueChange={setQuery}
            >
              {status !== null ? (
                <div className="py-10 text-center text-muted-foreground text-sm">{status}</div>
              ) : (
                <ContextMenu.Trigger render={<CommandList />}>
                  <CommandGroup items={[...messages]}>
                    <CommandCollection>
                      {(message: SlackMessageSummary) => (
                        <CommandItem
                          key={message.url}
                          value={message.url}
                          data-slack-url={message.url}
                          disabled={attaching}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => void select(message, "thread")}
                        >
                          <SlackMessageRow message={message} />
                        </CommandItem>
                      )}
                    </CommandCollection>
                  </CommandGroup>
                </ContextMenu.Trigger>
              )}
            </CommandPaletteContent>
            <MenuPopup>
              {menuMessage === null ? null : (
                <>
                  <MenuItem onClick={() => void select(menuMessage, "thread")}>
                    Attach thread
                  </MenuItem>
                  <MenuItem onClick={() => void select(menuMessage, "message")}>
                    Attach only this message
                  </MenuItem>
                </>
              )}
            </MenuPopup>
          </ContextMenu.Root>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm">
            <p className="text-muted-foreground">
              Connect Slack to attach messages. T3 Code reads them as you and never posts.
            </p>
            <Button
              size="sm"
              onClick={() => {
                closeSlackMessagePicker();
                void navigate({ to: "/settings/integrations" });
              }}
            >
              Connect Slack
            </Button>
          </div>
        )}
      </CommandDialogPopup>
    </CommandDialog>
  );
}
