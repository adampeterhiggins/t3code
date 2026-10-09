import type { PreviewRecord, PullRequestToolPreview, ToolPreview } from "./toolPreview.ts";
import {
  documentPreview,
  inferredPreview,
  isRecord,
  properties,
  records,
  scalarText,
  str,
  table,
  type Record_,
} from "./previewBuilders.ts";

// --- PostHog ---

/** PostHog's single `exec` tool takes a CLI-style command: `call [--json] <tool> {args}`, `info <tool>`, `learn …`. */
function parsePostHogCommand(command: string) {
  const match = /^(\w+)\s+(?:--json\s+)?(\S+)?\s*([\s\S]*)$/.exec(command.trim());
  if (!match) return null;
  let args: Record_ | null = null;
  try {
    const parsed: unknown = JSON.parse(match[3] ?? "");
    args = isRecord(parsed) ? parsed : null;
  } catch {
    args = null;
  }
  return { verb: match[1]!, tool: match[2] ?? null, args };
}

/** `a|b\n1|2` rows, as PostHog prints SQL results. */
function pipeTable(text: string) {
  const lines = text.split("\n").filter((line) => line.length > 0);
  const columns = lines[0]?.split("|") ?? [];
  return { columns, rows: lines.slice(1).map((line) => line.split("|")) };
}

function flagRollout(flag: Record_): string | null {
  const filters = isRecord(flag.filters) ? flag.filters : null;
  const groups = Array.isArray(filters?.groups) ? filters.groups.filter(isRecord) : [];
  const rollout = groups[0]?.rollout_percentage;
  return typeof rollout === "number" ? `${rollout}% rollout` : null;
}

function postHogPreview(input: Record_, result: unknown, text: string | null): ToolPreview | null {
  const command = str(input.command);
  const parsed = command ? parsePostHogCommand(command) : null;
  if (!parsed) return null;
  if (parsed.verb === "info" || parsed.verb === "learn") {
    return text ? documentPreview(text, { title: parsed.tool, summary: command }) : null;
  }
  if (parsed.verb !== "call" || !parsed.tool) return null;
  const tool = parsed.tool;
  if (tool === "execute-sql") {
    const sql = str(parsed.args?.query);
    const data = isRecord(result) ? result : null;
    const pipeText =
      str(data?.results) ?? (text && text.includes("|") ? text.split("\n{")[0]! : null);
    if (!pipeText) return null;
    const { columns, rows } = pipeTable(pipeText);
    return table(columns, rows, {
      summary: sql,
      notes: [`${rows.length} row${rows.length === 1 ? "" : "s"}`],
    });
  }
  if (tool.startsWith("feature-flag-get-definition") && isRecord(result)) {
    const flag = result;
    const createdBy = isRecord(flag.created_by)
      ? [str(flag.created_by.first_name), str(flag.created_by.last_name)].filter(Boolean).join(" ")
      : null;
    return properties(
      [
        ["Key", scalarText(flag.key)],
        ["Active", flag.active === true ? "yes" : flag.active === false ? "no" : null],
        ["Rollout", flagRollout(flag)],
        ["Created by", createdBy || null],
        ["Updated", str(flag.updated_at)],
        ["Version", scalarText(flag.version)],
      ].flatMap(([key, value]) => (value ? [[key!, value] as const] : [])),
      { title: str(flag.name) ?? str(flag.key) ?? "Feature flag", summary: "Feature flag" },
    );
  }
  if (tool === "feature-flag-get-all") {
    const list = Array.isArray(result)
      ? result
      : isRecord(result) && Array.isArray(result.results)
        ? result.results
        : null;
    if (list) {
      return records(
        list.filter(isRecord).map((flag, index) => ({
          key: String(flag.id ?? index),
          title: str(flag.name) ?? str(flag.key) ?? "Flag",
          subtitle: flag.active === false ? "inactive" : "active",
          meta: [str(flag.key), flagRollout(flag)].filter((meta): meta is string => meta !== null),
          url: null,
          body: null,
          threadId: null,
        })),
        { summary: "Feature flags" },
      );
    }
  }
  return inferredPreview(result, tool) ?? (text ? documentPreview(text, { summary: tool }) : null);
}

// --- LangSmith ---

function runRecord(run: Record_, index: number): PreviewRecord {
  const extra = isRecord(run.extra) ? run.extra : null;
  const params = isRecord(extra?.invocation_params) ? extra.invocation_params : null;
  const start = str(run.start_time);
  const end = str(run.end_time);
  const seconds = start && end ? (Date.parse(end) - Date.parse(start)) / 1000 : null;
  return {
    key: str(run.id) ?? String(index),
    title: str(run.name) ?? "Run",
    subtitle: str(run.status) ?? (str(run.error) ? "error" : null),
    meta: [
      str(run.run_type),
      str(params?.model) ?? str(params?.model_name),
      seconds !== null && Number.isFinite(seconds) ? `${seconds.toFixed(1)}s` : null,
      typeof run.total_tokens === "number" ? `${run.total_tokens} tokens` : null,
      start?.slice(0, 19).replace("T", " ") ?? null,
    ].filter((meta): meta is string => meta !== null),
    url: null,
    body: str(run.error),
    threadId: null,
  };
}

