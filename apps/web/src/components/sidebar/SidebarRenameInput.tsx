import { type ScopedThreadRef } from "@t3tools/contracts";

import { useRef } from "react";

/** Inline title editor, mounted only while a row is being renamed. */
export function SidebarRenameInput(props: {
  threadRef: ScopedThreadRef;
  originalTitle: string;
  value: string;
  onChange: (title: string) => void;
  onCommit: (threadRef: ScopedThreadRef, title: string, originalTitle: string) => void;
  onCancel: () => void;
}) {
  // Enter and Escape unmount the field, which blurs it; the blur must not commit a second time.
  const finishedRef = useRef(false);
  return (
    <input
      autoFocus
      value={props.value}
      dir="auto"
      aria-label="Thread title"
      onChange={(event) => props.onChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter") {
          event.preventDefault();
          finishedRef.current = true;
          props.onCommit(props.threadRef, props.value, props.originalTitle);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finishedRef.current = true;
          props.onCancel();
        }
      }}
      onBlur={() => {
        if (!finishedRef.current) props.onCommit(props.threadRef, props.value, props.originalTitle);
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm font-medium text-card-foreground outline-none focus:border-foreground"
    />
  );
}
