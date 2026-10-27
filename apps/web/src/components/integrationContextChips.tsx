import type {
  CheckoutContextRecord,
  IntegrationContextKind,
  IntegrationContextRecord,
  KnownComposerContextRecord,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { FolderIcon, MessagesSquareIcon } from "lucide-react";

import { useOpenInPreferredEditor } from "~/editorPreferences";
import type { IssueContextRecord } from "~/issueContextStore";
import { primaryServerAvailableEditorsAtom } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  ComposerModelChip,
  ModelChipTrigger,
  modelChipAccessibleLabel,
} from "./chat/ModelContextChip";
import { SubagentChipTrigger, subagentChipAccessibleLabel } from "./chat/SubagentContextChip";
import type { UserMessageContextRenderContext } from "./chat/UserMessageContextChips";
import type {
  ComposerContextChipEntry,
  ComposerContextRenderContext,
} from "./composerContextPresentation";
import {
  buttonContextChip,
  type ContextChipSpec,
  type ContextPresentationHandler,
} from "./contextPreviewRegistry";
import { UnreadLinkChipTrigger, unreadLinkAccessibleLabel } from "./integrationContextDetails";
import {
  isLinkedObjectContextKind,
  isLinkedObjectContextRecord,
  linkedObjectIcon,
  linkedObjectKindLabel,
  type LinkedObjectContextKind,
} from "./linkedObjectPresentation";

/*
 * Fork: how the composer and sent messages draw the context kinds upstream does not have. The
 * shared registries spread these in, so a new integration's chip never touches upstream files.
 */

export type IntegrationDraftContextRecord = {
  [K in IntegrationContextKind]: {
    kind: K;
    record: Extract<IntegrationContextRecord, { kind: K }>;
  };
}[IntegrationContextKind];

export function issueDraftContextRecord(record: IssueContextRecord): IntegrationDraftContextRecord {
  switch (record.kind) {
    case "notion-page":
      return { kind: "notion-page", record };
    case "google-file":
      return { kind: "google-file", record };
    case "granola-note":
      return { kind: "granola-note", record };
    case "linear-issue":
      return { kind: "linear-issue", record };
    case "linear-object":
      return { kind: "linear-object", record };
    case "github-issue":
      return { kind: "github-issue", record };
    case "slack-thread":
      return { kind: "slack-thread", record };
    case "discord-thread":
      return { kind: "discord-thread", record };
    case "subagent":
      return { kind: "subagent", record };
    case "prompt-link":
      return { kind: "prompt-link", record };
    case "github-ref":
      return { kind: "github-ref", record };
    case "unread-link":
      return { kind: "unread-link", record };
    case "model":
      return { kind: "model", record };
  }
}

type ComposerHandler<K extends IntegrationContextKind> = ContextPresentationHandler<
  K,
  ComposerContextChipEntry,
  ComposerContextRenderContext
>;

function isLinkedObjectEntry(
  entry: ComposerContextChipEntry,
): entry is Extract<ComposerContextChipEntry, { kind: LinkedObjectContextKind }> {
  return isLinkedObjectContextKind(entry.kind);
}

function linkedObjectHandler<K extends LinkedObjectContextKind>(kind: K): ComposerHandler<K> {
  return {
    chip: (entry, { actions }) =>
      entry.kind === kind && isLinkedObjectEntry(entry)
        ? buttonContextChip({
            kind,
            icon: linkedObjectIcon(entry.record),
            label: entry.record.label,
            kindLabel: linkedObjectKindLabel(entry.record),
            preview: { record: entry.record, onOpenLink: actions.openLink },
          })
        : null,
  };
}

export const integrationComposerContextHandlers: {
  readonly [K in IntegrationContextKind]: ComposerHandler<K>;
} = {
  "thread-tab": {
    chip: (entry) =>
      entry.kind === "thread-tab"
        ? buttonContextChip({
            kind: "thread-tab",
            icon: <MessagesSquareIcon />,
            label: entry.record.label,
            kindLabel: "Chat summary",
            preview: { summary: entry.record.summary },
          })
        : null,
  },
  "linear-issue": linkedObjectHandler("linear-issue"),
  "linear-object": linkedObjectHandler("linear-object"),
  "github-issue": linkedObjectHandler("github-issue"),
  repository: linkedObjectHandler("repository"),
  checkout: {
    chip: (entry) =>
      entry.kind === "checkout"
        ? buttonContextChip({
            kind: "checkout",
            icon: <FolderIcon />,
            label: entry.record.label,
            kindLabel: "Checkout",
            preview: { record: entry.record },
          })
        : null,
  },
  "slack-thread": linkedObjectHandler("slack-thread"),
  "discord-thread": linkedObjectHandler("discord-thread"),
  "notion-page": linkedObjectHandler("notion-page"),
  "google-file": linkedObjectHandler("google-file"),
  "granola-note": linkedObjectHandler("granola-note"),
  subagent: {
    chip: (entry) =>
      entry.kind === "subagent"
        ? {
            trigger: <SubagentChipTrigger record={entry.record} />,
            accessibleLabel: subagentChipAccessibleLabel(entry.record),
            preview: { record: entry.record },
          }
        : null,
  },
  "prompt-link": linkedObjectHandler("prompt-link"),
  "github-ref": linkedObjectHandler("github-ref"),
  "unread-link": {
    chip: (entry, { actions }) => {
      if (entry.kind !== "unread-link") return null;
      const { record } = entry;
      return {
        trigger: <UnreadLinkChipTrigger record={record} />,
        accessibleLabel: unreadLinkAccessibleLabel(record),
        preview: {
          record,
          onOpenLink: actions.openLink,
          onRetry: () => actions.retryUnreadLink(record),
          onKeepAsText: () => actions.keepUnreadLinkAsText(record),
        },
      };
    },
  },
  model: {
    chip: (entry, { actions }) =>
      entry.kind === "model"
        ? {
            trigger: (
              <ComposerModelChip record={entry.record} onRecordChange={actions.updateModelChip} />
            ),
            accessibleLabel: modelChipAccessibleLabel(entry.record),
            preview: { record: entry.record },
          }
        : null,
  },
};

