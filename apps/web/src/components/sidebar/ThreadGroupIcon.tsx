import type { ThreadGroup } from "@t3tools/contracts/settings";
import { FolderOpenIcon } from "lucide-react";
import type { IconName } from "lucide-react/dynamic";
import { lazy, Suspense } from "react";

import { cn } from "~/lib/utils";
import { projectIconColorClassName } from "../../projectIconColors";
import { ProjectMonogram } from "../ProjectMonogram";

const DynamicIcon = lazy(() =>
  import("lucide-react/dynamic").then((module) => ({ default: module.DynamicIcon })),
);

/** A thread group's chosen icon, or a folder in its accent when it has none. */
export function ThreadGroupIcon(props: {
  style: ThreadGroup | undefined;
  className?: string | undefined;
}) {
  const icon = props.style?.icon ?? null;
  const box = cn("inline-flex size-3.5 shrink-0 items-center justify-center", props.className);
  if (icon?.kind === "emoji") {
    return (
      <span aria-hidden className={cn(box, "text-xs leading-none")}>
        {icon.emoji}
      </span>
    );
  }
  if (icon?.kind === "monogram") {
    return <ProjectMonogram text={icon.text} color={icon.color} className={box} />;
  }
  const color = icon?.kind === "lucide" ? icon.color : props.style?.accent;
  const colorClassName = color ? projectIconColorClassName(color) : undefined;
  if (icon?.kind === "lucide") {
    return (
      <span aria-hidden className={cn(box, colorClassName)}>
        <Suspense fallback={<FolderOpenIcon className="size-full" />}>
          <DynamicIcon name={icon.name as IconName} className="size-full" />
        </Suspense>
      </span>
    );
  }
  return <FolderOpenIcon aria-hidden className={cn(box, colorClassName)} />;
}
