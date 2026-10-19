import * as Schema from "effect/Schema";
import { ChevronDownIcon, MessageCircle, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Group, GroupSeparator } from "~/components/ui/group";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Textarea } from "~/components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useLocalStorage } from "~/hooks/useLocalStorage";

import { isCommentSubmitShortcut } from "./commentSubmitShortcut";

/** Hands the comment to the agent instead of the review: sent now, or left in its composer. */
interface DiffCommentAgentAction {
  readonly send: (text: string) => void;
  readonly addToComposer: (text: string) => void;
}

const AgentActionChoiceSchema = Schema.Literals(["send", "composer"]);
type AgentActionChoice = typeof AgentActionChoiceSchema.Type;
const AGENT_ACTION_CHOICE_STORAGE_KEY = "t3code:diff-comment-agent-action:v1";

const AGENT_ACTION_CHOICES = {
  send: { label: "Send to agent", description: "Starts a turn now" },
  composer: { label: "Add to composer", description: "Insert as a chip and keep writing" },
} as const satisfies Record<AgentActionChoice, { label: string; description: string }>;

interface DiffCommentAnnotationProps {
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
}

export function DiffCommentAnnotation({
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
        <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-primary/70" aria-hidden="true" />
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-5">{displayedText}</p>
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

  // Editable file annotations inherit Pierre's transparent native caret and selection.
  // Comments use a native textarea, so they need their own visible text feedback.
  return (
    <div
      data-diff-comment-annotation
      className="px-3 py-2 font-sans text-foreground caret-foreground selection:bg-primary selection:text-primary-foreground"
      contentEditable={false}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Textarea
        ref={textareaRef}
        autoFocus={focusOnMount}
        size="sm"
        value={displayedText}
        placeholder={placeholder}
        aria-label={`Comment on lines ${rangeLabel}`}
        onChange={(event) => (onTextChange ?? setLocalDraftText)(event.target.value)}
        onFocus={(event) => {
          const end = event.currentTarget.value.length;
          event.currentTarget.setSelectionRange(end, end);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if (!isCommentSubmitShortcut(event, trimmedText, pending)) return;
          // Shift picks the agent where both are offered; the agent is all there is without a review.
          if (agentAction && (event.shiftKey || !onComment)) {
            event.preventDefault();
            agentAction[AGENT_ACTION_HANDLERS[agentChoice]](trimmedText);
          } else if (onComment) {
            event.preventDefault();
            onComment(trimmedText);
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
        <Button variant="ghost-muted" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        {onComment ? (
          <Button
            size="xs"
            disabled={pending || !trimmedText}
            onClick={() => onComment(trimmedText)}
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
  return (
    <Group>
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
        </MenuPopup>
      </Menu>
    </Group>
  );
}
