import { ComposerContextActionsContext } from "./composerContextActions";
import { useAtomValue } from "@effect/atom-react";
import { isProviderSkillUserInvocable } from "@t3tools/client-runtime/providerSkills";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import {
  Extension,
  findChildren,
  InputRule,
  Node,
  wrappingInputRule,
  type JSONContent,
  type TiptapEditorHTMLElement,
} from "@tiptap/core";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type NodeViewProps,
  EditorContent,
  useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type NodeType, type ResolvedPos } from "@tiptap/pm/model";
import { newlineInCode, splitBlockKeepMarks } from "@tiptap/pm/commands";
import { isHistoryTransaction } from "@tiptap/pm/history";
import {
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { ComposerColorCodesExtension, useComposerColorCodeHover } from "./composerColorCodes";

import {
  type AssistantCitation,
  type ComposerContextClipboardFragment,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ServerProviderSkill,
  type ThreadId,
} from "@t3tools/contracts";
import {
  serializeAssistantCitation,
  withAssistantCitationComment,
} from "@t3tools/shared/assistantCitations";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextClipboardHtml,
} from "@t3tools/shared/composerContextClipboard";
import {
  createContext,
  use,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  expandCollapsedComposerCursor,
  pastedPathQueryLength,
} from "~/composer-logic";
import { useStableCallback } from "~/hooks/useStableCallback";
import { caretLineDirection, ComposerTextDirectionExtension } from "~/composer-text-direction";
import {
  collapseShownMarkdownSource,
  ComposerMarkdownSourceExtension,
} from "~/composer-markdown-source";
import { MARKDOWN_SOURCE_MARK } from "~/composer-rich-text";
import {
  collectComposerPromptInlineTokens,
  selectionTouchesMentionBoundary,
} from "~/composer-editor-mentions";
import {
  buildDocJson,
  ComposerBlockExtensions,
  ComposerCodeBlockExtension,
  ComposerListExtensions,
  buildTiptapContent,
  chipTokenEndingAt,
  ComposerBoldSelectionOnlyExtension,
  convertBulletItemToTask,
  ComposerCodeExtension,
  ComposerEmphasisExtensions,
  ComposerLinkExtension,
  ComposerTaskItemExtension,
  ComposerTaskListExtension,
  flatToMarkdown,
  flatToPm,
  markdownToFlat,
  pmToFlat,
  serializeEditorDoc,
  serializeSelection,
  skillChipReplacements,
  splitOrLiftListItem,
  surroundSelectionWithMark,
  stepCaretAcrossStyledEdge,
  type IsKnownModel,
  type SkillMeta,
} from "~/composer-rich-text-doc";
import {
  convertCodeFenceOnEnter,
  exitCodeBlockOnClosingFence,
  exitCodeBlockOnTrailingBlankLines,
  indentCodeBlock,
  indentedNewlineInCodeBlock,
  selectionInOneCodeBlock,
} from "~/composer-code-block";
import {
  COMPOSER_UNDO_GROUP_DELAY,
  type ComposerChangeKind,
  groupUndoByChangeKind,
  markAsClipboardEdit,
} from "~/composer-undo-grouping";
import { collectInlineContextIds } from "~/lib/composerContextReferences";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { isRichTextFormattingShortcut } from "~/keybindings";
import { cn, isMacPlatform } from "~/lib/utils";
import { isThreadNavigationShortcut } from "~/keybindings";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { hasCommandForKeyDown } from "~/shortcuts/dispatcher";

import { AssistantCitationChip } from "./chat/AssistantCitationChip";
import { type CitationCommentInputProps } from "./chat/AssistantCitationCommentEditor";
import { type ComposerTextTarget } from "./chat/composerTextTarget";
import { ModelMentionChip, modelMentionKey, modelMentionKeysAtom } from "./chat/ModelMentionChip";
import {
  type ComposerMentionDropHost,
  dataTransferHasComposerMention,
  makeComposerMentionDragHandlers,
} from "./chat/composerMentionDrag";
import {
  isFileDrag,
  makeWorkspaceFileDropHandlers,
  type WorkspaceFileDropHost,
} from "./chat/workspaceFileDrop";
import {
  type CitationDestination,
  type CitationDestinationAction,
} from "./chat/citationDestination";
import { getTimelinePageScrollKey } from "./chat/pageScrollController";
import {
  ComposerContextRecordChip,
  ComposerContextReferenceChip,
  ComposerContextRecordsContext,
  type ComposerDraftContextRecords,
} from "./composerContextPresentation";
import { skillPreviewDescription } from "./contextPreviews";
import { type AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { ComposerCodeBlockNodeView } from "./chat/ComposerCodeBlockNodeView";
import { resolveAssistantCitationCommentDismissal } from "./chat/assistantCitationCommentDismissal";
import { composerCodeBlockHighlight } from "./composerCodeBlockHighlight";
import { importPastedComposerText, readPastedPlainText } from "./composerInlineTokenPaste";
import { ComposerLoadingLinksExtension, setComposerLoadingLinks } from "./composerLoadingLinks";
import { didComposerSelectionChangeVisibly } from "./composerSelection";
import {
  deliverPendingDetachedComposerFocus,
  detachedComposerWindowCanFocus,
} from "./detachedChat/detachedComposerFocus";
import { isDetachedChatWindow } from "./quickMessage/quickMessageWindow";

export interface ComposerPromptEditorHandle {
  focus: () => void;
  focusAt: (cursor: number) => void;
  focusAtEnd: () => void;
  readSelectionRange: () => { start: number; end: number };
  requestCitationComment: (request: ComposerCitationCommentRequest) => void;
  readSnapshot: () => {
    value: string;
    cursor: number;
    expandedCursor: number;
    contextIds: string[];
  };
  isCaretOnVisualEdge: (edge: "start" | "end") => boolean;
}

export interface ComposerPromptEditorProps {
  draftKey?: string;
  value: string;
  cursor: number;
  richTextEnabled?: boolean;
  literalText?: boolean;
  contextRecords: ComposerDraftContextRecords;
  /** Links whose objects are loading, drawn as placeholder chips until they resolve. */
  loadingLinkUrls?: ReadonlyArray<string>;
  buildContextClipboardFragment?:
    | ((contextIds: ReadonlyArray<string>) => string | null)
    | undefined;
  importContextFragment?:
    | ((fragment: ComposerContextClipboardFragment) => ReadonlyMap<string, string>)
    | undefined;
  skills: ReadonlyArray<ServerProviderSkill>;
  disabled: boolean;
  placeholder: string;
  /** Rendered after the placeholder text, such as a key hint. */
  placeholderSuffix?: ReactNode;
  ariaLabel?: string | undefined;
  ariaDescription?: string | undefined;
  ariaInvalid?: boolean | undefined;
  suggestionListId?: string | undefined;
  activeSuggestionId?: string | undefined;
  isPathQueryActive?: () => boolean;
  containerClassName?: string;
  className?: string;
  placeholderClassName?: string;
  onChange: (
    nextValue: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
    contextIds: string[],
  ) => void;
  onVisibleSelectionChange?: () => void;
  onCommandKeyDown?: (key: string, event: KeyboardEvent, isTaskItem?: boolean) => boolean;
  onPageScrollKeyDown?: (key: "PageUp" | "PageDown") => void;
  onPageScrollKeyUp?: (key: string) => void;
  onPageScrollRelease?: () => void;
  /** Sends one citation as its own message; resolves true once it was sent. */
  onCitationSubmitAndSend?: (citationText: string) => Promise<boolean>;
  /** Saves the message, comment included, as a draft on the thread; absent where it cannot. */
  onCitationSubmitAndSaveDraft?: (() => void) | undefined;
  /** Sending from a citation comment adds the message to the queue instead of sending it now. */
  citationSendQueues?: boolean;
  citationDestinations?: ComposerCitationDestinations | undefined;
  /** Gives a citation's comment the prompt's links, `@` and `#` menus, and attachments. */
  citationCommentInput?: ComposerCitationCommentInput | undefined;
  /**
   * Called when a new controlled value replaces the document while a citation
   * comment is unsaved. The comment is saved into `replacedValue`, giving
   * `savedValue`, so the owner of `replacedValue` can keep it.
   */
  onCitationDraftSave?: (replacedValue: string, savedValue: string) => void;
  onPaste: React.ClipboardEventHandler<HTMLElement>;
  editorRef: React.RefObject<ComposerPromptEditorHandle | null>;
}

/** Lets a citation's comment panel send it to another thread; resolves true once it got there. */
export type ComposerCitationDestinations = {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  projectId: ProjectId;
  modelSelection: ModelSelection;
  followUpBehavior: "queue" | "steer";
  onSubmit: (
    destination: Exclude<CitationDestination, { kind: "here" }>,
    action: CitationDestinationAction,
    citationText: string,
  ) => Promise<boolean>;
};

export type ComposerCitationCommentInput = {
  /** Marks the comment as where chips land while it is open; returns the undo. */
  onOpen: (target: ComposerTextTarget) => () => void;
  /** Runs before the paste lands at `pasteStart`. */
  onPaste: (
    target: ComposerTextTarget,
    event: ReactClipboardEvent<HTMLElement>,
    pasteStart: number,
  ) => void;
  /** Every edit and caret move; `anchor` is where the comment's menu opens. */
  onChange: (
    target: ComposerTextTarget,
    previous: string,
    next: string,
    expandedCursor: number,
    anchor: HTMLElement | null,
  ) => void;
  /** Keys for a menu the comment opened; true when the menu took the key. */
  onCommandKey: (target: ComposerTextTarget, key: string, event: KeyboardEvent) => boolean;
  isPathQueryActive: (target: ComposerTextTarget) => boolean;
  /** The open menu, when the comment with this key opened it. */
  menu: { targetKey: string; listId: string; activeItemId: string | undefined } | null;
  loading: ReadonlyArray<{ readonly url: string; readonly workKey: string }>;
  /** Where files, folders, and file-tree or pull request drags dropped on the comment land. */
  dropHost: (target: ComposerTextTarget) => CitationCommentDropHost;
};

export type CitationCommentDropHost = Omit<
  WorkspaceFileDropHost & ComposerMentionDropHost,
  "setDragActive"
>;

export type ComposerCitationCommentRequest = {
  previousValue: string;
  value: string;
  citationStart: number;
  sourceAnchor?: AssistantCitationSourceAnchor | undefined;
  insertedSpaces: CitationInsertedSpaces;
};

type CitationInsertedSpaces = { before: boolean; after: boolean };

type OpenCitationComment = {
  key: string;
  sourceAnchor?: AssistantCitationSourceAnchor | undefined;
  removeOnCancel?: CitationInsertedSpaces;
};

const ComposerCitationCommentContext = createContext<{
  openComment: OpenCitationComment | null;
  onOpenChange: (citeKey: string, open: boolean) => void;
  onDraftChange: (citeKey: string, comment: string) => void;
  onSubmitAndSend: (citationText: string) => Promise<boolean>;
  onSubmitAndSaveDraft: (() => void) | null;
  sendQueues: boolean;
  destinations: ComposerCitationDestinations | null;
  renderInput: (props: CitationCommentInputProps) => ReactNode;
  renderContextReference: (reference: {
    kind: string;
    contextId: string;
    label: string;
  }) => ReactNode;
}>({
  openComment: null,
  onOpenChange: () => {},
  onDraftChange: () => {},
  onSubmitAndSend: async () => false,
  onSubmitAndSaveDraft: null,
  sendQueues: false,
  destinations: null,
  renderInput: () => null,
  renderContextReference: () => null,
});

const RichComposerSkillsContext = createContext<ReadonlyArray<ServerProviderSkill>>([]);

const SURROUND_CLOSE: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "'": "'",
  '"': '"',
  "“": "”",
  "`": "`",
  "<": ">",
  "«": "»",
  "*": "*",
  _: "_",
};

