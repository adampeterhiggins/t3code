import {
  DEFAULT_AGENT_LIST_VIEW,
  type AgentListSort,
  type AgentListView,
  type AgentStatusFilter,
} from "@t3tools/client-runtime/state/agent-list-view";
import { ArrowDownUpIcon, ListFilterIcon, XIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../ui/menu";

const STATUS_LABELS: Record<AgentStatusFilter, string> = {
  working: "Working",
  idle: "Idle",
  done: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

const SORT_LABELS: Record<AgentListSort, string> = {
  spawn: "Spawn order",
  status: "Status",
  tokens: "Tokens",
  duration: "Duration",
};

/** Fork: search, status filter, and sort for a thread's agents list. */
export function AgentListToolbar(props: {
  view: AgentListView;
  onChange: (view: AgentListView) => void;
}) {
  const { view } = props;
  const toggleStatus = (status: AgentStatusFilter, checked: boolean) =>
    props.onChange({
      ...view,
      statuses: checked
        ? [...view.statuses, status]
        : view.statuses.filter((value) => value !== status),
    });

  return (
    <div className="flex items-center gap-1 pb-1">
      <Input
        size="compact"
        type="search"
        value={view.query}
        placeholder="Search agents"
        aria-label="Search agents"
        onChange={(event) => props.onChange({ ...view, query: event.target.value })}
        className="min-w-0 flex-1"
      />
      <Menu>
        <MenuTrigger
          render={
            <Button
              type="button"
              size="xs"
              variant={view.statuses.length > 0 ? "outline" : "ghost"}
              aria-label="Filter agents by status"
            />
          }
        >
          <ListFilterIcon />
          {view.statuses.length > 0 ? view.statuses.length : null}
        </MenuTrigger>
        <MenuPopup align="end">
          {(Object.keys(STATUS_LABELS) as AgentStatusFilter[]).map((status) => (
            <MenuCheckboxItem
              key={status}
              checked={view.statuses.includes(status)}
              onCheckedChange={(checked) => toggleStatus(status, checked)}
            >
              {STATUS_LABELS[status]}
            </MenuCheckboxItem>
          ))}
        </MenuPopup>
      </Menu>
      <Menu>
        <MenuTrigger
          render={
            <Button
              type="button"
              size="xs"
              variant="ghost"
              aria-label={`Sort agents: ${SORT_LABELS[view.sort]}`}
            />
          }
        >
          <ArrowDownUpIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuRadioGroup
            value={view.sort}
            onValueChange={(sort: AgentListSort) => props.onChange({ ...view, sort })}
          >
            {(Object.keys(SORT_LABELS) as AgentListSort[]).map((sort) => (
              <MenuRadioItem key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
      {view.statuses.length > 0 || view.query.length > 0 || view.sort !== "spawn" ? (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Reset agent filters"
          onClick={() => props.onChange(DEFAULT_AGENT_LIST_VIEW)}
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  );
}
