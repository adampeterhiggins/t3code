import { ContextMenu } from "@base-ui/react/context-menu";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { discordThreadContextRecord } from "@t3tools/source-control-definitions/integrationContextRecords";
import type {
  DiscordGetThreadInput,
  DiscordMessageSummary,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useIssueContextStore } from "~/issueContextStore";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { discordEnvironment } from "~/state/discord";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { DiscordIcon } from "../Icons";
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
import { useComposerAttachRedirect } from "./composerAttachRedirect";

// Each search reads every server the bot is in, so typing settles before a search goes out.
const SEARCH_DEBOUNCE_MS = 400;
const EMPTY_MESSAGES: ReadonlyArray<DiscordMessageSummary> = [];

type DiscordMessagePickerMode = "attach" | "link";

/**
 * The thread the picker acts on and what picking does: attach the message to that thread's
 * composer, or link its Discord thread to the thread's tab group. Set by whichever entry point
 * asked (the attach menu, the thread menu, the command palette) and rendered once at the app
 * root, so the picker outlives a palette that closes the moment its command runs.
 */
const discordMessagePickerThreadAtom = Atom.make<{
  readonly threadRef: ScopedThreadRef;
  readonly mode: DiscordMessagePickerMode;
} | null>(null).pipe(Atom.keepAlive, Atom.withLabel("discord:message-picker-thread"));

export function openDiscordMessagePicker(
  threadRef: ScopedThreadRef,
  mode: DiscordMessagePickerMode = "attach",
): void {
  appAtomRegistry.set(discordMessagePickerThreadAtom, { threadRef, mode });
}

function closeDiscordMessagePicker(): void {
  appAtomRegistry.set(discordMessagePickerThreadAtom, null);
}

/** What to fetch for a search result: its whole thread, or the message alone. */
export function discordGetThreadInput(
  message: DiscordMessageSummary,
  scope: DiscordGetThreadInput["scope"],
): DiscordGetThreadInput {
  return {
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.messageId,
    url: message.url,
    scope,
  };
}

/**
 * Fetches a Discord thread (or one message) and drops its chip into the thread's composer. It is
 * snapshotted now, so the message keeps what the agent saw even if the thread moves on.
 */
export function useAttachDiscordMessage() {
  const getThread = useAtomCommand(discordEnvironment.getThread, { reportFailure: false });
  return async (threadRef: ScopedThreadRef, input: DiscordGetThreadInput): Promise<boolean> => {
    const result = await getThread({ environmentId: threadRef.environmentId, input });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not attach the Discord message",
          description: failure instanceof Error ? failure.message : undefined,
        });
      }
      return false;
    }
    const record = discordThreadContextRecord(result.value);
    useIssueContextStore.getState().upsert(threadRef.threadId, record);
    useComposerDraftStore.getState().insertContextReference(threadRef, {
      kind: "discord-thread",
      contextId: record.contextId,
      label: record.label,
    });
    return true;
  };
}

/** Links the Discord thread a message belongs to (or starts) to the thread's tab group. */
export function useLinkDiscordThread() {
  const linkThread = useAtomCommand(discordEnvironment.linkThread, { reportFailure: false });
  return async (threadRef: ScopedThreadRef, message: DiscordMessageSummary): Promise<boolean> => {
    const result = await linkThread({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.messageId,
        url: message.url,
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not link the Discord thread",
          description: failure instanceof Error ? failure.message : undefined,
        });
      }
      return false;
    }
    return true;
  };
}

/** A search result row. Fixed widths so channels and times line up down the list. */
export function DiscordMessageRow(props: { message: DiscordMessageSummary }) {
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
      <span className="w-16 shrink-0 truncate text-end text-muted-foreground/70 text-xs">
        {formatRelativeTimeLabel(message.postedAt)}
      </span>
    </span>
  );
}

/** Mounted once at the app root; shows the picker for whichever thread asked for it. */
export function DiscordMessagePickerHost() {
  const target = useAtomValue(discordMessagePickerThreadAtom);
  if (target === null) return null;
  return <DiscordMessagePickerDialog threadRef={target.threadRef} mode={target.mode} />;
}

function DiscordMessagePickerDialog(props: {
  threadRef: ScopedThreadRef;
  mode: DiscordMessagePickerMode;
}) {
  const { threadRef, mode } = props;
  const environmentId = threadRef.environmentId;
  const discordEnabled = useEnvironmentSettings(environmentId, (s) => s.enableDiscordIntegration);
  const navigate = useNavigate();
  const attachMessage = useAttachDiscordMessage();
  const redirect = useComposerAttachRedirect();
  const linkThread = useLinkDiscordThread();
  const [query, setQuery] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [menuMessage, setMenuMessage] = useState<DiscordMessageSummary | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const connection = useEnvironmentQuery(
    discordEnabled ? discordEnvironment.connection({ environmentId, input: {} }) : null,
  );
  const connected = connection.data?.phase === "connected";
  const messagesQuery = useEnvironmentQuery(
    discordEnabled && connected && debouncedQuery.length > 0
      ? discordEnvironment.messages({ environmentId, input: { query: debouncedQuery } })
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

  async function select(message: DiscordMessageSummary, scope: DiscordGetThreadInput["scope"]) {
    if (!discordEnabled) return;
    if (attaching) return;
    if (redirect) {
      redirect({
        type: "discord-message",
        input: discordGetThreadInput(message, scope),
        label: `${message.channelLabel} · ${message.authorName}`,
      });
      closeDiscordMessagePicker();
      return;
    }
    setAttaching(true);
    const done =
      mode === "link"
        ? await linkThread(threadRef, message)
        : await attachMessage(threadRef, discordGetThreadInput(message, scope));
    setAttaching(false);
    if (done) closeDiscordMessagePicker();
  }

  const status =
    connection.data === null
      ? "Reading Discord status…"
      : query.trim().length === 0
        ? "Search messages in every server the bot is in."
        : messagesQuery.error !== null && messages.length === 0
          ? messagesQuery.error
          : messages.length === 0
            ? searching
              ? "Searching Discord…"
              : "No messages match."
            : null;

  if (!discordEnabled) return null;
  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) closeDiscordMessagePicker();
      }}
    >
      <CommandDialogPopup
        aria-label={mode === "link" ? "Link Discord thread" : "Attach Discord message"}
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
                  ? target.closest("[data-discord-url]")?.getAttribute("data-discord-url")
                  : null;
              setMenuMessage(messages.find((message) => message.url === url) ?? null);
            }}
          >
            <CommandPaletteContent
              inputProps={{
                placeholder: "Search Discord messages",
                startAddon: <DiscordIcon />,
              }}
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
                    <CommandCollection>
                      {(message: DiscordMessageSummary) => (
                        <CommandItem
                          key={message.url}
                          value={message.url}
                          data-discord-url={message.url}
                          disabled={attaching}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => void select(message, "thread")}
                        >
                          <DiscordMessageRow message={message} />
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
                ? "Connect Discord to link a thread. T3 Code reads it through your bot and never posts."
                : "Connect Discord to attach messages. T3 Code reads them through your bot and never posts."}
            </p>
            <Button
              size="sm"
              onClick={() => {
                closeDiscordMessagePicker();
                void navigate({ to: "/settings/integrations" });
              }}
            >
              Connect Discord
            </Button>
          </div>
        )}
      </CommandDialogPopup>
    </CommandDialog>
  );
}