/**
 * Wraps an inline chip node view: keeps the caret and text selection out of the chip and
 * paints the editor's node selection over it. Keep the wrapper inline so a truncated chip
 * does not leave its full intrinsic width reserved in the surrounding text.
 */
const CHIP_NODE_SELECTION_CLASS_NAME =
  "relative inline select-none align-middle leading-none data-[composer-chip-selected]:after:pointer-events-none data-[composer-chip-selected]:after:absolute data-[composer-chip-selected]:after:inset-0 data-[composer-chip-selected]:after:rounded-sm data-[composer-chip-selected]:after:bg-[Highlight] data-[composer-chip-selected]:after:opacity-30 data-[composer-chip-selected]:after:content-['']";

const ComposerMentionExtension = Node.create({
  name: "composer-mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      path: { default: "" },
      source: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-composer-mention]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", { "data-composer-mention": "", ...HTMLAttributes }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ComposerMentionNodeView);
  },
});

function ComposerMentionNodeView({ node }: NodeViewProps) {
  const path = (node.attrs.path as string) ?? "";
  return (
    <NodeViewWrapper as="span" dir="ltr" className={CHIP_NODE_SELECTION_CLASS_NAME}>
      <ComposerContextRecordChip entry={{ kind: "mention", record: { path } }} label={path} />
    </NodeViewWrapper>
  );
}

const ComposerSkillExtension = Node.create({
  name: "composer-skill",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      skillName: { default: "" },
      skillLabel: { default: "" },
      skillDescription: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-composer-skill]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", { "data-composer-skill": "", ...HTMLAttributes }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ComposerSkillNodeView);
  },
});

function ComposerModelNodeView({ node }: NodeViewProps) {
  const actions = use(ComposerContextActionsContext);
  return (
    <NodeViewWrapper as="span" className={CHIP_NODE_SELECTION_CLASS_NAME}>
      <ModelMentionChip
        environmentId={actions.environmentId}
        instanceId={String(node.attrs.instanceId)}
        model={String(node.attrs.model)}
        source={String(node.attrs.source)}
      />
    </NodeViewWrapper>
  );
}

/** `model:<instance>/<model>` from the `@` menu; `source` is the exact prompt text. */
const ComposerModelExtension = Node.create({
  name: "composer-model",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      instanceId: { default: "" },
      model: { default: "" },
      source: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-composer-model]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", { "data-composer-model": "", ...HTMLAttributes }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ComposerModelNodeView);
  },
});

/** Chip presentation for `$name`, or null when the provider does not offer it to users. */
function composerSkillMeta(
  skills: ReadonlyArray<ServerProviderSkill>,
  name: string,
): SkillMeta | null {
  const skill = skills.find(
    (candidate) => candidate.name === name && isProviderSkillUserInvocable(candidate),
  );
  if (!skill) return null;
  const shortDescription = skill.shortDescription?.trim();
  return {
    label: formatProviderSkillDisplayName(skill),
    description: shortDescription || skill.description?.trim() || null,
  };
}

function ComposerSkillNodeView({ node }: NodeViewProps) {
  const skills = use(RichComposerSkillsContext);
  const skillName = (node.attrs.skillName as string) ?? "";
  const skill = skills.find(
    (candidate) => candidate.name === skillName && isProviderSkillUserInvocable(candidate),
  );
  // The node outlives a provider switch, so its stored label and description can be another
  // provider's; the current provider's skill wins.
  const label = skill
    ? formatProviderSkillDisplayName(skill)
    : (node.attrs.skillLabel as string) || skillName;
  const description = skill
    ? skillPreviewDescription(skill)
    : ((node.attrs.skillDescription as string | null) ?? null);
  return (
    <NodeViewWrapper as="span" className={CHIP_NODE_SELECTION_CLASS_NAME}>
      <ComposerContextRecordChip
        entry={{
          kind: "skill",
          record: { name: skillName, label, description, path: skill?.path ?? null },
        }}
        label={label}
      />
    </NodeViewWrapper>
  );
}

const ComposerCitationExtension = Node.create({
  name: "composer-citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      citation: { default: null },
      source: { default: "" },
      citeKey: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-composer-citation]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", { "data-composer-citation": "", ...HTMLAttributes }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ComposerCitationNodeView);
  },
});

function ComposerCitationNodeView({ node, editor, getPos }: NodeViewProps) {
  const commentContext = use(ComposerCitationCommentContext);
  const citation = node.attrs.citation as AssistantCitation;
  const citeKey = node.attrs.citeKey as string;
  const commentTarget =
    commentContext.openComment?.key === citeKey ? commentContext.openComment : null;

  const nodePos = () => {
    const pos = typeof getPos === "function" ? getPos() : null;
    return typeof pos === "number" ? pos : null;
  };

  const onSaveComment = (comment: string): boolean => {
    if (!editor.isEditable) return false;
    const pos = nodePos();
    if (pos === null) return false;
    const current = editor.state.doc.nodeAt(pos);
    if (!current || current.type.name !== "composer-citation") return false;
    const currentCitation = current.attrs.citation as AssistantCitation;
    const next = withAssistantCitationComment(currentCitation, comment);
    const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
      ...current.attrs,
      citation: next,
      source: serializeAssistantCitation(next),
    });
    editor.view.dispatch(tr);
    return true;
  };

  const removeOnCancel = commentTarget?.removeOnCancel;
  const onRemove = () => {
    if (!removeOnCancel) return;
    const pos = nodePos();
    if (pos === null) return;
    const { doc } = editor.state;
    const current = doc.nodeAt(pos);
    if (!current) return;
    const end = pos + current.nodeSize;
    const from = removeOnCancel.before && doc.textBetween(pos - 1, pos) === " " ? pos - 1 : pos;
    const to = removeOnCancel.after && doc.textBetween(end, end + 1) === " " ? end + 1 : end;
    // A read-only composer (dictation) can still receive a new citation, so Cancel must undo it.
    const chain = editor.chain();
    (editor.isEditable ? chain.focus() : chain).deleteRange({ from, to }).run();
  };

  // Runs after the send resolves, when this view may have moved or unmounted, so find the chip
  // by key. One adjoining space goes with it so the surrounding text closes up.
  const onRemoveSent = () => {
    if (editor.isDestroyed) return;
    const { doc } = editor.state;
    let pos: number | null = null;
    doc.descendants((child, childPos) => {
      if (pos !== null) return false;
      if (child.type.name === "composer-citation" && child.attrs.citeKey === citeKey) {
        pos = childPos;
        return false;
      }
      return true;
    });
    if (pos === null) return;
    const current = doc.nodeAt(pos);
    if (!current) return;
    const end = pos + current.nodeSize;
    const before = pos > 0 ? doc.textBetween(pos - 1, pos) : "";
    const after = end < doc.content.size ? doc.textBetween(end, end + 1) : "";
    const from = before === " " && after !== " " ? pos - 1 : pos;
    const to = after === " " && (before === " " || before === "") ? end + 1 : end;
    editor.commands.deleteRange({ from, to });
  };

  const onRestoreFocus = () => {
    if (!editor.isEditable) return;
    const pos = nodePos();
    const current = pos === null ? null : editor.state.doc.nodeAt(pos);
    if (pos === null || current?.type.name !== "composer-citation") {
      editor.view.focus();
      return;
    }
    editor
      .chain()
      .focus(pos + current.nodeSize)
      .run();
  };

  return (
    <NodeViewWrapper
      as="span"
      className={CHIP_NODE_SELECTION_CLASS_NAME}
      contentEditable={false}
      spellCheck={false}
      data-composer-citation-chip="true"
      onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => {
        if (
          !editor.isEditable ||
          event.key !== "Tab" ||
          event.shiftKey ||
          event.altKey ||
          event.metaKey ||
          event.ctrlKey ||
          !(event.target instanceof HTMLElement) ||
          event.target.dataset.citationCommentTrigger === undefined
        ) {
          return;
        }
        event.preventDefault();
        onRestoreFocus();
      }}
    >
      <AssistantCitationChip
        citation={citation}
        composer
        currentThreadId={commentContext.destinations?.threadId}
        renderContextReference={commentContext.renderContextReference}
        commentEditor={{
          open: commentTarget !== null,
          sourceAnchor: commentTarget?.sourceAnchor,
          onOpenChange: (open) => {
            if (open && !editor.isEditable) return;
            commentContext.onOpenChange(citeKey, open);
          },
          ...(removeOnCancel ? { onCancel: onRemove } : {}),
          onSave: onSaveComment,
          onDraftChange: (comment) => commentContext.onDraftChange(citeKey, comment),
          onSaveAndSend: (comment) => {
            // Saved first, so a send that fails leaves the comment in the composer.
            if (!onSaveComment(comment)) return false;
            const sent = serializeAssistantCitation(
              withAssistantCitationComment(citation, comment),
            );
            void commentContext.onSubmitAndSend(sent).then((ok) => {
              if (ok) onRemoveSent();
            });
            return true;
          },
          saveAndSendQueues: commentContext.sendQueues,
          ...(commentContext.onSubmitAndSaveDraft
            ? {
                onSaveAndSaveDraft: (comment: string) => {
                  if (!onSaveComment(comment)) return false;
                  commentContext.onSubmitAndSaveDraft?.();
                  return true;
                },
              }
            : {}),
          onRestoreFocus,
          renderInput: commentContext.renderInput,
          ...(commentContext.destinations
            ? {
                destinations: {
                  ...commentContext.destinations,
                  onSubmit: (destination, action, comment) => {
                    // Saved first, so a send that fails leaves the comment in this composer.
                    if (!onSaveComment(comment)) return false;
                    const text = serializeAssistantCitation(
                      withAssistantCitationComment(citation, comment),
                    );
                    // Saving to a new thread navigates there, and this composer's document goes
                    // with it, so the quote leaves this composer first.
                    if (destination.kind === "new-thread" && action === "save") {
                      onRemoveSent();
                      void commentContext.destinations?.onSubmit(destination, action, text);
                      return true;
                    }
                    void commentContext.destinations
                      ?.onSubmit(destination, action, text)
                      .then((ok) => {
                        if (ok) onRemoveSent();
                      });
                    return true;
                  },
                },
              }
            : {}),
        }}
      />
    </NodeViewWrapper>
  );
}

