import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { deriveProviderInstanceEntries } from "~/providerInstances";
import { useProject, useServerConfigs, useThreadShell } from "~/state/entities";
import { getTriggerDisplayModelLabel } from "./providerIconUtils";
import {
  type createThreadAttachSummaryLoader,
  parseThreadSummaryPreview,
} from "./threadAttachPickerSummary";

/** The thread's provider and model, named the way the model picker shows them. */
function useThreadProviderLabel(environmentId: EnvironmentId, threadId: ThreadId) {
  const thread = useThreadShell(scopeThreadRef(environmentId, threadId));
  const serverConfigs = useServerConfigs();
  return useMemo(() => {
    if (!thread) return null;
    const { instanceId, model } = thread.modelSelection;
    const provider = deriveProviderInstanceEntries(
      serverConfigs.get(environmentId)?.providers ?? [],
    ).find((entry) => entry.instanceId === instanceId);
    const selected = provider?.models.find((entry) => entry.slug === model);
    return `${provider?.displayName ?? thread.session?.providerName ?? instanceId} · ${
      selected ? getTriggerDisplayModelLabel(selected) : model
    }`;
  }, [thread, serverConfigs, environmentId]);
}

/**
 * Hover preview of a thread to attach: how it started, the latest exchange, and changed files,
 * read from the same summary an attachment captures. Mount it only while visible; it fetches.
 */
export function ThreadSummaryPreview(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  title: string;
  parentTitle: string | null;
  loadSummary: ReturnType<typeof createThreadAttachSummaryLoader> | null;
}) {
  const { environmentId, threadId, loadSummary } = props;
  const thread = useThreadShell(scopeThreadRef(environmentId, threadId));
  const project = useProject(thread ? scopeProjectRef(environmentId, thread.projectId) : null);
  const providerLabel = useThreadProviderLabel(environmentId, threadId);
  const [preview, setPreview] = useState<{ summary: string } | { error: string } | null>(null);
  useEffect(() => {
    if (loadSummary === null) return;
    let active = true;
    loadSummary(threadId).then(
      (summary) => {
        if (active) setPreview({ summary });
      },
      (cause: unknown) => {
        if (active)
          setPreview({
            error: cause instanceof Error ? cause.message : "Could not summarize that thread.",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [threadId, loadSummary]);
  const content = useMemo(
    () => (preview && "summary" in preview ? parseThreadSummaryPreview(preview.summary) : null),
    [preview],
  );
  const facts = [
    project?.title ?? null,
    providerLabel,
    content && content.files.length > 0
      ? `${content.files.length + content.moreFiles} ${content.files.length + content.moreFiles === 1 ? "file" : "files"} changed`
      : null,
  ].filter((fact) => fact !== null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        {props.parentTitle !== null && props.parentTitle !== props.title ? (
          <p className="truncate text-muted-foreground">Tab of {props.parentTitle}</p>
        ) : null}
        <p className="truncate font-medium text-foreground text-sm">{props.title}</p>
        <p className="truncate text-muted-foreground">{facts.join(" · ")}</p>
      </div>
      {content ? (
        <div className="flex flex-col gap-2.5 border-t pt-2.5">
          {content.opening === null &&
          content.latestUser === null &&
          content.latestAssistant === null ? (
            <p className="text-muted-foreground">No messages yet.</p>
          ) : null}
          {content.opening !== null ? (
            <SummaryPreviewSection label="Started with">
              <p className="line-clamp-3 whitespace-pre-line wrap-break-word">{content.opening}</p>
            </SummaryPreviewSection>
          ) : null}
          {content.latestUser !== null ? (
            <SummaryPreviewSection
              label={
                content.earlierTurns > 0
                  ? `Latest · after ${content.earlierTurns} more ${content.earlierTurns === 1 ? "turn" : "turns"}`
                  : "Latest"
              }
            >
              <p className="line-clamp-2 whitespace-pre-line wrap-break-word">
                {content.latestUser}
              </p>
            </SummaryPreviewSection>
          ) : null}
          {content.latestAssistant !== null ? (
            <SummaryPreviewSection label="Agent replied">
              <p className="line-clamp-4 whitespace-pre-line wrap-break-word text-muted-foreground">
                {content.latestAssistant}
              </p>
            </SummaryPreviewSection>
          ) : null}
          {content.files.length > 0 ? (
            <SummaryPreviewSection label="Files changed">
              <p className="line-clamp-2 wrap-break-word font-mono text-muted-foreground">
                {content.files.map((file) => file.split("/").at(-1)).join(", ")}
                {content.moreFiles > 0 ? `, +${content.moreFiles} more` : ""}
              </p>
            </SummaryPreviewSection>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground">
          {preview && "error" in preview
            ? preview.error
            : loadSummary === null
              ? "Connect to preview this thread."
              : "Summarizing…"}
        </p>
      )}
    </div>
  );
}

function SummaryPreviewSection(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium text-muted-foreground">{props.label}</p>
      {props.children}
    </div>
  );
}
