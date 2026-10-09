import type {
  DocumentToolPreview,
  PreviewRecord,
  PropertiesToolPreview,
  RecordsToolPreview,
  TableToolPreview,
  ThreadActionToolPreview,
} from "./toolPreview.ts";

export type Record_ = Record<string, unknown>;

// Cards are a glance; the raw call keeps the rest.
const MAX_RECORDS = 50;
const MAX_TABLE_ROWS = 50;
const MAX_TABLE_COLUMNS = 8;
const MAX_PROPERTY_ROWS = 24;

export function isRecord(value: unknown): value is Record_ {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function str(value: unknown): string | null {
  return isText(value) ? value.trim() : null;
}

export function firstLine(value: string): string {
  return (
    value
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? value.trim()
  );
}

export function link(label: string, url: string | null): DocumentToolPreview["link"] {
  return url ? { label, url } : null;
}

export function header(fields: {
  readonly summary?: string | null;
  readonly link?: DocumentToolPreview["link"];
  readonly notes?: ReadonlyArray<string | null | undefined>;
}) {
  return {
    summary: fields.summary ?? null,
    link: fields.link ?? null,
    notes: (fields.notes ?? []).filter((note): note is string => isText(note)),
  };
}

export function records(
  items: ReadonlyArray<PreviewRecord>,
  fields: Parameters<typeof header>[0] = {},
): RecordsToolPreview {
  return {
    kind: "records",
    ...header(fields),
    items: items.slice(0, MAX_RECORDS),
    more: Math.max(0, items.length - MAX_RECORDS),
  };
}

export function documentPreview(
  markdown: string,
  fields: Parameters<typeof header>[0] & {
    readonly title?: string | null;
    readonly url?: string | null;
    readonly preformatted?: boolean;
  } = {},
): DocumentToolPreview {
  return {
    kind: "document",
    ...header(fields),
    title: fields.title ?? null,
    url: fields.url ?? null,
    markdown: markdown.trim(),
    preformatted: fields.preformatted ?? false,
  };
}

export function properties(
  rows: ReadonlyArray<readonly [string, string]>,
  fields: Parameters<typeof header>[0] & {
    readonly title?: string | null;
    readonly url?: string | null;
  } = {},
): PropertiesToolPreview {
  return {
    kind: "properties",
    ...header(fields),
    title: fields.title ?? null,
    url: fields.url ?? null,
    rows: rows.slice(0, MAX_PROPERTY_ROWS),
  };
}

export function table(
  columns: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
  fields: Parameters<typeof header>[0] = {},
): TableToolPreview {
  return {
    kind: "table",
    ...header(fields),
    columns: columns.slice(0, MAX_TABLE_COLUMNS),
    rows: rows.slice(0, MAX_TABLE_ROWS).map((row) => row.slice(0, MAX_TABLE_COLUMNS)),
    more: Math.max(0, rows.length - MAX_TABLE_ROWS),
  };
}

export function action(
  headline: string,
  details: ReadonlyArray<string | null>,
): ThreadActionToolPreview {
  return {
    kind: "thread-action",
    headline,
    status: null,
    details: details.filter((detail): detail is string => isText(detail)),
    threadId: null,
  };
}

// --- Inference for JSON results no tool-specific card describes ---

const TITLE_KEYS = [
  "title",
  "name",
  "summary",
  "subject",
  "label",
  "displayName",
  "threadTitle",
  "prompt",
  "message",
  "text",
  "key",
  "filename",
] as const;
const SUBTITLE_KEYS = [
  "status",
  "state",
  "sessionStatus",
  "check_result",
  "role",
  "type",
  "kind",
] as const;
const BODY_KEYS = [
  "snippet",
  "highlight",
  "description",
  "detail",
  "response",
  "text",
  "message",
  "contentSnippet",
  "content",
] as const;
const URL_KEYS = ["url", "htmlLink", "permalink", "link", "href", "webViewLink"] as const;
const TIME_KEYS = [
  "createdAt",
  "created_at",
  "created_date",
  "created",
  "timestamp",
  "time",
  "updatedAt",
  "lastActivityAt",
  "modifiedTime",
  "start_time",
  "requestedAt",
] as const;
const META_KEYS = [
  "projectTitle",
  "model",
  "email",
  "service",
  "team",
  "priority",
  "assignee",
  "identifier",
] as const;

/** A scalar shown as text, a markdown link as its label; null for nested values and blanks. */
export function scalarText(value: unknown): string | null {
  if (typeof value === "string")
    return str(value.replace(/\[([^\]]+)\]\((?:https?:[^)]+)\)/g, "$1"));
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export function pick(record: Record_, keys: ReadonlyArray<string>, skip?: string): string | null {
  for (const key of keys) {
    if (key === skip) continue;
    const value = scalarText(record[key]);
    if (value) return value;
  }
  return null;
}