const ComposerContextReferenceExtension = Node.create({
  name: "composer-context-reference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      kind: { default: "" },
      contextId: { default: "" },
      label: { default: "" },
      source: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-composer-context-reference]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", { "data-composer-context-reference": "", ...HTMLAttributes }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ComposerContextReferenceNodeView);
  },
});

function ComposerContextReferenceNodeView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper as="span" className={CHIP_NODE_SELECTION_CLASS_NAME}>
      <ComposerContextReferenceChip
        kind={(node.attrs.kind as string) ?? ""}
        contextId={(node.attrs.contextId as string) ?? ""}
        label={(node.attrs.label as string) ?? ""}
      />
    </NodeViewWrapper>
  );
}

/**
 * A citation's comment, edited in this same editor so it reads chips, links, pasted context, and
 * the `@` and `#` menus the way the prompt does. Its chips' records live with the composer's own.
 */
function CitationCommentPromptInput({
  input,
  shared,
  richTextEnabled,
  contextRecords,
  buildContextClipboardFragment,
  importContextFragment,
  skills,
}: {
  input: CitationCommentInputProps;
  shared: ComposerCitationCommentInput | undefined;
  richTextEnabled: boolean;
  contextRecords: ComposerDraftContextRecords;
  buildContextClipboardFragment: ComposerPromptEditorProps["buildContextClipboardFragment"];
  importContextFragment: ComposerPromptEditorProps["importContextFragment"];
  skills: ReadonlyArray<ServerProviderSkill>;
}) {
  const id = useId();
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(input.value);
  const openRef = useRef(true);
  const [cursor, setCursor] = useState(() =>
    collapseExpandedComposerCursor(input.value, input.value.length),
  );
  useImperativeHandle(input.inputRef, () => ({
    focus: () => editorRef.current?.focus(),
    readSelection: () =>
      editorRef.current?.readSelectionRange() ?? {
        start: valueRef.current.length,
        end: valueRef.current.length,
      },
  }));
  const setValue = (next: string, nextCursor: number) => {
    valueRef.current = next;
    setCursor(nextCursor);
    input.onChange(next);
  };
  const readCaret = () =>
    editorRef.current?.readSnapshot().expandedCursor ?? valueRef.current.length;
  // Work that lands later, such as a loaded link, keeps the caret where the reader has since left it.
  const replaceText = useStableCallback((start: number, end: number, text: string) => {
    if (!openRef.current) return false;
    const previous = valueRef.current;
    const next = `${previous.slice(0, start)}${text}${previous.slice(end)}`;
    const caret = readCaret();
    const caretAfter =
      caret <= start
        ? caret
        : caret >= end
          ? caret + text.length - (end - start)
          : start + text.length;
    const collapsed = collapseExpandedComposerCursor(next, caretAfter);
    setValue(next, collapsed);
    return true;
  });
  const [target] = useState<ComposerTextTarget>(() => ({
    key: `citation-comment:${id}`,
    read: () => (openRef.current ? valueRef.current : null),
    caret: () => readCaret(),
    replace: (start, end, text) => replaceText(start, end, text),
    focus: () => {
      window.requestAnimationFrame(() => {
        if (openRef.current) editorRef.current?.focus();
      });
    },
  }));
  const onOpen = shared?.onOpen;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the open comment with the composer, and marks it closed so later work leaves it alone
  useEffect(() => {
    openRef.current = true;
    const close = onOpen?.(target);
    return () => {
      openRef.current = false;
      close?.();
    };
  }, [onOpen, target]);
  const menu = shared?.menu?.targetKey === target.key ? shared.menu : null;
  const referenced = new Set(collectInlineContextIds(input.value));
  const [dragActive, setDragActive] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window dragend clears the drop highlight when a drag is cancelled without dragleave
  useEffect(() => {
    if (!dragActive) return;
    const clear = () => setDragActive(false);
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, [dragActive]);
  const dropHost = shared ? { ...shared.dropHost(target), setDragActive } : null;
  const mentionDrop = dropHost ? makeComposerMentionDragHandlers(dropHost) : null;
  const fileDrop = dropHost ? makeWorkspaceFileDropHandlers(dropHost) : null;
  // Claimed in capture so neither the comment's editor nor the chat's prompt drop target sees it.
  const onDrag =
    (
      mention: ((event: ReactDragEvent<HTMLDivElement>) => void) | undefined,
      file: ((event: ReactDragEvent<HTMLDivElement>) => void) | undefined,
    ) =>
    (event: ReactDragEvent<HTMLDivElement>) => {
      mention?.(event);
      if (!isFileDrag(event)) return;
      file?.(event);
      event.stopPropagation();
      event.nativeEvent.stopPropagation();
    };
  return (
    <div
      ref={anchorRef}
      className={cn("rounded-md", dragActive && "bg-accent/45 ring-1 ring-inset ring-primary/70")}
      onDragEnterCapture={onDrag(mentionDrop?.onDragEnter, fileDrop?.onDragEnter)}
      onDragOverCapture={onDrag(mentionDrop?.onDragOver, fileDrop?.onDragOver)}
      onDragLeaveCapture={(event) => {
        if (!isFileDrag(event) && !dataTransferHasComposerMention(event.dataTransfer.types)) return;
        event.stopPropagation();
        const next = event.relatedTarget;
        if (!(next instanceof globalThis.Node && event.currentTarget.contains(next))) {
          setDragActive(false);
        }
      }}
      onDropCapture={onDrag(mentionDrop?.onDrop, fileDrop?.onDrop)}
    >
      <ComposerPromptEditorTiptap
        richTextEnabled={richTextEnabled}
        buildContextClipboardFragment={buildContextClipboardFragment}
        importContextFragment={importContextFragment}
        skills={skills}
        draftKey={target.key}
        editorRef={editorRef}
        value={input.value}
        cursor={cursor}
        // Only the comment's own chips, so its placeholder shows while it is empty.
        contextRecords={new Map([...contextRecords].filter(([id]) => referenced.has(id)))}
        loadingLinkUrls={(shared?.loading ?? [])
          .filter((entry) => entry.workKey === target.key)
          .map((entry) => entry.url)}
        disabled={input.readOnly ?? false}
        placeholder={input.placeholder}
        ariaLabel={input.ariaLabel}
        ariaDescription={input.ariaDescription}
        ariaInvalid={input.invalid}
        suggestionListId={menu?.listId}
        activeSuggestionId={menu?.activeItemId}
        isPathQueryActive={() => shared?.isPathQueryActive(target) ?? false}
        className="max-h-40"
        onChange={(next, nextCursor, expandedCursor) => {
          const previous = valueRef.current;
          if (next === previous) {
            setCursor(nextCursor);
          } else {
            setValue(next, nextCursor);
          }
          shared?.onChange(target, previous, next, expandedCursor, anchorRef.current);
        }}
        onCommandKeyDown={(key, event, isListItem) => {
          if (shared?.onCommandKey(target, key, event)) return true;
          if (key !== "Enter" || event.shiftKey) return false;
          // Like the prompt, plain Enter continues a list.
          if (isListItem && !event.metaKey && !event.ctrlKey) return false;
          return input.onEnter(event);
        }}
        onPaste={(event) => shared?.onPaste(target, event, readCaret())}
      />
    </div>
  );
}

/** Wait for a character after '- ' so task markers reach their input rule before becoming bullets. */
function listMarkerInputRule(find: RegExp, listType: "bulletList" | "orderedList"): InputRule {
  return new InputRule({
    find,
    handler: ({ state, range, match, chain }) => {
      const marker = match.groups?.marker ?? "-";
      const space = match.groups?.space ?? " ";
      const carried = match.groups?.carried ?? "";
      // Nested lists would serialize flat, so accept only top-level paragraphs.
      const $from = state.doc.resolve(range.from);
      if ($from.parent.type.name !== "paragraph" || $from.depth !== 1) return null;
      const command = chain()
        .deleteRange(range)
        .wrapInList(
          listType,
          listType === "orderedList" ? { start: Number.parseInt(marker, 10) || 1 } : {},
        )
        .updateAttributes("listItem", { marker, space });
      (carried ? command.insertContent(carried) : command).run();
      return undefined;
    },
  });
}

const bulletToTaskInputRule = new InputRule({
  find: /^\[([ xX])\] $/,
  handler: ({ state, range, match, chain }) => {
    const $from = state.doc.resolve(range.from);
    const item = $from.node(-1);
    if ($from.parent.type.name !== "paragraph" || item?.type.name !== "listItem") return null;
    if (!["-", "*", "+"].includes((item.attrs as { marker?: string }).marker ?? "")) return null;
    const checked = (match[1] ?? " ").toLowerCase() === "x";
    chain()
      .command(({ tr }) => {
        convertBulletItemToTask(tr, range.from, range.to, checked);
        return true;
      })
      .run();
    return undefined;
  },
});

function taskInputRule(type: NodeType): InputRule {
  const rule = wrappingInputRule({
    find: /^- \[([ xX])\] $/,
    type,
    getAttributes: (match) => ({ checked: match[1]?.toLowerCase() === "x" }),
  });
  return new InputRule({
    find: rule.find,
    handler: (props) =>
      props.state.doc.resolve(props.range.from).depth === 1 ? rule.handler(props) : null,
  });
}

function hasAncestor($pos: ResolvedPos, name: string): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === name) return true;
  }
  return false;
}

