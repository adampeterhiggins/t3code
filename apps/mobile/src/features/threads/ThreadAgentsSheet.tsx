import { useAtomValue } from "@effect/atom-react";
import { MenuView } from "@react-native-menu/menu";
import type { EnvironmentThread } from "@t3tools/client-runtime/state/shell";
import {
  deriveWorkflowGroups,
  projectedSubagentsToRuntime,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type { ThreadTurnSubagents } from "@t3tools/client-runtime/state/thread-subagents";
import {
  isOrchestrationV2WorkActive,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type ThreadId,
} from "@t3tools/contracts";
import { deriveSubagentElapsedMs, formatDuration } from "@t3tools/shared/orchestrationTiming";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import * as DateTime from "effect/DateTime";
import { Atom } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { useMemo } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { ScreenStack } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidSheetHeader } from "../../components/ui/AndroidScreenHeader";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";

import { environmentThreadDetails } from "../../state/threads";
import { NativeStackScreenOptions, nativeHeaderScrollEdgeEffects } from "../../native/StackHeader";
import {
  agentReferenceKey,
  attachAgentToChat,
  useAgentReferences,
  type AgentReference,
} from "./agent-references";
import { NativeHeader, NativeScreen } from "../../native/ThemedScreenStack";
import { useEnvironments } from "../../state/environments";
import { SubagentRow } from "./SubagentRow";
import { useVisibleSecondClock } from "./use-visible-second-clock";
import { SubagentStopButton } from "./SubagentStopButton";
import { ThreadWorkflowGroup } from "./ThreadWorkflowGroup";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { subagentThreadTarget } from "./threadAgentsPresentation";

import { useOpenThreadInspector } from "./thread-inspector-navigation";

const HEADER_SCROLL_EDGE_EFFECTS = nativeHeaderScrollEdgeEffects(Platform.OS, Platform.Version);

type AgentsTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

const EMPTY_SUBAGENTS: ReadonlyArray<OrchestrationV2Subagent> = [];
const selectSubagents = (thread: EnvironmentThread | null) =>
  thread?.projection.subagents ?? EMPTY_SUBAGENTS;

const EMPTY_TURN_SUBAGENTS_ATOM = Atom.make<ThreadTurnSubagents | null>(null).pipe(
  Atom.withLabel("mobile-thread-turn-subagents:empty"),
);

export function useThreadTurnSubagents(target: AgentsTarget | null): ThreadTurnSubagents | null {
  return useAtomValue(
    target === null
      ? EMPTY_TURN_SUBAGENTS_ATOM
      : environmentThreadDetails.turnSubagentsAtom(target),
  );
}

export function ThreadAgentsSheet({ route }: StaticScreenProps<AgentsTarget>) {
  const { layout } = useAdaptiveWorkspaceLayout();
  const target = route.params;
  const navigation = useNavigation();
  const openInspector = useOpenThreadInspector();
  const insets = useSafeAreaInsets();
  const turn = useThreadTurnSubagents(target);
  const subagents = turn?.subagents ?? [];
  const hasLiveAgent = (turn?.liveCount ?? 0) > 0;
  // Handles are deduped across every agent the thread started, not only this turn's.
  const references = useAgentReferences(
    target.environmentId,
    target.threadId,
    useAtomValue(environmentThreadDetails.threadAtom(target), selectSubagents),
  );
  const workflowGroups = useMemo(
    () =>
      new Map(
        deriveWorkflowGroups(projectedSubagentsToRuntime(subagents)).map((group) => [
          group.workflow.id,
          group,
        ]),
      ),
    [subagents],
  );

  const openChildThread = (child: { environmentId: EnvironmentId; threadId: ThreadId }) => {
    void Haptics.selectionAsync();
    if (
      openInspector(target, {
        type: "thread",
        environmentId: child.environmentId,
        threadId: child.threadId,
      })
    )
      return;
    // Replace this leaf sheet so the child enters the workspace stack expected by Home's Back button.
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: child.environmentId,
        threadId: child.threadId,
      }),
    );
  };

  const attachInChat = (subagent: OrchestrationV2Subagent, reference: AgentReference) => {
    if (!attachAgentToChat(target.environmentId, subagent, reference)) return;
    void Haptics.selectionAsync();
    navigation.goBack();
  };

  const content = (
    <ScrollView
      nestedScrollEnabled
      className="flex-1"
      // UIKit must inset content beneath the floating translucent iOS header.
      contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
      contentContainerClassName="px-5 pb-6"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
    >
      {subagents.length === 0 ? (
        <Text className="pt-6 text-center text-sm text-foreground-muted">
          No agents in this turn.
        </Text>
      ) : (
        subagents.map((subagent) => {
          const group = workflowGroups.get(subagent.id);
          return group === undefined ? (
            <View key={subagent.id} className="border-b border-border">
              <AgentRow
                subagent={subagent}
                environmentId={target.environmentId}
                reference={references.get(agentReferenceKey(subagent)) ?? null}
                tickSeconds={hasLiveAgent}
                onOpen={openChildThread}
                onAttach={attachInChat}
              />
            </View>
          ) : (
            <ThreadWorkflowGroup
              key={subagent.id}
              environmentId={target.environmentId}
              subagent={subagent}
              group={group}
              onOpen={(threadId) =>
                openChildThread({ environmentId: target.environmentId, threadId })
              }
            />
          );
        })
      )}
    </ScrollView>
  );

  if (Platform.OS === "ios") {
    // Plain formSheets lack stack headers; host one in a nested native stack.
    return (
      <View collapsable={false} className="flex-1 bg-sheet">
        <ScreenStack style={{ flex: 1 }}>
          <NativeScreen
            activityState={2}
            enabled
            isNativeStack
            screenId="thread-agents-sheet-native"
            scrollEdgeEffects={HEADER_SCROLL_EDGE_EFFECTS}
            className="flex-1 bg-sheet"
          >
            {content}
            <NativeHeader
              backgroundColor="rgba(0,0,0,0)"
              tintColorClassName="accent-foreground"
              hideBackButton
              hideShadow={false}
              title="Agents"
              titleColorClassName="accent-foreground"
              titleFontSize={18}
              titleFontWeight="800"
              translucent
            />
          </NativeScreen>
        </ScreenStack>
      </View>
    );
  }

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <NativeStackScreenOptions options={{ sheetCornerRadius: 28 }} />
      <AndroidSheetHeader title="Agents" onBack={() => navigation.goBack()} />
      <ScreenContent insetHorizontal={layout.usesSplitView}>{content}</ScreenContent>
    </View>
  );
}

