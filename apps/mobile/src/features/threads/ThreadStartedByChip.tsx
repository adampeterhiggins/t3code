import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { Pressable, Text } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { useThreadShell } from "../../state/entities";

/**
 * Names who started a thread when an agent did: the thread whose agent
 * started it, which the chip opens, or the agent access token's label.
 */
export function ThreadStartedByChip(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const navigation = useNavigation();
  const createdBy = useThreadShell(scopeThreadRef(props.environmentId, props.threadId))?.createdBy;
  const parentId = createdBy?.kind === "thread" ? createdBy.threadId : null;
  const parent = useThreadShell(
    parentId === null ? null : scopeThreadRef(props.environmentId, parentId),
  );
  if (createdBy == null) return null;

  const label =
    createdBy.kind === "agent-access" ? createdBy.label : (parent?.title ?? "an archived thread");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Started by the agent ${createdBy.kind === "agent-access" ? "using" : "in"} ${label}`}
      disabled={parent === null}
      onPress={() => {
        if (parentId === null) return;
        navigation.navigate("Thread", {
          environmentId: String(props.environmentId),
          threadId: String(parentId),
        });
      }}
      className="min-w-0 shrink flex-row items-center gap-1.5 self-start rounded-full bg-subtle px-3 py-1.5 active:opacity-70"
    >
      <SymbolView name="person.crop.circle" size={13} tintColorClassName="accent-foreground" />
      <Text numberOfLines={1} className="shrink text-sm font-medium text-foreground">
        {label}
      </Text>
    </Pressable>
  );
}