const blockquoteInputRule = new InputRule({
  find: /^>(\s)$/,
  handler: ({ state, range, match, chain }) => {
    const $from = state.doc.resolve(range.from);
    if ($from.parent.type.name !== "paragraph" || $from.depth !== 1) return null;
    chain()
      .deleteRange(range)
      .wrapIn("blockquote", { prefix: `>${match[1] ?? " "}` })
      .run();
    return undefined;
  },
});

/** Require a space after *** or ___ to preserve bold typing. Lists and quotes cannot serialize rules. */
const horizontalRuleInputRule = new InputRule({
  find: /^(---|\*\*\*|___)\s?$/,
  handler: ({ state, range, match, chain }) => {
    const source = match[0] ?? "---";
    if (!source.startsWith("---") && !/\s$/.test(source)) return null;
    const $from = state.doc.resolve(range.from);
    if ($from.parent.type.name !== "paragraph" || $from.depth !== 1) return null;
    chain()
      .deleteRange(range)
      .setHorizontalRule()
      .command(({ tr }) => {
        const $pos = tr.selection.$from;
        const index = $pos.index(0) - 1;
        if (index < 0) return true;
        const rulePos = $pos.posAtIndex(index, 0);
        const rule = tr.doc.nodeAt(rulePos);
        if (rule?.type.name === "horizontalRule") {
          tr.setNodeMarkup(rulePos, undefined, { ...rule.attrs, source });
        }
        return true;
      })
      .run();
    return undefined;
  },
});

/** Require a space to preserve PR references; lists and quotes cannot serialize headings. */
const headingInputRule = new InputRule({
  find: /^(#{1,6})(\s)$/,
  handler: ({ state, range, match, chain }) => {
    const $from = state.doc.resolve(range.from);
    if ($from.parent.type.name !== "paragraph" || $from.depth !== 1) return null;
    chain()
      .deleteRange(range)
      .setNode("heading", { level: match[1]?.length ?? 1, space: match[2] ?? " " })
      .run();
    return undefined;
  },
});

function isInCodeBlock(view: EditorView): boolean {
  return view.state.selection.$from.parent.type.spec.code === true;
}

const ChipSelectionPluginKey = new PluginKey<DecorationSet>("composer-chip-range-selection");

/** Highlights chips inside a text selection; their node views draw no native highlight. */
const ComposerChipSelectionExtension = Extension.create({
  name: "composer-chip-range-selection",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: ChipSelectionPluginKey,
        state: {
          init: (_, state) => chipSelectionDecorations(state),
          apply: (tr, old, _, state) =>
            tr.docChanged || tr.selectionSet ? chipSelectionDecorations(state) : old,
        },
        props: {
          decorations: (state) => ChipSelectionPluginKey.getState(state),
        },
      }),
    ];
  },
});

function chipSelectionDecorations({ doc, selection }: EditorState): DecorationSet {
  if (selection.empty) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (!node.type.name.startsWith("composer-")) return true;
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, { class: "composer-chip-range-selected" }),
    );
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

type TiptapEditor = NonNullable<ReturnType<typeof useEditor>>;

const SILENT_SELECTION_META = "composerSilentSelection";

function replaceSkillChips(
  editor: TiptapEditor,
  replacements: ReturnType<typeof skillChipReplacements>,
): void {
  const transaction = editor.state.tr.setMeta("addToHistory", false);
  for (const { from, to, node } of replacements) transaction.replaceWith(from, to, node);
  editor.view.dispatch(transaction);
}

export function ComposerPromptEditorTiptap(props: ComposerPromptEditorProps) {
  const restoreFocusRef = useRef(false);
  const { onChange: onPromptChange } = props;
  const [selection, setSelection] = useState<{
    value: string;
    cursor: number;
    expandedCursor: number;
  } | null>(null);
  const onChange: ComposerPromptEditorProps["onChange"] = (
    value,
    cursor,
    expandedCursor,
    ...rest
  ) => {
    setSelection({ value, cursor, expandedCursor });
    onPromptChange(value, cursor, expandedCursor, ...rest);
  };
  // Changing text mode remounts the editor. Its collapsed cursor cannot represent
  // a caret inside unknown `$name` text, so retain the exact Markdown offset here.
  return (
    <ComposerPromptEditorTiptapInner
      key={`${props.draftKey ?? ""}:${props.literalText ? "literal" : props.richTextEnabled ? "rich" : "plain"}`}
      {...props}
      restoreFocusRef={restoreFocusRef}
      initialExpandedCursor={
        selection?.value === props.value && selection.cursor === props.cursor
          ? selection.expandedCursor
          : expandCollapsedComposerCursor(props.value, props.cursor, props.literalText)
      }
      onChange={onChange}
    />
  );
}

/** Decide grouping in dispatch middleware before the history plugin applies the transaction. */
const ComposerUndoGroupingExtension = Extension.create<
  Record<string, never>,
  { previous: ComposerChangeKind | null }
>({
  name: "composer-undo-grouping",
  addStorage() {
    return { previous: null };
  },
  dispatchTransaction({ transaction, next }) {
    this.storage.previous = groupUndoByChangeKind(transaction, this.storage.previous);
    next(transaction);
  },
});

// Module scope keeps extension identity stable; Tiptap hooks read config through this.
function createComposerExtensions(richText: boolean) {
  return [
    StarterKit.configure({
      blockquote: false,
      bulletList: false,
      codeBlock: false,
      heading: false,
      horizontalRule: false,
      listItem: false,
      link: false,
      orderedList: false,
      underline: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      code: false,
      listKeymap: false,
      undoRedo: { newGroupDelay: COMPOSER_UNDO_GROUP_DELAY },
      bold: false,
      italic: false,
      strike: false,
    }),
    ComposerUndoGroupingExtension,
    ComposerTextDirectionExtension,
    ComposerMentionExtension,
    ComposerSkillExtension,
    ComposerModelExtension,
    ComposerCitationExtension,
    ComposerContextReferenceExtension,
    ComposerColorCodesExtension,
    ComposerLoadingLinksExtension,
    ComposerChipSelectionExtension,
    ...(richText
      ? [
          ComposerMarkdownSourceExtension,
          ComposerBoldSelectionOnlyExtension,
          ...ComposerEmphasisExtensions,
          ComposerLinkExtension,
          ComposerCodeExtension,
          ComposerCodeBlockExtension.extend({
            addNodeView() {
              return ReactNodeViewRenderer(ComposerCodeBlockNodeView, {
                // Tiptap shields only the button; header clicks would move ProseMirror's selection.
                stopEvent: ({ event }) =>
                  event.target instanceof Element &&
                  event.target.closest(".chat-markdown-codeblock-header") !== null,
              });
            },
            // Tiptap's fence rule allows unserializable lists/quotes; use top-level Enter instead.
            addInputRules() {
              return [];
            },
          }),
          composerCodeBlockHighlight({
            resolveTheme: () =>
              resolveDiffThemeName(
                document.documentElement.classList.contains("dark") ? "dark" : "light",
              ),
          }),
          ...ComposerBlockExtensions.map((extension) =>
            extension.name === "blockquote"
              ? extension.extend({
                  addInputRules() {
                    return [blockquoteInputRule];
                  },
                })
              : extension.name === "horizontalRule"
                ? extension.extend({
                    addInputRules() {
                      return [horizontalRuleInputRule];
                    },
                  })
                : extension.name === "heading"
                  ? extension.extend({
                      addInputRules() {
                        return [headingInputRule];
                      },
                    })
                  : extension,
          ),
          ...ComposerListExtensions.map((extension) =>
            extension.name === "listItem"
              ? extension
              : extension.extend({
                  addInputRules() {
                    return this.name === "bulletList"
                      ? [
                          listMarkerInputRule(/^(?<marker>[*+])(?<space>\s)$/, "bulletList"),
                          listMarkerInputRule(
                            /^(?<marker>-)(?<space>[ \t]+)(?<carried>[^\s[])$/,
                            "bulletList",
                          ),
                        ]
                      : [listMarkerInputRule(/^(?<marker>\d+[.)])(?<space>\s)$/, "orderedList")];
                  },
                }),
          ),
          ComposerTaskListExtension,
          ComposerTaskItemExtension.extend({
            addInputRules() {
              return [taskInputRule(this.type), bulletToTaskInputRule];
            },
          }),
        ]
      : []),
  ];
}

const RICH_TEXT_EXTENSIONS = createComposerExtensions(true);
const PLAIN_TEXT_EXTENSIONS = createComposerExtensions(false);

