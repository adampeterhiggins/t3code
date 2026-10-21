import {
  type ComposerObjectLink,
  composerObjectLinkChipLabel,
  composerObjectLinkNoun,
  findComposerObjectLinks,
} from "@t3tools/shared/composerObjectLinks";
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { FolderGit2Icon, MessageSquareTextIcon } from "lucide-react";
import { createRoot, type Root } from "react-dom/client";

import { ContextChip, type ContextChipKind, ContextChipLabel } from "./ContextChip";
import { GitHubRefIcon } from "./gitHubRefPresentation";
import { DiscordIcon, GitHubIcon, GranolaIcon, LinearIcon, NotionIcon, SlackIcon } from "./Icons";
import { PullRequestGlyph } from "./pullRequest/pullRequestIcons";

function loadingLinkChipKind(link: ComposerObjectLink): ContextChipKind {
  switch (link.kind) {
    case "slack-message":
      return "slack-thread";
    case "discord-message":
      return "discord-thread";
    default:
      return link.kind;
  }
}

function loadingLinkIcon(link: ComposerObjectLink) {
  switch (link.kind) {
    case "linear-issue":
      return <LinearIcon />;
    case "github-issue":
      return <GitHubIcon />;
    case "pull-request":
      return <PullRequestGlyph.pullRequest />;
    case "github-ref":
      return (
        <GitHubRefIcon
          refType={
            link.linkType === "tree" ? "branch" : link.linkType === "commit" ? "commit" : "release"
          }
        />
      );
    case "repository":
      return <FolderGit2Icon />;
    case "notion-page":
      return <NotionIcon />;
    case "granola-note":
      return <GranolaIcon />;
    case "prompt-link":
      return <MessageSquareTextIcon />;
    case "slack-message":
      return <SlackIcon />;
    case "discord-message":
      return <DiscordIcon />;
  }
}

/** The chip a link shows while its object loads, labelled from the link alone. */
export function LoadingLinkChip({ link }: { link: ComposerObjectLink }) {
  return (
    <ContextChip
      kind={loadingLinkChipKind(link)}
      state="loading"
      aria-label={`Attaching ${composerObjectLinkNoun(link.kind)}`}
    >
      {loadingLinkIcon(link)}
      <ContextChipLabel>{composerObjectLinkChipLabel(link)}</ContextChipLabel>
    </ContextChip>
  );
}

const LoadingLinksKey = new PluginKey<LoadingLinksState>("composer-loading-links");

interface LoadingLinksState {
  readonly urls: ReadonlySet<string>;
  readonly decorations: DecorationSet;
}

/** Where each loading link's text sits, so it can be hidden and stood in for by a chip. */
export function loadingLinkRanges(
  doc: ProseMirrorNode,
  urls: ReadonlySet<string>,
): Array<{ from: number; to: number; link: ComposerObjectLink }> {
  const ranges: Array<{ from: number; to: number; link: ComposerObjectLink }> = [];
  if (urls.size === 0) return ranges;
  doc.descendants((node, pos) => {
    if (!node.isText || node.text === undefined) return true;
    for (const { link, index } of findComposerObjectLinks(node.text)) {
      if (!urls.has(link.url)) continue;
      ranges.push({ from: pos + index, to: pos + index + link.url.length, link });
    }
    return false;
  });
  return ranges;
}

// A chip root unmounts after the update that dropped it; React refuses to unmount a root
// synchronously while it is rendering, and the editor can update from a React commit.
const chipRoots = new WeakMap<globalThis.Node, Root>();

function loadingLinkDecorations(doc: ProseMirrorNode, urls: ReadonlySet<string>): DecorationSet {
  const decorations: Decoration[] = [];
  for (const { from, to, link } of loadingLinkRanges(doc, urls)) {
    decorations.push(Decoration.inline(from, to, { class: "composer-loading-link-text" }));
    decorations.push(
      Decoration.widget(
        from,
        () => {
          const dom = document.createElement("span");
          dom.contentEditable = "false";
          const root = createRoot(dom);
          root.render(<LoadingLinkChip link={link} />);
          chipRoots.set(dom, root);
          return dom;
        },
        {
          side: 1,
          ignoreSelection: true,
          // Keyed by the link alone, so typing elsewhere moves the chip instead of redrawing it
          // and restarting its sweep.
          key: `loading-link:${link.url}`,
          destroy: (dom) => {
            const root = chipRoots.get(dom);
            chipRoots.delete(dom);
            if (root) queueMicrotask(() => root.unmount());
          },
        },
      ),
    );
  }
  return DecorationSet.create(doc, decorations);
}

/** The loading link whose hidden text ends at (backward) or starts at (forward) the caret. */
function loadingLinkAtCaret(state: EditorState, direction: "backward" | "forward") {
  const { selection } = state;
  if (!selection.empty) return null;
  const urls = LoadingLinksKey.getState(state)?.urls;
  if (!urls || urls.size === 0) return null;
  return (
    loadingLinkRanges(state.doc, urls).find((range) =>
      direction === "backward" ? range.to === selection.from : range.from === selection.from,
    ) ?? null
  );
}

/**
 * While a pasted or typed link loads its object, its text is hidden behind a chip labelled from
 * the link. The prompt still holds the link, so sending, undo, and a link that cannot be read
 * all behave as before; this only changes what the editor draws.
 */
export const ComposerLoadingLinksExtension = Extension.create({
  name: "composer-loading-links",
  // Ahead of the keymaps, so their Backspace handling never sees the hidden text.
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin<LoadingLinksState>({
        key: LoadingLinksKey,
        state: {
          init: (_, state) => ({
            urls: new Set(),
            decorations: DecorationSet.create(state.doc, []),
          }),
          apply: (tr, old, _, state) => {
            const urls: ReadonlySet<string> | undefined = tr.getMeta(LoadingLinksKey);
            if (urls !== undefined) {
              return { urls, decorations: loadingLinkDecorations(state.doc, urls) };
            }
            if (!tr.docChanged || old.urls.size === 0) return old;
            return { urls: old.urls, decorations: loadingLinkDecorations(state.doc, old.urls) };
          },
        },
        props: {
          decorations: (state) => LoadingLinksKey.getState(state)?.decorations,
          // The text is hidden, so deleting into it removes the whole link, as deleting a chip
          // would. Its conversion then finds no link and leaves the prompt alone.
          handleKeyDown: (view, event) => {
            // A word deletion takes the link too; a line deletion (Cmd) is left to the editor.
            if ((event.key !== "Backspace" && event.key !== "Delete") || event.metaKey) {
              return false;
            }
            const range = loadingLinkAtCaret(
              view.state,
              event.key === "Backspace" ? "backward" : "forward",
            );
            if (range === null) return false;
            view.dispatch(view.state.tr.delete(range.from, range.to));
            return true;
          },
        },
      }),
    ];
  },
});

/** Sets which links are loading; a no-op when they already are. */
export function setComposerLoadingLinks(
  view: { state: EditorState; dispatch: (tr: EditorState["tr"]) => void },
  urls: ReadonlyArray<string>,
): void {
  const current = LoadingLinksKey.getState(view.state)?.urls;
  if (current === undefined) return;
  const next = new Set(urls);
  if (current.size === next.size && [...next].every((url) => current.has(url))) return;
  view.dispatch(view.state.tr.setMeta(LoadingLinksKey, next).setMeta("addToHistory", false));
}
