import { SourceTabs } from "./SourceTabs";
import { LinkedObjectLinkPreview } from "./LinkedObjectLinkPreview";
import { GoogleIcon, GoogleSourceIcon } from "../Icons";
import { useAtomValue } from "@effect/atom-react";
import { googleFileContextRecord } from "@t3tools/client-runtime/state/google";
import {
  parseGoogleFileLink,
  type GoogleFileSummary,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useState } from "react";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useIssueContextStore } from "~/issueContextStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { googleEnvironment } from "~/state/google";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { toastManager } from "../ui/toast";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { Button } from "../ui/button";
import {
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
} from "../ui/command";
import { useComposerAttachRedirect } from "./composerAttachRedirect";
import {
  addDays,
  dayFromKey,
  dayHeading,
  DEFAULT_GOOGLE_FILE_PICKER_VIEWS,
  eventDayKey,
  eventTimeLabel,
  filterGoogleFiles,
  googleFileTimeLabel,
  googleFilterFacets,
  groupEventsByDay,
  localDayKey,
  startOfWeek,
  type GoogleFilePickerSource,
} from "./googleFilePicker.logic";
import { GoogleFilePickerFilterBar } from "./GoogleFilePickerFilters";
import { GoogleCalendarWeekStrip } from "./GoogleCalendarWeekStrip";
type GoogleFilePickerMode = "attach" | "link";
/** The thread the picker acts on, and whether picking attaches the page or links it. */
const pickerThread = Atom.make<{
  readonly threadRef: ScopedThreadRef;
  readonly mode: GoogleFilePickerMode;
} | null>(null).pipe(Atom.keepAlive, Atom.withLabel("google:page-picker-thread"));
export function openGoogleFilePicker(
  threadRef: ScopedThreadRef,
  mode: GoogleFilePickerMode = "attach",
) {
  appAtomRegistry.set(pickerThread, { threadRef, mode });
}
const closePicker = () => appAtomRegistry.set(pickerThread, null);
export function useAttachGoogleFile() {
  const getFile = useAtomCommand(googleEnvironment.getFile);
  return async (threadRef: ScopedThreadRef, id: string) => {
    const result = await getFile({ environmentId: threadRef.environmentId, input: { id } });
    if (result._tag === "Failure") return false;
    const record = googleFileContextRecord(result.value);
    useIssueContextStore.getState().upsert(threadRef.threadId, record);
    useComposerDraftStore.getState().insertContextReference(threadRef, {
      kind: record.kind,
      contextId: record.contextId,
      label: record.label,
    });
    return true;
  };
}
/** Links a page to the thread's tab group, replacing the one it had. */
function useLinkGoogleFile() {
  const linkThread = useAtomCommand(googleEnvironment.linkThread, { reportFailure: false });
  return async (threadRef: ScopedThreadRef, fileId: string): Promise<boolean> => {
    const result = await linkThread({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, fileId },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not link the Google file or event",
          description: failure instanceof Error ? failure.message : undefined,
        });
      }
      return false;
    }
    return true;
  };
}
export function GoogleFilePickerHost() {
  const target = useAtomValue(pickerThread);
  return target === null ? null : (
    <GoogleFilePickerDialog threadRef={target.threadRef} mode={target.mode} />
  );
}
function GoogleFilePickerDialog({
  threadRef,
  mode,
}: {
  threadRef: ScopedThreadRef;
  mode: GoogleFilePickerMode;
}) {
  const googleEnabled = useEnvironmentSettings(
    threadRef.environmentId,
    (s) => s.enableGoogleIntegration,
  );
  const navigate = useNavigate();
  const attachPage = useAttachGoogleFile();
  const redirect = useComposerAttachRedirect();
  const linkPage = useLinkGoogleFile();
  const [source, setSource] = useState<GoogleFilePickerSource>("drive");
  const [views, setViews] = useState(DEFAULT_GOOGLE_FILE_PICKER_VIEWS);
  const view = views[source];
  // Date filters, "Today", and the opening week count from when the picker opened.
  const [openedAt] = useState(() => Date.now());
  const today = localDayKey(new Date(openedAt));
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(openedAt)));
  const [selectedDay, setSelectedDay] = useState<string | null>(today);
  const [query, setQuery] = useState("");
  const [attaching, setAttaching] = useState(false);
  const settled = useDebouncedValue(query.trim(), 400);
  const connection = useEnvironmentQuery(
    googleEnabled
      ? googleEnvironment.connection({ environmentId: threadRef.environmentId, input: {} })
      : null,
  );
  const connected = connection.data?.phase === "connected";
  // With no search, the calendar shows one week at a time, read a week at a time.
  const browsingWeek = source === "calendar" && settled === "";
  const result = useEnvironmentQuery(
    connected
      ? googleEnvironment.files({
          environmentId: threadRef.environmentId,
          input: {
            query: settled,
            source,
            ...(browsingWeek
              ? {
                  timeMin: weekStart.toISOString(),
                  timeMax: addDays(weekStart, 7).toISOString(),
                }
              : {}),
          },
        })
      : null,
  );
  const loaded = result.data?.files;
  const pasted = parseGoogleFileLink(settled) !== null;
  const files = filterGoogleFiles(loaded ?? [], view, openedAt, pasted);
  const facets = googleFilterFacets(loaded ?? [], view, openedAt, pasted);
  const dayCounts = new Map<string, number>();
  for (const event of source === "calendar" ? files : []) {
    const day = eventDayKey(event);
    if (day !== null) dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  const days =
    source === "calendar"
      ? groupEventsByDay(files).filter(
          (group) => !browsingWeek || selectedDay === null || group.day === selectedDay,
        )
      : [];
  const pick = async (page: GoogleFileSummary) => {
    if (attaching) return;
    if (redirect) {
      redirect({ type: "google-file", fileId: page.url, label: page.title });
      closePicker();
      return;
    }
    setAttaching(true);
    const choose = mode === "link" ? linkPage : attachPage;
    const picked = await settlePromise(() => choose(threadRef, page.url));
    setAttaching(false);
    if (picked._tag === "Success" && picked.value) closePicker();
  };
  const row = (page: GoogleFileSummary) => (
    <CommandItem
      key={page.id}
      value={page.id}
      disabled={attaching}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => pick(page)}
    >
      <GoogleSourceIcon
        fileType={page.fileType}
        className="size-4 shrink-0 text-muted-foreground"
      />
      <LinkedObjectLinkPreview
        environmentId={threadRef.environmentId}
        threadRef={threadRef}
        objectLink={{ kind: "google-file", fileId: page.id, url: page.url }}
        link={
          page.fileType === "event" ? (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="w-28 shrink-0 text-muted-foreground text-xs tabular-nums">
                {eventTimeLabel(page)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{page.title}</span>
              <span className="w-40 shrink-0 truncate text-end text-muted-foreground text-xs">
                {page.owner}
              </span>
            </span>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{page.title}</span>
              <span className="w-40 shrink-0 truncate text-muted-foreground text-xs">
                {page.owner}
              </span>
              <span className="w-28 shrink-0 text-end text-muted-foreground/70 text-xs tabular-nums">
                {googleFileTimeLabel(page, openedAt)}
              </span>
            </span>
          )
        }
      />
    </CommandItem>
  );
  const status =
    connection.error ??
    result.error ??
    (connection.data === null
      ? "Reading Google status…"
      : result.isPending || settled !== query.trim()
        ? "Searching Google…"
        : files.length === 0 || (source === "calendar" && days.length === 0)
          ? view !== DEFAULT_GOOGLE_FILE_PICKER_VIEWS[source] && (loaded?.length ?? 0) > 0
            ? "Nothing matches these filters."
            : browsingWeek
              ? selectedDay === null
                ? "No events this week."
                : `No events on ${dayHeading(selectedDay, openedAt)}.`
              : "No matching files or events. Search by title or paste a Google link."
          : null);
  if (!googleEnabled) return null;
  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) closePicker();
      }}
    >
      <CommandDialogPopup
        aria-label={mode === "link" ? "Link Google file or event" : "Attach Google file or event"}
        className="overflow-hidden"
      >
        {connected || connection.data === null ? (
          <CommandPaletteContent
            inputProps={{
              placeholder: "Search Google Drive files and Calendar events or paste a document link",
              startAddon: <GoogleIcon />,
            }}
            footerActionLabel={
              mode === "link"
                ? attaching
                  ? "Linking…"
                  : "Link document"
                : attaching
                  ? "Attaching…"
                  : "Attach document"
            }
            inputAccessory={
              <>
                <SourceTabs
                  className="flex gap-1 px-3 py-2"
                  options={[
                    { id: "drive", label: "Drive" },
                    { id: "calendar", label: "Calendar" },
                  ]}
                  activeId={source}
                  onSelect={setSource}
                />
                <GoogleFilePickerFilterBar
                  {...facets}
                  source={source}
                  loading={loaded === undefined && result.error === null}
                  view={view}
                  onChange={(next) => setViews((current) => ({ ...current, [source]: next }))}
                />
                {browsingWeek ? (
                  <GoogleCalendarWeekStrip
                    weekStart={weekStart}
                    selectedDay={selectedDay}
                    today={today}
                    counts={dayCounts}
                    onSelectDay={setSelectedDay}
                    onWeekStartChange={(next) => {
                      setWeekStart(next);
                      // Moving a week keeps the picked weekday, so the agenda follows along.
                      const shift = Math.round((next.getTime() - weekStart.getTime()) / 86_400_000);
                      setSelectedDay((day) =>
                        day === null ? null : localDayKey(addDays(dayFromKey(day), shift)),
                      );
                    }}
                  />
                ) : null}
              </>
            }
            mode="none"
            value={query}
            onValueChange={setQuery}
          >
            {status ? (
              <div className="py-10 text-center text-muted-foreground text-sm">{status}</div>
            ) : (
              <CommandList>
                {source === "calendar" ? (
                  days.map((group) => (
                    <CommandGroup key={group.day}>
                      <CommandGroupLabel>{dayHeading(group.day, openedAt)}</CommandGroupLabel>
                      {group.events.map(row)}
                    </CommandGroup>
                  ))
                ) : (
                  <CommandGroup items={[...files]}>
                    <CommandCollection>{row}</CommandCollection>
                  </CommandGroup>
                )}
              </CommandList>
            )}
            {result.data?.hasMore ? (
              <p className="px-4 py-2 text-xs text-muted-foreground">
                {source === "calendar"
                  ? "Showing the first events from each calendar. Search by title to narrow the results."
                  : "Showing the first 30 files. Search by title to narrow the results."}
              </p>
            ) : null}
          </CommandPaletteContent>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm">
            <p className="text-muted-foreground">
              {mode === "link"
                ? "Connect Google to link a Drive file or Calendar event."
                : "Connect Google to attach Drive files and Calendar events."}
            </p>
            <Button
              size="sm"
              onClick={() => {
                closePicker();
                void navigate({ to: "/settings/integrations" });
              }}
            >
              Connect Google
            </Button>
          </div>
        )}
      </CommandDialogPopup>
    </CommandDialog>
  );
}