function ComposerPromptEditorTiptapInner(
  props: ComposerPromptEditorProps & {
    initialExpandedCursor: number;
    restoreFocusRef: RefObject<boolean>;
  },
) {
  const {
    value,
    cursor,
    richTextEnabled,
    literalText = false,
    contextRecords,
    loadingLinkUrls,
    buildContextClipboardFragment,
    importContextFragment,
    skills,
    disabled,
    placeholder,
    ariaLabel,
    ariaDescription,
    ariaInvalid,
    suggestionListId,
    activeSuggestionId,
    isPathQueryActive,
    containerClassName,
    className,
    placeholderClassName,
    placeholderSuffix,
    onChange,
    onVisibleSelectionChange,
    onCommandKeyDown,
    onPageScrollKeyDown,
    onPageScrollKeyUp,
    onPageScrollRelease,
    onCitationSubmitAndSend,
    onCitationSubmitAndSaveDraft,
    citationSendQueues = false,
    citationDestinations,
    citationCommentInput,
    onCitationDraftSave,
    onPaste,
    editorRef,
    restoreFocusRef,
  } = props;
  const richText = !literalText && (richTextEnabled ?? false);
  const clampEditorCursor = (text: string, position: number) =>
    literalText
      ? Math.max(
          0,
          Math.min(text.length, Number.isFinite(position) ? Math.floor(position) : text.length),
        )
      : clampCollapsedComposerCursor(text, position);
  const expandEditorCursor = (text: string, position: number) =>
    literalText ? position : expandCollapsedComposerCursor(text, position);

  const latestValueRef = useRef(value);
  // The editor config is built once, so its handlers reach the current callbacks through here.
  const readCallbacks = useStableCallback(() => ({
    onChange,
    onVisibleSelectionChange,
    onCommandKeyDown,
    isPathQueryActive,
    importContextFragment,
  }));

  const { environmentId } = use(ComposerContextActionsContext);
  const modelKeys = useAtomValue(modelMentionKeysAtom(environmentId ?? ""));
  // Stable so a skills or models refresh does not rerun the controlled-value effect.
  const skillLabelFor = useStableCallback((name: string) => composerSkillMeta(skills, name));
  const isKnownModel = useStableCallback((instanceId: string, model: string) =>
    modelKeys.has(modelMentionKey(instanceId, model)),
  );

  const initialCursor = clampEditorCursor(value, cursor);
  const initialExpandedCursor = Math.max(0, Math.min(value.length, props.initialExpandedCursor));
  const snapshotRef = useRef({
    value,
    cursor: initialCursor,
    expandedCursor: initialExpandedCursor,
    contextIds: literalText ? [] : collectInlineContextIds(value),
  });
  const selectionRangeRef = useRef({ start: initialExpandedCursor, end: initialExpandedCursor });
  const isApplyingControlledUpdateRef = useRef(false);
  const hasAppliedControlledSelectionRef = useRef(false);
  const citationRequestRef = useRef<ComposerCitationCommentRequest | null>(null);
  const [openCitation, setOpenCitation] = useState<OpenCitationComment | null>(null);
  const citationDraftRef = useRef<{ key: string; comment: string } | null>(null);
  const [isEmpty, setIsEmpty] = useState(value.length === 0);
  const colorCodeHover = useComposerColorCodeHover();

  const citationCommentActions = {
    openComment: openCitation,
    onOpenChange: (nodeKey: string, open: boolean) => {
      if (!open && citationDraftRef.current?.key === nodeKey) citationDraftRef.current = null;
      setOpenCitation((current) => {
        if (open) {
          if (current?.key === nodeKey) return current;
          return { key: nodeKey };
        }
        return current?.key === nodeKey ? null : current;
      });
    },
    onDraftChange: (nodeKey: string, comment: string) => {
      citationDraftRef.current = { key: nodeKey, comment };
    },
    onSubmitAndSend: onCitationSubmitAndSend ?? (async () => false),
    onSubmitAndSaveDraft: onCitationSubmitAndSaveDraft ?? null,
    sendQueues: citationSendQueues,
    destinations: citationDestinations ?? null,
    // The comment is this same editor, given this composer's records, skills, and links.
    renderInput: (input: CitationCommentInputProps) => (
      <CitationCommentPromptInput
        input={input}
        richTextEnabled={richText}
        contextRecords={contextRecords}
        buildContextClipboardFragment={buildContextClipboardFragment}
        importContextFragment={importContextFragment}
        skills={skills}
        shared={citationCommentInput}
      />
    ),
    renderContextReference: (reference: { kind: string; contextId: string; label: string }) => (
      <ComposerContextReferenceChip {...reference} />
    ),
  };

  const handleEditorChange = (updated: TiptapEditor, transaction: Transaction) => {
    const map = serializeEditorDoc(updated.state.doc);
    const contextIds = literalText ? [] : [...map.contextIds];
    const { from, to } = updated.state.selection;
    const fromFlat = pmToFlat(map, from);
    const toFlat = pmToFlat(map, to);
    const nextValue = map.value;
    const nextExpandedCursor = Math.max(
      0,
      Math.min(map.value.length, flatToMarkdown(map, fromFlat)),
    );
    const nextCursor = collapseExpandedComposerCursor(map.value, nextExpandedCursor, literalText);
    const nextSelectionRange = {
      start: Math.min(nextExpandedCursor, flatToMarkdown(map, toFlat)),
      end: Math.max(nextExpandedCursor, flatToMarkdown(map, toFlat)),
    };
    const previousSelectionRange = selectionRangeRef.current;
    selectionRangeRef.current = nextSelectionRange;
    setIsEmpty(nextValue.length === 0);
    const previousSnapshot = snapshotRef.current;
    const snapshotChanged = !(
      previousSnapshot.value === nextValue &&
      previousSnapshot.cursor === nextCursor &&
      previousSnapshot.expandedCursor === nextExpandedCursor &&
      previousSnapshot.contextIds.length === contextIds.length &&
      previousSnapshot.contextIds.every((id, index) => id === contextIds[index])
    );
    if (isApplyingControlledUpdateRef.current || transaction.getMeta(SILENT_SELECTION_META)) return;
    if (!snapshotChanged) {
      if (didComposerSelectionChangeVisibly(previousSelectionRange, nextSelectionRange)) {
        readCallbacks().onVisibleSelectionChange?.();
      }
      return;
    }
    // Ignore selection-only updates while a controlled rewrite is pending to avoid overwriting the new
    // prompt.
    if (previousSnapshot.value === nextValue && nextValue !== latestValueRef.current) {
      return;
    }
    snapshotRef.current = {
      value: nextValue,
      cursor: nextCursor,
      expandedCursor: nextExpandedCursor,
      contextIds,
    };
    const inCodeBlock = updated.state.selection.$from.parent.type.spec.code === true;
    const suppressTrigger =
      literalText ||
      inCodeBlock ||
      [updated.state.selection.$from.nodeBefore, updated.state.selection.$from.nodeAfter].some(
        (node) => node?.isInline && node.isAtom && !node.isText && node.type.name !== "hardBreak",
      );
    readCallbacks().onChange(
      nextValue,
      nextCursor,
      nextExpandedCursor,
      suppressTrigger,
      contextIds,
    );
  };

  const editorAttributes = {
    class: cn(
      "composer-tiptap -m-1 block max-h-52 min-h-[calc(2lh+--spacing(2))] overflow-y-auto p-1 whitespace-pre-wrap wrap-break-word bg-transparent leading-relaxed text-foreground focus:outline-none",
      className,
    ),
    "data-testid": "composer-editor",
    "data-composer-rich-text": richText ? "true" : "false",
    role: "textbox",
    "aria-multiline": "true",
    ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
    ...(ariaDescription ? { "aria-description": ariaDescription } : {}),
    ...(ariaInvalid ? { "aria-invalid": "true" } : {}),
    ...(disabled ? { "aria-readonly": "true" } : {}),
    ...(!disabled && suggestionListId
      ? {
          "aria-autocomplete": "list",
          "aria-haspopup": "listbox",
          ...(activeSuggestionId
            ? {
                "aria-controls": suggestionListId,
                "aria-activedescendant": activeSuggestionId,
              }
            : {}),
        }
      : {}),
    "aria-placeholder": placeholder,
  };

  const editor = useEditor(
    {
      extensions: richText ? RICH_TEXT_EXTENSIONS : PLAIN_TEXT_EXTENSIONS,
      content: buildDocJson(value, (name) => composerSkillMeta(skills, name), {
        styling: richText,
        literalText,
        isKnownModel: (instanceId, model) => modelKeys.has(modelMentionKey(instanceId, model)),
      }),
      editable: !disabled,
      editorProps: {
        attributes: editorAttributes,
        handleDOMEvents: {
          // Composer commands keep precedence; otherwise true skips the editor's keymaps without
          // preventDefault, so a bound app command still runs.
          keydown: (_view, event) => {
            if (!isRichTextFormattingShortcut(event)) return false;
            if (readCallbacks().onCommandKeyDown?.(event.key, event)) {
              event.preventDefault();
              event.stopPropagation();
              return true;
            }
            return hasCommandForKeyDown(event);
          },
        },
        handleKeyDown: (view, event) => {
          // In a right-to-left line the start is on the right.
          const backArrow = caretLineDirection(view.state) === "rtl" ? "ArrowRight" : "ArrowLeft";
          const boundary = event.metaKey
            ? event.key === "ArrowLeft" || event.key === "ArrowRight"
              ? "lineboundary"
              : event.key === "ArrowUp" || event.key === "ArrowDown"
                ? "documentboundary"
                : null
            : event.key === "Home" || event.key === "End"
              ? "lineboundary"
              : null;
          if (
            isMacPlatform(navigator.platform) &&
            boundary &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.isComposing
          ) {
            if (
              isThreadNavigationShortcut(event, appAtomRegistry.get(primaryServerKeybindingsAtom), {
                context: { editableFocus: true },
              })
            ) {
              return false;
            }
            const selection = window.getSelection();
            if (
              selection?.anchorNode &&
              view.dom.contains(selection.anchorNode) &&
              typeof selection.modify === "function"
            ) {
              event.preventDefault();
              event.stopPropagation();
              const backward =
                event.key === "Home" || event.key === "ArrowUp" || event.key === backArrow;
              selection.modify(
                event.shiftKey ? "extend" : "move",
                backward ? "backward" : "forward",
                boundary,
              );
              if (selection.anchorNode && selection.focusNode) {
                const tr = view.state.tr.setSelection(
                  TextSelection.create(
                    view.state.doc,
                    view.posAtDOM(selection.anchorNode, selection.anchorOffset),
                    view.posAtDOM(selection.focusNode, selection.focusOffset),
                  ),
                );
                // A marker has two caret stops at one document position. Keep
                // the outer stop when native navigation reaches a boundary.
                if (richText && tr.selection.empty) {
                  const { $head } = tr.selection;
                  tr.setStoredMarks((backward ? $head.nodeBefore : $head.nodeAfter)?.marks ?? []);
                }
                view.dispatch(tr.scrollIntoView());
              }
              return true;
            }
          }
          if (
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
            !event.shiftKey &&
            !event.altKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.isComposing &&
            view.state.selection.empty
          ) {
            const { $from } = view.state.selection;
            const direction = event.key === "ArrowUp" || event.key === backArrow ? -1 : 1;
            const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
            // At document edges, Up/Down may cross markers without changing position; record the stop to
            // preserve the caret.
            const atDocumentEdge =
              $from.pos ===
              (direction === -1
                ? TextSelection.atStart(view.state.doc).from
                : TextSelection.atEnd(view.state.doc).to);
            // Visit the styled edge's other stop before a chip so the plain stop stays reachable.
            const step =
              horizontal || atDocumentEdge
                ? stepCaretAcrossStyledEdge(view.state, direction)
                : null;
            if (step) {
              event.preventDefault();
              event.stopPropagation();
              view.dispatch(step);
              return true;
            }
            const adjacent = direction === -1 ? $from.nodeBefore : $from.nodeAfter;
            if (horizontal && adjacent?.type.name.startsWith("composer-")) {
              event.preventDefault();
              event.stopPropagation();
              view.dispatch(
                view.state.tr
                  .setSelection(
                    TextSelection.create(view.state.doc, $from.pos + direction * adjacent.nodeSize),
                  )
                  .scrollIntoView(),
              );
              return true;
            }
          }
          // Native tab order skips citation comment buttons inside the editor.
          if (
            event.key === "Tab" &&
            event.shiftKey &&
            !event.altKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            view.state.selection.empty
          ) {
            const { $from } = view.state.selection;
            const citation = $from.nodeBefore;
            if (citation?.type.name === "composer-citation") {
              const chip = view.nodeDOM($from.pos - citation.nodeSize);
              const commentButton =
                chip instanceof HTMLElement
                  ? chip.querySelector<HTMLElement>("[data-citation-comment-trigger]")
                  : null;
              if (commentButton) {
                event.preventDefault();
                event.stopPropagation();
                commentButton.focus();
                return true;
              }
            }
          }
          if (event.key === "Enter" && (event.isComposing || event.keyCode === 229)) {
            event.stopPropagation();
            return true;
          }
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            return true;
          }
          if (
            event.key === "Tab" &&
            !event.metaKey &&
            !event.ctrlKey &&
            selectionInOneCodeBlock(view.state)
          ) {
            event.preventDefault();
            event.stopPropagation();
            return indentCodeBlock(view.state, event.shiftKey ? "out" : "in", (tr) =>
              view.dispatch(tr),
            );
          }
          if (
            event.key === "Enter" &&
            richText &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.isComposing
          ) {
            if (selectionInOneCodeBlock(view.state)) {
              event.preventDefault();
              event.stopPropagation();
              const dispatch = (tr: typeof view.state.tr) => view.dispatch(tr.scrollIntoView());
              return (
                exitCodeBlockOnClosingFence(view.state, dispatch) ||
                exitCodeBlockOnTrailingBlankLines(view) ||
                indentedNewlineInCodeBlock(view.state, dispatch) ||
                newlineInCode(view.state, dispatch)
              );
            }
            if (convertCodeFenceOnEnter(view.state, (tr) => view.dispatch(tr))) {
              event.preventDefault();
              event.stopPropagation();
              return true;
            }
          }
          const handler = readCallbacks().onCommandKeyDown;
          if (event.key === "Enter") {
            const instance = (view.dom as TiptapEditorHTMLElement).editor;
            const isTaskItem = richText && (instance?.isActive("taskItem") ?? false);
            const isListItem = richText && (instance?.isActive("listItem") ?? false);
            const handled = handler?.("Enter", event, isTaskItem || isListItem) ?? false;
            if (handled) {
              event.preventDefault();
              event.stopPropagation();
              return true;
            }
            event.preventDefault();
            // A new line ends a token the way a typed space does.
            const { selection } = view.state;
            const chipped =
              !literalText && selection.empty
                ? chipTokenEndingAt(view.state, selection.from, "\n", skillLabelFor)
                : null;
            if (chipped) view.dispatch(chipped);
            if (
              (isTaskItem || isListItem) &&
              instance &&
              splitOrLiftListItem(instance, collapseShownMarkdownSource)
            ) {
              return true;
            }
            if (
              richText &&
              instance &&
              hasAncestor(view.state.selection.$from, "blockquote") &&
              view.state.selection.$from.parent.content.size === 0 &&
              instance.commands.lift("blockquote")
            ) {
              return true;
            }
            // Parse shown Markdown first, or the split leaves each half with one delimiter.
            if (instance) {
              return instance
                .chain()
                .command(collapseShownMarkdownSource)
                .command(({ state, dispatch }) => splitBlockKeepMarks(state, dispatch))
                .scrollIntoView()
                .run();
            }
            return splitBlockKeepMarks(view.state, (tr) => {
              view.dispatch(tr.scrollIntoView());
            });
          }
          if (!handler) return false;
          const handled = handler(event.key, event);
          if (handled) {
            event.preventDefault();
            event.stopPropagation();
          }
          return handled;
        },
        handleTextInput: (view, from, to, text) => {
          if (literalText || view.composing || text.length !== 1) return false;
          const chipped =
            from === to ? chipTokenEndingAt(view.state, from, text, skillLabelFor) : null;
          if (chipped) {
            view.dispatch(chipped.insertText(text).scrollIntoView());
            return true;
          }
          const closer = SURROUND_CLOSE[text];
          const { selection } = view.state;
          // Compose preedit updates replace a range even without a user selection.
          if (
            !closer ||
            !(selection instanceof TextSelection) ||
            selection.empty ||
            selection.from !== from ||
            selection.to !== to
          ) {
            return false;
          }
          // Do not wrap chips, atoms, or styled text; default replacement preserves marks.
          // Shown Markdown source is plain text, so typed delimiters wrap it.
          let touchesSpecial = false;
          view.state.doc.nodesBetween(from, to, (node) => {
            if (
              (node.isAtom && node.isInline && !node.isText) ||
              (node.isText && node.marks.some((mark) => mark.type.name !== MARKDOWN_SOURCE_MARK))
            ) {
              touchesSpecial = true;
              return false;
            }
            return true;
          });
          if (touchesSpecial) return false;
          const map = serializeEditorDoc(view.state.doc);
          const startMd = flatToMarkdown(map, pmToFlat(map, from));
          const endMd = flatToMarkdown(map, pmToFlat(map, to));
          if (selectionTouchesMentionBoundary(map.value, startMd, endMd)) return false;
          const markTr = surroundSelectionWithMark(view.state, from, to, text);
          if (markTr) {
            view.dispatch(markTr);
            return true;
          }
          const tr = view.state.tr.insertText(closer, to).insertText(text, from);
          tr.setSelection(TextSelection.create(tr.doc, from + text.length, to + text.length));
          view.dispatch(tr);
          return true;
        },
        handlePaste: (view, event) => {
          const clipboardData = event.clipboardData;
          if (!clipboardData || clipboardData.files.length > 0) return false;
          const pastedText = readPastedPlainText(clipboardData);
          if (!pastedText) return false;
          event.preventDefault();
          // Paste verbatim inside fences; markdown parsing would split blocks and create unsupported chips.
          if (isInCodeBlock(view)) {
            const { from, to } = view.state.selection;
            view.dispatch(
              markAsClipboardEdit(
                view.state.tr.insertText(pastedText, from, to),
                "paste",
              ).scrollIntoView(),
            );
            return true;
          }
          // Shown Markdown source is parsed when the caret leaves, so paste one line into it as text.
          const sourceType = view.state.schema.marks[MARKDOWN_SOURCE_MARK];
          const { from: pasteFrom, to: pasteTo, $from: $pasteFrom } = view.state.selection;
          if (
            sourceType?.isInSet($pasteFrom.marks()) &&
            !pastedText.includes("\n") &&
            collectComposerPromptInlineTokens(`${pastedText}\n`).length === 0
          ) {
            view.dispatch(
              markAsClipboardEdit(
                view.state.tr.insertText(pastedText, pasteFrom, pasteTo),
                "paste",
              ).scrollIntoView(),
            );
            return true;
          }
          let text = literalText
            ? pastedText
            : importPastedComposerText(clipboardData, readCallbacks().importContextFragment);
          const tokens = literalText ? [] : collectComposerPromptInlineTokens(`${text}\n`);
          const isChip = (token: (typeof tokens)[number] | undefined) =>
            token?.type === "mention" ||
            (token?.type === "skill" && skillLabelFor(token.value) !== null) ||
            (token?.type === "model" && isKnownModel(token.instanceId, token.model));
          const lastToken = tokens.at(-1);
          if (isChip(lastToken) && lastToken?.end === text.length) {
            text += " ";
          }
          if (isChip(tokens[0]) && tokens[0]?.start === 0) {
            const map = serializeEditorDoc(view.state.doc);
            const offset = flatToMarkdown(map, pmToFlat(map, view.state.selection.from));
            if (offset > 0 && !/\s/.test(map.value[offset - 1]!)) text = ` ${text}`;
          }
          const { $from } = view.state.selection;
          const lineBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "\uFFFC");
          const literalLength = literalText
            ? 0
            : pastedPathQueryLength(lineBefore, text, readCallbacks().isPathQueryActive?.());
          const editorInstance = (view.dom as TiptapEditorHTMLElement).editor;
          if (editorInstance) {
            const $paste = view.state.selection.$from;
            const nested = ["listItem", "taskItem", "blockquote"].some((name) =>
              hasAncestor($paste, name),
            );
            insertMarkdownParagraphs(
              text,
              skillLabelFor,
              { styling: richText, blocks: !nested, literalText, literalLength, isKnownModel },
              (content) => {
                editorInstance
                  .chain()
                  .command(({ tr }) => {
                    markAsClipboardEdit(tr, "paste");
                    return true;
                  })
                  // Pasted chips and lines would split shown Markdown, so parse it first.
                  .command(collapseShownMarkdownSource)
                  .insertContent(content)
                  .command(({ tr }) => {
                    // Move after a pasted rule so the next keystroke cannot replace it; add a trailing line
                    // if needed.
                    const { selection } = tr;
                    if (!(selection instanceof NodeSelection) || !selection.node.isBlock) {
                      return true;
                    }
                    if (!tr.doc.resolve(selection.to).nodeAfter?.isTextblock) {
                      tr.insert(selection.to, tr.doc.type.schema.nodes.paragraph!.create());
                    }
                    tr.setSelection(TextSelection.create(tr.doc, selection.to + 1));
                    return true;
                  })
                  .run();
              },
            );
            scrollTiptapCaretIntoView(editorInstance);
          }
          return true;
        },
      },
      onUpdate: ({ editor: updated, transaction }) => {
        // Undo can restore a chip for a skill or model the environment no longer offers.
        if (!literalText && isHistoryTransaction(transaction)) {
          const stale = skillChipReplacements(
            updated.state.doc,
            skillLabelFor,
            isKnownModel,
          ).filter(({ node }) => node.isText);
          if (stale.length > 0) {
            replaceSkillChips(updated, stale);
            return;
          }
        }
        handleEditorChange(updated, transaction);
      },
      onSelectionUpdate: ({ editor: updated, transaction }) => {
        handleEditorChange(updated, transaction);
      },
    },
    [],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the disabled prop into the imperative Tiptap editor via setEditable
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies loading-link decorations and a waiting detached focus once the Tiptap view has mounted
  useLayoutEffect(() => {
    if (!editor) return;
    const apply = () => {
      setComposerLoadingLinks(editor.view, loadingLinkUrls ?? []);
      if (!isDetachedChatWindow) return;
      const dom = editor.view.dom;
      deliverPendingDetachedComposerFocus({
        connected: dom.isConnected,
        eligible: detachedComposerWindowCanFocus(document),
        focus: () => {
          editor.view.focus();
        },
      });
    };
    if (editor.isInitialized) {
      apply();
      return;
    }
    editor.on("create", apply);
    return () => {
      editor.off("create", apply);
    };
  }, [editor, loadingLinkUrls]);

  // Push attributes before layout measurements; Tiptap updates them later in a passive effect.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes DOM attributes into the ProseMirror view before layout measurements read them
  useLayoutEffect(() => {
    if (!editor?.isInitialized) return;
    editor.view.setProps({ attributes: editorAttributes });
  }, [editor, editorAttributes]);

  const readSnapshot = () => {
    const snapshot = snapshotRef.current;
    if (!editor) return snapshot;
    const map = serializeEditorDoc(editor.state.doc);
    const { from, to } = editor.state.selection;
    const fromFlat = pmToFlat(map, from);
    const expandedCursor = Math.max(0, Math.min(map.value.length, flatToMarkdown(map, fromFlat)));
    const next: typeof snapshot = {
      value: map.value,
      cursor: collapseExpandedComposerCursor(map.value, expandedCursor, literalText),
      expandedCursor,
      contextIds: literalText ? [] : [...map.contextIds],
    };
    const toFlat = pmToFlat(map, to);
    selectionRangeRef.current = {
      start: Math.min(next.expandedCursor, flatToMarkdown(map, toFlat)),
      end: Math.max(next.expandedCursor, flatToMarkdown(map, toFlat)),
    };
    snapshotRef.current = next;
    return next;
  };

  // Save citation drafts before controlled rewrites unmount their node views.
  const saveCitationDraft = useEffectEvent((current: TiptapEditor, replacedValue: string) => {
    const draft = citationDraftRef.current;
    citationDraftRef.current = null;
    if (!draft || !onCitationDraftSave) return;
    const [target] = findChildren(
      current.state.doc,
      (node) => node.type.name === "composer-citation" && node.attrs.citeKey === draft.key,
    );
    if (!target) return;
    const { node, pos } = target;
    const citation = node.attrs.citation as AssistantCitation;
    const dismissal = resolveAssistantCitationCommentDismissal({
      reason: "none",
      draft: draft.comment,
      savedComment: citation.comment,
    });
    if (dismissal.kind !== "commit") return;
    const next = withAssistantCitationComment(citation, dismissal.comment);
    current.view.dispatch(
      current.state.tr
        .setNodeMarkup(pos, undefined, {
          ...node.attrs,
          citation: next,
          source: serializeAssistantCitation(next),
        })
        .setMeta("addToHistory", false),
    );
    onCitationDraftSave(replacedValue, serializeEditorDoc(current.state.doc).value);
  });

  // The one place the controlled value reaches the editor. Imperative handlers compare against
  // the committed value, so it is recorded here even before the editor exists.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the controlled value and cursor into the Tiptap document before paint
  useLayoutEffect(() => {
    latestValueRef.current = value;
    if (!editor) return;
    const initialSelection = !hasAppliedControlledSelectionRef.current;
    hasAppliedControlledSelectionRef.current = true;
    const normalizedCursor = clampEditorCursor(value, cursor);
    const previousSnapshot = snapshotRef.current;
    if (
      !initialSelection &&
      previousSnapshot.value === value &&
      previousSnapshot.cursor === normalizedCursor
    ) {
      return;
    }
    const normalizedExpandedCursor = initialSelection
      ? initialExpandedCursor
      : expandEditorCursor(value, normalizedCursor);
    snapshotRef.current = {
      value,
      cursor: normalizedCursor,
      expandedCursor: normalizedExpandedCursor,
      contextIds: collectInlineContextIds(value),
    };
    selectionRangeRef.current = {
      start: normalizedExpandedCursor,
      end: normalizedExpandedCursor,
    };
    setIsEmpty(value.length === 0);
    const rootElement = editor.view.dom;
    const isFocused = Boolean(rootElement && document.activeElement === rootElement);
    if (!initialSelection && previousSnapshot.value === value && !isFocused) return;

    isApplyingControlledUpdateRef.current = true;
    const pendingCitation =
      citationRequestRef.current?.value === value ? citationRequestRef.current : null;
    if (previousSnapshot.value !== value) {
      saveCitationDraft(editor, previousSnapshot.value);
      editor.commands.setContent(
        buildDocJson(value, skillLabelFor, { styling: richText, literalText, isKnownModel }),
        {
          emitUpdate: false,
        },
      );
    }
    selectMarkdownOffset(editor, normalizedExpandedCursor);
    const map = serializeEditorDoc(editor.state.doc);
    if (isFocused) scrollTiptapCaretIntoView(editor);
    if (pendingCitation) {
      citationRequestRef.current = null;
      const target = map.runs.find(
        (run) =>
          run.kind === "token" &&
          run.nodeName === "composer-citation" &&
          run.mdStart === pendingCitation.citationStart,
      );
      if (target) {
        const node = editor.state.doc.nodeAt(target.pmPos);
        const citeKey = (node?.attrs as { citeKey?: string } | undefined)?.citeKey;
        if (citeKey) {
          setOpenCitation({
            key: citeKey,
            sourceAnchor: pendingCitation.sourceAnchor,
            removeOnCancel: pendingCitation.insertedSpaces,
          });
        }
      }
    }
    queueMicrotask(() => {
      isApplyingControlledUpdateRef.current = false;
    });
  }, [
    clampEditorCursor,
    cursor,
    editor,
    expandEditorCursor,
    initialExpandedCursor,
    literalText,
    richText,
    skillLabelFor,
    isKnownModel,
    value,
  ]);

  // Reconcile loaded or switched provider skills and models without rebuilding citation node views.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- replaces skill and model chip nodes in the Tiptap document when the provider skill or model list loads or changes
  useEffect(() => {
    if (!editor || literalText) return;
    const replacements = skillChipReplacements(
      editor.state.doc,
      (name) => composerSkillMeta(skills, name),
      (instanceId, model) => modelKeys.has(modelMentionKey(instanceId, model)),
    );
    if (replacements.length > 0) replaceSkillChips(editor, replacements);
  }, [editor, literalText, modelKeys, skills]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores ProseMirror focus and caret scroll when the keyed editor remounts, capturing focus on teardown
  useLayoutEffect(() => {
    if (!editor) return;
    if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      editor.view.focus();
      scrollTiptapCaretIntoView(editor);
    }
    return () => {
      // Capture focus before the keyed editor's DOM is removed.
      restoreFocusRef.current = editor.view.hasFocus();
    };
  }, [editor, restoreFocusRef]);

  const focusAt = (nextCursor: number, exactExpandedCursor?: number) => {
    if (!editor) return;
    // view.focus() writes selection immediately; bare DOM focus waits 20ms and can misplace fast dictation.
    editor.view.focus();
    if (snapshotRef.current.value !== latestValueRef.current) return;
    const boundedCursor = clampEditorCursor(snapshotRef.current.value, nextCursor);
    const expandedCursor =
      exactExpandedCursor ?? expandEditorCursor(snapshotRef.current.value, boundedCursor);
    selectMarkdownOffset(editor, expandedCursor);
    scrollTiptapCaretIntoView(editor);
    if (boundedCursor === snapshotRef.current.cursor) return;
    snapshotRef.current = {
      value: snapshotRef.current.value,
      cursor: boundedCursor,
      expandedCursor,
      contextIds: snapshotRef.current.contextIds,
    };
    selectionRangeRef.current = {
      start: snapshotRef.current.expandedCursor,
      end: snapshotRef.current.expandedCursor,
    };
    readCallbacks().onChange(
      snapshotRef.current.value,
      boundedCursor,
      snapshotRef.current.expandedCursor,
      literalText,
      snapshotRef.current.contextIds,
    );
  };

  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => {
        // The collapsed cursor cannot say where inside `$name` text a caret
        // sits, so restoring the caret passes along its exact offset.
        focusAt(snapshotRef.current.cursor, snapshotRef.current.expandedCursor);
      },
      focusAt: (cursor) => focusAt(cursor),
      focusAtEnd: () => {
        focusAt(
          literalText
            ? snapshotRef.current.value.length
            : collapseExpandedComposerCursor(
                snapshotRef.current.value,
                snapshotRef.current.value.length,
              ),
        );
      },
      readSelectionRange: () => {
        readSnapshot();
        return selectionRangeRef.current;
      },
      requestCitationComment: (request) => {
        citationRequestRef.current = request;
        if (!editor) return;
        const map = serializeEditorDoc(editor.state.doc);
        if (map.value !== request.value) return;
        const target = map.runs.find(
          (run) =>
            run.kind === "token" &&
            run.nodeName === "composer-citation" &&
            run.mdStart === request.citationStart,
        );
        if (!target) return;
        const node = editor.state.doc.nodeAt(target.pmPos);
        const citeKey = (node?.attrs as { citeKey?: string } | undefined)?.citeKey;
        if (citeKey) {
          citationRequestRef.current = null;
          setOpenCitation({
            key: citeKey,
            sourceAnchor: request.sourceAnchor,
            removeOnCancel: request.insertedSpaces,
          });
        }
      },
      readSnapshot,
      isCaretOnVisualEdge: (edge) => {
        const snapshot = readSnapshot();
        if (snapshot.value.length === 0) return true;
        const beforeCaret = snapshot.value.slice(0, snapshot.expandedCursor);
        const afterCaret = snapshot.value.slice(snapshot.expandedCursor);
        if (edge === "start" ? beforeCaret.includes("\n") : afterCaret.includes("\n")) {
          return false;
        }
        const rootElement = editor?.view.dom;
        const selection = window.getSelection();
        if (
          !rootElement ||
          !selection ||
          !selection.isCollapsed ||
          selection.rangeCount === 0 ||
          !selection.anchorNode ||
          !rootElement.contains(selection.anchorNode)
        ) {
          return false;
        }
        const caretRect = caretLineRect(selection.getRangeAt(0), edge);
        if (!caretRect) return false;
        const edgeElement =
          edge === "start" ? rootElement.firstElementChild : rootElement.lastElementChild;
        const edgeRect = (edgeElement ?? rootElement).getBoundingClientRect();
        const threshold = caretRect.height / 2;
        return edge === "start"
          ? caretRect.top - edgeRect.top < threshold
          : edgeRect.bottom - caretRect.bottom < threshold;
      },
    }),
    [editor, focusAt, literalText, readSnapshot],
  );

  const handleCopyCut = (event: React.ClipboardEvent, cut: boolean) => {
    const build = buildContextClipboardFragment;
    if (!editor || (cut && !editor.isEditable)) return;
    const clipboardData = event.clipboardData;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = serializeSelection(editor.state.doc, from, to);
    const contextIds = literalText ? [] : Array.from(new Set(collectInlineContextIds(text)));
    const fragment = contextIds.length > 0 ? build?.(contextIds) : null;
    event.preventDefault();
    clipboardData.setData("text/plain", text);
    if (fragment) {
      clipboardData.setData(COMPOSER_CONTEXT_CLIPBOARD_MIME, fragment);
      clipboardData.setData("text/html", encodeComposerContextClipboardHtml(text, fragment));
    }
    if (cut) {
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          markAsClipboardEdit(tr, "cut");
          return true;
        })
        .deleteSelection()
        .run();
    }
  };

  return (
    <RichComposerSkillsContext value={skills}>
      <ComposerContextRecordsContext value={contextRecords}>
        <ComposerCitationCommentContext value={citationCommentActions}>
          <div
            {...colorCodeHover.containerProps}
            className={cn(
              "relative flow-root font-(family-name:--font-composer,var(--font-sans)) text-(length:--font-size-prompt,var(--text-sm)) max-sm:pointer-coarse:text-(length:--font-size-prompt-touch)",
              containerClassName,
            )}
          >
            <EditorContent
              editor={editor}
              onKeyDown={(event) => {
                if (
                  event.key === "Control" ||
                  event.key === "Meta" ||
                  event.key === "Alt" ||
                  event.key === "Shift"
                ) {
                  onPageScrollRelease?.();
                }
                if (event.key !== "PageUp" && event.key !== "PageDown") return;
                const target = event.currentTarget.querySelector(
                  '[data-testid="composer-editor"]',
                ) as HTMLElement | null;
                if (!target) return;
                const pageScrollKey = getTimelinePageScrollKey({
                  altKey: event.altKey,
                  clientHeight: target.clientHeight,
                  ctrlKey: event.ctrlKey,
                  defaultPrevented: event.defaultPrevented,
                  isComposing: event.nativeEvent.isComposing,
                  key: event.key,
                  keyCode: event.keyCode,
                  metaKey: event.metaKey,
                  scrollHeight: target.scrollHeight,
                  scrollTop: target.scrollTop,
                  shiftKey: event.shiftKey,
                });
                if (!pageScrollKey) {
                  onPageScrollRelease?.();
                  return;
                }
                if (!onPageScrollKeyDown) return;
                event.preventDefault();
                onPageScrollKeyDown(pageScrollKey);
              }}
              onKeyUp={(event) => onPageScrollKeyUp?.(event.key)}
              onBlur={onPageScrollRelease}
              onPasteCapture={onPaste}
              onCopyCapture={(event) => handleCopyCut(event, false)}
              onCutCapture={(event) => handleCopyCut(event, true)}
            />
            {isEmpty && contextRecords.size === 0 && placeholder ? (
              <div
                className={cn(
                  "pointer-events-none absolute inset-0 leading-relaxed text-placeholder",
                  placeholderClassName,
                )}
              >
                {placeholder}
                {placeholderSuffix}
              </div>
            ) : null}
            {colorCodeHover.popover}
          </div>
        </ComposerCitationCommentContext>
      </ComposerContextRecordsContext>
    </RichComposerSkillsContext>
  );
}

