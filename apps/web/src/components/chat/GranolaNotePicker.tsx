import { GranolaIcon } from "../Icons";
import { useAtomValue } from "@effect/atom-react";
import { granolaNoteContextRecord } from "@t3tools/client-runtime/state/granola";
import {
  type GranolaNoteSummary,
  parseGranolaNoteId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useState } from "react";
import { useLinkClickHandler } from "~/browser/useOpenLink";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useIssueContextStore } from "~/issueContextStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { granolaEnvironment } from "~/state/granola";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { toastManager } from "../ui/toast";
import { GranolaNoteDetails } from "../contextChipParts";
import { CursorPreviewCard } from "./CursorPreviewCard";
import {
  DEFAULT_GRANOLA_NOTE_PICKER_VIEW,
  filterGranolaNotes,
  granolaAttendeesLabel,
  granolaFilterFacets,
} from "./granolaNotePicker.logic";
import { GranolaNotePickerFilterBar } from "./GranolaNotePickerFilters";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { Button } from "../ui/button";
import {
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";

type GranolaNotePickerMode = "attach" | "link";
/** The thread the picker acts on, and whether picking attaches the note or links it. */
const pickerThread = Atom.make<{
  readonly threadRef: ScopedThreadRef;
  readonly mode: GranolaNotePickerMode;
} | null>(null).pipe(Atom.keepAlive, Atom.withLabel("granola:note-picker-thread"));
export function openGranolaNotePicker(
  threadRef: ScopedThreadRef,
  mode: GranolaNotePickerMode = "attach",
) {
  appAtomRegistry.set(pickerThread, { threadRef, mode });
}
const closePicker = () => appAtomRegistry.set(pickerThread, null);

/** `Oct 12 · Ada, Grace`: when the meeting was and who was in it. */
export function granolaNoteDescription(note: GranolaNoteSummary): string {
  const date = note.meetingAt === null ? null : new Date(note.meetingAt);
  const when =
    date === null || Number.isNaN(date.getTime())
      ? null
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return [when, granolaAttendeesLabel(note.participants) || null].filter(Boolean).join(" · ");
}

/** `13 Oct, 11:00`: the meeting's start, for the picker's date column. */
function meetingTimeLabel(meetingAt: string | null): string {
  const date = meetingAt === null ? null : new Date(meetingAt);
  return date === null || Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

export function useAttachGranolaNote() {
  const getNote = useAtomCommand(granolaEnvironment.getNote);
  return async (threadRef: ScopedThreadRef, id: string) => {
    const result = await getNote({ environmentId: threadRef.environmentId, input: { id } });
    if (result._tag === "Failure") return false;
    const record = granolaNoteContextRecord(result.value);
    useIssueContextStore.getState().upsert(threadRef.threadId, record);
    useComposerDraftStore.getState().insertContextReference(threadRef, {
      kind: record.kind,
      contextId: record.contextId,
      label: record.label,
    });
    return true;
  };
}

/** Links a note to the thread's tab group, replacing the one it had. */
export function useLinkGranolaNote() {
  const linkThread = useAtomCommand(granolaEnvironment.linkThread, { reportFailure: false });
  return async (threadRef: ScopedThreadRef, noteId: string): Promise<boolean> => {
    const result = await linkThread({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, noteId },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not link the Granola note",
          description: failure instanceof Error ? failure.message : undefined,
        });
      }
      return false;
    }
    return true;
  };
}

export function GranolaNotePickerHost() {
  const target = useAtomValue(pickerThread);
  return target === null ? null : (
    <GranolaNotePickerDialog threadRef={target.threadRef} mode={target.mode} />
  );
}

