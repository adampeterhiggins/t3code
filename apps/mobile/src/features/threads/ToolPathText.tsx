import { useAtomValue } from "@effect/atom-react";
import { toolPathTextParts } from "@t3tools/client-runtime/work-log/tool-paths";
import type { EnvironmentId } from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react-native";
import { Alert } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { toolPathRootsAtom } from "../../state/toolPaths";

/** Native equivalent of the path tooltip: tap a breadcrumb to inspect and copy its full path. */
export function ToolPathText(props: {
  text: string;
  environmentId: EnvironmentId;
  workspaceRoot: string | null | undefined;
  targets?: ReadonlyArray<string>;
}) {
  const gt = useGT();
  const messages = useMessages();
  const roots = useAtomValue(toolPathRootsAtom(props.environmentId));
  const occurrences = new Map<string, number>();
  const parts = toolPathTextParts(props.text, props.workspaceRoot, roots, props.targets, messages);
  return parts.map((part) => {
    if ("text" in part) return part.text;
    const { path } = part;
    const occurrence = (occurrences.get(path.absolutePath) ?? 0) + 1;
    occurrences.set(path.absolutePath, occurrence);
    return (
      <Text
        key={`${path.absolutePath}:${occurrence}`}
        accessibilityRole="button"
        accessibilityLabel={gt("Full path: {path}", { path: path.absolutePath })}
        accessibilityHint={gt("Shows the full path with a copy action.")}
        className="font-t3-mono text-xs"
        onPress={(event) => {
          event.stopPropagation();
          Alert.alert(path.project ?? gt("Full file path"), path.absolutePath, [
            { text: gt("Close"), style: "cancel" },
            {
              text: gt("Copy full path"),
              onPress: () => {
                void tryCopyTextWithHaptic(path.absolutePath, { target: "full file path" }).then(
                  (copied) => {
                    if (!copied) Alert.alert(gt("Could not copy"), gt("Try again."));
                  },
                );
              },
            },
          ]);
        }}
      >
        <Text className="text-foreground underline decoration-dotted">{path.rootLabel}</Text>
        {path.segments.map((segment) => `/${segment}`).join("")}
      </Text>
    );
  });
}
