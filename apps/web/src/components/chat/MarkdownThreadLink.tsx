import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useGT, useMessages } from "gt-react";
import { MessagesSquareIcon } from "lucide-react";
import {
  formatHostedThreadLink,
  guessThreadLinkRef,
  threadLinkCandidates,
  type ThreadLink,
} from "@t3tools/shared/threadLinks";
import { Link } from "@tanstack/react-router";
import { MessageSquareTextIcon } from "lucide-react";
import { unknownThreadLinkLabel } from "@t3tools/shared/threadLinksCopy";
import { resolveLinkedThreadOpen } from "@t3tools/client-runtime/linked-thread";

import { useProject, useThreadRefs, useThreadShell } from "../../state/entities";
import { configuredHostedAppUrl } from "../../hostedPairing";
import { useConnectedEnvironmentIds, useEnvironmentIdentities } from "../../state/environments";
import { useSideThreadTrigger } from "../../hooks/useSideThreadTrigger";
import { openLinkedThreadRead } from "../../lib/sideChatPane";
import { useLinkedEnvironments } from "../../state/peerLinks";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import { UnresolvedChip } from "../contextChipParts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useSideChatThreadLinkClick } from "../../lib/sideChatPane";
import { ProjectFavicon } from "../ProjectFavicon";
import { ContextPreviewHover } from "../contextPreviewRegistry";

/** `label` is the link's written text; an autolink has none. */
export function MarkdownThreadLink(props: {
  readonly environmentId: EnvironmentId;
  /** The thread the link is written in; a linked environment's thread can open in its right panel. */
  readonly threadRef?: ScopedThreadRef | undefined;
  readonly link: ThreadLink;
  readonly label: string | null;
}) {
  const gt = useGT();
  const messages = useMessages();
  const navigate = useNavigate();
  const trigger = useSideThreadTrigger();
  const panelRef = props.threadRef ?? null;
  const candidates = threadLinkCandidates(props.link, props.environmentId);
  const writtenRef = candidates[0]!;
  const written = useThreadShell(writtenRef);
  const saved = useEnvironmentIdentities().some(
    (environment) => environment.environmentId === writtenRef.environmentId,
  );
  const connected = useConnectedEnvironmentIds().includes(writtenRef.environmentId);
  // A thread on a machine this client is not connected to still reads through the one that links to it.
  const linkedLabel = useLinkedEnvironments(
    connected || writtenRef.environmentId === props.environmentId ? null : props.environmentId,
  ).get(writtenRef.environmentId);
  // A shell cached from an earlier connection does not make the thread open there now.
  const linked =
    resolveLinkedThreadOpen({
      environmentId: writtenRef.environmentId,
      viaEnvironmentId: props.environmentId,
      own: saved ? { connected } : undefined,
      linked: linkedLabel !== undefined,
    }) === "linked";
  const reachable = saved && !linked;
  const lookup = useEnvironmentQuery(
    written === null && reachable
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
  const missing = target === null && (settled || !reachable);
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
  const onLinkClick = useSideChatThreadLinkClick({ environmentId, threadId }, written ?? remote);
  const project = useProject(
    resolved?.metadata.projectId
      ? scopeProjectRef(environmentId, resolved.metadata.projectId)
      : null,
  );
  if (linked && linkedLabel !== undefined) {
    const knownTitle = props.label ?? written?.title ?? null;
    const title = knownTitle ?? gt("Thread on {label}", { label: linkedLabel });
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <ContextChip
              kind="thread"
              render={
                <button
                  type="button"
                  {...trigger(
                    (intent) =>
                      openLinkedThreadRead({
                        panelRef,
                        target: {
                          viaEnvironmentId: props.environmentId,
                          ...writtenRef,
                          label: linkedLabel,
                          title: knownTitle,
                        },
                        intent,
                        navigate,
                      }),
                    // Outside a thread there is no panel to read it in.
                    { panel: panelRef !== null },
                  )}
                />
              }
              aria-label={gt("Thread, {title}", { title })}
            >
              <MessagesSquareIcon />
              <ContextChipLabel>{title}</ContextChipLabel>
            </ContextChip>
          }
        />
        <TooltipPopup side="top">
          {gt("Read the thread on {label}", { label: linkedLabel })}
        </TooltipPopup>
      </Tooltip>
    );
  }
  if (missing && resolved === null) {
    const unknown = unknownThreadLinkLabel(props.link, props.environmentId, messages);
    return <UnresolvedChip label={props.label ?? unknown} tooltip={unknown} />;
  }
  const title = resolved?.metadata.title.trim() || props.label || gt("Thread");
  return (
    <ContextPreviewHover
      kind="thread"
      accessibleLabel={gt("Thread, {title}", { title })}
      preview={{ record: { environmentId, threadId, title } }}
      trigger={
        <Link
          aria-label={gt("Thread, {title}", { title })}
          to="/$environmentId/$threadId"
          params={{ environmentId, threadId }}
          onClick={onLinkClick}
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
