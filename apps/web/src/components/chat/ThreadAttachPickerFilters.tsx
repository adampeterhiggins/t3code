import type { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { ArrowDownUpIcon, BotIcon, FolderIcon, ListFilterIcon } from "lucide-react";
import { useState } from "react";

import { FilterPill } from "../FilterPill";
import { MenuChoiceLabel } from "../MenuChoiceLabel";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
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
  DEFAULT_THREAD_ATTACH_PICKER_VIEW,
  type ThreadAttachPickerView,
} from "./composerThreadReferences";

const SORT_LABELS = {
  updated: "Recently updated",
  newest: "Newest",
  oldest: "Oldest",
  title: "Title A–Z",
} as const satisfies Record<ThreadAttachPickerView["sort"], string>;

type Choice<T extends string> = {
  readonly value: T;
  readonly label: string;
  readonly count: number;
};

function toggle<T>(values: ReadonlyArray<T>, value: T, checked: boolean) {
  return checked
    ? [...values.filter((entry) => entry !== value), value]
    : values.filter((entry) => entry !== value);
}

/** A searchable checklist with each choice's thread count and "Only". */
function ChoiceChecklist<T extends string>(props: {
  choices: ReadonlyArray<Choice<T>>;
  selected: ReadonlyArray<T>;
  placeholder: string;
  empty: string;
  onChange: (selected: ReadonlyArray<T>) => void;
  onOnly: (value: T) => void;
}) {
  if (props.choices.length === 0) return <MenuItem disabled>{props.empty}</MenuItem>;
  return (
    <MenuSearch
      items={props.choices}
      getText={(choice) => choice.label}
      placeholder={props.placeholder}
    >
      {(matches, query) =>
        matches.map((choice) => (
          <MenuCheckboxItem
            key={choice.value}
            checked={props.selected.includes(choice.value)}
            onCheckedChange={(checked) =>
              props.onChange(toggle(props.selected, choice.value, checked))
            }
          >
            <span className="flex w-full min-w-0 items-center gap-2">
              <MenuChoiceLabel
                label={choice.label}
                query={query}
                onOnly={() => props.onOnly(choice.value)}
              />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {choice.count}
              </span>
            </span>
          </MenuCheckboxItem>
        ))
      }
    </MenuSearch>
  );
}

/**
 * Project and provider filters share the same local view as the picker's search and sort. Each
 * applied selection shows as a pill on its own row below, with an × to drop it.
 */
export function ThreadAttachPickerFilterBar(props: {
  projects: ReadonlyArray<Choice<ProjectId>>;
  providers: ReadonlyArray<Choice<ProviderInstanceId>>;
  view: ThreadAttachPickerView;
  onChange: (view: ThreadAttachPickerView) => void;
}) {
  const { view } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  // "Only" settles the filter, so it also closes the menu.
  const pickOnly = (next: ThreadAttachPickerView) => {
    props.onChange(next);
    setMenuOpen(false);
  };
  const filtered = view.projectIds.length > 0 || view.providerInstanceIds.length > 0;
  const labelOf = <T extends string>(choices: ReadonlyArray<Choice<T>>, value: T) =>
    choices.find((choice) => choice.value === value)?.label ?? value;
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
              <MenuSubTrigger>Project</MenuSubTrigger>
              <MenuSubPopup>
                <ChoiceChecklist
                  choices={props.projects}
                  selected={view.projectIds}
                  placeholder="Search projects"
                  empty="No projects in these threads"
                  onChange={(projectIds) => props.onChange({ ...view, projectIds })}
                  onOnly={(projectId) => pickOnly({ ...view, projectIds: [projectId] })}
                />
              </MenuSubPopup>
            </MenuSub>
            <MenuSub>
              <MenuSubTrigger>Provider</MenuSubTrigger>
              <MenuSubPopup>
                <ChoiceChecklist
                  choices={props.providers}
                  selected={view.providerInstanceIds}
                  placeholder="Search providers"
                  empty="No providers in these threads"
                  onChange={(providerInstanceIds) =>
                    props.onChange({ ...view, providerInstanceIds })
                  }
                  onOnly={(providerInstanceId) =>
                    pickOnly({ ...view, providerInstanceIds: [providerInstanceId] })
                  }
                />
              </MenuSubPopup>
            </MenuSub>
          </MenuPopup>
        </Menu>
        <div className="flex-1" />
        {filtered || view.sort !== DEFAULT_THREAD_ATTACH_PICKER_VIEW.sort ? (
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            onClick={() => props.onChange(DEFAULT_THREAD_ATTACH_PICKER_VIEW)}
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
              onValueChange={(sort: ThreadAttachPickerView["sort"]) =>
                props.onChange({ ...view, sort })
              }
            >
              {(Object.keys(SORT_LABELS) as Array<ThreadAttachPickerView["sort"]>).map((sort) => (
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
          {view.projectIds.map((projectId) => (
            <FilterPill
              key={`project:${projectId}`}
              icon={<FolderIcon />}
              label={labelOf(props.projects, projectId)}
              onRemove={() =>
                props.onChange({
                  ...view,
                  projectIds: view.projectIds.filter((entry) => entry !== projectId),
                })
              }
            />
          ))}
          {view.providerInstanceIds.map((providerInstanceId) => (
            <FilterPill
              key={`provider:${providerInstanceId}`}
              icon={<BotIcon />}
              label={labelOf(props.providers, providerInstanceId)}
              onRemove={() =>
                props.onChange({
                  ...view,
                  providerInstanceIds: view.providerInstanceIds.filter(
                    (entry) => entry !== providerInstanceId,
                  ),
                })
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
