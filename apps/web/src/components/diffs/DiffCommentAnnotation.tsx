import * as Schema from "effect/Schema";
import { ChevronDownIcon, MessageCircle, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";

import { Button } from "~/components/ui/button";
import { Group, GroupSeparator } from "~/components/ui/group";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { readLocalApi } from "~/localApi";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  PullRequestMarkdownTextarea,
  type PullRequestCompletionScope,
} from "~/components/pullRequest/PullRequestMarkdownTextarea";
import {
  SpeechTextField,
  TextFieldSpeechControls,
  type TextFieldSpeech,
} from "~/speech/useTextFieldSpeech";
import { textDirection } from "~/textDirection";

import { isCommentSubmitShortcut } from "./commentSubmitShortcut";

/**
 * Hands the comment to the agent instead of the review: sent now, left in its composer, or kept
 * as a draft on its thread to send later.
 */
interface DiffCommentAgentAction {
  readonly send: (text: string) => void;
  readonly addToComposer: (text: string) => void;
  /** Absent where the comment would land in a new thread, which has nowhere to keep drafts. */
  readonly saveDraft?: ((text: string) => void) | undefined;
}

const AgentActionChoiceSchema = Schema.Literals(["send", "composer"]);
type AgentActionChoice = typeof AgentActionChoiceSchema.Type;
const AGENT_ACTION_CHOICE_STORAGE_KEY = "t3code:diff-comment-agent-action:v1";

const AGENT_ACTION_CHOICES = {
  send: { label: "Send to agent", description: "Starts a turn now" },
  composer: { label: "Add to composer", description: "Insert as a chip and keep writing" },
} as const satisfies Record<AgentActionChoice, { label: string; description: string }>;

// Not a remembered choice: a draft is a one-off detour, not how the reader usually hands over.
const SAVE_DRAFT_ACTION = {
  label: "Save as draft",
  description: "Keep it in the thread to send later",
} as const;

interface DiffCommentAnnotationProps {
  /** With an environment, the draft can be dictated; its project supplies vocabulary. */
  environmentId?: EnvironmentId | undefined;
  projectId?: ProjectId | null | undefined;
  ownerKey?: string;
  kind: "draft" | "comment";
  rangeLabel: string;
  text: string;
  onTextChange?: (text: string) => void;
  onCancel: () => void;
  /** Omitted where a comment can only go to the agent. */
  onComment?: (text: string) => void;
  onDelete?: () => void;
  placeholder?: string;
  submitLabel?: string;
  pending?: boolean;
  agentAction?: DiffCommentAgentAction;
  focusOnMount?: boolean;
  /** Set only for pull request comments, where `@` completes the repository's users. */
  completionScope?: PullRequestCompletionScope | null;
}

export function DiffCommentAnnotation({
  environmentId,
  projectId,
  ownerKey,
  kind,
  rangeLabel,
  text,
  onTextChange,
  onCancel,
  onComment,
  onDelete,
  placeholder = "Add a comment…",
  submitLabel = "Comment",
  pending = false,
  agentAction,
  focusOnMount = true,
  completionScope = null,
}: DiffCommentAnnotationProps) {
  const [localDraftText, setLocalDraftText] = useState("");
  const displayedText = kind === "draft" && !onTextChange ? localDraftText : text;
  const trimmedText = displayedText.trim();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const shortcutHint =
    agentAction && onComment
      ? "⌘/Ctrl Enter for review, with Shift for agent"
      : "⌘/Ctrl Enter to send";
  const [agentChoice, setAgentChoice] = useLocalStorage(
    AGENT_ACTION_CHOICE_STORAGE_KEY,
    "send",
    AgentActionChoiceSchema,
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the draft textarea on the next animation frame after mount
  useLayoutEffect(() => {
    if (kind !== "draft" || !focusOnMount) return;
    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusOnMount, kind]);

  if (kind === "comment") {
    return (
      <div
        data-diff-comment-annotation
        className="group/comment flex min-w-0 items-start gap-2.5 border-s-2 border-primary/55 bg-primary/[0.045] px-3 py-2.5 font-sans text-foreground selection:bg-primary selection:text-primary-foreground"
        contentEditable={false}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <MessageCircle className="size-3.5 h-5 shrink-0 text-primary/70" aria-hidden="true" />
        <p
          className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-5"
          dir={textDirection(displayedText)}
        >
          {displayedText}
        </p>
        {onDelete ? (
          <span className="-my-1 -mr-1 flex shrink-0 opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Delete comment"
              onClick={onDelete}
            >
              <Trash2 className="size-3" />
            </Button>
          </span>
        ) : null}
      </div>
    );
  }

  const submit = (
    speech: TextFieldSpeech | undefined,
    action: (text: string) => void,
    allowEmpty = false,
  ) => {
    const finish = (value: string) => {
      if (!pending && (allowEmpty || value.trim())) action(value.trim());
    };
    if (speech) speech.submitAfterDictation(finish);
    else finish(displayedText);
  };

  // Pierre hides native carets and selection; textarea comments need their own visible feedback.
  const renderDraft = (speech?: TextFieldSpeech) => (
    <div
      data-diff-comment-annotation
      className="px-3 py-2 font-sans text-foreground caret-foreground selection:bg-primary selection:text-primary-foreground"
      contentEditable={false}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <PullRequestMarkdownTextarea
        ref={textareaRef}
        completionScope={completionScope}
        readOnly={speech?.freezesEditor}
        autoFocus={focusOnMount}
        size="sm"
        value={displayedText}
        dir={textDirection(displayedText)}
        placeholder={placeholder}
        aria-label={`Comment on lines ${rangeLabel}`}
        onValueChange={onTextChange ?? setLocalDraftText}
        onFocus={(event) => {
          const end = event.currentTarget.value.length;
          event.currentTarget.setSelectionRange(end, end);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (speech && speech.state.phase !== "idle") speech.cancel();
            else onCancel();
          }
          if (!isCommentSubmitShortcut(event, trimmedText, pending)) return;
          // Shift picks the agent where both are offered; the agent is all there is without a review.
          if (agentAction && (event.shiftKey || !onComment)) {
            event.preventDefault();
            agentAction[AGENT_ACTION_HANDLERS[agentChoice]](trimmedText);
          } else if (onComment) {
            event.preventDefault();
            submit(speech, onComment);
          }
        }}
      />
      <div className="mt-1.5 flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={<span className="mr-auto min-w-0 truncate text-3xs text-muted-foreground/70" />}
          >
            {shortcutHint}
          </TooltipTrigger>
          <TooltipPopup side="top">{shortcutHint}</TooltipPopup>
        </Tooltip>
        {speech ? <TextFieldSpeechControls speech={speech} disabled={pending} /> : null}
        <Button variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        {onComment ? (
          <Button
            size="xs"
            variant="outline"
            disabled={speech?.preparing || pending || (!speech?.blocksSubmission && !trimmedText)}
            onClick={() => submit(speech, onComment)}
          >
            {submitLabel}
          </Button>
        ) : null}
        {agentAction ? (
          <AgentActionButton
            action={agentAction}
            choice={agentChoice}
            onChoose={setAgentChoice}
            disabled={!trimmedText}
            primary={!onComment}
            text={trimmedText}
          />
        ) : null}
      </div>
    </div>
  );

  return environmentId ? (
    <SpeechTextField
      environmentId={environmentId}
      projectId={projectId}
      ownerKey={ownerKey ?? rangeLabel}
      text={displayedText}
      textareaRef={textareaRef}
      onTextChange={onTextChange ?? setLocalDraftText}
      disabled={pending}
    >
      {renderDraft}
    </SpeechTextField>
  ) : (
    renderDraft()
  );
}