/** Split newlines into paragraphs; trailing hard breaks render no visible line. */
function insertMarkdownParagraphs(
  value: string,
  skillLabelFor: (name: string) => SkillMeta | null,
  options: {
    styling: boolean;
    blocks?: boolean;
    literalText?: boolean;
    literalLength?: number;
    isKnownModel?: IsKnownModel;
  },
  insertContent: (content: JSONContent[] | JSONContent) => void,
): void {
  const blocks = buildTiptapContent(value, skillLabelFor, options);
  if (blocks.length === 1 && blocks[0]?.type === "paragraph") {
    const inline = (blocks[0]?.content ?? []) as JSONContent[];
    if (inline.length === 0) return;
    insertContent(inline);
    return;
  }
  insertContent(blocks as JSONContent[]);
}

/** Placing the caret can show Markdown markers, so place it again in the shown source. */
function selectMarkdownOffset(editor: TiptapEditor, offset: number): void {
  for (let pass = 0; pass < 2; pass += 1) {
    const map = serializeEditorDoc(editor.state.doc);
    const pos = flatToPm(map, markdownToFlat(map, offset));
    const { selection } = editor.state;
    if (pass > 0 && selection.empty && selection.from === pos) return;
    editor.commands.setTextSelection(pos);
  }
}

/** Native scrolling follows only real input; explicitly reveal programmatically placed carets. */
function scrollTiptapCaretIntoView(editor: TiptapEditor): void {
  editor.view.dispatch(editor.state.tr.scrollIntoView());
}

