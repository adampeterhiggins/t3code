import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_LABEL_CLASS } from "./threadDetailsPanelStyles";

/** One linked item in the thread details panel's Links section; its menu holds the link's actions. */
export function ThreadLinkRow(props: {
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  accessibleLabel: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex h-8 items-center">
      <Menu>
        <MenuTrigger
          render={
            <ThreadDetailsControl
              variant="ghost"
              size="sm"
              part="row"
              aria-label={props.accessibleLabel}
              title={props.title}
            />
          }
        >
          {props.icon}
          <span
            className={cn("min-w-0 flex-1 truncate text-left", THREAD_DETAILS_PANEL_LABEL_CLASS)}
          >
            {props.label}
          </span>
          {props.trailing}
        </MenuTrigger>
        <MenuPopup align="end">{props.children}</MenuPopup>
      </Menu>
    </li>
  );
}
