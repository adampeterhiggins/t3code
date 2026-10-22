import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import {
  ASSISTANT_CITATION_MAX_COMMENT_LENGTH,
  type AssistantCitation,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ChevronDownIcon } from "lucide-react";
import { useRef, useState, type MouseEvent, type RefObject } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { readLocalApi } from "~/localApi";
import { useThreadShell } from "~/state/entities";

import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  CITATION_DESTINATION_HERE,
  type CitationDestination,
  type CitationDestinationAction,
} from "./citationDestination";
import { CitationDestinationPicker } from "./CitationDestinationPicker";
import { composerFloatingLayerProps } from "./composerEventScope";

const SubmitChoiceSchema = Schema.Literals(["send", "save"]);
type SubmitChoice = typeof SubmitChoiceSchema.Type;
const SUBMIT_CHOICE_STORAGE_KEY = "t3code:citation-comment-submit:v1";

const SUBMIT_CHOICES = {
  send: { label: "Send", description: "Send this quote now, apart from the composer" },
  save: { label: "Save", description: "Keep writing in the composer" },
} as const satisfies Record<SubmitChoice, { label: string; description: string }>;

const SAVE_DRAFT_CHOICE = {
  label: "Save as draft",
  description: "Keep the message in this thread to send later",
} as const;

// While a turn runs, sending follows the composer's follow-up setting, which may queue.
const QUEUE_SUBMIT_CHOICE = {
  label: "Add to queue",
  description: "Queue this quote for after this turn, apart from the composer",
} as const;

type SubmitChoices = Record<
  SubmitChoice,
  { label: string; description: string; contextMenuLabel?: string }
>;
type DraftChoice = { label: string; description: string };

/** Lets the panel send the citation to another thread instead of the composer it sits in. */
export interface AssistantCitationDestinations {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  /** A new thread starts in this project with this model until the reader picks others. */
  projectId: ProjectId;
  modelSelection: ModelSelection;
  followUpBehavior: "queue" | "steer";
  onSubmit: (
    destination: Exclude<CitationDestination, { kind: "here" }>,
    action: CitationDestinationAction,
    comment: string,
  ) => boolean;
}

function elsewhereChoices(
  destination: Exclude<CitationDestination, { kind: "here" }>,
  queues: boolean,
): { choices: SubmitChoices; draft: DraftChoice | null } {
  if (destination.kind === "new-thread") {
    return {
      choices: {
        send: { label: "Start thread", description: "Start a new thread with this quote" },
        save: {
          label: "Save",
          description: "Open a new thread with this quote in its composer",
          contextMenuLabel: "Save to a new thread",
        },
      },
      draft: null,
    };
  }
  const title = destination.title || "that thread";
  return {
    choices: {
      send: queues
        ? { label: "Add to queue", description: `Send to ${title} after its current turn` }
        : { label: "Send", description: `Send this quote to ${title} now` },
      save: {
        label: "Save",
        description: `Add it to ${title}'s composer to keep writing there`,
        contextMenuLabel: "Save to its composer",
      },
    },
    draft: { label: "Save as draft", description: `Keep the message in ${title} to send later` },
  };
}

