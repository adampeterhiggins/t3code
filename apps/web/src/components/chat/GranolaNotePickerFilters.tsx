import {
  ArrowDownUpIcon,
  CalendarIcon,
  ListFilterIcon,
  NotebookPenIcon,
  UserIcon,
} from "lucide-react";
import { useState } from "react";

import { FilterPill } from "../FilterPill";
import { Button } from "../ui/button";
import { MenuChoiceLabel } from "../MenuChoiceLabel";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuLoadingItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSearch,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import {
  DEFAULT_GRANOLA_NOTE_PICKER_VIEW,
  type GranolaNotePickerView,
} from "./granolaNotePicker.logic";

const SORT_LABELS = {
  newest: "Newest",
  oldest: "Oldest",
  title: "Title A–Z",
} as const satisfies Record<GranolaNotePickerView["sort"], string>;

const RANGE_LABELS = {
  week: "Last 7 days",
  month: "Last 30 days",
} as const satisfies Record<GranolaNotePickerView["range"], string>;

type Person = { readonly value: string; readonly label: string; readonly count: number };

function toggle(values: ReadonlyArray<string>, value: string, checked: boolean) {
  return checked
    ? [...values.filter((entry) => entry !== value), value]
    : values.filter((entry) => entry !== value);
}

/** A searchable checklist of people, with each one's meeting count and "Only". */
function PeopleChecklist(props: {
  people: ReadonlyArray<Person>;
  selected: ReadonlyArray<string>;
  onChange: (selected: ReadonlyArray<string>) => void;
  /** "Only" settles the filter, so it also closes the menu. */
  onOnly: (value: string) => void;
  /** The meetings are still loading, so there is nobody to list yet. */
  loading: boolean;
}) {
  if (props.people.length === 0) {
    return props.loading ? (
      <MenuLoadingItem>Loading people…</MenuLoadingItem>
    ) : (
      <MenuItem disabled>No people in these meetings</MenuItem>
    );
  }
  return (
    <MenuSearch items={props.people} getText={(person) => person.label} placeholder="Search people">
      {(matches, query) =>
        matches.map((person) => (
          <MenuCheckboxItem
            key={person.value}
            checked={props.selected.includes(person.value)}
            onCheckedChange={(checked) =>
              props.onChange(toggle(props.selected, person.value, checked))
            }
          >
            <span className="flex w-full min-w-0 items-center gap-2">
              <MenuChoiceLabel
                label={person.label}
                query={query}
                onOnly={() => props.onOnly(person.value)}
              />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {person.count}
              </span>
            </span>
          </MenuCheckboxItem>
        ))
      }
    </MenuSearch>
  );
}

/**
 * Attendee, note-taker, and date filters with a sort, over the picker's recent meetings. Each
 * applied selection shows as a pill on its own row below, with an × to drop it.
 */
export function GranolaNotePickerFilterBar(props: {
  attendees: ReadonlyArray<Person>;
  creators: ReadonlyArray<Person>;
  /** How many notes each date range shows under the other filters. */
  ranges: Record<GranolaNotePickerView["range"], number>;
  /** The meetings the menus are built from are still loading. */
  loading: boolean;
  view: GranolaNotePickerView;
  onChange: (view: GranolaNotePickerView) => void;
}) {
  const { view } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  // "Only" settles the filter, so it also closes the menu.
  const pickOnly = (next: GranolaNotePickerView) => {
    props.onChange(next);
    setMenuOpen(false);
  };
  const rangeFiltered = view.range !== DEFAULT_GRANOLA_NOTE_PICKER_VIEW.range;
  const filtered = view.participants.length > 0 || view.creators.length > 0 || rangeFiltered;
  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2">
      <div className="flex items-center gap-1.5">
        <Menu open={menuOpen} onOpenChange={setMenuOpen}>
          <MenuTrigger render={<Button type="button" size="xs" variant="outline" />}>
            <ListFilterIcon />
            Filter
          </MenuTrigger>
          <MenuPopup align="start">
            <MenuSub>
              <MenuSubTrigger>Attendee</MenuSubTrigger>
              <MenuSubPopup>
                <PeopleChecklist
                  people={props.attendees}
                  selected={view.participants}
                  onChange={(participants) => props.onChange({ ...view, participants })}
                  onOnly={(name) => pickOnly({ ...view, participants: [name] })}
                  loading={props.loading}
                />
              </MenuSubPopup>
            </MenuSub>
            <MenuSub>
              <MenuSubTrigger>Note taker</MenuSubTrigger>
              <MenuSubPopup>
                <PeopleChecklist
                  people={props.creators}
                  selected={view.creators}
                  onChange={(creators) => props.onChange({ ...view, creators })}
                  onOnly={(name) => pickOnly({ ...view, creators: [name] })}
                  loading={props.loading}
                />
              </MenuSubPopup>
            </MenuSub>
            <MenuSub>
              <MenuSubTrigger>Date</MenuSubTrigger>
              <MenuSubPopup>
                <MenuRadioGroup
                  value={view.range}
                  onValueChange={(range: GranolaNotePickerView["range"]) =>
                    props.onChange({ ...view, range })
                  }
                >
                  {(Object.keys(RANGE_LABELS) as Array<GranolaNotePickerView["range"]>).map(
                    (range) => (
                      <MenuRadioItem key={range} value={range}>
                        <span className="flex w-full min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate">{RANGE_LABELS[range]}</span>
                          {props.loading ? null : (
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {props.ranges[range]}
                            </span>
                          )}
                        </span>
                      </MenuRadioItem>
                    ),
                  )}
                </MenuRadioGroup>
              </MenuSubPopup>
            </MenuSub>
          </MenuPopup>
        </Menu>
        <div className="flex-1" />
        {filtered || view.sort !== DEFAULT_GRANOLA_NOTE_PICKER_VIEW.sort ? (
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            onClick={() => props.onChange(DEFAULT_GRANOLA_NOTE_PICKER_VIEW)}
          >
            Reset
          </Button>
        ) : null}
        <Menu>
          <MenuTrigger render={<Button type="button" size="xs" variant="ghost" />}>
            <ArrowDownUpIcon />
            {SORT_LABELS[view.sort]}
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuRadioGroup
              value={view.sort}
              onValueChange={(sort: GranolaNotePickerView["sort"]) =>
                props.onChange({ ...view, sort })
              }
            >
              {(Object.keys(SORT_LABELS) as Array<GranolaNotePickerView["sort"]>).map((sort) => (
                <MenuRadioItem key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
      </div>
      {filtered ? (
        <div className="flex flex-wrap items-center gap-1">
          {view.participants.map((name) => (
            <FilterPill
              key={`attendee:${name}`}
              icon={<UserIcon />}
              label={name}
              onRemove={() =>
                props.onChange({
                  ...view,
                  participants: view.participants.filter((entry) => entry !== name),
                })
              }
            />
          ))}
          {view.creators.map((name) => (
            <FilterPill
              key={`creator:${name}`}
              icon={<NotebookPenIcon />}
              label={`Notes by ${name}`}
              onRemove={() =>
                props.onChange({
                  ...view,
                  creators: view.creators.filter((entry) => entry !== name),
                })
              }
            />
          ))}
          {rangeFiltered ? (
            <FilterPill
              icon={<CalendarIcon />}
              label={RANGE_LABELS[view.range]}
              onRemove={() =>
                props.onChange({ ...view, range: DEFAULT_GRANOLA_NOTE_PICKER_VIEW.range })
              }
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
