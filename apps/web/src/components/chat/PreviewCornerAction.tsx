import type { ReactNode } from "react";

/**
 * A muted text action in the corner of a preview card, the same treatment as
 * "Open on GitHub" on an issue preview.
 */
export function PreviewCornerAction(props: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="shrink-0 cursor-pointer text-xs font-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
