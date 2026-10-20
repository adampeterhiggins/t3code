import type { ActiveTurnComposerAction } from "./composerDispatch.ts";

/**
 * The actions a send button offers on right-click (web, desktop) or long-press (mobile). Icons are
 * names from the context menu icon set; mobile maps them to its own glyphs.
 */
export type ComposerSendMenuAction =
  | { readonly type: "send" }
  | { readonly type: "queue" }
  | { readonly type: "steer" }
  | { readonly type: "send-in-new-thread" }
  | { readonly type: "save-draft" }
  | { readonly type: "update-queued" }
  | { readonly type: "move-to-drafts" }
  | { readonly type: "cancel-edit" }
  | { readonly type: "open-draft"; readonly draftId: string };

export interface ComposerSendMenuItem {
  readonly id: string;
  readonly label: string;
  readonly action?: ComposerSendMenuAction;
  readonly icon?: string;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly header?: boolean;
  readonly separatorBefore?: boolean;
  readonly children?: ReadonlyArray<ComposerSendMenuItem>;
}

export interface ComposerSendMenuInput {
  readonly hasContent: boolean;
  readonly running: boolean;
  readonly canSteer: boolean;
  readonly activeTurnDefault: ActiveTurnComposerAction;
  readonly canSendInNewThread: boolean;
  /** False where the composer is itself an unsaved new thread, which already persists locally. */
  readonly canSaveDraft: boolean;
  readonly isEditingQueuedMessage: boolean;
  /** The composer cannot send right now (busy, connecting); saving a draft still can. */
  readonly sendDisabled?: boolean;
  readonly drafts: ReadonlyArray<{ readonly id: string; readonly text: string }>;
}

const DRAFT_LABEL_MAX = 48;

export function draftMenuLabel(text: string): string {
  const firstLine = text.trim().split("\n")[0]?.trim() ?? "";
  if (firstLine.length === 0) return "Untitled draft";
  return firstLine.length > DRAFT_LABEL_MAX
    ? `${firstLine.slice(0, DRAFT_LABEL_MAX - 1)}…`
    : firstLine;
}

function item(
  action: ComposerSendMenuAction,
  label: string,
  extra: Omit<ComposerSendMenuItem, "id" | "label" | "action"> = {},
): ComposerSendMenuItem {
  return {
    id: action.type === "open-draft" ? `open-draft:${action.draftId}` : action.type,
    label,
    action,
    ...extra,
  };
}

export const SAVE_DRAFT_MENU_ITEM = item({ type: "save-draft" }, "Save as draft", {
  icon: "file-text",
});

export function resolveComposerSendMenu(input: ComposerSendMenuInput): ComposerSendMenuItem[] {
  const sendState = input.sendDisabled ? { disabled: true } : {};
  if (input.isEditingQueuedMessage) {
    return [
      item({ type: "update-queued" }, "Update queued message", { icon: "check", ...sendState }),
      ...(input.canSaveDraft
        ? [item({ type: "move-to-drafts" }, "Move to drafts", { icon: "file-text" })]
        : []),
      item({ type: "cancel-edit" }, "Cancel edit", { icon: "x", separatorBefore: true }),
    ];
  }

  const draftItems = input.drafts.map((draft) =>
    item({ type: "open-draft", draftId: draft.id }, draftMenuLabel(draft.text), {
      icon: "file-text",
    }),
  );

  if (!input.hasContent) {
    if (draftItems.length === 0) return [];
    return [{ id: "drafts-header", label: "Drafts in this thread", header: true }, ...draftItems];
  }

  const items: ComposerSendMenuItem[] = [];
  if (input.running && input.canSteer) {
    items.push(
      item({ type: "queue" }, "Queue", {
        checked: input.activeTurnDefault === "queue",
        ...sendState,
      }),
      item({ type: "steer" }, "Steer now", {
        checked: input.activeTurnDefault === "steer",
        ...sendState,
      }),
    );
  } else {
    items.push(
      item({ type: input.running ? "queue" : "send" }, input.running ? "Queue" : "Send", {
        icon: input.running ? "list-plus" : "arrow-up",
        ...sendState,
      }),
    );
  }
  if (input.canSendInNewThread) {
    items.push(
      item({ type: "send-in-new-thread" }, "Send and start new thread", {
        icon: "message-square-plus",
        ...sendState,
      }),
    );
  }
  if (input.canSaveDraft) {
    items.push({ ...SAVE_DRAFT_MENU_ITEM, separatorBefore: true });
    if (draftItems.length > 0) {
      items.push({
        id: "open-draft",
        label: `Open draft (${draftItems.length})`,
        icon: "pencil",
        children: draftItems,
      });
    }
  }
  return items;
}

/** Finds the action behind a context-menu id, including inside submenus. */
export function findComposerSendMenuAction(
  items: ReadonlyArray<ComposerSendMenuItem>,
  id: string | null,
): ComposerSendMenuAction | null {
  if (id === null) return null;
  for (const candidate of items) {
    if (candidate.id === id && candidate.action) return candidate.action;
    const nested = candidate.children ? findComposerSendMenuAction(candidate.children, id) : null;
    if (nested) return nested;
  }
  return null;
}