const AGENT_ACTION_HANDLERS = {
  send: "send",
  composer: "addToComposer",
} as const satisfies Record<AgentActionChoice, keyof DiffCommentAgentAction>;

/**
 * The agent half of the form: the last way the reader handed a comment over, with the other one
 * a click away. Picking from the menu does it and makes it the default next time.
 */
function AgentActionButton(props: {
  action: DiffCommentAgentAction;
  choice: AgentActionChoice;
  onChoose: (choice: AgentActionChoice) => void;
  disabled: boolean;
  primary: boolean;
  text: string;
}) {
  const variant = props.primary ? "default" : "outline";
  const run = (choice: AgentActionChoice) => {
    props.onChoose(choice);
    props.action[AGENT_ACTION_HANDLERS[choice]](props.text);
  };
  const saveDraft = props.action.saveDraft;
  const openContextMenu = async (event: MouseEvent) => {
    event.preventDefault();
    const api = readLocalApi();
    if (!api || props.disabled) return;
    const selected = await api.contextMenu.show(
      [
        { id: "send", label: AGENT_ACTION_CHOICES.send.label, icon: "arrow-up" },
        { id: "composer", label: AGENT_ACTION_CHOICES.composer.label, icon: "message-square-plus" },
        ...(saveDraft ? [{ id: "draft", label: SAVE_DRAFT_ACTION.label, icon: "file-text" }] : []),
      ],
      { x: event.clientX, y: event.clientY },
    );
    if (selected === "send" || selected === "composer") run(selected);
    else if (selected === "draft") saveDraft?.(props.text);
  };
  return (
    <Group onContextMenu={(event) => void openContextMenu(event)}>
      <Button
        size="xs"
        variant={variant}
        disabled={props.disabled}
        onClick={() => run(props.choice)}
      >
        {AGENT_ACTION_CHOICES[props.choice].label}
      </Button>
      <GroupSeparator />
      <Menu>
        <MenuTrigger
          disabled={props.disabled}
          render={
            <Button size="icon-xs" variant={variant} aria-label="More ways to hand to the agent" />
          }
        >
          <ChevronDownIcon aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="end">
          {(["send", "composer"] as const).map((choice) => (
            <MenuItem key={choice} onClick={() => run(choice)}>
              <span className="flex min-w-0 flex-col py-0.5">
                <MenuItemLabel>{AGENT_ACTION_CHOICES[choice].label}</MenuItemLabel>
                <span className="truncate text-xs text-muted-foreground">
                  {AGENT_ACTION_CHOICES[choice].description}
                </span>
              </span>
            </MenuItem>
          ))}
          {saveDraft ? (
            <MenuItem onClick={() => saveDraft(props.text)}>
              <span className="flex min-w-0 flex-col py-0.5">
                <MenuItemLabel>{SAVE_DRAFT_ACTION.label}</MenuItemLabel>
                <span className="truncate text-xs text-muted-foreground">
                  {SAVE_DRAFT_ACTION.description}
                </span>
              </span>
            </MenuItem>
          ) : null}
        </MenuPopup>
      </Menu>
    </Group>
  );
}
