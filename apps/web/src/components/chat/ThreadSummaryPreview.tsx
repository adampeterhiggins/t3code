import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { msg, T, useGT, Var } from "gt-react";
import { type ReactNode, useEffect, useState } from "react";

import { m } from "~/i18n/messages";
import { deriveProviderInstanceEntries } from "~/providerInstances";
import { useProject, useThreadShell } from "~/state/entities";
import { providersIgnoringCheckedAtAtom } from "~/state/server";
import { getTriggerDisplayModelLabel } from "./providerIconUtils";
import {
  type createThreadAttachSummaryLoader,
  parseThreadSummaryPreview,
} from "./threadAttachPickerSummary";

/** The thread's provider and model, named the way the model picker shows them. */
function useThreadProviderLabel(environmentId: EnvironmentId, threadId: ThreadId) {
  const thread = useThreadShell(scopeThreadRef(environmentId, threadId));
  const providers = useAtomValue(providersIgnoringCheckedAtAtom(environmentId));
  if (!thread) return null;
  const { instanceId, model } = thread.modelSelection;
  const provider = deriveProviderInstanceEntries(providers).find(
    (entry) => entry.instanceId === instanceId,
  );
  const selected = provider?.models.find((entry) => entry.slug === model);
  return `${provider?.displayName ?? thread.runtime?.providerName ?? instanceId} · ${
    selected ? getTriggerDisplayModelLabel(selected) : model
  }`;
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
  const gt = useGT();
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
            error:
              cause instanceof Error ? cause.message : m(msg("Could not summarize that thread.")),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [threadId, loadSummary]);
  const content =
    preview && "summary" in preview ? parseThreadSummaryPreview(preview.summary) : null;
  const facts = [
    project?.title ?? null,
    providerLabel,
    content && content.files.length > 0
      ? gt("{count, plural, one {{count} file changed} other {{count} files changed}}", {
          count: content.files.length + content.moreFiles,
        })
      : null,
  ].filter((fact) => fact !== null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        {props.parentTitle !== null && props.parentTitle !== props.title ? (
          <p className="truncate text-muted-foreground">
            <T>
              Tab of <Var>{props.parentTitle}</Var>
            </T>
          </p>
        ) : null}
        <p className="truncate font-medium text-foreground text-sm">{props.title}</p>
        <p className="truncate text-muted-foreground">{facts.join(" · ")}</p>
      </div>
      {content ? (
        <div className="flex flex-col gap-2.5 border-t pt-2.5">
          {content.opening === null &&
          content.latestUser === null &&
          content.latestAssistant === null ? (
            <p className="text-muted-foreground">
              <T>No messages yet.</T>
            </p>
          ) : null}
          {content.opening !== null ? (
            <SummaryPreviewSection label={gt("Started with")}>
              <p className="line-clamp-3 whitespace-pre-line wrap-break-word">{content.opening}</p>
            </SummaryPreviewSection>
          ) : null}
          {content.latestUser !== null ? (
            <SummaryPreviewSection
              label={
                content.earlierTurns > 0
                  ? gt(
                      "{count, plural, one {Latest · after {count} more turn} other {Latest · after {count} more turns}}",
                      { count: content.earlierTurns },
                    )
                  : gt("Latest", { $context: "the most recent exchange in a thread" })
              }
            >
              <p className="line-clamp-2 whitespace-pre-line wrap-break-word">
                {content.latestUser}
              </p>
            </SummaryPreviewSection>
          ) : null}
          {content.latestAssistant !== null ? (
            <SummaryPreviewSection label={gt("Agent replied")}>
              <p className="line-clamp-4 whitespace-pre-line wrap-break-word text-muted-foreground">
                {content.latestAssistant}
              </p>
            </SummaryPreviewSection>
          ) : null}
          {content.files.length > 0 ? (
            <SummaryPreviewSection label={gt("Files changed")}>
              <p className="line-clamp-2 wrap-break-word font-mono text-muted-foreground">
                {content.moreFiles > 0
                  ? gt("{files}, +{count} more", {
                      files: content.files.map((file) => file.split("/").at(-1)).join(", "),
                      count: content.moreFiles,
                    })
                  : content.files.map((file) => file.split("/").at(-1)).join(", ")}
              </p>
            </SummaryPreviewSection>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground">
          {preview && "error" in preview
            ? preview.error
            : loadSummary === null
              ? gt("Connect to preview this thread.")
              : gt("Summarizing…")}
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
