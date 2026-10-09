import type {
  PreviewRecord,
  PullRequestToolPreview,
  ThreadToolPreview,
  ToolPreview,
} from "./toolPreview.ts";
import {
  documentPreview,
  firstLine,
  inferredPreview,
  isRecord,
  properties,
  records,
  scalarText,
  str,
  table,
  type Record_,
} from "./previewBuilders.ts";

function count(value: unknown, noun: string): string | null {
  return typeof value === "number" ? `${value} ${noun}${value === 1 ? "" : "s"}` : null;
}

function diffStat(item: Record_): string | null {
  const add = typeof item.additions === "number" ? item.additions : null;
  const del = typeof item.deletions === "number" ? item.deletions : null;
  return add === null && del === null ? null : `+${add ?? 0} −${del ?? 0}`;
}

function time(value: unknown): string | null {
  return str(value)?.slice(0, 16).replace("T", " ") ?? null;
}

function present(values: ReadonlyArray<string | null>): string[] {
  return values.filter((value): value is string => value !== null);
}

function line(value: unknown): string | null {
  const text = str(value);
  return text ? firstLine(text) : null;
}

function rows(
  pairs: ReadonlyArray<readonly [string, string | null]>,
): Array<readonly [string, string]> {
  return pairs.flatMap(([key, value]) => (value ? [[key, value] as const] : []));
}

function record(
  fields: Partial<PreviewRecord> & { readonly key: string; readonly title: string },
): PreviewRecord {
  return {
    subtitle: null,
    meta: [],
    url: null,
    body: null,
    threadId: null,
    ...fields,
  };
}

function threadRecord(thread: Record_, index: number): PreviewRecord {
  return record({
    key: str(thread.threadId) ?? String(index),
    title: str(thread.title) ?? "Untitled thread",
    subtitle: str(thread.sessionStatus),
    meta: present([
      str(thread.projectTitle),
      str(thread.model),
      time(thread.lastActivityAt),
      thread.pullRequestCount ? count(thread.pullRequestCount, "PR") : null,
    ]),
    threadId: str(thread.threadId),
  });
}

function messageRecord(message: Record_, index: number): PreviewRecord {
  return record({
    key: str(message.messageId) ?? String(index),
    title: str(message.threadTitle) ?? "Message",
    subtitle: str(message.role),
    meta: present([time(message.createdAt)]),
    body: str(message.text) ?? str(message.snippet),
    threadId: str(message.threadId),
  });
}

function pullRequestEntries(entries: ReadonlyArray<unknown>): PullRequestToolPreview {
  return {
    kind: "pull-requests",
    pullRequests: entries.filter(isRecord).flatMap((pr) => {
      const url = str(pr.url);
      if (!url) return [];
      const state = pr.state;
      return [
        {
          url,
          repository: str(pr.repository),
          number: typeof pr.number === "number" ? pr.number : null,
          title: str(pr.title),
          state: state === "open" || state === "closed" || state === "merged" ? state : null,
          isDraft: pr.isDraft === true,
          headBranch: str(pr.headBranch),
          note: str(pr.threadTitle),
        },
      ];
    }),
  };
}

const TIMELINE_KINDS: Readonly<Record<string, string>> = {
  "thread.created": "created",
  prompt: "prompt",
  "turn.completed": "turn done",
  "plan.proposed": "plan",
  "plan.implemented": "plan done",
  "pull_request.linked": "PR linked",
  "approval.requested": "approval",
  error: "error",
  "thread.archived": "archived",
  "thread.settled": "settled",
};

function usageTable(data: Record_): ToolPreview | null {
  const buckets = Array.isArray(data.buckets) ? data.buckets.filter(isRecord) : [];
  const byModel = new Map<string, { input: number; output: number; cost: number }>();
  for (const bucket of buckets) {
    const key = `${str(bucket.provider) ?? "?"} · ${str(bucket.model) ?? "?"}`;
    const totals = isRecord(bucket.totals) ? bucket.totals : {};
    const sum = byModel.get(key) ?? { input: 0, output: 0, cost: 0 };
    const n = (value: unknown) => (typeof value === "number" ? value : 0);
    sum.input +=
      n(totals.uncachedInputTokens) + n(totals.cachedInputTokens) + n(totals.cacheCreationTokens);
    sum.output += n(totals.outputTokens) + n(totals.reasoningTokens);
    sum.cost += n(bucket.costUsd);
    byModel.set(key, sum);
  }
  const compact = (value: number) =>
    value >= 1e6
      ? `${(value / 1e6).toFixed(1)}M`
      : value >= 1e3
        ? `${(value / 1e3).toFixed(1)}k`
        : String(value);
  const rows = [...byModel.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([model, sum]) => [
      model,
      compact(sum.input),
      compact(sum.output),
      `$${sum.cost.toFixed(2)}`,
    ]);
  return table(["Model", "Input", "Output", "Cost"], rows, {
    summary: present([str(data.sinceDay), str(data.untilDay)]).join(" → ") || null,
  });
}

