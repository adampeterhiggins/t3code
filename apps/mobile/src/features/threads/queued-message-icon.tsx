import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { selectedThreadRowColors } from "./thread-list-v2-row-appearance";

export function QueuedMessageIcon({ selected = false }: { readonly selected?: boolean }) {
  return (
    <SymbolView
      name="tray.and.arrow.up"
      size={12}
      tintColorClassName={
        selected ? "accent-user-bubble-foreground-muted" : "accent-foreground-muted"
      }
      type="monochrome"
    />
  );
}

export function DraftCountIcon({
  count,
  selected = false,
}: {
  readonly count: number;
  readonly selected?: boolean;
}) {
  return (
    <View className="flex-row items-center gap-0.5">
      <SymbolView
        name="doc.text"
        size={12}
        tintColorClassName={
          selected ? "accent-user-bubble-foreground-muted" : "accent-foreground-muted"
        }
        type="monochrome"
      />
      {count > 1 ? (
        <Text
          className={`text-2xs tabular-nums ${
            selected ? selectedThreadRowColors.mutedForegroundClassName : "text-foreground-muted"
          }`}
        >
          {count}
        </Text>
      ) : null}
    </View>
  );
}
