import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveStartedBy, startedByThreadRef } from "@t3tools/client-runtime/state/startedBy";
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
  const thread = useThreadShell(scopeThreadRef(props.environmentId, props.threadId));
  const starter = useThreadShell(startedByThreadRef(thread));
  const attribution = resolveStartedBy(thread, starter);
  if (attribution === null) return null;
  const { label, description, openRef } = attribution;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={description}
      disabled={openRef === null}
      onPress={() => {
        if (openRef === null) return;
        navigation.navigate("Thread", {
          environmentId: String(openRef.environmentId),
          threadId: String(openRef.threadId),
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
