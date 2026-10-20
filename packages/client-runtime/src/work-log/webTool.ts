import type { OrchestrationV2TurnItem, OrchestrationV2WebSearchResult } from "@t3tools/contracts";

type WebSearchItem = Extract<OrchestrationV2TurnItem, { type: "web_search" }>;

export interface WebToolView {
  readonly action: "search" | "fetch";
  readonly query: string | undefined;
  readonly url: string | undefined;
  readonly prompt: string | undefined;
  readonly answer: string | undefined;
  readonly statusCode: number | undefined;
  readonly results: ReadonlyArray<OrchestrationV2WebSearchResult>;
}

const HTTP_URL = /^https?:\/\/\S+$/i;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Items stored before fetches had their own fields put Claude's whole WebFetch
 * output, `{bytes, code, result, url, …}`, in a result snippet.
 */
function legacyFetchOutput(
  snippet: string | undefined,
): { answer: string; statusCode?: number; url?: string } | undefined {
  if (!snippet?.trimStart().startsWith("{")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(snippet);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  if (typeof record.result !== "string") return undefined;
  return {
    answer: record.result,
    ...(typeof record.code === "number" ? { statusCode: record.code } : {}),
    ...(typeof record.url === "string" ? { url: record.url } : {}),
  };
}

/** One reading of a web tool call for every client, whichever provider made it. */
export function webToolView(item: WebSearchItem): WebToolView {
  // Codex reports a search's query in both `query` and `queries`.
  const patterns = [
    ...new Set((item.patterns ?? []).flatMap((pattern) => nonEmpty(pattern) ?? [])),
  ];
  const results = item.results ?? [];
  const onlyResult = results.length === 1 ? results[0] : undefined;
  const legacy = item.answer === undefined ? legacyFetchOutput(onlyResult?.snippet) : undefined;
  const url =
    nonEmpty(item.url) ??
    legacy?.url ??
    (item.action !== "search" ? patterns.find((pattern) => HTTP_URL.test(pattern)) : undefined);
  const action = item.action ?? (url !== undefined ? "fetch" : "search");
  // A fetch's single result is the page itself, so its snippet is the answer.
  const pageResult =
    action === "fetch" && onlyResult !== undefined && (!onlyResult.url || onlyResult.url === url)
      ? onlyResult
      : undefined;
  return {
    action,
    query:
      action === "search"
        ? patterns.join(", ") || undefined
        : patterns.find((pattern) => pattern !== url && !HTTP_URL.test(pattern)),
    url: action === "fetch" ? url : undefined,
    prompt: nonEmpty(item.prompt),
    answer: nonEmpty(item.answer) ?? nonEmpty(legacy?.answer ?? pageResult?.snippet),
    statusCode: item.statusCode ?? legacy?.statusCode,
    results: pageResult !== undefined ? [] : results,
  };
}

export interface WebUrlParts {
  readonly host: string;
  /** Readable path segments, without the query string. */
  readonly segments: ReadonlyArray<string>;
}

export function webUrlParts(url: string): WebUrlParts | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const segments = parsed.pathname.split("/").flatMap((segment) => {
    if (!segment) return [];
    try {
      return [decodeURIComponent(segment)];
    } catch {
      return [segment];
    }
  });
  return { host: parsed.hostname.replace(/^www\./, ""), segments };
}

/** `docs.github.com › … › private-registries`: the host plus the last path segment. */
export function webUrlBreadcrumb(url: string): string {
  const parts = webUrlParts(url);
  if (parts === undefined) return url;
  const last = parts.segments.at(-1);
  if (last === undefined) return parts.host;
  return parts.segments.length > 1 ? `${parts.host} › … › ${last}` : `${parts.host} › ${last}`;
}

/** The row label: what was read, or what was searched for. */
export function webToolLabel(view: WebToolView): string | undefined {
  if (view.action === "fetch") {
    return view.url === undefined ? undefined : `Fetched ${webUrlBreadcrumb(view.url)}`;
  }
  return view.query === undefined ? undefined : `Searched “${view.query}”`;
}
