import {
  createThreadTab,
  forkThreadTabFromRun,
  listThreadTabs,
  setThreadTabGroupName,
  subscribeThreadTabGroupNames,
  prepareThreadTabHandoff,
  type ThreadForkPoint,
} from "@t3tools/client-runtime/thread-tabs";
import {
  COMPOSER_CONTEXT_THREAD_TAB_SUMMARY_MAX_CHARS,
  AuthOrchestrationOperateScope,
  type ComposerContextId,
  type EnvironmentId,
  type ModelSelection,
  ThreadId,
  type ThreadTabContextRecord,
  type ThreadTabGroup,
} from "@t3tools/contracts";
import {
  formatComposerContextReference,
  sanitizeComposerContextLabel,
} from "@t3tools/shared/composerContextReferences";
import { useNavigation } from "@react-navigation/native";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

import { showTextInputDialog } from "../../components/ConfirmDialogHost";
import { SymbolView } from "../../components/AppSymbol";
import { ControlPillMenu } from "../../components/ControlPillMenu";
import { useLinearIssuePicker } from "../../components/LinearIssuePickerSheet";
import { buildModelOptions, groupByProvider, type ModelOption } from "../../lib/modelOptions";
import { runtime } from "../../lib/runtime";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentScope, usePreparedConnection } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  getComposerDraftSnapshot,
  insertComposerDraftContext,
  isComposerDraftEmpty,
} from "../../state/use-composer-drafts";
import { refreshArchivedThreadsForEnvironment } from "../archive/useArchivedThreadSnapshots";
import { ThreadGitHubIssueLinkChip, useThreadGitHubIssueLink } from "./ThreadGitHubIssueLink";
import {
  ThreadLinearLinkButton,
  ThreadLinearLinkChip,
  useThreadLinearLink,
} from "./ThreadLinearLink";
import { ThreadStartedByChip } from "./ThreadStartedByChip";

const NEW_TAB_ACTION = "tab:new";
const CLOSE_TAB_ACTION = "tab:close";
const RESTART_SESSION_ACTION = "tab:restart-session";
const LINK_LINEAR_ACTION = "tab:link-linear";
const HAND_OFF_PREFIX = "tab:hand-off:";
const CONTINUE_PREFIX = "tab:continue:";
const INCLUDE_PREFIX = "tab:include:";

const selectedSources = new Map<string, ReadonlyArray<ThreadId>>();

export function selectedThreadTabSources(threadId: ThreadId): ReadonlyArray<ThreadId> {
  return selectedSources.get(threadId) ?? [];
}

export function clearSelectedThreadTabSources(threadId: ThreadId): void {
  selectedSources.delete(threadId);
}

/**
 * Switches, opens, and closes a thread's chat tabs, and restarts the open tab's agent session;
 * empty tabs also include a sibling's summary or continue its conversation in their place. A
 * started chat can hand off to any model: a new tab on that model whose draft starts with a
 * summary of this chat, followed by this chat's unsent draft. The group's linked Linear and
 * GitHub issues sit beside the switcher.
 */
