function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const MAX_PREVIEW = 2400;

/** Summarize provider inputs before wire slimming, without retaining full file bodies. */
export function summarizeToolActivityInput(data: unknown): string | undefined {
  const root = record(data);
  if (!root) return undefined;
  if (typeof root.preview === "string") return root.preview.slice(0, MAX_PREVIEW);
  const parts = new Set<string>();
  const excerpt = (text: string) => (text.length > 500 ? `${text.slice(0, 499)}…` : text);
  let visited = 0;
  const add = (text: string) => {
    parts.add(text.length > 600 ? `${text.slice(0, 599)}…` : text);
  };
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || visited++ >= 40) return;
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 12)) visit(entry, depth + 1);
      return;
    }
    const row = record(value);
    if (!row) return;
    const string = (...keys: string[]) => {
      for (const key of keys) if (typeof row[key] === "string") return row[key] as string;
      return undefined;
    };
    const path = string("file_path", "filePath", "path", "TargetFile");
    if (path) add(path);
    const diff = string("diff", "diffString", "unifiedDiff", "patch");
    const before = string("old_string", "oldText", "old_text", "oldString");
    const after = string("new_string", "newText", "new_text", "newString", "ReplacementContent");
    const added = row.linesAdded ?? row.lines_added;
    const removed = row.linesRemoved ?? row.lines_removed;
    if (typeof added === "number" && typeof removed === "number") {
      add(`+${added}, −${removed} lines`);
    } else if (diff) {
      let plus = 0;
      let minus = 0;
      for (let offset = 0; offset < diff.length;) {
        if (diff[offset] === "+" && !diff.startsWith("+++", offset)) plus++;
        if (diff[offset] === "-" && !diff.startsWith("---", offset)) minus++;
        const newline = diff.indexOf("\n", offset);
        if (newline === -1) break;
        offset = newline + 1;
      }
      add(`+${plus}, −${minus} lines`);
    }
    if (diff) add(`Diff\n${excerpt(diff)}`);
    else if (before !== undefined && after !== undefined) {
      add(`Before\n${excerpt(before) || "(empty)"}`);
      add(`After\n${excerpt(after) || "(empty)"}`);
    } else if (path && typeof row.content === "string") {
      add(`Content\n${excerpt(row.content)}`);
    }
    for (const [label, keys] of [
      ["Start line", ["start_line", "startLine", "line", "offset", "StartLine"]],
      ["End line", ["end_line", "endLine", "EndLine"]],
      ["Limit", ["limit", "max_results"]],
      ["Pattern", ["pattern", "query", "search_term", "regex"]],
      ["Glob", ["glob", "include"]],
      ["URL", ["url"]],
      ["Working directory", ["cwd", "workdir", "workingDirectory", "Cwd"]],
      ["Exit code", ["exitCode", "exit_code"]],
      ["Error", ["error", "errorMessage"]],
    ] as const) {
      const key = keys.find((key) => typeof row[key] === "string" || typeof row[key] === "number");
      if (key !== undefined) add(`${label}: ${row[key]}`);
    }
    for (const key of [
      "rawInput",
      "input",
      "arguments",
      "item",
      "state",
      "result",
      "rawOutput",
      "changes",
      "edits",
      "content",
      "locations",
    ]) {
      if (key in row) visit(row[key], depth + 1);
    }
  };
  visit(root, 0);
  const text = [...parts].join("\n\n");
  if (!text) return undefined;
  const bounded = text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW - 1)}…` : text;
  // A small sliced excerpt must not keep a provider's entire file body alive.
  return Array.from(bounded).join("");
}
