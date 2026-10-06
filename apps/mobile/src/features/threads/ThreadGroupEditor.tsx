import type { ProjectIconColor } from "@t3tools/contracts";
import type { ThreadGroup } from "@t3tools/contracts/settings";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";

import { AppText } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { PROJECT_ICON_COLORS, projectIconColorClassNames } from "../../lib/projectIcon";
import { ThreadGroupIcon } from "./ThreadGroupIcon";

export interface ThreadGroupDraft {
  readonly name: string;
  readonly style: ThreadGroup;
}

/** The saved draft, "delete" (edit only), or null when cancelled. */
export type ThreadGroupEditorResult = ThreadGroupDraft | "delete" | null;

type Request = {
  /** The group being edited; null when naming a new one. */
  readonly initial: ThreadGroupDraft | null;
  readonly resolve: (result: ThreadGroupEditorResult) => void;
};

let presentRequest: ((request: Request) => void) | null = null;

/** Mobile has no Lucide set, so the picker offers a short emoji list. */
const GROUP_EMOJIS = [
  "📁",
  "⭐️",
  "🔥",
  "🚀",
  "🐛",
  "🧪",
  "🛠️",
  "📦",
  "🎨",
  "📝",
  "💡",
  "🔒",
  "📈",
  "🤖",
  "🧹",
  "⏳",
] as const;

/**
 * Asks for a group's name, icon and accent. Editing also offers Delete group.
 * Requires ThreadGroupEditorHost to be mounted at the app root.
 */
export function requestThreadGroup(
  initial: ThreadGroupDraft | null,
): Promise<ThreadGroupEditorResult> {
  return new Promise((resolve) => {
    if (presentRequest === null) resolve(null);
    else presentRequest({ initial, resolve });
  });
}

export function ThreadGroupEditorHost() {
  const [request, setRequest] = useState<Request | null>(null);
  useEffect(() => {
    presentRequest = (next) =>
      setRequest((current) => {
        current?.resolve(null);
        return next;
      });
    return () => {
      presentRequest = null;
    };
  }, []);
  if (request === null) return null;
  const finish = (result: ThreadGroupEditorResult) => {
    request.resolve(result);
    setRequest(null);
  };
  return <ThreadGroupEditor initial={request.initial} onFinish={finish} />;
}

function ThreadGroupEditor(props: {
  readonly initial: ThreadGroupDraft | null;
  readonly onFinish: (result: ThreadGroupEditorResult) => void;
}) {
  const [name, setName] = useState(props.initial?.name ?? "");
  const [style, setStyle] = useState<ThreadGroup>(props.initial?.style ?? {});
  const [error, setError] = useState<string | null>(null);
  const initialIcon = props.initial?.style.icon ?? null;
  const setAccent = (accent: ProjectIconColor | undefined) => {
    const { accent: _accent, ...rest } = style;
    setStyle(accent === undefined ? rest : { ...rest, accent });
  };
  const save = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Group name cannot be empty.");
      return;
    }
    props.onFinish({ name: trimmed, style });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => props.onFinish(null)}>
      <KeyboardAvoidingView
        className="flex-1 items-center justify-center bg-backdrop px-6"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="max-h-[80%] w-full max-w-md grow-0 rounded-3xl bg-screen"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 24, gap: 20 }}
        >
          <View className="flex-row items-center gap-3">
            <ThreadGroupIcon
              name={name.trim() || "Group"}
              style={style}
              size={22}
              fallbackTintClassName="accent-icon-muted"
            />
            <AppText accessibilityRole="header" className="text-xl font-t3-semibold">
              {props.initial === null ? "New group" : "Edit group"}
            </AppText>
          </View>
          <TextInput
            accessibilityLabel="Group name"
            autoFocus={props.initial === null}
            className="min-h-12 rounded-xl bg-subtle px-3 text-base text-foreground"
            placeholder="Group name"
            returnKeyType="done"
            value={name}
            onChangeText={(value) => {
              setName(value);
              setError(null);
            }}
            onSubmitEditing={save}
          />
          <View className="gap-2">
            <AppText className="text-sm text-foreground-secondary">Icon</AppText>
            <View className="flex-row flex-wrap gap-2">
              <IconChoice
                label="No icon"
                selected={style.icon == null}
                onPress={() => {
                  const { icon: _icon, ...rest } = style;
                  setStyle(rest);
                }}
              >
                <ThreadGroupIcon
                  name={name}
                  style={{ ...(style.accent ? { accent: style.accent } : {}) }}
                  size={18}
                  fallbackTintClassName="accent-icon-muted"
                />
              </IconChoice>
              {/* A Lucide or monogram icon set on web stays selectable as-is. */}
              {initialIcon !== null && initialIcon.kind !== "emoji" ? (
                <IconChoice
                  label="Current icon"
                  selected={style.icon === initialIcon}
                  onPress={() => setStyle({ ...style, icon: initialIcon })}
                >
                  <ThreadGroupIcon
                    name={name}
                    style={{ icon: initialIcon }}
                    size={18}
                    fallbackTintClassName="accent-icon-muted"
                  />
                </IconChoice>
              ) : null}
              {GROUP_EMOJIS.map((emoji) => (
                <IconChoice
                  key={emoji}
                  label={emoji}
                  selected={style.icon?.kind === "emoji" && style.icon.emoji === emoji}
                  onPress={() => setStyle({ ...style, icon: { kind: "emoji", emoji } })}
                >
                  <AppText allowFontScaling={false} style={{ fontSize: 18 }}>
                    {emoji}
                  </AppText>
                </IconChoice>
              ))}
            </View>
          </View>
          <View className="gap-2">
            <AppText className="text-sm text-foreground-secondary">Accent</AppText>
            <View className="flex-row flex-wrap gap-2">
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel="No accent"
                accessibilityState={{ checked: style.accent === undefined }}
                className={cn(
                  "size-8 items-center justify-center rounded-full border border-border",
                  style.accent === undefined && "border-2 border-foreground",
                )}
                onPress={() => setAccent(undefined)}
              >
                <AppText className="text-xs text-foreground-tertiary">—</AppText>
              </Pressable>
              {PROJECT_ICON_COLORS.map((color) => (
                <Pressable
                  key={color}
                  accessibilityRole="radio"
                  accessibilityLabel={color}
                  accessibilityState={{ checked: style.accent === color }}
                  className={cn(
                    "size-8 rounded-full",
                    projectIconColorClassNames(color).swatch,
                    style.accent === color && "border-2 border-foreground",
                  )}
                  onPress={() => setAccent(color)}
                />
              ))}
            </View>
          </View>
          {error ? (
            <AppText accessibilityRole="alert" className="text-danger-foreground">
              {error}
            </AppText>
          ) : null}
          <View className="flex-row items-center justify-end gap-3">
            {props.initial !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Removes the group and moves its threads out of it."
                className="mr-auto min-h-12 justify-center"
                onPress={() => props.onFinish("delete")}
              >
                <AppText className="text-danger-foreground">Delete group</AppText>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              className="min-h-12 justify-center px-3"
              onPress={() => props.onFinish(null)}
            >
              <AppText>Cancel</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className="min-h-12 justify-center rounded-xl bg-subtle px-3"
              onPress={save}
            >
              <AppText>{props.initial === null ? "Create" : "Save"}</AppText>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function IconChoice(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={props.label}
      accessibilityState={{ checked: props.selected }}
      className={cn(
        "size-10 items-center justify-center rounded-xl",
        props.selected ? "bg-subtle border-2 border-foreground" : "bg-subtle",
      )}
      onPress={props.onPress}
    >
      {props.children}
    </Pressable>
  );
}
