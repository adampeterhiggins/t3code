import type { ScopedThreadRef } from "@t3tools/contracts";
import { PaperclipIcon, SquareKanbanIcon } from "lucide-react";
import { memo } from "react";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { useComposerMenuProps } from "./composerEventScope";
import { openLinearIssuePicker } from "./LinearIssuePicker";

/** The composer's attach button: asks what to attach, files or a Linear issue. */
export const ComposerAttachMenu = memo(function ComposerAttachMenu(props: {
  threadRef: ScopedThreadRef;
  onAttachFiles: () => void;
}) {
  const composerMenuProps = useComposerMenuProps();
  return (
    <Menu>
      <MenuTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Attach" />}
      >
        <PaperclipIcon />
      </MenuTrigger>
      <MenuPopup side="top" align="end" {...composerMenuProps}>
        <MenuItem onClick={props.onAttachFiles}>
          <PaperclipIcon />
          Files and images
        </MenuItem>
        <MenuItem onClick={() => openLinearIssuePicker(props.threadRef)}>
          <SquareKanbanIcon />
          Linear issue
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
});