// The sheet is a native modal, where Android's anchored menu would sit behind it.
const AgentRowMenu = Platform.OS === "android" ? MenuView : Menu;

function AgentRow(props: {
  readonly environmentId: EnvironmentId;
  readonly subagent: OrchestrationV2Subagent;
  readonly reference: AgentReference | null;
  readonly tickSeconds: boolean;
  readonly onOpen: (child: { environmentId: EnvironmentId; threadId: ThreadId }) => void;
  readonly onAttach: (subagent: OrchestrationV2Subagent, reference: AgentReference) => void;
}) {
  const { subagent, reference } = props;
  const { presentationById } = useEnvironments();
  const target = subagentThreadTarget(subagent, props.environmentId, (id) =>
    presentationById.has(id),
  );

  const row = (
    <View className="py-3.5">
      <SubagentRow
        environmentId={props.environmentId}
        subagent={subagent}
        handle={reference?.handle ?? null}
        canOpenRemote={target !== null}
        elapsed={<AgentElapsed subagent={subagent} tickSeconds={props.tickSeconds} />}
      />
    </View>
  );

  const pressable =
    target === null ? (
      <Pressable
        accessibilityHint={
          subagent.remoteChild !== undefined
            ? `Runs on ${subagent.remoteChild.label}. Connect to it to open its thread.`
            : reference
              ? "Provider-managed agent. Its work appears in the transcript. Long press for actions."
              : "Provider-managed agent. Its work appears in the transcript."
        }
      >
        {row}
      </Pressable>
    ) : (
      <Pressable
        accessibilityRole="link"
        accessibilityHint={
          reference
            ? "Opens this agent's thread. Long press for actions."
            : "Opens this agent's thread"
        }
        onPress={() => props.onOpen(target)}
        className="active:opacity-70"
      >
        {row}
      </Pressable>
    );

  const actions = [
    { id: "attach", title: "Attach to chat" },
    { id: "copy-handle", title: "Copy handle" },
    ...(target === null ? [] : [{ id: "open", title: "Open agent" }]),
  ];
  return (
    <View className="flex-row items-center">
      <View className="min-w-0 flex-1">
        {reference === null ? (
          pressable
        ) : (
          <AgentRowMenu
            title={`@${reference.handle}`}
            shouldOpenOnLongPress
            actions={actions}
            onPressAction={({ nativeEvent }) => {
              if (nativeEvent.event === "attach") props.onAttach(subagent, reference);
              else if (nativeEvent.event === "copy-handle") {
                copyTextWithHaptic(`@${reference.handle}`, { target: "agent handle" });
              } else if (nativeEvent.event === "open" && target !== null) {
                props.onOpen(target);
              }
            }}
          >
            {pressable}
          </AgentRowMenu>
        )}
      </View>
      <SubagentStopButton environmentId={props.environmentId} subagent={subagent} />
    </View>
  );
}

function AgentElapsed(props: {
  readonly subagent: OrchestrationV2Subagent;
  readonly tickSeconds: boolean;
}) {
  const elapsed = useSubagentElapsed(props.subagent, props.tickSeconds);
  return elapsed === null ? null : (
    <Text className="shrink-0 text-xs tabular-nums text-foreground-muted">{elapsed}</Text>
  );
}

function useSubagentElapsed(
  subagent: Pick<OrchestrationV2Subagent, "status" | "startedAt" | "completedAt">,
  tickSeconds: boolean,
): string | null {
  const running = isOrchestrationV2WorkActive(subagent.status);
  const nowMs = useVisibleSecondClock(tickSeconds && running);
  const elapsedMs = deriveSubagentElapsedMs(
    {
      status: subagent.status,
      startedAt: subagent.startedAt === null ? null : DateTime.formatIso(subagent.startedAt),
      completedAt: subagent.completedAt === null ? null : DateTime.formatIso(subagent.completedAt),
    },
    nowMs,
  );
  return elapsedMs === null || elapsedMs === 0 ? null : formatDuration(elapsedMs);
}
