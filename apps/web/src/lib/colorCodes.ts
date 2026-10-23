import { githubIssueReferenceUrl } from "@t3tools/shared/githubIssueReferences";

import { findAndReplaceText, type MarkdownNode } from "~/vendor/mdast-find-and-replace";

/**
 * A hex colour such as `#F2EDE5`, `#fff` or `#333333`. URL fragments, entities and anchors like
 * `#abc-def` are left alone.
 */
export const COLOR_CODE = /(?<![\w/&#-])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{3,4})(?![\w-])/giu;

/** All digits without a leading zero, so it may also be an issue or pull request number. */
export function mayBeIssueReference(code: string): boolean {
  return /^#[1-9]\d*$/u.test(code);
}

const WHOLE_COLOR_CODE = new RegExp(`^${COLOR_CODE.source}$`, "iu");

/** Cheap check, so text without a colour skips the rewrite. */
export function mayHaveColorCode(text: string): boolean {
  return /#[\da-f]{3}/iu.test(text);
}

/** `text` when it is exactly one colour code, ignoring surrounding whitespace. */
export function wholeColorCode(text: string): string | null {
  const trimmed = text.trim();
  return WHOLE_COLOR_CODE.test(trimmed) ? trimmed : null;
}

const IGNORED_TYPES = new Set(["link", "linkReference"]);

/**
 * Fork: wraps colour codes in prose so the renderer can draw them as swatch chips. A code that
 * may be an issue or pull request number depends on `repositoryUrl`, the thread's GitHub
 * repository: given one, the code carries its URL there and the renderer shows the colour only
 * once neither exists; null means the project is not on GitHub, so it is a colour; undefined
 * means there is no thread to ask, so it stays text. `#123` links made by
 * `remarkGitHubIssueReferences` are marked for the same check.
 */
export function remarkColorCodes(repositoryUrl: string | null | undefined) {
  return (tree: MarkdownNode) => {
    findAndReplaceText(
      tree,
      COLOR_CODE,
      (code) => {
        if (!mayBeIssueReference(code) || repositoryUrl === null) return colorCodeNode(code);
        if (repositoryUrl === undefined) return false;
        return colorCodeNode(
          code,
          githubIssueReferenceUrl(undefined, code.slice(1), repositoryUrl),
        );
      },
      IGNORED_TYPES,
    );
    markIssueReferenceLinks(tree);
  };
}

function colorCodeNode(code: string, reference?: string | null): MarkdownNode {
  return {
    type: "text",
    value: code,
    data: {
      hName: "span",
      hProperties: { dataColorCode: code, ...(reference ? { dataColorReference: reference } : {}) },
    },
  };
}

function markIssueReferenceLinks(node: MarkdownNode): void {
  for (const child of node.children ?? []) {
    const text = child.children?.length === 1 ? child.children[0] : undefined;
    const code = text?.type === "text" ? wholeColorCode(text.value ?? "") : null;
    const isIssueLink = child.type === "link" && /\/issues\/\d+$/u.test(child.url ?? "");
    if (isIssueLink && code !== null && mayBeIssueReference(code)) {
      child.data = { hProperties: { dataColorCode: code } };
    } else {
      markIssueReferenceLinks(child);
    }
  }
}

export interface ColorFacts {
  rgb: string;
  hsl: string;
  /** WCAG contrast ratios, to two decimals. */
  contrastOnWhite: string;
  contrastOnBlack: string;
  /** Whether black text reads better than white text on this colour. */
  prefersDarkText: boolean;
}

export function describeColorCode(code: string): ColorFacts {
  let digits = code.slice(1);
  if (digits.length <= 4) digits = Array.from(digits, (digit) => digit + digit).join("");
  const channel = (index: number) => Number.parseInt(digits.slice(index, index + 2), 16);
  const [red, green, blue] = [channel(0), channel(2), channel(4)];
  const alpha = digits.length === 8 ? channel(6) / 255 : 1;

  const [r, g, b] = [red / 255, green / 255, blue / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (Math.round(hue * 60) + 360) % 360;
  }

  const linear = (value: number) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const onWhite = 1.05 / (luminance + 0.05);
  const onBlack = (luminance + 0.05) / 0.05;
  const alphaSuffix = alpha < 1 ? ` / ${Math.round(alpha * 100)}%` : "";

  return {
    rgb: `${red} ${green} ${blue}${alphaSuffix}`,
    hsl: `${hue} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%${alphaSuffix}`,
    contrastOnWhite: onWhite.toFixed(2),
    contrastOnBlack: onBlack.toFixed(2),
    prefersDarkText: onBlack >= onWhite,
  };
}
