import type { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { ArrowDownUpIcon, ListFilterIcon } from "lucide-react";

import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
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

function toggle<T>(values: ReadonlyArray<T>, value: T, checked: boolean) {
  return checked
    ? [...values.filter((entry) => entry !== value), value]
    : values.filter((entry) => entry !== value);
}

/** Project and provider filters share the same local view as the picker's search and sort. */
export function ThreadAttachPickerFilterBar(props: {
  projects: ReadonlyArray<{ value: ProjectId; label: string }>;
  providers: ReadonlyArray<{ value: ProviderInstanceId; label: string }>;
  view: ThreadAttachPickerView;
  onChange: (view: ThreadAttachPickerView) => void;
}) {
  const { view } = props;
  const filterCount = view.projectIds.length + view.providerInstanceIds.length;
  return (
    <div className="flex items-center gap-1.5 px-3 pb-2">
      <Menu>
        <MenuTrigger render={<Button type="button" size="xs" variant="outline" />}>
          <ListFilterIcon />
          {filterCount > 0 ? `Filter (${filterCount})` : "Filter"}
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuSub>
            <MenuSubTrigger>
              Project{view.projectIds.length > 0 ? ` (${view.projectIds.length})` : ""}
            </MenuSubTrigger>
            <MenuSubPopup>
              {props.projects.map((project) => (
                <MenuCheckboxItem
                  key={project.value}
                  checked={view.projectIds.includes(project.value)}
                  onCheckedChange={(checked) =>
                    props.onChange({
                      ...view,
                      projectIds: toggle(view.projectIds, project.value, checked),
                    })
                  }
                >
                  {project.label}
                </MenuCheckboxItem>
              ))}
            </MenuSubPopup>
          </MenuSub>
          <MenuSub>
            <MenuSubTrigger>
              Provider
              {view.providerInstanceIds.length > 0 ? ` (${view.providerInstanceIds.length})` : ""}
            </MenuSubTrigger>
            <MenuSubPopup>
              {props.providers.map((provider) => (
                <MenuCheckboxItem
                  key={provider.value}
                  checked={view.providerInstanceIds.includes(provider.value)}
                  onCheckedChange={(checked) =>
                    props.onChange({
                      ...view,
                      providerInstanceIds: toggle(
                        view.providerInstanceIds,
                        provider.value,
                        checked,
                      ),
                    })
                  }
                >
                  {provider.label}
                </MenuCheckboxItem>
              ))}
            </MenuSubPopup>
          </MenuSub>
        </MenuPopup>
      </Menu>
      <div className="flex-1" />
      {filterCount > 0 || view.sort !== DEFAULT_THREAD_ATTACH_PICKER_VIEW.sort ? (
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
  );
}
