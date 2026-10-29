import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  formatThreadLink,
  guessThreadLinkRef,
  percentDecodedThreadLinkId,
  type ThreadLink,
  unknownThreadLinkLabel,
} from "@t3tools/shared/threadLinks";
import { Link } from "@tanstack/react-router";
import { MessageSquareTextIcon } from "lucide-react";

import { useProject, useThreadRefs, useThreadShell } from "../../state/entities";
import { ProjectFavicon } from "../ProjectFavicon";
import { ContextPreviewHover } from "../contextPreviewRegistry";

/** `label` is the link's written text; an autolink has none. */
export function MarkdownThreadLink(props: {
  readonly environmentId: EnvironmentId;
  readonly link: ThreadLink;
  readonly label: string | null;
}) {
  const linkEnvironmentId = props.link.environmentId ?? props.environmentId;
  const decodedId = percentDecodedThreadLinkId(props.link.threadId);
  const written = useThreadShell(scopeThreadRef(linkEnvironmentId, props.link.threadId));
  const decoded = useThreadShell(
    written === null && decodedId !== null ? scopeThreadRef(linkEnvironmentId, decodedId) : null,
  );
  const local = written ?? decoded;
  const guess = local === null && props.link.environmentId === null;
  const refs = useThreadRefs(guess);
  const remote = useThreadShell(guess ? guessThreadLinkRef(props.link, refs) : null);
  const thread = local ?? remote;
  const environmentId = thread?.environmentId ?? linkEnvironmentId;
  const threadId = thread?.id ?? props.link.threadId;
  const project = useProject(
    thread === null ? null : scopeProjectRef(environmentId, thread.projectId),
  );
  const title =
    thread?.title.trim() || props.label || unknownThreadLinkLabel(props.link, props.environmentId);
  return (
    <ContextPreviewHover
      kind="thread"
      accessibleLabel={`Thread, ${title}`}
      preview={{ record: { environmentId, threadId, title } }}
      trigger={
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId, threadId }}
          data-markdown-copy={formatThreadLink({ environmentId, threadId }, title)}
        >
          <span
            className="ms-[0.25em] me-[0.2em] inline-flex size-[14px] [vertical-align:-0.125em]"
            aria-hidden
          >
            {project === null ? (
              <MessageSquareTextIcon className="block size-full shrink-0" />
            ) : (
              <ProjectFavicon project={project} className="size-full" />
            )}
          </span>
          {title}
        </Link>
      }
    />
  );
}
