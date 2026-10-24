import { ContextMenu } from "@base-ui/react/context-menu";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { slackThreadContextRecord } from "@t3tools/source-control-definitions/integrationContextRecords";
import { parseComposerObjectLink } from "@t3tools/source-control-definitions/composerObjectLinks";
import type {
  EnvironmentId,
  ScopedThreadRef,
  SlackGetThreadInput,
  SlackMessageSummary,
  SlackSearchScope,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { AtSignIcon, HashIcon } from "lucide-react";
import { useState } from "react";

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
import { FilterPill } from "../FilterPill";
import { SlackIcon } from "../Icons";
import { Button } from "../ui/button";
import {
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
} from "../ui/command";
import { MenuItem, MenuPopup } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { useComposerAttachRedirect } from "./composerAttachRedirect";
import { CursorPreviewCard } from "./CursorPreviewCard";
import { isPreviewableObjectLink, LinkedObjectPreviewBody } from "./LinkedObjectLinkPreview";

// Slack search is rate-limited per minute, so typing settles before a search goes out.
const SEARCH_DEBOUNCE_MS = 400;
const EMPTY_MESSAGES: ReadonlyArray<SlackMessageSummary> = [];

type SlackMessagePickerMode = "attach" | "link";

/**
 * The thread the picker acts on and what picking does: attach the message to that thread's
 * composer, or link its Slack thread to the thread's tab group. Set by whichever entry point
 * asked (the attach menu, the thread menu, the command palette) and rendered once by the chat
 * view, so the picker outlives a palette that closes the moment its command runs.
 */
const slackMessagePickerThreadAtom = Atom.make<{
  readonly threadRef: ScopedThreadRef;
  readonly mode: SlackMessagePickerMode;
} | null>(null).pipe(Atom.keepAlive, Atom.withLabel("slack:message-picker-thread"));

export function openSlackMessagePicker(
  threadRef: ScopedThreadRef,
  mode: SlackMessagePickerMode = "attach",
): void {
  appAtomRegistry.set(slackMessagePickerThreadAtom, { threadRef, mode });
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
  return async (threadRef: ScopedThreadRef, input: SlackGetThreadInput): Promise<boolean> => {
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
  };
}

/** Links the Slack thread a message belongs to (or starts) to the thread's tab group. */
export function useLinkSlackThread() {
  const linkThread = useAtomCommand(slackEnvironment.linkThread, { reportFailure: false });
  return async (threadRef: ScopedThreadRef, message: SlackMessageSummary): Promise<boolean> => {
    const result = await linkThread({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        channelId: message.channelId,
        ts: message.ts,
        ...(message.threadTs === null ? {} : { threadTs: message.threadTs }),
        url: message.url,
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not link the Slack thread",
          description: failure instanceof Error ? failure.message : undefined,
        });
      }
      return false;
    }
    return true;
  };
}

/** A search result row. Fixed widths so channels, authors, and times line up down the list. */
function SlackMessageRow(props: { message: SlackMessageSummary }) {
  const { message } = props;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="w-28 shrink-0 truncate text-muted-foreground text-xs">
        {message.channelLabel}
      </span>
      <span className="w-20 shrink-0 truncate font-medium text-foreground text-sm">
        {message.authorName}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm">{message.text}</span>
      {message.threadTs === null ? null : (
        <span className="shrink-0 text-muted-foreground/70 text-xs">in thread</span>
      )}
      <span className="w-16 shrink-0 truncate text-end text-muted-foreground/70 text-xs">
        {formatRelativeTimeLabel(message.postedAt)}
      </span>
    </span>
  );
}

/** The row, with the same thread card a pasted link to the message shows on hover. */
function SlackMessageHoverPreview(props: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  message: SlackMessageSummary;
}) {
  const row = (
    <span className="flex min-w-0 flex-1">
      <SlackMessageRow message={props.message} />
    </span>
  );
  const objectLink = parseComposerObjectLink(props.message.url);
  if (!isPreviewableObjectLink(objectLink)) return row;
  return (
    <CursorPreviewCard trigger={row} bare>
      <div className="px-3 py-2">
        <LinkedObjectPreviewBody
          objectLink={objectLink}
          environmentId={props.environmentId}
          threadRef={props.threadRef}
        />
      </div>
    </CursorPreviewCard>
  );
}

function scopeLabel(scope: SlackSearchScope): string {
  return scope.kind === "channel" ? `in ${scope.label}` : `from ${scope.label}`;
}

function ScopeIcon(props: { scope: SlackSearchScope }) {
  return props.scope.kind === "channel" ? <HashIcon /> : <AtSignIcon />;
}

/** Mounted once at the app root; shows the picker for whichever thread asked for it. */
export function SlackMessagePickerHost() {
  const target = useAtomValue(slackMessagePickerThreadAtom);
  if (target === null) return null;
  return <SlackMessagePickerDialog threadRef={target.threadRef} mode={target.mode} />;
}

