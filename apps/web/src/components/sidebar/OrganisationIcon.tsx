import type { Organisation } from "@t3tools/contracts/settings";
import { BuildingIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { ThreadGroupIcon } from "./ThreadGroupIcon";

/** An organisation's chosen icon, or a building when it has none. */
export function OrganisationIcon(props: {
  organisation: Organisation | undefined;
  className?: string | undefined;
}) {
  const icon = props.organisation?.icon;
  return icon ? (
    <ThreadGroupIcon style={{ icon }} className={props.className} />
  ) : (
    <BuildingIcon aria-hidden className={cn("size-3.5 shrink-0", props.className)} />
  );
}
