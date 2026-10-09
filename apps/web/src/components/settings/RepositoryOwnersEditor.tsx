import { MAX_CONTEXT_REPOSITORY_OWNERS } from "@t3tools/contracts";
import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Adds owners from free text: one or several, separated by commas or spaces. Owners already in
 * the list (case-insensitively) are skipped, so pasting a list twice is harmless.
 */
export function addRepositoryOwners(
  owners: ReadonlyArray<string>,
  text: string,
): ReadonlyArray<string> {
  const next = [...owners];
  for (const owner of text.split(/[\s,]+/)) {
    if (owner.length === 0) continue;
    if (next.some((existing) => existing.toLowerCase() === owner.toLowerCase())) continue;
    next.push(owner);
  }
  return next.slice(0, MAX_CONTEXT_REPOSITORY_OWNERS);
}

/** Adds owners to the end of the list on Enter or blur. */
export function RepositoryOwnersAddInput(props: {
  readonly owners: ReadonlyArray<string>;
  readonly mixed: boolean;
  readonly onChange: (owners: ReadonlyArray<string>) => void;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    if (draft.trim().length === 0) return;
    props.onChange(addRepositoryOwners(props.owners, draft));
    setDraft("");
  };
  return (
    <Input
      size="sm"
      className="w-full sm:w-72"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      disabled={props.owners.length >= MAX_CONTEXT_REPOSITORY_OWNERS}
      placeholder={props.mixed ? "Mixed" : "Add an owner, e.g. acme"}
      spellCheck={false}
      aria-label="Add repository owner"
    />
  );
}

/** The owners, highest priority first, with reorder and remove per row. */
export function RepositoryOwnersList(props: {
  readonly owners: ReadonlyArray<string>;
  readonly onChange: (owners: ReadonlyArray<string>) => void;
}) {
  const { owners, onChange } = props;
  if (owners.length === 0) return null;
  const move = (index: number, offset: -1 | 1) => {
    const next = [...owners];
    const [owner] = next.splice(index, 1);
    next.splice(index + offset, 0, owner!);
    onChange(next);
  };
  return (
    <ol className="mt-2 flex flex-col gap-0.5">
      {owners.map((owner, index) => (
        <li key={owner} className="flex items-center gap-2 text-sm">
          <span className="w-5 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 truncate">{owner}</span>
          <span className="flex shrink-0 items-center gap-0.5">
            <OwnerAction
              label="Move up"
              ariaLabel={`Move ${owner} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUpIcon />
            </OwnerAction>
            <OwnerAction
              label="Move down"
              ariaLabel={`Move ${owner} down`}
              disabled={index === owners.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDownIcon />
            </OwnerAction>
            <OwnerAction
              label="Remove"
              ariaLabel={`Remove ${owner}`}
              onClick={() => onChange(owners.filter((_, other) => other !== index))}
            >
              <XIcon />
            </OwnerAction>
          </span>
        </li>
      ))}
    </ol>
  );
}

function OwnerAction(props: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-micro"
            variant="ghost-muted"
            disabled={props.disabled ?? false}
            onClick={props.onClick}
            aria-label={props.ariaLabel}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="top">{props.label}</TooltipPopup>
    </Tooltip>
  );
}