function SlackMessagePickerDialog(props: {
  threadRef: ScopedThreadRef;
  mode: SlackMessagePickerMode;
}) {
  const { threadRef, mode } = props;
  const environmentId = threadRef.environmentId;
  const slackEnabled = useEnvironmentSettings(environmentId, (s) => s.enableSlackIntegration);
  const navigate = useNavigate();
  const attachMessage = useAttachSlackMessage();
  const redirect = useComposerAttachRedirect();
  const linkThread = useLinkSlackThread();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SlackSearchScope | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [menuMessage, setMenuMessage] = useState<SlackMessageSummary | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const connection = useEnvironmentQuery(
    slackEnabled ? slackEnvironment.connection({ environmentId, input: {} }) : null,
  );
  const connected = connection.data?.phase === "connected";
  const suggestionsQuery = useEnvironmentQuery(
    slackEnabled && connected ? slackEnvironment.suggestions({ environmentId, input: {} }) : null,
  );
  const suggesting = scope === null && query.trim().length === 0;
  const searchQuery = [scope?.query ?? "", debouncedQuery].join(" ").trim();
  const messagesQuery = useEnvironmentQuery(
    slackEnabled && connected && searchQuery.length > 0
      ? slackEnvironment.messages({ environmentId, input: { query: searchQuery } })
      : null,
  );
  // A new query starts from an empty atom; keep the last results on screen until it answers.
  const [shownMessages, setShownMessages] = useState(EMPTY_MESSAGES);
  const latestMessages = messagesQuery.data?.messages;
  if (latestMessages !== undefined && latestMessages !== shownMessages) {
    setShownMessages(latestMessages);
  }
  const suggestedThreads = suggestionsQuery.data?.threads ?? EMPTY_MESSAGES;
  const messages = suggesting
    ? suggestedThreads
    : searchQuery.length === 0
      ? EMPTY_MESSAGES
      : (latestMessages ?? shownMessages);
  const scopes = suggestionsQuery.data?.scopes ?? [];
  const searching = messagesQuery.isPending || query.trim() !== debouncedQuery;

  async function select(message: SlackMessageSummary, scope: SlackGetThreadInput["scope"]) {
    if (!slackEnabled) return;
    if (attaching) return;
    if (redirect) {
      redirect({
        type: "slack-message",
        input: slackGetThreadInput(message, scope),
        label: `${message.channelLabel} · ${message.authorName}`,
      });
      closeSlackMessagePicker();
      return;
    }
    setAttaching(true);
    const done =
      mode === "link"
        ? await linkThread(threadRef, message)
        : await attachMessage(threadRef, slackGetThreadInput(message, scope));
    setAttaching(false);
    if (done) closeSlackMessagePicker();
  }

  const status =
    connection.data === null
      ? "Reading Slack status…"
      : suggesting
        ? suggestedThreads.length > 0
          ? null
          : suggestionsQuery.isPending
            ? "Loading suggestions…"
            : "Search Slack. Try in:#channel, from:@name, or a phrase."
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
      <CommandDialogPopup
        aria-label={mode === "link" ? "Link Slack thread" : "Attach Slack message"}
        className="overflow-hidden"
      >
        {connected || connection.data === null ? (
          <ContextMenu.Root
            open={menuMessage !== null}
            onOpenChange={(open, details) => {
              // One menu serves every row, so it names whichever row was right-clicked. Linking
              // always takes the whole thread, so it has no menu.
              const target = details.event?.target;
              const url =
                open && mode === "attach" && target instanceof Element
                  ? target.closest("[data-slack-url]")?.getAttribute("data-slack-url")
                  : null;
              setMenuMessage(messages.find((message) => message.url === url) ?? null);
            }}
          >
            <CommandPaletteContent
              inputProps={{
                placeholder:
                  scope === null ? "Search Slack messages" : `Search messages ${scopeLabel(scope)}`,
                startAddon: <SlackIcon />,
                onKeyDown: (event) => {
                  if (event.key === "Backspace" && query.length === 0 && scope !== null) {
                    event.preventDefault();
                    setScope(null);
                  }
                },
              }}
              inputAccessory={
                scope !== null ? (
                  <div className="flex px-3 pb-2">
                    <FilterPill
                      icon={<ScopeIcon scope={scope} />}
                      label={scope.kind === "channel" ? `In ${scope.label}` : `From ${scope.label}`}
                      onRemove={() => setScope(null)}
                    />
                  </div>
                ) : scopes.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
                    {scopes.map((option) => (
                      <Button
                        key={option.query}
                        type="button"
                        size="xs"
                        variant="outline"
                        // Keeps focus in the search box, so typing carries on after a click.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => setScope(option)}
                      >
                        <ScopeIcon scope={option} />
                        {option.label.slice(1)}
                      </Button>
                    ))}
                  </div>
                ) : null
              }
              footerActionLabel={
                mode === "link"
                  ? attaching
                    ? "Linking…"
                    : "Link thread"
                  : attaching
                    ? "Attaching…"
                    : "Attach thread"
              }
              mode="none"
              value={query}
              onValueChange={setQuery}
            >
              {status !== null ? (
                <div className="py-10 text-center text-muted-foreground text-sm">{status}</div>
              ) : (
                <ContextMenu.Trigger render={<CommandList />}>
                  <CommandGroup items={[...messages]}>
                    {suggesting ? (
                      <CommandGroupLabel>Threads you posted in</CommandGroupLabel>
                    ) : null}
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
                          <SlackMessageHoverPreview
                            environmentId={environmentId}
                            threadRef={threadRef}
                            message={message}
                          />
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
              {mode === "link"
                ? "Connect Slack to link a thread. T3 Code reads it as you and never posts."
                : "Connect Slack to attach messages. T3 Code reads them as you and never posts."}
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
