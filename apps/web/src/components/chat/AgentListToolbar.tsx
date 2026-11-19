import {
  DEFAULT_AGENT_LIST_VIEW,
  type AgentListSort,
  type AgentListView,
  type AgentStatusFilter,
} from "@t3tools/client-runtime/state/agent-list-view";
import { msg, T, useGT, useMessages } from "gt-react";
import { ArrowDownUpIcon, CircleDotIcon, ListFilterIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { FilterPill } from "../FilterPill";
import { MenuChoiceLabel } from "../MenuChoiceLabel";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../ui/menu";

const STATUS_LABELS: Record<AgentStatusFilter, string> = {
  working: msg("Working", { $context: "agent status" }),
  idle: msg("Idle", { $context: "agent status" }),
  done: msg("Completed", { $context: "agent status" }),
  failed: msg("Failed", { $context: "agent status" }),
  stopped: msg("Stopped", { $context: "agent status" }),
};

const SORT_LABELS: Record<AgentListSort, string> = {
  spawn: msg("Spawn order"),
  status: msg("Status", { $context: "sort agents by status" }),
  tokens: msg("Tokens", { $context: "sort agents by token usage" }),
  duration: msg("Duration", { $context: "sort agents by duration" }),
};

/**
 * Fork: search, status filter, and sort for a thread's agents list. Each status lists how many
 * agents it would show under the search (`agentListStatusCounts`); picked statuses show as pills
 * below.
 */
export function AgentListToolbar(props: {
  view: AgentListView;
  statusCounts: ReadonlyMap<AgentStatusFilter, number>;
  onChange: (view: AgentListView) => void;
}) {
  const { view } = props;
  const gt = useGT();
  const m = useMessages();
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statuses = (Object.keys(STATUS_LABELS) as AgentStatusFilter[]).filter((status) =>
    props.statusCounts.has(status),
  );
  const toggleStatus = (status: AgentStatusFilter, checked: boolean) =>
    props.onChange({
      ...view,
      statuses: checked
        ? [...view.statuses, status]
        : view.statuses.filter((value) => value !== status),
    });

  return (
    <div className="flex flex-col gap-1.5 pb-1">
      <div className="flex items-center gap-1">
        <Input
          size="compact"
          type="search"
          value={view.query}
          placeholder={gt("Search agents")}
          aria-label={gt("Search agents")}
          onChange={(event) => props.onChange({ ...view, query: event.target.value })}
          className="min-w-0 flex-1"
        />
        <Menu open={statusMenuOpen} onOpenChange={setStatusMenuOpen}>
          <MenuTrigger
            render={
              <Button
                type="button"
                size="xs"
                variant={view.statuses.length > 0 ? "outline" : "ghost"}
                aria-label={gt("Filter agents by status")}
              />
            }
          >
            <ListFilterIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            {statuses.length === 0 ? (
              <MenuItem disabled>
                <T>No agents match</T>
              </MenuItem>
            ) : null}
            {statuses.map((status) => (
              <MenuCheckboxItem
                key={status}
                checked={view.statuses.includes(status)}
                onCheckedChange={(checked) => toggleStatus(status, checked)}
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  <MenuChoiceLabel
                    label={m(STATUS_LABELS[status])}
                    onOnly={() => {
                      // "Only" settles the filter, so it also closes the menu.
                      props.onChange({ ...view, statuses: [status] });
                      setStatusMenuOpen(false);
                    }}
                  />
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {props.statusCounts.get(status)}
                  </span>
                </span>
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
                aria-label={gt("Sort agents: {sort}", { sort: m(SORT_LABELS[view.sort]) })}
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
                  {m(SORT_LABELS[sort])}
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
            aria-label={gt("Reset agent filters")}
            onClick={() => props.onChange(DEFAULT_AGENT_LIST_VIEW)}
          >
            <XIcon />
          </Button>
        ) : null}
      </div>
      {view.statuses.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {view.statuses.map((status) => (
            <FilterPill
              key={status}
              icon={<CircleDotIcon />}
              label={m(STATUS_LABELS[status])}
              onRemove={() => toggleStatus(status, false)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
