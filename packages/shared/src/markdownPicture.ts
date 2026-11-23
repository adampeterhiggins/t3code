export interface PictureSource {
  readonly media?: string | undefined;
  readonly srcSet?: string | undefined;
}

/**
 * The image a `<picture>` should show. GitHub review badges offer one
 * `<source>` per color scheme and an `<img>` fallback. A query this does not
 * understand keeps the fallback rather than guessing.
 */
export function pictureSourceUrl(
  sources: ReadonlyArray<PictureSource>,
  fallbackSrc: string | undefined,
  appearance: "light" | "dark",
): string | undefined {
  for (const source of sources) {
    if (!mediaMatches(source.media, appearance)) continue;
    const url = firstSafeSrcSetUrl(source.srcSet);
    if (url) return url;
  }
  return fallbackSrc;
}

function mediaMatches(media: string | undefined, appearance: "light" | "dark"): boolean {
  if (media === undefined) return true;
  const query = media.trim();
  if (query === "" || query.toLowerCase() === "all") return true;
  const scheme = /^\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/i.exec(query);
  return scheme?.[1]?.toLowerCase() === appearance;
}

function firstSafeSrcSetUrl(srcSet: string | undefined): string | undefined {
  if (!srcSet) return undefined;
  for (const candidate of srcSet.split(",")) {
    const url = candidate.trim().split(/\s+/)[0];
    if (url && isSafeImageUrl(url)) return url;
  }
  return undefined;
}

function isSafeImageUrl(url: string): boolean {
  if (url.startsWith("//")) return true;
  // A scheme other than http(s) — `javascript:`, `data:` — is not an image we load.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return /^https?:/i.test(url);
  return true;
}