export function AssistantCitationCommentEditor({
  citation,
  inputRef,
  onSubmit,
  onSubmitAndSend,
  onSubmitAndSaveDraft,
  submitAndSendQueues = false,
  onCancel,
  onDraftChange,
  destinations,
}: {
  citation: AssistantCitation;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  onSubmit: (comment: string) => boolean;
  onSubmitAndSend?: (comment: string) => boolean;
  /** Saves the comment into the prompt, then keeps the whole message as a thread draft. */
  onSubmitAndSaveDraft?: (comment: string) => boolean;
  submitAndSendQueues?: boolean;
  onCancel: () => void;
  onDraftChange?: (comment: string) => void;
  destinations?: AssistantCitationDestinations | undefined;
}) {
  const [comment, setComment] = useState(citation.comment ?? "");
  const ownTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? ownTextareaRef;
  const [choice, setChoice] = useLocalStorage(
    SUBMIT_CHOICE_STORAGE_KEY,
    "send",
    SubmitChoiceSchema,
  );
  // Always starts here, so a cite never lands in another thread without the reader choosing it.
  const [destination, setDestination] = useState<CitationDestination>(CITATION_DESTINATION_HERE);
  const elsewhere = destinations && destination.kind !== "here" ? destination : null;
  const targetThread = useThreadShell(
    destinations && elsewhere?.kind === "thread"
      ? scopeThreadRef(destinations.environmentId, elsewhere.threadId)
      : null,
  );
  const elsewhereQueues =
    destinations?.followUpBehavior === "queue" && threadRuntimeIsActive(targetThread?.runtime);
  const elsewhereMenu = elsewhere ? elsewhereChoices(elsewhere, elsewhereQueues) : null;
  // Without a send path the button only saves, so Enter must too.
  const enterChoice: SubmitChoice = onSubmitAndSend || elsewhere ? choice : "save";
  const commentTooLong = comment.length > ASSISTANT_CITATION_MAX_COMMENT_LENGTH;
  const submitElsewhere = (action: CitationDestinationAction) => {
    if (!commentTooLong && elsewhere) destinations?.onSubmit(elsewhere, action, comment);
  };
  const submit = () => {
    if (elsewhere) return submitElsewhere("save");
    if (!commentTooLong) onSubmit(comment);
  };
  const submitAndSend = () => {
    if (elsewhere) return submitElsewhere("send");
    if (commentTooLong) return;
    if (onSubmitAndSend) {
      onSubmitAndSend(comment);
    } else {
      onSubmit(comment);
    }
  };
  const runChoice = (next: SubmitChoice) => (next === "send" ? submitAndSend() : submit());
  const sendVerb = elsewhere
    ? (elsewhereMenu?.choices.send.label.toLowerCase() ?? "send")
    : submitAndSendQueues
      ? "queue"
      : "send";
  const saveDraft = elsewhere
    ? elsewhereMenu?.draft
      ? () => submitElsewhere("draft")
      : undefined
    : onSubmitAndSaveDraft
      ? () => {
          if (!commentTooLong) onSubmitAndSaveDraft(comment);
        }
      : undefined;

  return (
    <div
      data-citation-comment-editor="true"
      onKeyDown={(event) => {
        // The destination picker portals out of this panel; its keys, Escape included, are its own.
        if (!(event.target instanceof Node && event.currentTarget.contains(event.target))) return;
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <textarea
        ref={textareaRef}
        aria-label="Comment on selected text"
        aria-description={
          enterChoice === "send"
            ? `Enter to save and ${sendVerb}; Command/Ctrl+Enter to save the citation comment; Shift+Enter for a new line.`
            : `Enter to save the citation comment; Command/Ctrl+Enter to save and ${sendVerb}; Shift+Enter for a new line.`
        }
        aria-invalid={commentTooLong || undefined}
        placeholder="Add an optional comment..."
        rows={2}
        className="field-sizing-content block max-h-40 min-h-16 w-full resize-none bg-transparent px-1 py-1.5 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
        value={comment}
        onChange={(event) => {
          setComment(event.currentTarget.value);
          onDraftChange?.(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            // Enter does what the button shows; the modifier does the other choice.
            const alternate = event.metaKey || event.ctrlKey;
            runChoice(alternate ? (enterChoice === "send" ? "save" : "send") : enterChoice);
          }
        }}
      />
      {commentTooLong ? (
        <p role="status" className="pt-1 text-xs text-destructive">
          Comments can contain up to {ASSISTANT_CITATION_MAX_COMMENT_LENGTH.toLocaleString()}{" "}
          characters.
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-end gap-2">
        {destinations ? (
          <div className="me-auto flex min-w-0">
            <CitationDestinationPicker
              environmentId={destinations.environmentId}
              currentThreadId={destinations.threadId}
              defaultProjectId={destinations.projectId}
              defaultModelSelection={destinations.modelSelection}
              destination={destination}
              onChange={setDestination}
              onModelPicked={() => textareaRef.current?.focus()}
            />
          </div>
        ) : null}
        <Button
          variant="outline"
          size="xs"
          onPointerDown={(event) => event.preventDefault()}
          onClick={onCancel}
        >
          Cancel
        </Button>
        {onSubmitAndSend || elsewhereMenu ? (
          <SubmitChoiceButton
            disabled={commentTooLong}
            choices={
              elsewhereMenu?.choices ??
              (submitAndSendQueues
                ? { ...SUBMIT_CHOICES, send: QUEUE_SUBMIT_CHOICE }
                : SUBMIT_CHOICES)
            }
            draftChoice={elsewhereMenu ? elsewhereMenu.draft : SAVE_DRAFT_CHOICE}
            choice={choice}
            onRun={(next) => {
              setChoice(next);
              runChoice(next);
            }}
            {...(saveDraft ? { onSaveDraft: saveDraft } : {})}
          />
        ) : (
          <Button
            size="xs"
            disabled={commentTooLong}
            onPointerDown={(event) => event.preventDefault()}
            onClick={submit}
          >
            {commentTooLong ? "Shorten comment" : "Save"}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Mirrors the pull request comment form: the last way the reader finished a comment, with the
 * other a click away. Picking from the menu does it and makes it the default next time.
 */
function SubmitChoiceButton(props: {
  disabled: boolean;
  choices: SubmitChoices;
  draftChoice: DraftChoice | null;
  choice: SubmitChoice;
  onRun: (choice: SubmitChoice) => void;
  /** A one-off: saving as a draft is never remembered as the button's default. */
  onSaveDraft?: () => void;
}) {
  const { choices } = props;
  const draftChoice = props.onSaveDraft ? props.draftChoice : null;
  const openContextMenu = async (event: MouseEvent) => {
    event.preventDefault();
    const api = readLocalApi();
    if (!api || props.disabled) return;
    const selected = await api.contextMenu.show(
      [
        {
          id: "send",
          label: choices.send.label,
          icon: choices.send.label === QUEUE_SUBMIT_CHOICE.label ? "list-plus" : "arrow-up",
        },
        { id: "save", label: choices.save.contextMenuLabel ?? "Save to composer", icon: "check" },
        ...(draftChoice ? [{ id: "draft", label: draftChoice.label, icon: "file-text" }] : []),
      ],
      { x: event.clientX, y: event.clientY },
    );
    if (selected === "send" || selected === "save") props.onRun(selected);
    else if (selected === "draft") props.onSaveDraft?.();
  };
  return (
    <Group onContextMenu={(event) => void openContextMenu(event)}>
      <Button
        size="xs"
        disabled={props.disabled}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => props.onRun(props.choice)}
      >
        {props.disabled ? "Shorten comment" : choices[props.choice].label}
      </Button>
      <GroupSeparator />
      <Menu>
        <MenuTrigger
          disabled={props.disabled}
          render={<Button size="icon-xs" aria-label="More ways to finish the comment" />}
        >
          <ChevronDownIcon aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup {...composerFloatingLayerProps} align="end">
          {(["send", "save"] as const).map((option) => (
            <MenuItem key={option} onClick={() => props.onRun(option)}>
              <span className="flex min-w-0 flex-col py-0.5">
                <MenuItemLabel>{choices[option].label}</MenuItemLabel>
                <span className="truncate text-xs text-muted-foreground">
                  {choices[option].description}
                </span>
              </span>
            </MenuItem>
          ))}
          {draftChoice ? (
            <MenuItem onClick={props.onSaveDraft}>
              <span className="flex min-w-0 flex-col py-0.5">
                <MenuItemLabel>{draftChoice.label}</MenuItemLabel>
                <span className="truncate text-xs text-muted-foreground">
                  {draftChoice.description}
                </span>
              </span>
            </MenuItem>
          ) : null}
        </MenuPopup>
      </Menu>
    </Group>
  );
}
