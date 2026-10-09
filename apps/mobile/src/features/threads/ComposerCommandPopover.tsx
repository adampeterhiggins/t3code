import {
  resolveProviderSkillSourceKind,
  type ProviderSkillSourceKind,
} from "@t3tools/client-runtime/providerSkills";
import type { AgentFleetEntry } from "@t3tools/client-runtime/state/agent-fleet";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  formatSubagentModelLabel,
  formatSubagentTokenCount,
  isActiveSubagentStatus,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type {
  PullRequestContextMetadata,
  ScopedThreadRef,
  ServerProvider,
  ServerProviderSkill,
  ServerProviderSlashCommand,
} from "@t3tools/contracts";
import type { ComposerTriggerKind } from "@t3tools/shared/composerTrigger";
import { deriveSubagentElapsedMs, formatDuration } from "@t3tools/shared/orchestrationTiming";
import { memo, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { GlassSurface } from "../../components/GlassSurface";
import { PierreEntryIcon } from "../../components/PierreEntryIcon";
import { ProviderIcon } from "../../components/ProviderIcon";
import { SegmentedControl } from "../../components/SegmentedControl";
import { cn } from "../../lib/cn";
import { SUBAGENT_TONE_TEXT_CLASS, SubagentStatusDot } from "./SubagentStatusDot";
import { subagentStatusLabel, subagentStatusTone } from "./threadAgentsPresentation";

/** The `@` menu's tabs. Agents shows only when the thread has agents to reference. */
export type ComposerPathTab = "files" | "chats" | "agents";

export type ComposerCommandItem =
  | {
      readonly id: string;
      readonly type: "pull-request";
      readonly pullRequest: PullRequestContextMetadata;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "path";
      readonly path: string;
      readonly kind: "file" | "directory";
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "thread";
      readonly thread: ScopedThreadRef;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "subagent";
      readonly entry: AgentFleetEntry;
      readonly provider: ServerProvider | undefined;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "slash-command";
      readonly command: string;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "provider-slash-command";
      readonly command: ServerProviderSlashCommand;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "skill";
      readonly skill: ServerProviderSkill;
      readonly label: string;
      readonly description: string;
    };

interface ComposerCommandPopoverProps {
  readonly items: ReadonlyArray<ComposerCommandItem>;
  readonly triggerKind: ComposerTriggerKind | null;
  readonly isLoading: boolean;
  readonly error?: string | null;
  /** Files/Chats/Agents tabs for the `@` menu. */
  readonly pathTab?: {
    readonly active: ComposerPathTab;
    readonly showAgents: boolean;
    readonly onChange: (tab: ComposerPathTab) => void;
  } | null;
  readonly onSelect: (item: ComposerCommandItem) => void;
}

const PATH_TAB_OPTIONS = [
  { value: "files", label: "Files" },
  { value: "chats", label: "Chats" },
  { value: "agents", label: "Agents" },
] as const satisfies ReadonlyArray<{ value: ComposerPathTab; label: string }>;
const PATH_TAB_OPTIONS_WITHOUT_AGENTS = PATH_TAB_OPTIONS.filter(
  (option) => option.value !== "agents",
);

function PopoverSurface(props: { readonly children: React.ReactNode; readonly style?: ViewStyle }) {
  const baseStyle: ViewStyle = {
    borderRadius: 16,
    overflow: "hidden",
    ...props.style,
  };

  return (
    <GlassSurface
      glassEffectStyle="clear"
      tintColorClassName="accent-glass-surface"
      style={baseStyle}
    >
      {props.children}
    </GlassSurface>
  );
}

const SKILL_SOURCE_SYMBOL_BY_KIND: Record<ProviderSkillSourceKind, AppSymbolName> = {
  app: "square.grid.2x2",
  repo: "folder",
  project: "folder",
  personal: "person.crop.circle",
  system: "gearshape",
  other: "cube",
};

function itemIcon(item: ComposerCommandItem): AppSymbolName | null {
  switch (item.type) {
    case "pull-request":
      return { ios: "arrow.triangle.pull", android: "merge" };
    case "slash-command":
    case "provider-slash-command":
      return "terminal";
    case "skill":
      return SKILL_SOURCE_SYMBOL_BY_KIND[resolveProviderSkillSourceKind(item.skill)];
    case "path":
      return null;
    case "thread":
      return "text.bubble";
    case "subagent":
      return null;
  }
}

function groupLabel(triggerKind: ComposerTriggerKind | null): string | null {
  switch (triggerKind) {
    case "pull-request":
      return "Pull requests";
    case "slash-command":
      return "Commands";
    case "skill":
      return "Skills";
    case "path":
      return "Files";
    default:
      return null;
  }
}

function emptyText(
  triggerKind: ComposerTriggerKind | null,
  isLoading: boolean,
  pathTab: ComposerPathTab | null,
): string {
  if (pathTab === "agents") return "No matching agents.";
  if (pathTab === "chats") return "No matching chats.";
  if (isLoading) {
    return triggerKind === "path" ? "Searching files…" : "Loading…";
  }
  switch (triggerKind) {
    case "pull-request":
      return "No matching pull requests.";
    case "path":
      return "No matching files or folders.";
    case "skill":
      return "No skills found.";
    case "slash-command":
      return "No matching commands.";
    default:
      return "No results.";
  }
}

/** Ticks once a second while the agent works, so a settled row never repaints. */
function useAgentClock(live: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const intervalId = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(intervalId);
  }, [live]);
  return nowMs;
}