/** Cards for the read-only T3 Code history server (`t3-code-history`). */
export function historyToolPreview(
  tool: string,
  input: Record_,
  result: unknown,
): ToolPreview | null {
  const data = isRecord(result) ? result : null;
  if (!data) return null;
  switch (tool) {
    case "get_environment": {
      const counts = isRecord(data.counts) ? data.counts : {};
      return properties(
        rows([
          ["Server version", str(data.serverVersion)],
          ["Time zone", str(data.timeZone)],
          ["Projects", count(counts.projects, "project")],
          ["Threads", count(counts.threads, "thread")],
          ["Archived", count(counts.archivedThreads, "archived thread")],
        ]),
        { title: str(data.label) ?? "Environment" },
      );
    }
    case "get_activity_timeline": {
      const entries = Array.isArray(data.entries) ? data.entries.filter(isRecord) : [];
      return records(
        entries.map((entry, index) =>
          record({
            key: str(entry.id) ?? String(index),
            title: line(entry.summary) ?? str(entry.threadTitle) ?? "Event",
            subtitle: TIMELINE_KINDS[str(entry.kind) ?? ""] ?? str(entry.kind),
            meta: present([time(entry.at), str(entry.threadTitle), str(entry.projectTitle)]),
            threadId: str(entry.threadId),
          }),
        ),
      );
    }
    case "list_projects": {
      const projects = Array.isArray(data.projects) ? data.projects.filter(isRecord) : [];
      return records(
        projects.map((project, index) =>
          record({
            key: str(project.projectId) ?? String(index),
            title: str(project.title) ?? "Project",
            meta: present([count(project.threadCount, "thread"), time(project.lastActivityAt)]),
            body: str(project.workspaceRoot),
          }),
        ),
      );
    }
    case "get_project": {
      const project = isRecord(data.project) ? data.project : {};
      const threads = Array.isArray(data.recentThreads) ? data.recentThreads.filter(isRecord) : [];
      const scripts = Array.isArray(data.scripts) ? data.scripts.filter(isRecord) : [];
      return records(threads.map(threadRecord), {
        summary: str(project.title),
        notes: [
          str(project.workspaceRoot),
          str(data.defaultModel) ? `Default model: ${str(data.defaultModel)}` : null,
          scripts.length > 0
            ? `Scripts: ${scripts
                .map((script) => str(script.name))
                .filter(Boolean)
                .join(", ")}`
            : null,
        ],
      });
    }
    case "list_threads": {
      const threads = Array.isArray(data.threads) ? data.threads.filter(isRecord) : [];
      return records(threads.map(threadRecord));
    }
    case "get_thread": {
      const thread = isRecord(data.thread) ? data.thread : null;
      const threadId = str(thread?.threadId);
      if (!thread || !threadId) return null;
      const session = isRecord(data.session) ? data.session : null;
      const firstPrompt = str(data.firstPrompt);
      const latestResponse = str(data.latestResponse);
      const preview: ThreadToolPreview = {
        kind: "thread",
        threadId,
        title: str(thread.title) ?? "Untitled thread",
        status: str(session?.status) ?? str(thread.sessionStatus),
        model: str(thread.model),
        branch: str(thread.branch),
        items: [
          ...(firstPrompt ? [{ key: "prompt", label: "First prompt", text: firstPrompt }] : []),
          ...(latestResponse
            ? [{ key: "response", label: "Latest reply", text: latestResponse }]
            : []),
        ],
        moreItems: 0,
      };
      return preview;
    }
    case "list_turns": {
      const turns = Array.isArray(data.turns) ? data.turns.filter(isRecord) : [];
      return records(
        turns.map((turn, index) =>
          record({
            key: str(turn.turnId) ?? String(index),
            title: line(turn.prompt) ?? `Turn ${scalarText(turn.turnCount) ?? index + 1}`,
            subtitle: str(turn.state),
            meta: present([
              typeof turn.turnCount === "number" ? `#${turn.turnCount}` : null,
              count(turn.fileCount, "file"),
              diffStat(turn),
              time(turn.completedAt ?? turn.requestedAt),
            ]),
            body: str(turn.response),
            threadId: str(turn.threadId),
          }),
        ),
      );
    }
    case "get_turn": {
      const turn = isRecord(data.turn) ? data.turn : null;
      if (!turn) return null;
      return documentPreview(str(turn.response) ?? "", {
        title: line(turn.prompt) ?? "Turn",
        notes: [str(turn.state), count(turn.fileCount, "file changed"), diffStat(turn)],
      });
    }
    case "get_turn_diff": {
      const files = Array.isArray(data.files) ? data.files.filter(isRecord) : [];
      return records(
        files.map((file, index) =>
          record({
            key: str(file.path) ?? String(index),
            title: str(file.path) ?? "File",
            subtitle: str(file.kind),
            meta: present([diffStat(file)]),
          }),
        ),
        {
          summary:
            typeof data.fromTurnCount === "number" && typeof data.toTurnCount === "number"
              ? `Turns ${data.fromTurnCount} → ${data.toTurnCount}`
              : null,
          notes: [data.truncated === true ? "Some files were left out" : null],
        },
      );
    }
    case "list_messages": {
      const messages = Array.isArray(data.messages) ? data.messages.filter(isRecord) : [];
      return records(messages.map(messageRecord));
    }
    case "get_message": {
      const message = isRecord(data.message) ? data.message : null;
      if (!message) return null;
      return documentPreview(str(message.text) ?? "", {
        title: str(message.threadTitle),
        summary: present([str(message.role), time(message.createdAt)]).join(" · ") || null,
      });
    }
    case "search": {
      const threads = Array.isArray(data.threads) ? data.threads.filter(isRecord) : [];
      const messages = Array.isArray(data.messages) ? data.messages.filter(isRecord) : [];
      return records([...threads.map(threadRecord), ...messages.map(messageRecord)], {
        summary: str(input.query),
      });
    }
    case "list_activities": {
      const activities = Array.isArray(data.activities) ? data.activities.filter(isRecord) : [];
      return records(
        activities.map((activity, index) =>
          record({
            key: str(activity.activityId) ?? String(index),
            title: str(activity.summary) ?? str(activity.kind) ?? "Activity",
            subtitle: str(activity.status),
            meta: present([
              str(activity.kind)?.replaceAll("_", " ") ?? null,
              time(activity.createdAt),
            ]),
            body: str(activity.detail),
            threadId: str(activity.threadId),
          }),
        ),
      );
    }
    case "get_activity": {
      const activity = isRecord(data.activity) ? data.activity : null;
      if (!activity) return null;
      return documentPreview(str(activity.detail) ?? "", {
        title: str(activity.summary),
        notes: [
          str(activity.kind)?.replaceAll("_", " ") ?? null,
          str(activity.status),
          time(activity.createdAt),
        ],
        preformatted: true,
      });
    }
    case "list_plans": {
      const plans = Array.isArray(data.plans) ? data.plans.filter(isRecord) : [];
      return records(
        plans.map((plan, index) =>
          record({
            key: str(plan.planId) ?? String(index),
            title: str(plan.title) ?? "Plan",
            subtitle: str(plan.status),
            meta: present([str(plan.threadTitle), time(plan.updatedAt)]),
            body: str(plan.preview),
            threadId: str(plan.threadId),
          }),
        ),
      );
    }
    case "get_plan": {
      const plan = isRecord(data.plan) ? data.plan : null;
      return documentPreview(str(data.markdown) ?? str(plan?.preview) ?? "", {
        title: str(plan?.title),
        notes: [str(plan?.status), str(plan?.threadTitle)],
      });
    }
    case "list_pull_requests":
      return Array.isArray(data.pullRequests) ? pullRequestEntries(data.pullRequests) : null;
    case "get_pull_request":
      return Array.isArray(data.links) ? pullRequestEntries(data.links) : null;
    case "get_usage_summary":
      return usageTable(data);
    case "get_subagent_transcript": {
      const entries = Array.isArray(data.entries) ? data.entries.filter(isRecord) : [];
      const shown = entries.slice(-4);
      const preview: ThreadToolPreview = {
        kind: "thread",
        threadId: str(data.childThreadId) ?? "",
        title: str(data.title) ?? "Subagent",
        status: str(data.status),
        model: null,
        branch: null,
        items: shown.flatMap((entry, index) => {
          const text = str(entry.text);
          if (!text) return [];
          const kind = str(entry.kind) ?? "entry";
          const label =
            kind === "tool"
              ? (str(entry.toolName) ?? "Tool")
              : kind === "assistant"
                ? "Agent"
                : kind.charAt(0).toUpperCase() + kind.slice(1);
          return [{ key: String(index), label, text }];
        }),
        moreItems: Math.max(0, entries.length - shown.length),
      };
      return preview.threadId
        ? preview
        : documentPreview(str(data.result) ?? str(data.prompt) ?? "", { title: str(data.title) });
    }
    default:
      return inferredPreview(result, str(input.query));
  }
}
