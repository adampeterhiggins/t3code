import { useRef, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./tooltip";

/**
 * One line of text that ends in an ellipsis when it does not fit, and shows the whole of it in a
 * tooltip only then. It inherits its type styles, so style the parent. Truncation is measured
 * when the tooltip would open, so long lists pay nothing until a row is hovered.
 */
export function Truncatable({
  children,
  tooltip,
  className,
}: {
  children: ReactNode;
  /** What the tooltip shows; defaults to `children`. */
  tooltip?: ReactNode;
  /** Layout only, such as width or flex sizing. */
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        const element = ref.current;
        setOpen(next && element !== null && element.scrollWidth - element.clientWidth > 1);
      }}
    >
      <TooltipTrigger
        render={<span ref={ref} className={cn("block min-w-0 truncate", className)} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup align="start" className="max-w-96 whitespace-normal break-words">
        {tooltip ?? children}
      </TooltipPopup>
    </Tooltip>
  );
}
