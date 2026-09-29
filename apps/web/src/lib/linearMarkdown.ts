const LINEAR_URL = String.raw`https?://linear\.app/[\w-]+/(?:issue|project|document)/[^\s)\]>]+`;
const MARKDOWN_LINK = new RegExp(String.raw`\[([^\]]*)\]\((${LINEAR_URL})\)`, "g");
const AUTOLINK = new RegExp(String.raw`<(${LINEAR_URL})>`, "g");
// A bare URL: not already a markdown link's target (`](url)`) or text (`[url]`).
const BARE_URL = new RegExp(String.raw`(?<![(\[<])(${LINEAR_URL})`, "g");
const ISSUE_PATH = /^\/[\w-]+\/issue\/([a-z][a-z0-9_]*-\d+)/i;
const NAMED_PATH = /^\/[\w-]+\/(?:project|document)\/([\w-]+?)(?:-[0-9a-f]{8,})?(?:\/|$)/i;

/** How Linear names a link to its own pages: `ENG-123` for an issue, the name for a project. */
export function linearLinkLabel(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "linear.app") return null;
  const issue = ISSUE_PATH.exec(parsed.pathname);
  if (issue?.[1]) return issue[1].toUpperCase();
  const named = NAMED_PATH.exec(parsed.pathname);
  if (!named?.[1]) return null;
  const words = named[1].replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * An issue snapshot as a preview shows it: without the issue's own URL line (the preview links
 * there itself), and with links to Linear pages labelled the way Linear does. Links someone gave
 * their own text keep it. The agent still receives the snapshot unchanged.
 */
export function formatLinearMarkdownForPreview(markdown: string, issueUrl: string): string {
  const label = (url: string, fallback: string) => {
    const named = linearLinkLabel(url);
    return named === null ? fallback : `[${named}](${url})`;
  };
  return markdown
    .split("\n")
    .filter((line) => line.trim() !== issueUrl)
    .join("\n")
    .replace(MARKDOWN_LINK, (match, text: string, url: string) =>
      text.trim() === "" || text.trim() === url ? label(url, match) : match,
    )
    .replace(AUTOLINK, (match, url: string) => label(url, match))
    .replace(BARE_URL, (match, url: string) => label(url, match));
}
