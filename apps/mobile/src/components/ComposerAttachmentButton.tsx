import type { MenuAction } from "@react-native-menu/menu";
import { Pressable } from "react-native";

import { useAndroidControlSizing } from "./useAndroidControlSizing";
import { SymbolView } from "./AppSymbol";
import { ControlPillMenu } from "./ControlPill";

const PHOTOS_ACTION: MenuAction = { id: "photos", title: "Photo Library", image: "photo" };
const FILES_ACTION: MenuAction = { id: "files", title: "Choose Files", image: "folder" };
const LINEAR_ACTION: MenuAction = { id: "linear", title: "Linear issue", image: "ticket" };

export function ComposerAttachmentButton(props: {
  readonly disabled?: boolean;
  readonly supportsFiles: boolean;
  readonly onPickMedia: () => Promise<void>;
  readonly onPickFiles: () => Promise<void>;
  /** Omit to hide the Linear action. See `useLinearIssuePicker`. */
  readonly onPickLinearIssue?: () => void;
}) {
  const { scale } = useAndroidControlSizing();
  const actions = [
    PHOTOS_ACTION,
    ...(props.supportsFiles ? [FILES_ACTION] : []),
    ...(props.onPickLinearIssue ? [LINEAR_ACTION] : []),
  ];
  const usesMenu = !props.disabled && actions.length > 1;
  const button = (
    <Pressable
      accessibilityLabel="Add attachment"
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      className="size-[44px] shrink-0 items-center justify-center rounded-full active:opacity-70 disabled:opacity-50"
      disabled={props.disabled}
      onPress={usesMenu ? undefined : () => void props.onPickMedia()}
    >
      <SymbolView
        name="plus"
        size={Math.round(20 * scale)}
        weight="regular"
        tintColorClassName="accent-icon"
        type="monochrome"
      />
    </Pressable>
  );

  if (!usesMenu) {
    return button;
  }

  return (
    <ControlPillMenu
      accessible
      accessibilityLabel="Add attachment"
      accessibilityRole="button"
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "photos") {
          void props.onPickMedia();
        } else if (nativeEvent.event === "files") {
          void props.onPickFiles();
        } else if (nativeEvent.event === "linear") {
          props.onPickLinearIssue?.();
        }
      }}
    >
      {button}
    </ControlPillMenu>
  );
}
