import { ArrowDownUpIcon, CalendarIcon, FileIcon, ListFilterIcon, UserIcon } from "lucide-react";
import type { EnvironmentId, GoogleCalendarSummary } from "@t3tools/contracts";
import { useState } from "react";

import { googleEnvironment } from "~/state/google";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";

import { FilterPill } from "../FilterPill";
import { Button } from "../ui/button";
import { MenuChoiceLabel } from "../MenuChoiceLabel";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuLoadingItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSearch,
  MenuSearchInput,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import {
  DEFAULT_GOOGLE_FILE_PICKER_VIEWS,
  GOOGLE_FILE_TYPE_LABELS,
  type GoogleFilePickerSource,
  type GoogleFilePickerView,
  type GoogleFileType,
  type GoogleFilterOption,
} from "./googleFilePicker.logic";

type Range = GoogleFilePickerView["range"];
type Sort = GoogleFilePickerView["sort"];

const RANGE_LABELS = {
  all: "Any time",
  week: "Modified in the last 7 days",
  month: "Modified in the last 30 days",
} as const satisfies Record<Range, string>;

const SORT_LABELS = {
  newest: "Recently modified",
  oldest: "Least recently modified",
  title: "Title A–Z",
} as const satisfies Record<Sort, string>;

function toggle<T extends string>(values: ReadonlyArray<T>, value: T, checked: boolean) {
  return checked
    ? [...values.filter((entry) => entry !== value), value]
    : values.filter((entry) => entry !== value);
}