export function ThreadTabs({
  environmentId,
  threadId,
  title,
  modelSelection,
  forkPoint,
  empty,
  working,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  title: string;
  modelSelection: ModelSelection;
  /** The chat's latest finished response, which a hand-off forks from natively. */
  forkPoint: ThreadForkPoint | null;
  empty: boolean;
  working: boolean;
}) {
  const prepared = usePreparedConnection(environmentId);
  const navigation = useNavigation();
  const canNameGroup = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const archive = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  const stopSession = useAtomCommand(threadEnvironment.stopSession, { reportFailure: false });
  const [nameRevision, setNameRevision] = useState(0);
  useEffect(() => subscribeThreadTabGroupNames(() => setNameRevision((value) => value + 1)), []);
  const [group, setGroup] = useState<ThreadTabGroup | null>(null);
  const [selected, setSelected] = useState<ReadonlyArray<ThreadId>>(() =>
    selectedThreadTabSources(threadId),
  );
  const [busy, setBusy] = useState(false);
  const linear = useThreadLinearLink(environmentId, threadId);
  const linearPicker = useLinearIssuePicker({ mode: "link", environmentId, threadId });
  const gitHubIssueLink = useThreadGitHubIssueLink(environmentId, threadId);
  const serverConfig = useEnvironmentServerConfig(environmentId);
  const handOffModels = useMemo(
    () =>
      groupByProvider(
        buildModelOptions(serverConfig, modelSelection).filter(
          (option) => !option.isLegacy && !option.isUnavailable,
        ),
      ),
    [modelSelection, serverConfig],
  );

  useEffect(() => {
    if (Option.isNone(prepared)) return;
    let active = true;
    void runtime.runPromise(listThreadTabs(prepared.value, threadId)).then(
      (next) => {
        if (active) setGroup(next);
      },
      () => {
        if (active) setGroup(null);
      },
    );
    return () => {
      active = false;
    };
  }, [prepared, threadId, nameRevision]);

  if (!group || Option.isNone(prepared)) return null;

  const navigateTo = (target: ThreadId) => {
    navigation.navigate("Thread", {
      environmentId: String(environmentId),
      threadId: String(target),
    });
  };
  const create = async () => {
    setBusy(true);
    try {
      const next = ThreadId.make(uuidv4());
      await runtime.runPromise(
        createThreadTab(prepared.value, threadId, {
          threadId: next,
          creationSource: "mobile",
          modelSelection,
        }),
      );
      navigateTo(next);
    } catch (cause) {
      Alert.alert("Could not create tab", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(false);
    }
  };
  const handOff = async (option: ModelOption) => {
    setBusy(true);
    try {
      const next = ThreadId.make(uuidv4());
      // A native fork carries the conversation itself; with no finished response to fork
      // from, the new tab starts with a summary of this one.
      await runtime.runPromise(
        forkPoint
          ? forkThreadTabFromRun(prepared.value, threadId, {
              threadId: next,
              ...forkPoint,
              title: `${title} fork`,
              creationSource: "mobile",
              modelSelection: option.selection,
            })
          : createThreadTab(prepared.value, threadId, {
              threadId: next,
              creationSource: "mobile",
              modelSelection: option.selection,
            }),
      );
      const handoff = forkPoint
        ? { text: "" }
        : await runtime.runPromise(
            prepareThreadTabHandoff(prepared.value, next, { sourceThreadIds: [threadId] }),
          );
      const summary = handoff.text.slice(0, COMPOSER_CONTEXT_THREAD_TAB_SUMMARY_MAX_CHARS);
      const record: ThreadTabContextRecord | null = summary
        ? {
            version: 1,
            kind: "thread-tab",
            // Thread ids are UUIDs, which already fit the context id pattern.
            contextId: `thread-tab_${threadId}` as ComposerContextId,
            label: sanitizeComposerContextLabel(title, "thread-tab"),
            threadId,
            title: title.slice(0, 2_048),
            summary,
          }
        : null;
      // The unsent draft follows the summary; its attachments are shared, not moved.
      const source = getComposerDraftSnapshot(scopedThreadKey(environmentId, threadId));
      const records = [...(record ? [record] : []), ...(source.context?.records ?? [])];
      const text = [record ? formatComposerContextReference(record) : "", source.text]
        .filter((part) => part.trim().length > 0)
        .join("\n\n");
      if (text.length > 0) {
        insertComposerDraftContext(scopedThreadKey(environmentId, next), {
          text,
          context: { version: 1, records },
          attachments: source.attachments,
        });
      }
      navigateTo(next);
    } catch (cause) {
      Alert.alert("Could not hand off", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(false);
    }
  };
  // From an empty tab: a sibling's conversation continues in a native fork that takes this tab's
  // place, on the sibling's own model and with this tab's draft. This tab is archived, so it can
  // be reopened.
  const continueFrom = async (sourceThreadId: ThreadId, sourceTitle: string) => {
    setBusy(true);
    try {
      const next = ThreadId.make(uuidv4());
      await runtime.runPromise(
        forkThreadTabFromRun(prepared.value, threadId, {
          threadId: next,
          sourceThreadId,
          title: `${sourceTitle} fork`,
          creationSource: "mobile",
        }),
      );
      const source = getComposerDraftSnapshot(scopedThreadKey(environmentId, threadId));
      if (!isComposerDraftEmpty(source)) {
        insertComposerDraftContext(scopedThreadKey(environmentId, next), {
          text: source.text,
          context: { version: 1, records: source.context?.records ?? [] },
          attachments: source.attachments,
        });
      }
      const archived = await archive({ environmentId, input: { threadId } });
      if (archived._tag === "Success") refreshArchivedThreadsForEnvironment(environmentId);
      navigateTo(next);
    } catch (cause) {
      Alert.alert(
        "Could not continue that chat",
        cause instanceof Error ? cause.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  };
  // Closing archives the tab's thread, so the archived-threads list can reopen it.
  const close = async () => {
    const index = group.tabs.findIndex((tab) => tab.threadId === threadId);
    const next = group.tabs[index + 1] ?? group.tabs[index - 1];
    if (!next) return;
    if (working) {
      Alert.alert(
        "Could not close tab",
        "This tab is working. Interrupt it first, then try again.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await archive({ environmentId, input: { threadId } });
      if (result._tag === "Failure") {
        const error = Cause.squash(result.cause);
        Alert.alert("Could not close tab", error instanceof Error ? error.message : undefined);
        return;
      }
      refreshArchivedThreadsForEnvironment(environmentId);
      navigateTo(next.threadId);
    } finally {
      setBusy(false);
    }
  };
  // Stopping the provider process keeps the conversation; the next message resumes it in a fresh
  // one that reloads skills, plugins, and MCP servers.
  const restartSession = async () => {
    setBusy(true);
    try {
      const result = await stopSession({ environmentId, input: { threadId } });
      if (result._tag === "Failure") {
        const error = Cause.squash(result.cause);
        Alert.alert(
          "Could not restart agent session",
          error instanceof Error ? error.message : undefined,
        );
        return;
      }
      Alert.alert("Agent session will restart", "Your next message starts a fresh session.");
    } finally {
      setBusy(false);
    }
  };
  const onMenuAction = (id: string) => {
    if (id === NEW_TAB_ACTION) void create();
    else if (id === "tab:name-group" && canNameGroup)
      showTextInputDialog({
        title: "Name thread group (blank uses tab title)",
        initialValue: group.name ?? "",
        confirmText: "Save",
        onConfirm: (value) => {
          void (async () => {
            setBusy(true);
            try {
              setGroup(
                await runtime.runPromise(
                  setThreadTabGroupName(prepared.value, threadId, value.trim() || null),
                ),
              );
            } catch (cause) {
              Alert.alert(
                "Could not name thread group",
                cause instanceof Error ? cause.message : undefined,
              );
            } finally {
              setBusy(false);
            }
          })();
        },
      });
    else if (id === CLOSE_TAB_ACTION) void close();
    else if (id === RESTART_SESSION_ACTION) void restartSession();
    else if (id === LINK_LINEAR_ACTION) linearPicker.open();
    else if (id.startsWith(HAND_OFF_PREFIX)) {
      const key = id.slice(HAND_OFF_PREFIX.length);
      const option = handOffModels
        .flatMap((group) => group.models)
        .find((model) => model.key === key);
      if (option) void handOff(option);
    } else if (id.startsWith(CONTINUE_PREFIX)) {
      const source = group.tabs.find((tab) => tab.threadId === id.slice(CONTINUE_PREFIX.length));
      if (source) void continueFrom(source.threadId, source.title);
    } else if (id.startsWith(INCLUDE_PREFIX)) {
      toggle(ThreadId.make(id.slice(INCLUDE_PREFIX.length)));
    } else if (id !== threadId) navigateTo(ThreadId.make(id));
  };
  const toggle = (sourceId: ThreadId) => {
    if (!selected.includes(sourceId) && selected.length >= 8) {
      Alert.alert("Select up to eight chats for context.");
      return;
    }
    const next = selected.includes(sourceId)
      ? selected.filter((id) => id !== sourceId)
      : [...selected, sourceId];
    setSelected(next);
    selectedSources.set(threadId, next);
  };

  return (
    <View className="border-b border-border px-3 py-1.5">
      <View className="flex-row items-center gap-2">
        {group.tabs.length <= 1 && !group.name ? (
          // A lone tab would repeat the thread title, so the switcher is just a "new tab" action.
          <Pressable
            accessibilityLabel="New tab"
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void create()}
            className="flex-row items-center gap-1.5 self-start rounded-full bg-subtle px-3 py-1.5 active:opacity-70 disabled:opacity-50"
          >
            <SymbolView name="plus" size={13} tintColorClassName="accent-foreground" />
            <Text className="text-sm font-medium text-foreground">New tab</Text>
          </Pressable>
        ) : (
          <ControlPillMenu
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Chat tab: ${group.name ?? title}`}
            title="Tabs"
            // Long titles shrink so the linked issue beside the switcher stays visible.
            style={{ flexShrink: 1, minWidth: 0 }}
            actions={[
              ...group.tabs.map((tab) => ({
                id: tab.threadId,
                title: tab.threadId === threadId ? title : tab.title,
                state: tab.threadId === threadId ? ("on" as const) : ("off" as const),
              })),
              { id: NEW_TAB_ACTION, title: "New tab", image: "plus" },
              ...(canNameGroup
                ? [{ id: "tab:name-group", title: "Name thread group…", image: "pencil" }]
                : []),
              { id: CLOSE_TAB_ACTION, title: "Close tab", image: "xmark" },
              {
                id: RESTART_SESSION_ACTION,
                title: "Restart agent session",
                image: "arrow.clockwise",
              },
              ...(linear.canLink
                ? [{ id: LINK_LINEAR_ACTION, title: "Link Linear issue", image: "link" }]
                : []),
            ]}
            onPressAction={({ nativeEvent }) => onMenuAction(nativeEvent.event)}
          >
            <Pressable
              accessibilityLabel={`Chat tab: ${group.name ?? title}`}
              accessibilityRole="button"
              disabled={busy}
              className="min-w-0 shrink flex-row items-center gap-1.5 self-start rounded-full bg-subtle px-3 py-1.5 active:opacity-70 disabled:opacity-50"
            >
              <Text numberOfLines={1} className="shrink text-sm font-medium text-foreground">
                {group.name ?? title}
              </Text>
              <Text className="text-sm text-muted-foreground">{group.tabs.length}</Text>
              <SymbolView name="chevron.down" size={11} tintColorClassName="accent-foreground" />
            </Pressable>
          </ControlPillMenu>
        )}
        {!empty && handOffModels.length > 0 ? (
          <ControlPillMenu
            accessible
            accessibilityRole="button"
            accessibilityLabel="Hand off to another model"
            title="Continue in a new tab with"
            actions={handOffModels.map((group) => ({
              id: `tab:hand-off-provider:${group.providerKey}`,
              title: group.providerLabel,
              subactions: group.models.map((model) => ({
                id: `${HAND_OFF_PREFIX}${model.key}`,
                title: model.label,
                state:
                  model.selection.instanceId === modelSelection.instanceId &&
                  model.selection.model === modelSelection.model
                    ? ("on" as const)
                    : ("off" as const),
              })),
            }))}
            onPressAction={({ nativeEvent }) => onMenuAction(nativeEvent.event)}
          >
            <Pressable
              accessibilityLabel="Hand off to another model"
              accessibilityRole="button"
              disabled={busy}
              className="shrink-0 flex-row items-center gap-1.5 self-start rounded-full bg-subtle px-3 py-1.5 active:opacity-70 disabled:opacity-50"
            >
              <SymbolView
                name="arrow.triangle.branch"
                size={13}
                tintColorClassName="accent-foreground"
              />
              <Text className="text-sm font-medium text-foreground">Hand off</Text>
            </Pressable>
          </ControlPillMenu>
        ) : null}
        {linear.link ? (
          <ThreadLinearLinkChip
            environmentId={environmentId}
            threadId={threadId}
            link={linear.link}
            onChange={linearPicker.open}
          />
        ) : linear.canLink && group.tabs.length <= 1 && !group.name ? (
          <ThreadLinearLinkButton onPress={linearPicker.open} />
        ) : null}
        <ThreadStartedByChip environmentId={environmentId} threadId={threadId} />
        {gitHubIssueLink ? (
          <ThreadGitHubIssueLinkChip
            environmentId={environmentId}
            threadId={threadId}
            link={gitHubIssueLink}
          />
        ) : null}
      </View>
      {linearPicker.sheet}
      {empty && group.tabs.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="items-center gap-2 pt-2"
        >
          <Text className="text-xs text-muted-foreground">Include context from:</Text>
          {group.tabs
            .filter((tab) => tab.threadId !== threadId)
            .map((tab) => (
              <ControlPillMenu
                key={tab.threadId}
                accessible
                accessibilityRole="button"
                accessibilityLabel={`Context from ${tab.title}`}
                title={tab.title}
                actions={[
                  {
                    id: `${CONTINUE_PREFIX}${tab.threadId}`,
                    title: "Continue this conversation",
                    image: "arrow.triangle.branch",
                  },
                  {
                    id: `${INCLUDE_PREFIX}${tab.threadId}`,
                    title: "Include summary",
                    image: "paperclip",
                    state: selected.includes(tab.threadId) ? ("on" as const) : ("off" as const),
                  },
                ]}
                onPressAction={({ nativeEvent }) => onMenuAction(nativeEvent.event)}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: selected.includes(tab.threadId) }}
                  disabled={busy}
                >
                  <Text
                    className={
                      selected.includes(tab.threadId)
                        ? "font-semibold text-foreground"
                        : "text-muted-foreground"
                    }
                  >
                    {tab.title}
                  </Text>
                </Pressable>
              </ControlPillMenu>
            ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
