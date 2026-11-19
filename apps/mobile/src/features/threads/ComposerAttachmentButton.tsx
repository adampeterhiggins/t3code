import type { MenuAction } from "@react-native-menu/menu";
import { msg, useGT, useMessages } from "gt-react-native";
import { Pressable } from "react-native";

import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Menu } from "../../components/ui/Menu";

const PHOTOS_ACTION: MenuAction = { id: "photos", title: msg("Photo Library"), image: "photo" };
const FILES_ACTION: MenuAction = { id: "files", title: msg("Choose Files"), image: "folder" };
const LINEAR_ACTION: MenuAction = {
  id: "linear",
  title: msg("{product} issue", { product: "Linear" }),
  image: "ticket",
};
const GITHUB_ISSUE_ACTION: MenuAction = {
  id: "github-issue",
  title: msg("{product} issue", { product: "GitHub" }),
  image: "smallcircle.filled.circle",
};
const NOTION_ACTION: MenuAction = {
  id: "notion",
  title: msg("{product} page", { product: "Notion" }),
  image: "doc.text",
};
const GOOGLE_ACTION: MenuAction = {
  id: "google",
  title: msg("{product} file, event or email", { product: "Google" }),
  image: "doc.text",
};
const GRANOLA_ACTION: MenuAction = {
  id: "granola",
  title: msg("{product} note", { product: "Granola" }),
  image: "waveform",
};
const SLACK_ACTION: MenuAction = {
  id: "slack",
  title: msg("{product} message", { product: "Slack" }),
  image: "number",
};
const DISCORD_ACTION: MenuAction = {
  id: "discord",
  title: msg("{product} message", { product: "Discord" }),
  image: "bubble.left.and.bubble.right",
};
const CHECKOUT_ACTION: MenuAction = {
  id: "checkout",
  title: msg("Checkout", { $context: "attach a local checkout of a repository" }),
  image: "laptopcomputer",
};
const REPOSITORY_ACTION: MenuAction = {
  id: "repository",
  title: msg("Repository", { $context: "attach a repository" }),
  image: "arrow.triangle.branch",
};

export function ComposerAttachmentButton(props: {
  readonly disabled?: boolean;
  readonly size?: "regular" | "large";
  readonly supportsFiles: boolean;
  readonly onPickMedia: () => Promise<void>;
  readonly onPickFiles: () => Promise<void>;
  /** Omit to hide the Linear action. See `useLinearIssuePicker`. */
  readonly onPickLinearIssue?: () => void;
  /** Omit to hide the GitHub issue action. See `useGitHubIssuePicker`. */
  readonly onPickGitHubIssue?: () => void;
  /** Omit to hide the Notion action. See `useNotionPagePicker`. */
  readonly onPickNotionPage?: () => void;
  readonly onPickGoogleFile?: () => void;
  /** Omit to hide the Granola action. See `useGranolaNotePicker`. */
  readonly onPickGranolaNote?: () => void;
  /** Omit to hide the Slack action. See `useSlackMessagePicker`. */
  readonly onPickSlackMessage?: () => void;
  /** Omit to hide the Discord action. See `useDiscordMessagePicker`. */
  readonly onPickDiscordMessage?: () => void;
  /** Omit to hide the checkout action. See `useCheckoutPicker`. */
  readonly onPickCheckout?: () => void;
  /** Omit to hide the repository action. See `useRepositoryPicker`. */
  readonly onPickRepository?: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { scale } = useAndroidControlSizing();
  const actions = [
    PHOTOS_ACTION,
    ...(props.supportsFiles ? [FILES_ACTION] : []),
    ...(props.onPickLinearIssue ? [LINEAR_ACTION] : []),
    ...(props.onPickGitHubIssue ? [GITHUB_ISSUE_ACTION] : []),
    ...(props.onPickNotionPage ? [NOTION_ACTION] : []),
    ...(props.onPickGoogleFile ? [GOOGLE_ACTION] : []),
    ...(props.onPickGranolaNote ? [GRANOLA_ACTION] : []),
    ...(props.onPickSlackMessage ? [SLACK_ACTION] : []),
    ...(props.onPickDiscordMessage ? [DISCORD_ACTION] : []),
    ...(props.onPickCheckout ? [CHECKOUT_ACTION] : []),
    ...(props.onPickRepository ? [REPOSITORY_ACTION] : []),
  ];
  const usesMenu = !props.disabled && actions.length > 1;
  const button = (
    <Pressable
      accessibilityLabel={gt("Add attachment")}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      className="size-[44px] shrink-0 items-center justify-center rounded-full active:opacity-70 disabled:opacity-50"
      disabled={props.disabled}
      onPress={usesMenu ? undefined : () => void props.onPickMedia()}
    >
      <SymbolView
        name="plus"
        size={Math.round((props.size === "large" ? 26 : 20) * scale)}
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
    <Menu
      accessible
      accessibilityLabel={gt("Add attachment")}
      accessibilityRole="button"
      actions={actions.map((action) => ({ ...action, title: m(action.title) }))}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "photos") {
          void props.onPickMedia();
        } else if (nativeEvent.event === "files") {
          void props.onPickFiles();
        } else if (nativeEvent.event === "linear") {
          props.onPickLinearIssue?.();
        } else if (nativeEvent.event === "github-issue") {
          props.onPickGitHubIssue?.();
        } else if (nativeEvent.event === "google") {
          props.onPickGoogleFile?.();
        } else if (nativeEvent.event === "notion") {
          props.onPickNotionPage?.();
        } else if (nativeEvent.event === "granola") {
          props.onPickGranolaNote?.();
        } else if (nativeEvent.event === "slack") {
          props.onPickSlackMessage?.();
        } else if (nativeEvent.event === "discord") {
          props.onPickDiscordMessage?.();
        } else if (nativeEvent.event === "checkout") {
          props.onPickCheckout?.();
        } else if (nativeEvent.event === "repository") {
          props.onPickRepository?.();
        }
      }}
    >
      {button}
    </Menu>
  );
}
