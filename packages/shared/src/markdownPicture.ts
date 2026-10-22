export interface PictureSource {
  readonly media?: string | undefined;
  readonly srcSet?: string | undefined;
}

interface PictureHastNode {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: PictureHastNode[];
}

/**
 * Replaces a `<picture>` with the `<img>` for this appearance. The chat image
 * renderer is not a direct child of `<picture>`, so the browser would ignore
 * `<source>` and always paint the fallback.
 */
export function rehypeResolvePictureSources(appearance: "light" | "dark") {
  const visit = (node: PictureHastNode) => {
    const children = node.children;
    if (!children) return;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!;
      if (child.tagName !== "picture") {
        visit(child);
        continue;
      }
      const image = resolvedPictureImage(child, appearance);
      if (image) children[index] = image;
      else visit(child);
    }
  };
  // An attacher, same as the other rehype plugins: unified calls it, then the transformer.
  return () => (tree: PictureHastNode) => {
    visit(tree);
  };
}

function resolvedPictureImage(
  picture: PictureHastNode,
  appearance: "light" | "dark",
): PictureHastNode | null {
  const sources: PictureSource[] = [];
  let image: PictureHastNode | undefined;
  for (const child of picture.children ?? []) {
    if (child.tagName === "source") {
      sources.push({
        media: hastProperty(child.properties?.media),
        srcSet: hastProperty(child.properties?.srcSet),
      });
    } else if (child.tagName === "img" && image === undefined) {
      image = child;
    }
  }
  if (!image) return null;
  const src = pictureSourceUrl(sources, hastProperty(image.properties?.src), appearance);
  if (!src) return null;
  return { ...image, properties: { ...image.properties, src } };
}

function hastProperty(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const text = value.filter((part) => typeof part === "string").join(" ");
  return text.length > 0 ? text : undefined;
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
