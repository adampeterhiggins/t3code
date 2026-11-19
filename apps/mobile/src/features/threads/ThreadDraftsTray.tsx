import type { MessageDraft, MessageDraftSendMode } from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react-native";
import { Platform, Pressable, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Menu } from "../../components/ui/Menu";
import { relativeTime } from "../../lib/time";
import { messageDraftRowPresentation } from "./messageDraftPresentation";

// Three rows stay visible; more scroll so the tray never pushes the composer off screen.
const TRAY_MAX_HEIGHT = 3 * 44;

type DraftRowAction = "open" | "send" | "steer" | "delete";

export function ThreadDraftsTray(props: {
  readonly drafts: ReadonlyArray<MessageDraft>;
  readonly disabled: boolean;
  readonly sendMode: MessageDraftSendMode;
  readonly canSteer: boolean;
  readonly onOpen: (draft: MessageDraft) => void;
  readonly onSend: (draft: MessageDraft, mode: MessageDraftSendMode) => void;
  readonly onDelete: (draft: MessageDraft) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  if (props.drafts.length === 0) return null;
  const sendLabel =
    props.sendMode === "auto"
      ? gt("Send", { $context: "verb, sends a draft" })
      : props.sendMode === "queue"
        ? gt("Queue", { $context: "verb, queues a draft" })
        : gt("Steer now");
  const sendDraftLabel = (title: string) =>
    props.sendMode === "auto"
      ? gt("Send draft {title}", { title })
      : props.sendMode === "queue"
        ? gt("Queue draft {title}", { title })
        : gt("Steer now draft {title}", { title });
  const act = (draft: MessageDraft, action: DraftRowAction) => {
    if (action === "open") props.onOpen(draft);
    else if (action === "send") props.onSend(draft, props.sendMode);
    else if (action === "steer") props.onSend(draft, "steer");
    else props.onDelete(draft);
  };
  return (
    <View className="mx-3 mb-2 overflow-hidden rounded-2xl border border-border bg-card">
      <ScrollView
        nestedScrollEnabled
        keyboardShouldPersistTaps="always"
        style={{ maxHeight: TRAY_MAX_HEIGHT }}
      >
        {props.drafts.map((draft, index) => {
          const row = messageDraftRowPresentation(draft, messages);
          const meta = [row.originLabel, relativeTime(draft.createdAt)].filter(Boolean).join(" · ");
          return (
            <Menu
              key={draft.id}
              accessibilityLabel={gt("Actions for draft {title}", { title: row.title })}
              shouldOpenOnLongPress
              actions={[
                {
                  id: "open",
                  title: gt("Open", { $context: "verb, opens a draft" }),
                  image: Platform.OS === "ios" ? "pencil" : "edit",
                },
                {
                  id: "send",
                  title: sendLabel,
                  ...(Platform.OS === "ios" ? { image: "arrow.up" } : {}),
                },
                ...(props.canSteer && props.sendMode !== "steer"
                  ? [
                      {
                        id: "steer",
                        title: gt("Steer now"),
                        image: Platform.OS === "ios" ? "arrow.turn.left.up" : "arrow_upward",
                      },
                    ]
                  : []),
                { id: "delete", title: gt("Delete"), attributes: { destructive: true } },
              ]}
              onPressAction={({ nativeEvent }) => {
                if (!props.disabled) act(draft, nativeEvent.event as DraftRowAction);
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={gt("Draft: {title}", { title: row.title })}
                accessibilityHint={gt("Opens this draft in the composer")}
                disabled={props.disabled}
                onPress={() => act(draft, "open")}
                className={
                  index === 0
                    ? "min-h-11 flex-row items-center gap-2.5 pl-3 pr-1.5 active:opacity-70"
                    : "min-h-11 flex-row items-center gap-2.5 border-t border-border pl-3 pr-1.5 active:opacity-70"
                }
              >
                <SymbolView
                  name="doc.text"
                  size={13}
                  tintColorClassName="accent-foreground-muted"
                />
                <Text className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={1}>
                  {row.title}
                </Text>
                {row.attachmentCount > 0 ? (
                  <View
                    accessibilityLabel={gt(
                      "{count, plural, one {{count} attachment} other {{count} attachments}}",
                      { count: row.attachmentCount },
                    )}
                    className="flex-row items-center gap-0.5"
                  >
                    <SymbolView
                      name="photo"
                      size={11}
                      tintColorClassName="accent-foreground-muted"
                    />
                    <Text className="text-2xs tabular-nums text-foreground-muted">
                      {row.attachmentCount}
                    </Text>
                  </View>
                ) : null}
                <Text className="shrink-0 text-2xs text-foreground-muted">{meta}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={sendDraftLabel(row.title)}
                  disabled={props.disabled}
                  hitSlop={6}
                  onPress={() => act(draft, "send")}
                  className="size-8 items-center justify-center rounded-full bg-primary active:opacity-70 disabled:opacity-40"
                >
                  <SymbolView
                    name="arrow.up"
                    size={13}
                    tintColorClassName="accent-primary-foreground"
                  />
                </Pressable>
              </Pressable>
            </Menu>
          );
        })}
      </ScrollView>
    </View>
  );
}