function caretLineRect(range: Range, edge: "start" | "end"): DOMRect | null {
  const collapsedRects = Array.from(range.getClientRects()).filter((rect) => rect.height > 0);
  const collapsedRect = edge === "start" ? collapsedRects.at(-1) : collapsedRects[0];
  if (collapsedRect) return collapsedRect;

  const container = range.startContainer;
  if (container.nodeType === 3) {
    const textNode = container as Text;
    if (textNode.data.length === 0) return null;
    const probeStart = Math.max(
      0,
      Math.min(
        edge === "start" ? range.startOffset : range.startOffset - 1,
        textNode.data.length - 1,
      ),
    );
    const probeRange = document.createRange();
    probeRange.setStart(textNode, probeStart);
    probeRange.setEnd(textNode, probeStart + 1);
    const probeRect = Array.from(probeRange.getClientRects()).find((rect) => rect.height > 0);
    if (probeRect) return probeRect;
    const boundingRect = probeRange.getBoundingClientRect();
    return boundingRect.height > 0 ? boundingRect : null;
  }

  if (!(container instanceof HTMLElement)) return null;
  const neighbour =
    container.childNodes[Math.max(0, range.startOffset - 1)] ??
    container.childNodes[range.startOffset];
  if (neighbour instanceof HTMLElement) {
    const neighbourRect = neighbour.getBoundingClientRect();
    if (neighbourRect.height > 0) return neighbourRect;
  } else if (neighbour instanceof Text && neighbour.data.length > 0) {
    const isBeforeCaret = neighbour === container.childNodes[range.startOffset - 1];
    const probeStart = isBeforeCaret ? neighbour.data.length - 1 : 0;
    const probeRange = document.createRange();
    probeRange.setStart(neighbour, probeStart);
    probeRange.setEnd(neighbour, probeStart + 1);
    const probeRect = Array.from(probeRange.getClientRects()).find((rect) => rect.height > 0);
    if (probeRect) return probeRect;
  }
  const containerRect = container.getBoundingClientRect();
  return containerRect.height > 0 ? containerRect : null;
}
