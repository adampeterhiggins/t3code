import { EllipsisIcon } from "lucide-react";
import type { ChatComposerProps } from "./ChatComposer";
import { shortcutLabelForCommand } from "../../keybindings";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ComposerStartFromButton({
  onStartFrom,
  keybindings,
  terminalOpen,
}: Pick<ChatComposerProps, "onStartFrom" | "keybindings" | "terminalOpen">) {
  const startFromShortcutLabel = onStartFrom
    ? shortcutLabelForCommand(keybindings, "chat.startFrom", {
        context: { terminalFocus: false, terminalOpen, modelPickerOpen: false },
      })
    : null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute end-2 top-2 z-10 sm:end-2.5 sm:top-2.5"
            aria-label="Start from a pull request, branch, issue, or automation"
            onClick={onStartFrom}
          />
        }
      >
        <EllipsisIcon />
      </TooltipTrigger>
      <TooltipPopup>
        Start from a PR, branch, issue, or automation
        {startFromShortcutLabel ? ` (${startFromShortcutLabel})` : null}
      </TooltipPopup>
    </Tooltip>
  );
}
