import type { PhrasingContent, Root, RootContent } from "mdast";

/**
 * Marks each of a Slack or Discord message's `mentions` (`@Ada`, `#eng`) as a
 * `span[data-chat-mention]`, which the thread preview highlights the way those apps do. The
 * server lists the mentions because the text alone cannot tell a multi-word name from the words
 * after it. Code and links are left alone.
 */
export function remarkChatMentions(mentions: ReadonlyArray<string>) {
  const pattern = mentionPattern(mentions);
  return (tree: Root) => {
    if (pattern === null) return;
    const visit = (node: Root | RootContent) => {
      if (!("children" in node) || node.type === "link" || node.type === "linkReference") return;
      const children: Array<RootContent> = [];
      for (const child of node.children) {
        if (child.type === "text") children.push(...splitMentions(child.value, pattern));
        else {
          visit(child);
          children.push(child);
        }
      }
      node.children = children as typeof node.children;
    };
    visit(tree);
  };
}

function mentionPattern(mentions: ReadonlyArray<string>): RegExp | null {
  if (mentions.length === 0) return null;
  const alternatives = mentions
    .toSorted((a, b) => b.length - a.length)
    .map((mention) => mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // `@Ben` must not light up the start of `@Benjamin`.
  return new RegExp(`(?:${alternatives.join("|")})(?![\\p{L}\\p{N}_-])`, "gu");
}

function splitMentions(value: string, pattern: RegExp): Array<PhrasingContent> {
  const parts: Array<PhrasingContent> = [];
  let last = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index;
    if (index > last) parts.push({ type: "text", value: value.slice(last, index) });
    parts.push({
      type: "text",
      value: match[0],
      data: { hName: "span", hProperties: { dataChatMention: "" } },
    });
    last = index + match[0].length;
  }
  if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
  return parts;
}
