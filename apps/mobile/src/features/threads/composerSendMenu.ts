import type {
  ComposerSendMenuAction,
  ComposerSendMenuItem,
} from "@t3tools/client-runtime/state/send-menu";

/** The subset of `@react-native-menu/menu`'s action this menu fills in. */
export interface NativeSendMenuAction {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly image?: string;
  readonly state?: "on" | "off";
  readonly displayInline?: boolean;
  readonly subactions?: NativeSendMenuAction[];
}

const SUBTITLES: Partial<Record<ComposerSendMenuAction["type"], string>> = {
  queue: "Run after the current turn",
  steer: "Interrupt what the agent is doing",
  "save-draft": "Keep it in this thread",
};

const IOS_IMAGES: Record<string, string> = {
  "arrow-up": "arrow.up",
  "list-plus": "text.badge.plus",
  "file-text": "doc.text",
  pencil: "pencil",
  check: "checkmark",
  x: "xmark",
};

// Android's popup only draws glyphs it has a Tabler mapping for.
const ANDROID_IMAGES: Record<string, string> = { pencil: "edit" };

function nativeAction(
  item: ComposerSendMenuItem,
  platform: "ios" | "android",
): NativeSendMenuAction {
  const subtitle = item.action ? SUBTITLES[item.action.type] : undefined;
  const image = item.icon
    ? (platform === "ios" ? IOS_IMAGES : ANDROID_IMAGES)[item.icon]
    : undefined;
  return {
    id: item.id,
    title: item.label,
    ...(subtitle ? { subtitle } : {}),
    ...(image ? { image } : {}),
    ...(item.checked === undefined ? {} : { state: item.checked ? "on" : "off" }),
    ...(item.children
      ? { subactions: item.children.map((child) => nativeAction(child, platform)) }
      : {}),
  };
}

/**
 * A leading header becomes the menu title. Separators become inline sections on iOS; Android's
 * popup has no inline sections, so its items stay flat.
 */
export function composerSendMenuActions(
  items: ReadonlyArray<ComposerSendMenuItem>,
  platform: "ios" | "android",
): { readonly title?: string; readonly actions: NativeSendMenuAction[] } {
  const header = items[0]?.header ? items[0] : undefined;
  const body = header ? items.slice(1) : items;
  const sections: ComposerSendMenuItem[][] = [];
  for (const item of body) {
    if (sections.length === 0 || (item.separatorBefore && platform === "ios")) sections.push([]);
    sections.at(-1)!.push(item);
  }
  const actions =
    sections.length <= 1
      ? (sections[0] ?? []).map((item) => nativeAction(item, platform))
      : sections.map((section, index) => ({
          id: `section:${index}`,
          title: "",
          displayInline: true,
          subactions: section.map((item) => nativeAction(item, platform)),
        }));
  return { ...(header ? { title: header.label } : {}), actions };
}