/** An agent in the `@` menu: enough to tell apart agents with similar titles. */
const AgentCommandRow = memo(function AgentCommandRow(props: {
  readonly entry: AgentFleetEntry;
  readonly provider: ServerProvider | undefined;
  readonly onPress: () => void;
  readonly isLast: boolean;
}) {
  const { entry, provider } = props;
  const { agent } = entry;
  const tone = subagentStatusTone(agent.status);
  const nowMs = useAgentClock(isActiveSubagentStatus(agent.status));
  const elapsedMs = deriveSubagentElapsedMs(agent, nowMs);
  const details = [
    provider ? resolveProviderInstanceDisplayName(provider) : null,
    formatSubagentModelLabel(agent.model, agent.effort),
    elapsedMs ? formatDuration(elapsedMs) : null,
    agent.usage ? `${formatSubagentTokenCount(agent.usage.totalTokens)} tokens` : null,
  ].filter((part) => part !== null);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`@${entry.handle}, ${entry.title}, ${subagentStatusLabel(agent.status)}`}
      onPress={props.onPress}
      className="flex-row gap-2.5 border-border px-3.5 py-2.5 active:opacity-60"
      style={{ borderBottomWidth: props.isLast ? 0 : StyleSheet.hairlineWidth }}
    >
      <View className="h-5 justify-center">
        <SubagentStatusDot tone={tone} placement="sheet" />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="min-w-0 flex-row items-baseline gap-1.5">
          <Text className="shrink-0 text-base font-t3-medium text-foreground" numberOfLines={1}>
            @{entry.handle}
          </Text>
          <Text className={cn("shrink-0 text-xs font-t3-medium", SUBAGENT_TONE_TEXT_CLASS[tone])}>
            {subagentStatusLabel(agent.status)}
          </Text>
        </View>
        <Text className="text-xs text-foreground" numberOfLines={1}>
          {entry.title}
        </Text>
        {details.length > 0 ? (
          <View className="min-w-0 flex-row items-center gap-1.5">
            <ProviderIcon
              provider={provider?.driver ?? entry.subagent?.driver ?? ""}
              iconUrl={provider?.iconUrl}
              size={11}
            />
            <Text className="min-w-0 shrink text-xs text-foreground-muted" numberOfLines={1}>
              {details.join(" · ")}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

const CommandRow = memo(function CommandRow(props: {
  readonly item: ComposerCommandItem;
  readonly onPress: () => void;
  readonly isLast: boolean;
  readonly isSlashSkill: boolean;
}) {
  const iconName = itemIcon(props.item);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      className="flex-row items-center gap-2.5 border-border px-3.5 py-2.5 active:opacity-60"
      style={{ borderBottomWidth: props.isLast ? 0 : StyleSheet.hairlineWidth }}
    >
      {props.item.type === "path" ? (
        <PierreEntryIcon path={props.item.path} kind={props.item.kind} size={16} />
      ) : iconName ? (
        <SymbolView
          name={iconName}
          size={14}
          tintColorClassName={"accent-icon-subtle"}
          type="monochrome"
        />
      ) : null}
      <Text className="shrink-0 text-base font-t3-medium text-foreground" numberOfLines={1}>
        {props.isSlashSkill && props.item.type === "skill" ? (
          <>
            <Text className="text-foreground-muted">skill:</Text>
            {props.item.skill.name}
          </>
        ) : (
          props.item.label
        )}
      </Text>
      {props.item.description ? (
        <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
          {props.item.description}
        </Text>
      ) : null}
    </Pressable>
  );
});

export const ComposerCommandPopover = memo(function ComposerCommandPopover(
  props: ComposerCommandPopoverProps,
) {
  const label = groupLabel(props.triggerKind);
  const pathTab = props.triggerKind === "path" ? (props.pathTab ?? null) : null;

  return (
    <PopoverSurface>
      {pathTab ? (
        <View className="px-2.5 pt-2.5 pb-1">
          <SegmentedControl
            size="compact"
            role="tab"
            options={pathTab.showAgents ? PATH_TAB_OPTIONS : PATH_TAB_OPTIONS_WITHOUT_AGENTS}
            selected={pathTab.active}
            onSelect={pathTab.onChange}
          />
        </View>
      ) : label ? (
        <View className="px-3.5 pt-2.5 pb-1">
          <Text className="text-3xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
            {label}
          </Text>
        </View>
      ) : null}
      {props.items.length > 0 ? (
        <ScrollView
          className="max-h-[180px]"
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
        >
          {props.items.map((item, index) =>
            item.type === "subagent" ? (
              <AgentCommandRow
                key={item.id}
                entry={item.entry}
                provider={item.provider}
                onPress={() => props.onSelect(item)}
                isLast={index === props.items.length - 1}
              />
            ) : (
              <CommandRow
                key={item.id}
                item={item}
                onPress={() => props.onSelect(item)}
                isLast={index === props.items.length - 1}
                isSlashSkill={props.triggerKind === "slash-command" && item.type === "skill"}
              />
            ),
          )}
        </ScrollView>
      ) : (
        <View className="px-3.5 py-2.5">
          <Text className="text-xs text-foreground-tertiary">
            {props.error ?? emptyText(props.triggerKind, props.isLoading, pathTab?.active ?? null)}
          </Text>
        </View>
      )}
    </PopoverSurface>
  );
});
