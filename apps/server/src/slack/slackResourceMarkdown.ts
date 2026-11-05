import { truncate } from "../issueMarkdown.ts";

export interface SlackListColumn {
  readonly id: string;
  readonly name: string;
  readonly isPrimary: boolean;
  /** Select option value → label. */
  readonly choices: ReadonlyMap<string, string>;
}

/** One cell as Slack sends it: typed arrays sit beside `text` and the raw `value`. */
export interface SlackListCell {
  readonly column_id?: string | undefined;
  readonly key?: string | undefined;
  readonly text?: string | undefined;
  readonly value?: unknown;
  readonly select?: ReadonlyArray<string> | undefined;
  readonly user?: ReadonlyArray<string> | undefined;
  readonly date?: ReadonlyArray<string> | undefined;
  readonly number?: ReadonlyArray<number> | undefined;
  readonly rating?: ReadonlyArray<number> | undefined;
  readonly checkbox?: boolean | undefined;
  readonly link?: ReadonlyArray<{ readonly original_url?: string | undefined }> | undefined;
}

export interface SlackListRow {
  readonly fields: ReadonlyArray<SlackListCell>;
}

const tableCell = (text: string) =>
  text
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
    .trim();

function cellText(
  cell: SlackListCell,
  column: SlackListColumn | undefined,
  names: ReadonlyMap<string, string>,
): string {
  if (cell.text !== undefined && cell.text.trim() !== "") return cell.text;
  if (cell.select !== undefined) {
    return cell.select.map((value) => column?.choices.get(value) ?? value).join(", ");
  }
  if (cell.user !== undefined) return cell.user.map((id) => `@${names.get(id) ?? id}`).join(", ");
  if (cell.date !== undefined) return cell.date.join(", ");
  if (cell.number !== undefined) return cell.number.join(", ");
  if (cell.rating !== undefined) return cell.rating.join(", ");
  if (cell.checkbox !== undefined) return cell.checkbox ? "✓" : "";
  if (cell.link !== undefined) {
    return cell.link.flatMap((link) => (link.original_url ? [link.original_url] : [])).join(", ");
  }
  if (typeof cell.value === "string" || typeof cell.value === "number") return String(cell.value);
  if (typeof cell.value === "boolean") return cell.value ? "✓" : "";
  return "";
}

/**
 * A Slack list as a markdown table, primary column first. Without a column schema (an empty
 * list), the columns are the cells' own keys.
 */
export function renderSlackList(
  input: {
    readonly title: string;
    readonly url: string;
    readonly columns: ReadonlyArray<SlackListColumn>;
    readonly rows: ReadonlyArray<SlackListRow>;
    readonly names: ReadonlyMap<string, string>;
  },
  maxChars: number,
): string {
  const header = [`# Slack list: ${input.title}`, `url: ${input.url}`].join("\n");
  if (input.rows.length === 0) return truncate(`${header}\n\n_The list has no items._`, maxChars);
  const keyOf = (cell: SlackListCell) => cell.column_id ?? cell.key ?? "";
  const columns =
    input.columns.length > 0
      ? input.columns.toSorted((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      : [...new Set(input.rows.flatMap((row) => row.fields.map(keyOf)))].map(
          (id): SlackListColumn => ({ id, name: id, isPrimary: false, choices: new Map() }),
        );
  const byId = new Map(columns.map((column) => [column.id, column]));
  const lines = [
    `| ${columns.map((column) => tableCell(column.name)).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
  ];
  let kept = 0;
  const parts = [header, `${input.rows.length} items`];
  for (const row of input.rows) {
    const cells = new Map(row.fields.map((cell) => [keyOf(cell), cell]));
    const line = `| ${columns
      .map((column) => {
        const cell = cells.get(column.id);
        return cell === undefined
          ? ""
          : tableCell(cellText(cell, byId.get(column.id), input.names));
      })
      .join(" | ")} |`;
    if ([...parts, ...lines, line].join("\n\n").length > maxChars - 40) break;
    lines.push(line);
    kept++;
  }
  const omitted = input.rows.length - kept;
  return truncate(
    [...parts, lines.join("\n"), ...(omitted > 0 ? [`_${omitted} more items omitted._`] : [])].join(
      "\n\n",
    ),
    maxChars,
  );
}

export interface SlackFileSummary {
  readonly title: string;
  readonly url: string;
  readonly typeLabel: string;
  readonly sizeBytes: number | null;
  readonly uploaderName: string | null;
  readonly createdAt: string | null;
  /** The file's text, for text files; null when it was not read. */
  readonly text: string | null;
}

/** A Slack file: what it is, and its text when it has some. */
export function renderSlackFile(file: SlackFileSummary, maxChars: number): string {
  const facts = [
    `type: ${file.typeLabel}`,
    ...(file.sizeBytes === null ? [] : [`size: ${file.sizeBytes} bytes`]),
    ...(file.uploaderName === null ? [] : [`uploaded by: ${file.uploaderName}`]),
    ...(file.createdAt === null ? [] : [`uploaded: ${file.createdAt}`]),
  ];
  const header = [`# Slack file: ${file.title}`, `url: ${file.url}`, ...facts].join("\n");
  if (file.text === null) return truncate(`${header}\n\n_Contents not downloaded._`, maxChars);
  const fence = file.text.includes("```") ? "~~~~" : "```";
  return truncate(`${header}\n\n${fence}\n${file.text}\n${fence}`, maxChars);
}

export interface SlackProfileSummary {
  readonly name: string;
  readonly realName: string | null;
  readonly title: string | null;
  readonly status: string | null;
  readonly timeZone: string | null;
  readonly isBot: boolean;
  readonly deactivated: boolean;
  readonly url: string;
}

export function renderSlackProfile(profile: SlackProfileSummary): string {
  return [
    `# Slack profile: ${profile.name}`,
    `url: ${profile.url}`,
    ...(profile.realName && profile.realName !== profile.name
      ? [`full name: ${profile.realName}`]
      : []),
    ...(profile.title ? [`title: ${profile.title}`] : []),
    ...(profile.status ? [`status: ${profile.status}`] : []),
    ...(profile.timeZone ? [`time zone: ${profile.timeZone}`] : []),
    ...(profile.isBot ? ["bot account"] : []),
    ...(profile.deactivated ? ["deactivated"] : []),
  ].join("\n");
}