function langSmithPreview(input: Record_, result: unknown): ToolPreview | null {
  const data = isRecord(result) ? result : null;
  if (!data) return null;
  const runs = Array.isArray(data.runs) ? data.runs.filter(isRecord) : [];
  let items = runs.map(runRecord);
  // A page over LangSmith's budget arrives as a truncated JSON preview; name its runs anyway.
  const preview = str(data._truncated_preview);
  if (items.length === 0 && preview) {
    items = [
      ...preview.matchAll(
        /"id": "([^"]+)", "name": "([^"]+)", "start_time": "([^"]+)", "run_type": "([^"]+)"/g,
      ),
    ].map((match) => ({
      key: match[1]!,
      title: match[2]!,
      subtitle: null,
      meta: [match[4]!, match[3]!.slice(0, 19).replace("T", " ")],
      url: null,
      body: null,
      threadId: null,
    }));
  }
  const page =
    typeof data.page_number === "number" && typeof data.total_pages === "number"
      ? `Page ${data.page_number} of ${data.total_pages}`
      : null;
  return records(items, {
    summary:
      [str(input.project_name), str(input.trace_id) ? `trace ${str(input.trace_id)}` : null]
        .filter(Boolean)
        .join(" · ") || null,
    notes: [page, data._truncated === true ? "Some runs were cut to fit the page budget" : null],
  });
}

// --- Gmail ---

function header(message: Record_, name: string): string | null {
  const direct = str(message[name.toLowerCase()]);
  if (direct) return direct;
  const payload = isRecord(message.payload) ? message.payload : null;
  const headers = Array.isArray(payload?.headers) ? payload.headers.filter(isRecord) : [];
  return str(headers.find((entry) => str(entry.name)?.toLowerCase() === name.toLowerCase())?.value);
}

function gmailPreview(input: Record_, result: unknown): ToolPreview | null {
  const data = isRecord(result) ? result : null;
  const threads = Array.isArray(data?.threads) ? data.threads.filter(isRecord) : null;
  if (!threads) return null;
  return records(
    threads.map((thread, index) => {
      const messages = Array.isArray(thread.messages) ? thread.messages.filter(isRecord) : [];
      const first = messages[0] ?? thread;
      return {
        key: str(thread.id) ?? String(index),
        title: header(first, "Subject") ?? str(thread.snippet) ?? "(No subject)",
        subtitle: messages.length > 1 ? `${messages.length} messages` : null,
        meta: [header(first, "From"), header(first, "Date")].filter(
          (meta): meta is string => meta !== null,
        ),
        url: null,
        body: str(thread.snippet) ?? str(first.snippet),
        threadId: null,
      };
    }),
    { summary: str(input.query) },
  );
}

// --- Codex apps ---

function codexAppPreview(tool: string, result: unknown): ToolPreview | null {
  const data = isRecord(result) ? result : null;
  const url = str(data?.html_url) ?? str(data?.url);
  if (data && url && /\/pull\/\d+/.test(url)) {
    const repository = /github\.com\/([^/]+\/[^/]+)\/pull/.exec(url)?.[1] ?? null;
    const head = isRecord(data.head)
      ? str(data.head.ref)
      : (str(data.head_branch) ?? str(data.headBranch));
    const merged = data.merged === true || str(data.merged_at) !== null;
    const state = merged ? "merged" : str(data.state) === "closed" ? "closed" : "open";
    const preview: PullRequestToolPreview = {
      kind: "pull-requests",
      pullRequests: [
        {
          url,
          repository,
          number: typeof data.number === "number" ? data.number : null,
          title: str(data.title),
          state,
          isDraft: data.draft === true,
          headBranch: head,
          note: tool.startsWith("github.create") ? "Created" : null,
        },
      ],
    };
    return preview;
  }
  return null;
}

/** Cards for PostHog, LangSmith, Gmail and Codex's app connectors. */
export function serviceToolPreview(
  server: string,
  tool: string,
  input: Record_,
  result: unknown,
  text: string | null,
): ToolPreview | null {
  if (server.startsWith("posthog") && tool === "exec") return postHogPreview(input, result, text);
  if (server === "langsmith" && tool === "fetch_runs") return langSmithPreview(input, result);
  if (server === "gmail") return gmailPreview(input, result);
  if (server === "codex_apps") return codexAppPreview(tool, result);
  return null;
}
