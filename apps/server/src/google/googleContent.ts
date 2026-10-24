import type { GoogleFileLocation } from "@t3tools/contracts";

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

interface Paragraph {
  text: string;
  heading?: string;
  level: number;
  tab?: string;
}

/** Docs nests table cells and tabs; walking only body.content silently drops those sources. */
export function googleDocumentMarkdown(
  document: unknown,
  location: GoogleFileLocation,
  url: string,
) {
  const paragraphs: Paragraph[] = [];
  const walkContent = (content: unknown, depth = 0, tab?: string) => {
    if (depth > 20) return;
    for (const value of array(content)) {
      const item = object(value);
      const paragraph = object(item.paragraph);
      if (item.paragraph) {
        const style = object(paragraph.paragraphStyle);
        const text = array(paragraph.elements)
          .map((e) => object(object(e).textRun).content)
          .filter((v) => typeof v === "string")
          .join("")
          .trimEnd();
        const level = Number(String(style.namedStyleType ?? "").match(/^HEADING_(\d)$/)?.[1] ?? 0);
        paragraphs.push({
          text,
          level,
          ...(tab ? { tab } : {}),
          ...(typeof style.headingId === "string" ? { heading: style.headingId } : {}),
        });
      }
      for (const row of array(object(item.table).tableRows)) {
        for (const cell of array(object(row).tableCells))
          walkContent(object(cell).content, depth + 1, tab);
      }
      if (item.tableOfContents) walkContent(object(item.tableOfContents).content, depth + 1, tab);
    }
  };
  let foundTab = !location.tab;
  const walkTabs = (tabs: unknown, depth = 0) => {
    if (depth > 20) return;
    for (const value of array(tabs)) {
      const tab = object(value);
      const props = object(tab.tabProperties);
      if (!location.tab || props.tabId === location.tab) {
        foundTab = true;
        paragraphs.push({ text: typeof props.title === "string" ? props.title : "Tab", level: 1 });
        walkContent(
          object(object(tab.documentTab).body).content,
          0,
          typeof props.tabId === "string" ? props.tabId : undefined,
        );
      }
      walkTabs(tab.childTabs, depth + 1);
    }
  };
  const doc = object(document);
  if (array(doc.tabs).length) walkTabs(doc.tabs);
  else walkContent(object(doc.body).content);
  if (!foundTab) return null;
  let selected = paragraphs;
  if (location.heading) {
    const start = paragraphs.findIndex((p) => p.heading === location.heading);
    if (start < 0) return null;
    const level = paragraphs[start]!.level;
    const end = paragraphs.findIndex((p, i) => i > start && p.level > 0 && p.level <= level);
    selected = paragraphs.slice(start, end < 0 ? undefined : end);
  }
  return selected
    .map((p) =>
      p.heading
        ? `${"#".repeat(p.level || 2)} [${p.text.replaceAll("[", "\\[").replaceAll("]", "\\]")}](${url.split("#")[0]}${p.tab ? `?tab=${encodeURIComponent(p.tab)}` : ""}#heading=${encodeURIComponent(p.heading)})`
        : p.level
          ? `# ${p.text}`
          : p.text,
    )
    .join("\n\n");
}

export function googleGridMarkdown(rows: ReadonlyArray<ReadonlyArray<string>>) {
  const escape = (value: string) => value.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (!width) return "(Empty range)";
  const row = (cells: ReadonlyArray<string>) =>
    `| ${Array.from({ length: width }, (_, i) => escape(cells[i] ?? "")).join(" | ")} |`;
  return [
    row(rows[0]!),
    row(Array.from({ length: width }, () => "---")),
    ...rows.slice(1).map(row),
  ].join("\n");
}

/** Bound the remote read itself, before Google returns a potentially enormous grid. */
export function boundedGoogleRange(range: string) {
  const match = /^([A-Z]+)([1-9]\d*)(?::([A-Z]+)([1-9]\d*))?$/i.exec(range);
  if (!match) return null;
  const columnNumber = (value: string) =>
    Array.from(value.toUpperCase()).reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const columnName = (value: number): string =>
    value > 26
      ? columnName(Math.floor((value - 1) / 26)) + String.fromCharCode(65 + ((value - 1) % 26))
      : String.fromCharCode(64 + value);
  const firstColumn = columnNumber(match[1]!);
  const lastColumn = columnNumber(match[3] ?? match[1]!);
  const firstRow = Number(match[2]);
  const lastRow = Number(match[4] ?? match[2]);
  if (lastColumn < firstColumn || lastRow < firstRow || lastColumn > 18278 || lastRow > 10_000_000)
    return null;
  return `${match[1]!.toUpperCase()}${firstRow}:${columnName(Math.min(lastColumn, firstColumn + 25))}${Math.min(lastRow, firstRow + 99)}`;
}
