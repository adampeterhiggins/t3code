import { ASSISTANT_CITATION_MAX_COMMENT_LENGTH, type AssistantCitation } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ChevronDownIcon } from "lucide-react";
import { useState, type Ref } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";

import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuTrigger } from "../ui/menu";
import { composerFloatingLayerProps } from "./composerEventScope";

const SubmitChoiceSchema = Schema.Literals(["send", "save"]);
type SubmitChoice = typeof SubmitChoiceSchema.Type;
const SUBMIT_CHOICE_STORAGE_KEY = "t3code:citation-comment-submit:v1";

const SUBMIT_CHOICES = {
  send: { label: "Send", description: "Save and send the message now" },
  save: { label: "Save", description: "Keep writing in the composer" },
} as const satisfies Record<SubmitChoice, { label: string; description: string }>;

export function AssistantCitationCommentEditor({
  citation,
  inputRef,
  onSubmit,
  onSubmitAndSend,
  onCancel,
  onDraftChange,
}: {
  citation: AssistantCitation;
  inputRef?: Ref<HTMLTextAreaElement>;
  onSubmit: (comment: string) => boolean;
  onSubmitAndSend?: (comment: string) => boolean;
  onCancel: () => void;
  onDraftChange?: (comment: string) => void;
}) {
  const [comment, setComment] = useState(citation.comment ?? "");
  const commentTooLong = comment.length > ASSISTANT_CITATION_MAX_COMMENT_LENGTH;
  const submit = () => {
    if (!commentTooLong) onSubmit(comment);
  };
  const submitAndSend = () => {
    if (commentTooLong) return;
    if (onSubmitAndSend) {
      onSubmitAndSend(comment);
    } else {
      onSubmit(comment);
    }
  };

  return (
    <div
      data-citation-comment-editor="true"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <textarea
        ref={inputRef}
        aria-label="Comment on selected text"
        aria-description="Enter to save the citation comment; Command/Ctrl+Enter to save and send; Shift+Enter for a new line."
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
            if (event.metaKey || event.ctrlKey) {
              submitAndSend();
            } else {
              submit();
            }
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
        <Button
          variant="outline"
          size="xs"
          onPointerDown={(event) => event.preventDefault()}
          onClick={onCancel}
        >
          Cancel
        </Button>
        {onSubmitAndSend ? (
          <SubmitChoiceButton
            disabled={commentTooLong}
            onRun={(choice) => (choice === "send" ? submitAndSend() : submit())}
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
function SubmitChoiceButton(props: { disabled: boolean; onRun: (choice: SubmitChoice) => void }) {
  const [choice, setChoice] = useLocalStorage(
    SUBMIT_CHOICE_STORAGE_KEY,
    "send",
    SubmitChoiceSchema,
  );
  const run = (next: SubmitChoice) => {
    setChoice(next);
    props.onRun(next);
  };
  return (
    <Group>
      <Button
        size="xs"
        disabled={props.disabled}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => run(choice)}
      >
        {props.disabled ? "Shorten comment" : SUBMIT_CHOICES[choice].label}
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
            <MenuItem key={option} onClick={() => run(option)}>
              <span className="flex min-w-0 flex-col py-0.5">
                <MenuItemLabel>{SUBMIT_CHOICES[option].label}</MenuItemLabel>
                <span className="truncate text-xs text-muted-foreground">
                  {SUBMIT_CHOICES[option].description}
                </span>
              </span>
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </Group>
  );
}
