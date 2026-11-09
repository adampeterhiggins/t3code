import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  formatHostedThreadLink,
  guessThreadLinkRef,
  threadLinkCandidates,
  type ThreadLink,
  unknownThreadLinkLabel,
} from "@t3tools/shared/threadLinks";
import { Link } from "@tanstack/react-router";
import { MessageSquareTextIcon } from "lucide-react";

import { useProject, useThreadRefs, useThreadShell } from "../../state/entities";
import { configuredHostedAppUrl } from "../../hostedPairing";
import { ProjectFavicon } from "../ProjectFavicon";
import { UnresolvedChip } from "../contextChipParts";
import { ContextPreviewHover } from "../contextPreviewRegistry";

/** `label` is the link's written text; an autolink has none. */
export function MarkdownThreadLink(props: {
  readonly environmentId: EnvironmentId;
  readonly link: ThreadLink;
  readonly label: string | null;
}) {
  const candidates = threadLinkCandidates(props.link, props.environmentId);
  const writtenRef = candidates[0]!;
  const written = useThreadShell(writtenRef);
  const lookup = useEnvironmentQuery(
    written === null
      ? orchestrationEnvironment.threadLinkMetadata({
          environmentId: writtenRef.environmentId,
          input: { threadIds: candidates.map((ref) => ref.threadId) },
        })
      : null,
  );
  const settled = lookup.isSuccess && !lookup.isPending;
  const target =
    written !== null
      ? { ref: writtenRef, metadata: written }
      : (candidates.flatMap((ref) => {
          const metadata = lookup.data?.[ref.threadId];
          return metadata ? [{ ref, metadata }] : [];
        })[0] ?? null);
  const missing = target === null && settled;
  const guess = missing && props.link.environmentId === null;
  const refs = useThreadRefs(guess);
  const remoteRef = guess
    ? guessThreadLinkRef(
        props.link,
        refs.filter((ref) => ref.environmentId !== writtenRef.environmentId),
      )
    : null;
  const remote = useThreadShell(remoteRef);
  const resolved = target ?? (remoteRef && remote ? { ref: remoteRef, metadata: remote } : null);
  const environmentId = resolved?.ref.environmentId ?? writtenRef.environmentId;
  const threadId = resolved?.ref.threadId ?? writtenRef.threadId;
  const project = useProject(
    resolved?.metadata.projectId
      ? scopeProjectRef(environmentId, resolved.metadata.projectId)
      : null,
  );
  if (missing && resolved === null) {
    const unknown = unknownThreadLinkLabel(props.link, props.environmentId);
    return <UnresolvedChip label={props.label ?? unknown} tooltip={unknown} />;
  }
  const title = resolved?.metadata.title.trim() || props.label || "Thread";
  return (
    <ContextPreviewHover
      kind="thread"
      accessibleLabel={`Thread, ${title}`}
      preview={{ record: { environmentId, threadId, title } }}
      trigger={
        <Link
          aria-label={`Thread, ${title}`}
          to="/$environmentId/$threadId"
          params={{ environmentId, threadId }}
          data-markdown-copy={formatHostedThreadLink(
            { environmentId, threadId },
            title,
            configuredHostedAppUrl(),
          )}
        >
          <span className="ms-[0.25em] me-[0.2em] inline-flex size-[14px] [vertical-align:-0.125em]">
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
