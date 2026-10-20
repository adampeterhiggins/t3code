import { BuildingIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import type { OrganisationOption } from "../Sidebar.logic";
import { ThreadGroupIcon } from "./ThreadGroupIcon";

/** The GitHub avatar of a `github.com/<owner>` organisation, or null for other hosts. */
export function githubAvatarUrlOf(organisationKey: string): string | null {
  const [host, owner, ...rest] = organisationKey.split("/");
  if (host?.toLowerCase() !== "github.com" || !owner || rest.length > 0) return null;
  return `https://github.com/${encodeURIComponent(owner)}.png?size=64`;
}

/** An organisation's chosen icon, else its GitHub avatar, else a building. */
export function OrganisationIcon(props: {
  option: Pick<OrganisationOption, "key" | "organisation">;
  className?: string | undefined;
}) {
  const organisation = props.option.organisation;
  const avatarUrl = githubAvatarUrlOf(props.option.key);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  if (organisation?.icon) {
    return <ThreadGroupIcon style={{ icon: organisation.icon }} className={props.className} />;
  }
  if (avatarUrl && avatarUrl !== failedAvatarUrl) {
    return (
      <img
        alt=""
        src={avatarUrl}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={cn("size-3.5 shrink-0 rounded-sm", props.className)}
        onError={() => setFailedAvatarUrl(avatarUrl)}
      />
    );
  }
  return <BuildingIcon aria-hidden className={cn("size-3.5 shrink-0", props.className)} />;
}