type UserMessageChip<K extends IntegrationContextKind> = (
  record: KnownComposerContextRecord,
  context: UserMessageContextRenderContext,
) => ContextChipSpec<K> | null;

function linkedObjectUserMessageChip<K extends LinkedObjectContextKind>(
  kind: K,
): UserMessageChip<K> {
  return (record, context) =>
    record.kind === kind && isLinkedObjectContextRecord(record)
      ? buttonContextChip({
          kind,
          icon: linkedObjectIcon(record),
          label: record.label,
          kindLabel: linkedObjectKindLabel(record),
          copyMarkdown: context.copyMarkdown,
          preview: { record, onOpenLink: context.onOpenLink },
        })
      : null;
}

export const integrationUserMessageChips: {
  readonly [K in IntegrationContextKind]: UserMessageChip<K>;
} = {
  "thread-tab": (record, context) =>
    record.kind === "thread-tab"
      ? buttonContextChip({
          kind: "thread-tab",
          icon: <MessagesSquareIcon />,
          label: record.label,
          kindLabel: "Chat summary",
          copyMarkdown: context.copyMarkdown,
          preview: { summary: record.summary },
        })
      : null,
  "linear-issue": linkedObjectUserMessageChip("linear-issue"),
  "linear-object": linkedObjectUserMessageChip("linear-object"),
  "github-issue": linkedObjectUserMessageChip("github-issue"),
  repository: linkedObjectUserMessageChip("repository"),
  checkout: (record, context) =>
    record.kind === "checkout"
      ? buttonContextChip({
          kind: "checkout",
          icon: <FolderIcon />,
          label: record.label,
          kindLabel: "Checkout",
          copyMarkdown: context.copyMarkdown,
          preview: { record, ...context.checkoutActions },
        })
      : null,
  "slack-thread": linkedObjectUserMessageChip("slack-thread"),
  "discord-thread": linkedObjectUserMessageChip("discord-thread"),
  "notion-page": linkedObjectUserMessageChip("notion-page"),
  "google-file": linkedObjectUserMessageChip("google-file"),
  "granola-note": linkedObjectUserMessageChip("granola-note"),
  subagent: (record, context) =>
    record.kind === "subagent"
      ? {
          trigger: <SubagentChipTrigger record={record} copyMarkdown={context.copyMarkdown} />,
          accessibleLabel: subagentChipAccessibleLabel(record),
          preview: { record },
        }
      : null,
  "prompt-link": linkedObjectUserMessageChip("prompt-link"),
  "github-ref": linkedObjectUserMessageChip("github-ref"),
  "unread-link": (record, context) =>
    record.kind === "unread-link"
      ? {
          trigger: <UnreadLinkChipTrigger record={record} copyMarkdown={context.copyMarkdown} />,
          accessibleLabel: unreadLinkAccessibleLabel(record),
          preview: { record, onOpenLink: context.onOpenLink },
        }
      : null,
  model: (record, context) =>
    record.kind === "model"
      ? {
          trigger: <ModelChipTrigger record={record} copyMarkdown={context.copyMarkdown} />,
          accessibleLabel: modelChipAccessibleLabel(record),
          preview: { record },
        }
      : null,
};

/** Opening a sent message's checkout in the editor, and linking it to the thread. */
export function useCheckoutContextActions(
  record: KnownComposerContextRecord | undefined,
  threadRef: ScopedThreadRef | null,
): UserMessageContextRenderContext["checkoutActions"] {
  const checkout: CheckoutContextRecord | null = record?.kind === "checkout" ? record : null;
  const editors = useAtomValue(primaryServerAvailableEditorsAtom);
  const openInEditor = useOpenInPreferredEditor(checkout?.environmentId ?? null, editors);
  const linkCheckout = useAtomCommand(threadEnvironment.linkCheckout, { reportFailure: true });
  if (checkout === null) return undefined;
  return {
    onOpen: () => {
      void openInEditor(checkout.path);
    },
    ...(threadRef === null
      ? {}
      : {
          onLink: () => {
            void linkCheckout({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId, path: checkout.path, name: checkout.label },
            });
          },
        }),
  };
}