/** Turns a JSON object into a record row by its usual title, status, link and time fields. */
export function recordOf(value: unknown, index: number): PreviewRecord | null {
  const scalar = scalarText(value);
  if (scalar) {
    return {
      key: String(index),
      title: scalar,
      subtitle: null,
      meta: [],
      url: null,
      body: null,
      threadId: null,
    };
  }
  if (!isRecord(value)) return null;
  const titleKey =
    TITLE_KEYS.find((key) => scalarText(value[key])) ??
    Object.keys(value).find(
      (key) => /(title|name|text|description|label)$/i.test(key) && scalarText(value[key]),
    ) ??
    Object.keys(value).find((key) => /(_id|Id)$/.test(key) && scalarText(value[key]));
  const nestedStatus = isRecord(value.status)
    ? value.status
    : isRecord(value.state)
      ? value.state
      : null;
  const nestedName = nestedStatus ? pick(nestedStatus, ["name"]) : null;
  const titleValue = titleKey ? scalarText(value[titleKey]) : null;
  const title = titleValue
    ? firstLine(titleValue)
    : (pick(value, ["id", "uuid", "event_id"]) ?? "Item");
  const body = pick(value, BODY_KEYS, titleKey);
  return {
    key: pick(value, ["id", "uuid", "messageId", "threadId", "event_id"]) ?? String(index),
    title,
    subtitle: pick(value, SUBTITLE_KEYS) ?? nestedName,
    meta: [pick(value, TIME_KEYS), ...META_KEYS.map((key) => scalarText(value[key]))].filter(
      (meta): meta is string => meta !== null,
    ),
    url: pick(value, URL_KEYS),
    body: body && body !== titleValue ? body : null,
    threadId: str(value.threadId),
  };
}

export function recordsOf(values: ReadonlyArray<unknown>): ReadonlyArray<PreviewRecord> {
  const items = values.flatMap((value, index) => {
    const record = recordOf(value, index);
    return record ? [record] : [];
  });
  if (items.length < 2 || items.some((item) => item.title !== items[0]!.title)) return items;
  // Every row shares a title (a parent id): name rows by an id field that tells them apart.
  const objects = values.filter(isRecord);
  const distinctKey = Object.keys(objects[0] ?? {}).find(
    (key) =>
      /(_id|Id)$/.test(key) &&
      new Set(objects.map((object) => scalarText(object[key]))).size === objects.length,
  );
  return distinctKey
    ? items.map((item, index) => ({
        ...item,
        title: scalarText(objects[index]?.[distinctKey]) ?? item.title,
      }))
    : items;
}

export function humanKey(key: string): string {
  const spaced = key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A nested value summarised in a property cell. */
export function cellText(value: unknown): string | null {
  const scalar = scalarText(value);
  if (scalar !== null) return scalar;
  if (Array.isArray(value)) {
    const scalars = value.map(scalarText);
    if (value.length > 0 && scalars.every((item) => item !== null)) return scalars.join(", ");
    return value.length > 0 ? `${value.length} item${value.length === 1 ? "" : "s"}` : null;
  }
  if (isRecord(value)) {
    const name = pick(value, ["name", "title", "label", "value"]);
    return name ?? null;
  }
  return null;
}

const HIDDEN_PROPERTY_KEYS = new Set(["_meta", "toolIcon", "error", "upload_headers"]);

export function propertyRows(record: Record_, prefix = ""): Array<readonly [string, string]> {
  return Object.entries(record).flatMap(([key, value]): Array<readonly [string, string]> => {
    if (HIDDEN_PROPERTY_KEYS.has(key)) return [];
    const label = prefix ? `${prefix} ${humanKey(key).toLowerCase()}` : humanKey(key);
    const text = cellText(value);
    if (text) return [[label, text]];
    // A nested object without a name, such as `{ project: {...} }`, shows its own fields.
    return isRecord(value) && !prefix ? propertyRows(value, label) : [];
  });
}

/**
 * A card for any JSON result: its main list as records, a flat object as properties,
 * a lone message as text. Null when the result has nothing to show.
 */
export function inferredPreview(
  value: unknown,
  summary: string | null = null,
): RecordsToolPreview | PropertiesToolPreview | DocumentToolPreview | null {
  if (Array.isArray(value)) {
    const items = recordsOf(value);
    return items.length > 0 || value.length === 0 ? records(items, { summary }) : null;
  }
  if (!isRecord(value)) {
    const text = scalarText(value);
    return text ? documentPreview(text, { summary }) : null;
  }
  // A `{ result }` wrapper, as Forge returns, is the result.
  const keys = Object.keys(value).filter((key) => !HIDDEN_PROPERTY_KEYS.has(key));
  if (keys.length === 1 && keys[0] === "result") return inferredPreview(value.result, summary);
  const error = str(value.error);
  const lists = keys.flatMap((key) => {
    const list = value[key];
    return Array.isArray(list) && list.some(isRecord) ? [{ key, list }] : [];
  });
  if (lists.length === 1) {
    const { key: listKey, list } = lists[0]!;
    const rest = keys.filter((key) => key !== listKey);
    return records(recordsOf(list), {
      summary,
      notes: [
        error,
        ...rest.flatMap((key) => {
          const text = scalarText(value[key]);
          return text && text.length < 120 ? [`${humanKey(key)}: ${text}`] : [];
        }),
      ],
    });
  }
  // One nested object, such as `{ thread: {...} }` or `{ project: {...} }`, is the subject.
  if (keys.length === 1 && isRecord(value[keys[0]!])) {
    return inferredPreview(value[keys[0]!], summary);
  }
  const rows = propertyRows(value);
  if (rows.length === 0) return error ? documentPreview(error, { summary }) : null;
  const titleKey = TITLE_KEYS.find((key) => scalarText(value[key]));
  return properties(rows, {
    summary,
    title: titleKey ? firstLine(scalarText(value[titleKey])!) : null,
    url: pick(value, URL_KEYS),
    notes: [error],
  });
}
