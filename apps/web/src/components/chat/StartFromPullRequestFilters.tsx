import type {
  PullRequestInvolvement,
  PullRequestListFilters,
  PullRequestListState,
} from "@t3tools/contracts";
import { ArrowDownUpIcon } from "lucide-react";

import {
  collectPullRequestListFacets,
  filterPullRequestsByInvolvement,
  matchesPullRequestFilters,
  pullRequestEntryViewer,
  sortPullRequestGroups,
  type EnvironmentPullRequestEntry,
  type PullRequestViewers,
} from "../pullRequest/pullRequestList.logic";
import {
  PULL_REQUEST_INVOLVEMENT_OPTIONS,
  PULL_REQUEST_STATE_OPTIONS,
  PullRequestFiltersMenu,
} from "../pullRequest/PullRequestListFilters";
import type { PullRequestListSort } from "../pullRequest/pullRequestListPreferences";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";

// The size sorts are left out: a listing's rows carry no line counts until they are read apart.
const SORT_LABELS = {
  updated: "Updated",
  ready: "Merge readiness",
  newest: "Newest",
  oldest: "Oldest",
} as const satisfies Partial<Record<PullRequestListSort, string>>;
type PickerSort = keyof typeof SORT_LABELS;

export interface PullRequestPickerView {
  readonly state: PullRequestListState;
  readonly involvement: PullRequestInvolvement;
  readonly filters: PullRequestListFilters;
  readonly sort: PickerSort;
}

export const DEFAULT_PULL_REQUEST_PICKER_VIEW: PullRequestPickerView = {
  state: "open",
  involvement: "all",
  filters: {},
  sort: "updated",
};

// The picker is already scoped to one project on one server, so those groups stay out.
const NONE: never[] = [];
const NO_UNAVAILABLE = new Map<string, string>();
const ignore = () => {};

/**
 * The rows a view keeps, in its order. Hosts apply the filters themselves where they can, and
 * return every involvement, so both are narrowed here too, as the pull requests page does.
 */
export function narrowPickerPullRequests(
  entries: ReadonlyArray<EnvironmentPullRequestEntry>,
  viewers: PullRequestViewers,
  view: PullRequestPickerView,
  query: string,
): ReadonlyArray<EnvironmentPullRequestEntry> {
  const filtered = entries.filter((entry) =>
    matchesPullRequestFilters(entry, view.filters, pullRequestEntryViewer(entry, viewers)),
  );
  const involved = filterPullRequestsByInvolvement(filtered, viewers, view.involvement);
  const [group] = sortPullRequestGroups(
    [{ key: "others", label: "", entries: involved }],
    view.sort,
    query,
    undefined,
    view.involvement,
  );
  return group?.entries ?? involved;
}

/** The start-from picker's pull request filters and sort, the pull requests page's in small. */
export function PullRequestPickerFilterBar(props: {
  entries: ReadonlyArray<EnvironmentPullRequestEntry>;
  view: PullRequestPickerView;
  onChange: (view: PullRequestPickerView) => void;
}) {
  const { view } = props;
  const facets = collectPullRequestListFacets(props.entries, view.state);
  const isDefault = JSON.stringify(view) === JSON.stringify(DEFAULT_PULL_REQUEST_PICKER_VIEW);
  return (
    <div className="flex items-center gap-1.5 px-3 pb-2">
      <PullRequestFiltersMenu
        size="xs"
        state={view.state}
        stateOptions={PULL_REQUEST_STATE_OPTIONS}
        onState={(state) => props.onChange({ ...view, state })}
        involvement={view.involvement}
        involvementOptions={PULL_REQUEST_INVOLVEMENT_OPTIONS}
        onInvolvement={(involvement) => props.onChange({ ...view, involvement })}
        filters={view.filters}
        onFilters={(filters) => props.onChange({ ...view, filters })}
        authorOptions={facets.authors}
        labelOptions={facets.labels}
        host={undefined}
        hostOptions={NONE}
        onHost={ignore}
        server={undefined}
        serverOptions={NONE}
        onServer={ignore}
        projects={NONE}
        projectId={undefined}
        projectEnvironmentId={undefined}
        unavailable={NO_UNAVAILABLE}
        onProject={ignore}
      />
      <div className="flex-1" />
      {isDefault ? null : (
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          onClick={() => props.onChange(DEFAULT_PULL_REQUEST_PICKER_VIEW)}
        >
          Reset
        </Button>
      )}
      <Menu>
        <MenuTrigger render={<Button type="button" size="xs" variant="ghost" />}>
          <ArrowDownUpIcon />
          {SORT_LABELS[view.sort]}
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuRadioGroup
            value={view.sort}
            onValueChange={(sort: PickerSort) => props.onChange({ ...view, sort })}
          >
            {(Object.keys(SORT_LABELS) as PickerSort[]).map((sort) => (
              <MenuRadioItem key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
    </div>
  );
}