function GranolaNotePickerDialog({
  threadRef,
  mode,
}: {
  threadRef: ScopedThreadRef;
  mode: GranolaNotePickerMode;
}) {
  const granolaEnabled = useEnvironmentSettings(
    threadRef.environmentId,
    (s) => s.enableGranolaIntegration,
  );
  const navigate = useNavigate();
  const attachNote = useAttachGranolaNote();
  const linkNote = useLinkGranolaNote();
  const [query, setQuery] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [view, setView] = useState(DEFAULT_GRANOLA_NOTE_PICKER_VIEW);
  // Date filters count back from when the picker opened.
  const [openedAt] = useState(() => Date.now());
  // The server filters one cached listing, so typing only needs a short settle.
  const settled = useDebouncedValue(query.trim(), 150);
  const connection = useEnvironmentQuery(
    granolaEnabled
      ? granolaEnvironment.connection({ environmentId: threadRef.environmentId, input: {} })
      : null,
  );
  const connected = connection.data?.phase === "connected";
  const result = useEnvironmentQuery(
    connected
      ? granolaEnvironment.notes({
          environmentId: threadRef.environmentId,
          input: { query: settled },
        })
      : null,
  );
  const loaded = result.data?.notes;
  const pasted = parseGranolaNoteId(settled) !== null;
  const notes = filterGranolaNotes(loaded ?? [], view, openedAt, pasted);
  const facets = granolaFilterFacets(loaded ?? [], view, openedAt, pasted);
  const filtered = view !== DEFAULT_GRANOLA_NOTE_PICKER_VIEW;
  const status =
    connection.error ??
    result.error ??
    (connection.data === null
      ? "Reading Granola status…"
      : result.isPending && notes.length === 0
        ? "Loading meetings…"
        : notes.length === 0
          ? filtered && (loaded?.length ?? 0) > 0
            ? "No meetings match these filters."
            : "No meetings in the last 30 days match. Paste a note link to attach an older one."
          : null);
  if (!granolaEnabled) return null;
  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) closePicker();
      }}
    >
      <CommandDialogPopup
        aria-label={mode === "link" ? "Link Granola note" : "Attach Granola note"}
        className="overflow-hidden"
      >
        {connected || connection.data === null ? (
          <CommandPaletteContent
            inputProps={{
              placeholder: "Search recent meetings or paste a note link",
              startAddon: <GranolaIcon />,
            }}
            footerActionLabel={
              mode === "link"
                ? attaching
                  ? "Linking…"
                  : "Link note"
                : attaching
                  ? "Attaching…"
                  : "Attach note"
            }
            inputAccessory={
              <GranolaNotePickerFilterBar
                {...facets}
                loading={loaded === undefined && result.error === null}
                view={view}
                onChange={setView}
              />
            }
            mode="none"
            value={query}
            onValueChange={setQuery}
          >
            {status ? (
              <div className="py-10 text-center text-muted-foreground text-sm">{status}</div>
            ) : (
              <CommandList>
                <CommandGroup items={[...notes]}>
                  <CommandCollection>
                    {(note: GranolaNoteSummary) => (
                      <CommandItem
                        key={note.id}
                        value={note.id}
                        disabled={attaching}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={async () => {
                          if (attaching) return;
                          setAttaching(true);
                          const pick = mode === "link" ? linkNote : attachNote;
                          await pick(threadRef, note.id)
                            .then((picked) => {
                              if (picked) closePicker();
                            })
                            .finally(() => setAttaching(false));
                        }}
                      >
                        <CursorPreviewCard
                          trigger={
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-sm">{note.title}</span>
                              <span className="w-44 shrink-0 truncate text-muted-foreground text-xs">
                                {granolaAttendeesLabel(note.participants)}
                              </span>
                              <span className="w-28 shrink-0 text-end text-muted-foreground/70 text-xs tabular-nums">
                                {meetingTimeLabel(note.meetingAt)}
                              </span>
                            </span>
                          }
                        >
                          <GranolaNotePreview threadRef={threadRef} note={note} />
                        </CursorPreviewCard>
                      </CommandItem>
                    )}
                  </CommandCollection>
                </CommandGroup>
              </CommandList>
            )}
          </CommandPaletteContent>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm">
            <p className="text-muted-foreground">
              {mode === "link"
                ? "Connect Granola to link a meeting note."
                : "Connect Granola to attach meeting notes."}
            </p>
            <Button
              size="sm"
              onClick={() => {
                closePicker();
                void navigate({ to: "/settings/integrations" });
              }}
            >
              Connect Granola
            </Button>
          </div>
        )}
      </CommandDialogPopup>
    </CommandDialog>
  );
}

/**
 * Hover preview of a meeting: who was there and the summary an attachment would capture. Mounted
 * only while the card is open, so the note is read on hover rather than for every row.
 */
function GranolaNotePreview({
  threadRef,
  note,
}: {
  threadRef: ScopedThreadRef;
  note: GranolaNoteSummary;
}) {
  const onOpenLink = useLinkClickHandler(threadRef);
  const full = useEnvironmentQuery(
    granolaEnvironment.note({ environmentId: threadRef.environmentId, input: { id: note.id } }),
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium text-foreground text-sm">{note.title}</p>
      {note.participants.length > 0 ? (
        <p className="text-muted-foreground">
          {note.participants
            .map((name) => (name === note.creator ? `${name} (note taker)` : name))
            .join(", ")}
        </p>
      ) : null}
      {full.data ? (
        <div className="max-h-72 overflow-y-auto">
          <GranolaNoteDetails record={full.data} onOpenLink={onOpenLink} />
        </div>
      ) : (
        <p className="text-muted-foreground">{full.error ?? "Loading summary…"}</p>
      )}
    </div>
  );
}