/** A searchable checklist with each choice's result count and "Only". */
function Checklist(props: {
  options: ReadonlyArray<GoogleFilterOption>;
  selected: ReadonlyArray<string>;
  onChange: (selected: ReadonlyArray<string>) => void;
  /** "Only" settles the filter, so it also closes the menu. */
  onOnly: (value: string) => void;
  loading: boolean;
  noun: string;
}) {
  if (props.options.length === 0) {
    return props.loading ? (
      <MenuLoadingItem>Loading {props.noun}…</MenuLoadingItem>
    ) : (
      <MenuItem disabled>No {props.noun} in these results</MenuItem>
    );
  }
  return (
    <MenuSearch
      items={props.options}
      getText={(option) => option.label}
      placeholder={`Search ${props.noun}`}
    >
      {(matches, query) =>
        matches.map((option) => (
          <MenuCheckboxItem
            key={option.value}
            checked={props.selected.includes(option.value)}
            onCheckedChange={(checked) =>
              props.onChange(toggle(props.selected, option.value, checked))
            }
          >
            <span className="flex w-full min-w-0 items-center gap-2">
              <MenuChoiceLabel
                label={option.label}
                query={query}
                onOnly={() => props.onOnly(option.value)}
              />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {option.count}
              </span>
            </span>
          </MenuCheckboxItem>
        ))
      }
    </MenuSearch>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The calendars a search reads by default: the ones ticked in Google Calendar. */
function defaultCalendarIds(calendars: ReadonlyArray<GoogleCalendarSummary>): string[] {
  return calendars.filter((c) => c.primary || c.selected).map((c) => c.id);
}

function calendarLabel(calendar: GoogleCalendarSummary) {
  return calendar.primary ? `${calendar.name} (you)` : calendar.name;
}

/**
 * Every calendar the account can read, ticked ones first, and a search that also finds
 * colleagues in the Workspace directory, or takes an email, to read a calendar the user has not
 * subscribed to.
 */
function CalendarChecklist(props: {
  environmentId: EnvironmentId;
  calendars: ReadonlyArray<GoogleCalendarSummary> | null;
  selected: ReadonlyArray<string>;
  onChange: (selected: ReadonlyArray<string>) => void;
}) {
  const [value, setValue] = useState("");
  const settled = useDebouncedValue(value.trim(), 250);
  const directory = useEnvironmentQuery(
    settled.length >= 2
      ? googleEnvironment.people({ environmentId: props.environmentId, input: { query: settled } })
      : null,
  );
  if (props.calendars === null) return <MenuLoadingItem>Loading calendars…</MenuLoadingItem>;
  const known = new Set(props.calendars.map((c) => c.id));
  // Colleagues added by email are not in the account's calendar list.
  const entries = [
    ...props.calendars,
    ...props.selected
      .filter((id) => !known.has(id))
      .map((id) => ({ id, name: id, primary: false, selected: false })),
  ].toSorted(
    (a, b) =>
      Number(b.primary) - Number(a.primary) ||
      Number(b.selected) - Number(a.selected) ||
      a.name.localeCompare(b.name),
  );
  const query = value.trim().toLowerCase();
  const matches = query
    ? entries.filter((c) => `${c.name} ${c.id}`.toLowerCase().includes(query))
    : entries;
  const listed = (email: string) => entries.some((c) => c.id.toLowerCase() === email.toLowerCase());
  const people = (directory.data?.people ?? []).filter((person) => !listed(person.email));
  const addable =
    EMAIL.test(query) && !listed(query) && !people.some((person) => person.email === query);
  const add = (email: string) => {
    props.onChange([...props.selected, email]);
    setValue("");
  };
  return (
    <>
      <MenuSearchInput
        autoFocus
        value={value}
        placeholder="Search calendars or people"
        aria-label="Search calendars or people"
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      {matches.map((calendar) => (
        <MenuCheckboxItem
          key={calendar.id}
          checked={props.selected.includes(calendar.id)}
          onCheckedChange={(checked) =>
            props.onChange(toggle(props.selected, calendar.id, checked))
          }
        >
          <span className="min-w-0 flex-1 truncate">{calendarLabel(calendar)}</span>
        </MenuCheckboxItem>
      ))}
      {settled.length >= 2 ? (
        <>
          {matches.length > 0 ? <MenuSeparator /> : null}
          <MenuGroup>
            <MenuGroupLabel>People</MenuGroupLabel>
            {people.map((person) => (
              <MenuItem key={person.email} onClick={() => add(person.email)}>
                <span className="min-w-0 flex-1 truncate">{person.name}</span>
                <span className="shrink-0 truncate text-muted-foreground text-xs">
                  {person.email}
                </span>
              </MenuItem>
            ))}
            {addable ? (
              <MenuItem onClick={() => add(query)}>Show {query}&apos;s calendar</MenuItem>
            ) : null}
            {directory.data === null && directory.error === null ? (
              <MenuLoadingItem>Searching people…</MenuLoadingItem>
            ) : directory.data?.directoryAvailable === false ? (
              <MenuItem disabled>Reconnect Google to search your directory</MenuItem>
            ) : people.length === 0 && !addable ? (
              <MenuItem disabled>
                {directory.error ?? "No one matches. Type an email instead."}
              </MenuItem>
            ) : null}
          </MenuGroup>
        </>
      ) : matches.length === 0 ? (
        <MenuItem disabled>Type a name or email to find a colleague</MenuItem>
      ) : null}
    </>
  );
}

/**
 * Type, owner, and date filters with a sort over Drive files; just the organizer over Calendar
 * events, whose dates the week strip picks, with the calendars to read them from. Each applied selection shows as a pill on its own row below, with an × to drop it.
 */
export function GoogleFilePickerFilterBar(props: {
  source: GoogleFilePickerSource;
  types: ReadonlyArray<GoogleFilterOption>;
  owners: ReadonlyArray<GoogleFilterOption>;
  /** How many results each date range shows under the other filters. */
  ranges: Partial<Record<Range, number>>;
  loading: boolean;
  view: GoogleFilePickerView;
  onChange: (view: GoogleFilePickerView) => void;
  environmentId: EnvironmentId;
  /** The account's calendars, or null while they load. Calendar tab only. */
  calendars: ReadonlyArray<GoogleCalendarSummary> | null;
  /** The calendars picked in place of the ticked ones, or null for those. */
  calendarIds: ReadonlyArray<string> | null;
  onCalendarIdsChange: (calendarIds: ReadonlyArray<string> | null) => void;
}) {
  const { view, source } = props;
  const defaults = DEFAULT_GOOGLE_FILE_PICKER_VIEWS[source];
  const ownerNoun = source === "calendar" ? "organizers" : "owners";
  const [menuOpen, setMenuOpen] = useState(false);
  const pickOnly = (next: GoogleFilePickerView) => {
    props.onChange(next);
    setMenuOpen(false);
  };
  const rangeFiltered = view.range !== defaults.range;
  const defaultIds = defaultCalendarIds(props.calendars ?? []);
  const shownCalendarIds = props.calendarIds ?? defaultIds;
  const calendarsFiltered = source === "calendar" && props.calendarIds !== null;
  const filtered =
    view.types.length > 0 || view.owners.length > 0 || rangeFiltered || calendarsFiltered;
  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2">
      <div className="flex items-center gap-1.5">
        <Menu open={menuOpen} onOpenChange={setMenuOpen}>
          <MenuTrigger render={<Button type="button" size="xs" variant="outline" />}>
            <ListFilterIcon />
            Filter
          </MenuTrigger>
          <MenuPopup align="start">
            {source === "calendar" ? (
              <MenuSub>
                <MenuSubTrigger>Calendars</MenuSubTrigger>
                <MenuSubPopup>
                  <CalendarChecklist
                    environmentId={props.environmentId}
                    calendars={props.calendars}
                    selected={shownCalendarIds}
                    onChange={(ids) => {
                      const same =
                        ids.length === defaultIds.length &&
                        ids.every((id) => defaultIds.includes(id));
                      // No calendars would show nothing; fall back to the ticked ones.
                      props.onCalendarIdsChange(same || ids.length === 0 ? null : ids);
                    }}
                  />
                </MenuSubPopup>
              </MenuSub>
            ) : null}
            {source === "drive" ? (
              <MenuSub>
                <MenuSubTrigger>Type</MenuSubTrigger>
                <MenuSubPopup>
                  <Checklist
                    options={props.types}
                    selected={view.types}
                    onChange={(types) =>
                      props.onChange({ ...view, types: types as GoogleFileType[] })
                    }
                    onOnly={(type) => pickOnly({ ...view, types: [type as GoogleFileType] })}
                    loading={props.loading}
                    noun="types"
                  />
                </MenuSubPopup>
              </MenuSub>
            ) : null}
            <MenuSub>
              <MenuSubTrigger>{source === "calendar" ? "Organizer" : "Owner"}</MenuSubTrigger>
              <MenuSubPopup>
                <Checklist
                  options={props.owners}
                  selected={view.owners}
                  onChange={(owners) => props.onChange({ ...view, owners })}
                  onOnly={(owner) => pickOnly({ ...view, owners: [owner] })}
                  loading={props.loading}
                  noun={ownerNoun}
                />
              </MenuSubPopup>
            </MenuSub>
            {source === "drive" ? (
              <MenuSub>
                <MenuSubTrigger>Date</MenuSubTrigger>
                <MenuSubPopup>
                  <MenuRadioGroup
                    value={view.range}
                    onValueChange={(range: Range) => props.onChange({ ...view, range })}
                  >
                    {(Object.keys(RANGE_LABELS) as Range[]).map((range) => (
                      <MenuRadioItem key={range} value={range}>
                        <span className="flex w-full min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate">{RANGE_LABELS[range]}</span>
                          {props.loading ? null : (
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {props.ranges[range] ?? 0}
                            </span>
                          )}
                        </span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuSubPopup>
              </MenuSub>
            ) : null}
          </MenuPopup>
        </Menu>
        <div className="flex-1" />
        {filtered || view.sort !== defaults.sort ? (
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            onClick={() => {
              props.onChange(defaults);
              props.onCalendarIdsChange(null);
            }}
          >
            Reset
          </Button>
        ) : null}
        {source === "drive" ? (
          <Menu>
            <MenuTrigger render={<Button type="button" size="xs" variant="ghost" />}>
              <ArrowDownUpIcon />
              {SORT_LABELS[view.sort]}
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuRadioGroup
                value={view.sort}
                onValueChange={(sort: Sort) => props.onChange({ ...view, sort })}
              >
                {(Object.keys(SORT_LABELS) as Sort[]).map((sort) => (
                  <MenuRadioItem key={sort} value={sort}>
                    {SORT_LABELS[sort]}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>
        ) : null}
      </div>
      {filtered || (source === "calendar" && shownCalendarIds.length > 0) ? (
        <div className="flex flex-wrap items-center gap-1">
          {source === "calendar"
            ? shownCalendarIds.map((id) => {
                const calendar = props.calendars?.find((c) => c.id === id);
                const label = calendar ? calendarLabel(calendar) : id;
                return (
                  <FilterPill
                    key={`calendar:${id}`}
                    icon={<CalendarIcon />}
                    label={label}
                    // The last calendar stays: a search over none would show nothing.
                    {...(shownCalendarIds.length > 1
                      ? {
                          onRemove: () => {
                            const rest = shownCalendarIds.filter((entry) => entry !== id);
                            const isDefault =
                              rest.length === defaultIds.length &&
                              rest.every((entry) => defaultIds.includes(entry));
                            props.onCalendarIdsChange(isDefault ? null : rest);
                          },
                        }
                      : {})}
                  />
                );
              })
            : null}
          {view.types.map((type) => (
            <FilterPill
              key={`type:${type}`}
              icon={<FileIcon />}
              label={GOOGLE_FILE_TYPE_LABELS[type]}
              onRemove={() =>
                props.onChange({ ...view, types: view.types.filter((entry) => entry !== type) })
              }
            />
          ))}
          {view.owners.map((owner) => (
            <FilterPill
              key={`owner:${owner}`}
              icon={<UserIcon />}
              label={source === "calendar" ? `Organized by ${owner}` : `Owned by ${owner}`}
              onRemove={() =>
                props.onChange({ ...view, owners: view.owners.filter((entry) => entry !== owner) })
              }
            />
          ))}
          {rangeFiltered ? (
            <FilterPill
              icon={<CalendarIcon />}
              label={RANGE_LABELS[view.range]}
              onRemove={() => props.onChange({ ...view, range: defaults.range })}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
