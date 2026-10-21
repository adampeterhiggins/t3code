import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ChevronDownIcon, MessageSquareIcon, SquarePenIcon } from "lucide-react";
import { useState } from "react";

import { useProjects, useThreadShells } from "~/state/entities";

import { Button } from "../ui/button";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  CITATION_DESTINATION_HERE,
  rankCitationDestinationThreads,
  type CitationDestination,
} from "./citationDestination";
import { composerFloatingLayerProps } from "./composerEventScope";

function destinationLabel(destination: CitationDestination): string {
  switch (destination.kind) {
    case "here":
      return "This thread";
    case "new-thread":
      return "New thread";
    case "thread":
      return destination.title || "Untitled thread";
  }
}

/** The comment panel's "where does this go" control: this thread, a new thread, or any other. */
export function CitationDestinationPicker({
  environmentId,
  currentThreadId,
  destination,
  onChange,
}: {
  environmentId: EnvironmentId;
  currentThreadId: ThreadId;
  destination: CitationDestination;
  onChange: (destination: CitationDestination) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const threads = useThreadShells(open);
  const projects = useProjects();
  const projectTitles = new Map(
    projects
      .filter((project) => project.environmentId === environmentId)
      .map((project) => [project.id, project.title]),
  );
  const candidates = open
    ? rankCitationDestinationThreads({
        threads,
        projectTitles,
        environmentId,
        currentThreadId,
        query,
      })
    : [];
  const pick = (next: CitationDestination) => {
    onChange(next);
    setOpen(false);
    setQuery("");
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        aria-label={`Send citation to: ${destinationLabel(destination)}`}
        render={<Button variant="ghost" size="xs" className="min-w-0 max-w-52" />}
      >
        {destination.kind === "new-thread" ? (
          <SquarePenIcon aria-hidden="true" />
        ) : (
          <MessageSquareIcon aria-hidden="true" />
        )}
        <span className="truncate">{destinationLabel(destination)}</span>
        <ChevronDownIcon aria-hidden="true" />
      </PopoverTrigger>
      {open ? (
        <PopoverPopup
          {...composerFloatingLayerProps}
          side="bottom"
          align="start"
          width="lg"
          padding="none"
          aria-label="Choose where the citation goes"
        >
          <Command
            mode="none"
            value={query}
            onValueChange={setQuery}
            aria-label="Choose where the citation goes"
          >
            <CommandInput placeholder="Search threads..." />
            <CommandList className="max-h-72 overflow-y-auto">
              <CommandItem value="here" onClick={() => pick(CITATION_DESTINATION_HERE)}>
                <MessageSquareIcon aria-hidden className="size-4 shrink-0" />
                <span className="flex-1 truncate">This thread</span>
              </CommandItem>
              <CommandItem value="new-thread" onClick={() => pick({ kind: "new-thread" })}>
                <SquarePenIcon aria-hidden className="size-4 shrink-0" />
                <span className="flex-1 truncate">New thread</span>
              </CommandItem>
              {candidates.length > 0 ? (
                <CommandGroup>
                  <CommandGroupLabel>Threads</CommandGroupLabel>
                  {candidates.map(({ thread, projectTitle, running }) => (
                    <CommandItem
                      key={thread.id}
                      value={thread.id}
                      onClick={() =>
                        pick({ kind: "thread", threadId: thread.id, title: thread.title })
                      }
                    >
                      <MessageSquareIcon aria-hidden className="size-4 shrink-0" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{thread.title || "Untitled thread"}</span>
                        {projectTitle ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {projectTitle}
                          </span>
                        ) : null}
                      </span>
                      {running ? (
                        <span className="text-xs text-muted-foreground">Working</span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverPopup>
      ) : null}
    </Popover>
  );
}
