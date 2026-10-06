import {
  DEFAULT_CONTEXT_REPOSITORY_DIRECTORY,
  type EnvironmentId,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { isWindowsAbsolutePath } from "@t3tools/shared/path";
import { collectToolFilePaths } from "@t3tools/shared/toolActivity";
import { Atom } from "effect/reactivity";

import { toolGroupAction, type WorkLogPresentationEntry } from "./presentation.ts";

export interface ToolPathRoot {
  readonly path: string;
  readonly label: string;
  readonly project: string | null;
}

const normalize = (path: string) =>
  (isWindowsAbsolutePath(path) ? path.replaceAll("\\", "/") : path).replace(/\/+$/, "");
const basename = (path: string) => normalize(path).split("/").at(-1) ?? path;

function containsPath(path: string, root: string) {
  const fold = isWindowsAbsolutePath(root);
  const target = fold ? path.toLowerCase() : path;
  const directory = fold ? root.toLowerCase() : root;
  return target === directory || target.startsWith(`${directory}/`);
}

/** Environment-local roots, stable across shell updates that only change a thread's status. */
export function createToolPathRootsAtoms(input: {
  readonly threadsAtom: (id: EnvironmentId) => Atom.Atom<ReadonlyArray<OrchestrationV2ThreadShell>>;
  readonly projectsAtom: (id: EnvironmentId) => Atom.Atom<ReadonlyArray<OrchestrationProjectShell>>;
}) {
  return Atom.family((environmentId: EnvironmentId) => {
    let previous: ReadonlyArray<ToolPathRoot> = [];
    return Atom.make((get) => {
      const projects = get(input.projectsAtom(environmentId));
      const projectNames = new Map(projects.map((project) => [project.id, project.title]));
      const roots = new Map<string, ToolPathRoot>();
      for (const thread of get(input.threadsAtom(environmentId))) {
        if (!thread.worktreePath) continue;
        const path = normalize(thread.worktreePath);
        roots.set(path, {
          path,
          label: thread.branch ?? basename(path),
          project: projectNames.get(thread.projectId) ?? null,
        });
      }
      const next = [...roots.values()].sort((a, b) => b.path.length - a.path.length);
      if (
        next.length === previous.length &&
        next.every((root, index) => {
          const old = previous[index];
          return (
            old?.path === root.path && old.label === root.label && old.project === root.project
          );
        })
      )
        return previous;
      previous = next;
      return next;
    }).pipe(Atom.withLabel(`tool-path-roots:${environmentId}`));
  });
}

/** Only display is abbreviated; `absolutePath` retains the provider's original spelling. */
export function resolveToolPath(
  path: string,
  workspaceRoot: string | null | undefined,
  roots: ReadonlyArray<ToolPathRoot> = [],
) {
  const windows =
    isWindowsAbsolutePath(path) || Boolean(workspaceRoot && isWindowsAbsolutePath(workspaceRoot));
  const normalized = windows ? path.replaceAll("\\", "/") : path;
  const absolute = normalized.startsWith("/") || isWindowsAbsolutePath(normalized);
  const workspace = workspaceRoot ? normalize(workspaceRoot) : null;
  if (!absolute && !workspace) return null;
  // A relative traversal may leave the workspace. Do not label it as a file inside it.
  if (normalized.split("/").includes("..")) return null;
  const absolutePath = absolute
    ? path
    : `${workspaceRoot!.replace(/[\\/]+$/, "")}${windows ? "\\" : "/"}${path.replace(/^\.\//, "")}`;
  const target = absolute ? normalized : `${workspace}/${normalized.replace(/^\.\//, "")}`;
  let known: ToolPathRoot | null = null;
  for (const root of roots) {
    if (
      (!known || root.path.length > known.path.length) &&
      containsPath(target, normalize(root.path))
    )
      known = root;
  }
  const current =
    workspace && containsPath(target, workspace)
      ? { path: workspace, label: basename(workspace), project: null }
      : null;
  // Private worktrees may outlive their thread record; their layout is unambiguous.
  const managed = /^(.*\/\.t3\/worktrees\/([^/]+)\/([^/]+))(?=\/|$)/.exec(target);
  const claude = /^(.*\/\.claude\/worktrees\/([^/]+))(?=\/|$)/.exec(target);
  const inferred = managed
    ? { path: managed[1]!, label: managed[3]!, project: managed[2]! }
    : claude
      ? { path: claude[1]!, label: claude[2]!, project: null }
      : null;
  let root = [known, current, inferred]
    .filter((candidate): candidate is ToolPathRoot => candidate !== null && candidate !== undefined)
    .sort((a, b) => b.path.length - a.path.length)[0];
  let relative = root ? target.slice(normalize(root.path).length).replace(/^\//, "") : target;
  // Repositories linked to a message are cloned into `<root>/.context/<name>`; show the clone as
  // its own root rather than as a folder of the worktree that holds it.
  const [directory, name, ...rest] = relative.split("/");
  const repository = Boolean(root && directory === DEFAULT_CONTEXT_REPOSITORY_DIRECTORY && name);
  if (root && repository) {
    root = {
      path: `${normalize(root.path)}/${directory}/${name}`,
      label: name!,
      project: root.project,
    };
    relative = rest.join("/");
  }
  return {
    absolutePath,
    rootLabel: root?.label ?? "External",
    project: root?.project ?? null,
    external: root === undefined,
    repository,
    segments: relative.split("/").filter(Boolean),
  };
}

export type ToolPathPart =
  | { readonly text: string }
  | { readonly path: NonNullable<ReturnType<typeof resolveToolPath>> };

/** Shell commands stay verbatim; a command line is code, not a list of file targets. */
export function toolEntryShowsPathBreadcrumbs(entry: WorkLogPresentationEntry) {
  return entry.tone === "tool" && toolGroupAction(entry) !== "command";
}

/** Canonical inputs preserve spaces and Windows spelling when an adapter formats its label. */
export function toolPathTargets(
  entry: Pick<WorkLogPresentationEntry, "structuredPayload" | "toolData" | "changedFiles">,
) {
  const item = entry.structuredPayload;
  if (item?.type === "file_change")
    return [item.fileName, ...(item.changes?.map((change) => change.path) ?? [])];
  const paths = collectToolFilePaths(
    item?.type === "dynamic_tool" ? { input: item.input } : entry.toolData,
  );
  return paths.length > 0 ? paths : (entry.changedFiles ?? []);
}

/** Split tool labels/targets, never arbitrary provider output or source-code bodies. */
export function toolPathTextParts(
  text: string,
  workspaceRoot: string | null | undefined,
  roots: ReadonlyArray<ToolPathRoot> = [],
  targets: ReadonlyArray<string> = [],
): ReadonlyArray<ToolPathPart> {
  // Quoted absolute targets can contain spaces; unquoted shell paths stop at syntax delimiters.
  const pattern =
    /"((?:[A-Za-z]:[\\/]|\/|\\\\)[^"\r\n]+)"|'((?:[A-Za-z]:[\\/]|\/|\\\\)[^'\r\n]+)'|(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'`<>|;&,)]+/g;
  const parts: ToolPathPart[] = [];
  const matches: {
    start: number;
    length: number;
    path: NonNullable<ReturnType<typeof resolveToolPath>>;
  }[] = [];
  for (const target of targets) {
    const path = resolveToolPath(target, workspaceRoot, roots);
    if (!path) continue;
    for (const spelling of new Set([target, normalize(target)])) {
      if (!spelling) continue;
      let start = text.indexOf(spelling);
      while (start !== -1) {
        const after = text[start + spelling.length];
        if (
          (!after || /[\s"'`:)},;]/.test(after)) &&
          (start === 0 || /[\s"'=(:]/.test(text[start - 1]!))
        ) {
          const quote = text[start - 1];
          const quoted = (quote === '"' || quote === "'") && after === quote;
          matches.push({
            start: quoted ? start - 1 : start,
            length: spelling.length + (quoted ? 2 : 0),
            path,
          });
        }
        start = text.indexOf(spelling, start + spelling.length);
      }
    }
  }
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    // A slash inside a URL, relative path, or flag isn't an absolute file target.
    if (start > 0 && !/[\s"'=(:]/.test(text[start - 1]!)) continue;
    if (text[start - 1] === ":" && match[0].startsWith("//")) continue;
    if (start > 1 && text.slice(start - 2, start) === ":/") continue;
    const value = match[1] ?? match[2] ?? match[0];
    const path = resolveToolPath(value, workspaceRoot, roots);
    if (!path) continue;
    matches.push({ start, length: match[0].length, path });
  }
  for (const { start, length, path } of matches.sort(
    (a, b) => a.start - b.start || b.length - a.length,
  )) {
    if (start < offset) continue;
    if (start > offset) parts.push({ text: text.slice(offset, start) });
    parts.push({ path });
    offset = start + length;
  }
  if (offset === 0) return [{ text }];
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}
