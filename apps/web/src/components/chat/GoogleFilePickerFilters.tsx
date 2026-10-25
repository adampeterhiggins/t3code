import { ArrowDownUpIcon, CalendarIcon, FileIcon, ListFilterIcon, UserIcon } from "lucide-react";
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
  drive: {
    all: "Any time",
    week: "Modified in the last 7 days",
    month: "Modified in the last 30 days",
  },
  calendar: { all: "Any time", upcoming: "Upcoming", past: "Past" },
} as const satisfies Record<GoogleFilePickerSource, Partial<Record<Range, string>>>;

const SORT_LABELS = {
  drive: { newest: "Recently modified", oldest: "Least recently modified", title: "Title A–Z" },
  calendar: {
    nearest: "Closest to now",
    newest: "Latest first",
    oldest: "Earliest first",
    title: "Title A–Z",
  },
} as const satisfies Record<GoogleFilePickerSource, Partial<Record<Sort, string>>>;

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

/**
 * Type, owner (organizer for events), and date filters with a sort, over the files or events the
 * picker loaded. Each applied selection shows as a pill on its own row below, with an × to drop it.
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
}) {
  const { view, source } = props;
  const defaults = DEFAULT_GOOGLE_FILE_PICKER_VIEWS[source];
  const rangeLabels: Partial<Record<Range, string>> = RANGE_LABELS[source];
  const sortLabels: Partial<Record<Sort, string>> = SORT_LABELS[source];
  const ownerNoun = source === "calendar" ? "organizers" : "owners";
  const [menuOpen, setMenuOpen] = useState(false);
  const pickOnly = (next: GoogleFilePickerView) => {
    props.onChange(next);
    setMenuOpen(false);
  };
  const rangeFiltered = view.range !== defaults.range;
  const filtered = view.types.length > 0 || view.owners.length > 0 || rangeFiltered;
  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2">
      <div className="flex items-center gap-1.5">
        <Menu open={menuOpen} onOpenChange={setMenuOpen}>
          <MenuTrigger render={<Button type="button" size="xs" variant="outline" />}>
            <ListFilterIcon />
            Filter
          </MenuTrigger>
          <MenuPopup align="start">
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
            <MenuSub>
              <MenuSubTrigger>Date</MenuSubTrigger>
              <MenuSubPopup>
                <MenuRadioGroup
                  value={view.range}
                  onValueChange={(range: Range) => props.onChange({ ...view, range })}
                >
                  {(Object.keys(rangeLabels) as Range[]).map((range) => (
                    <MenuRadioItem key={range} value={range}>
                      <span className="flex w-full min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{rangeLabels[range]}</span>
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
          </MenuPopup>
        </Menu>
        <div className="flex-1" />
        {filtered || view.sort !== defaults.sort ? (
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            onClick={() => props.onChange(defaults)}
          >
            Reset
          </Button>
        ) : null}
        <Menu>
          <MenuTrigger render={<Button type="button" size="xs" variant="ghost" />}>
            <ArrowDownUpIcon />
            {sortLabels[view.sort]}
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuRadioGroup
              value={view.sort}
              onValueChange={(sort: Sort) => props.onChange({ ...view, sort })}
            >
              {(Object.keys(sortLabels) as Sort[]).map((sort) => (
                <MenuRadioItem key={sort} value={sort}>
                  {sortLabels[sort]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
      </div>
      {filtered ? (
        <div className="flex flex-wrap items-center gap-1">
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
              label={rangeLabels[view.range] ?? ""}
              onRemove={() => props.onChange({ ...view, range: defaults.range })}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
