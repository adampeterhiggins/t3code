import type { LinearObjectType } from "@t3tools/contracts";

import { renderIssueMarkdown } from "../issueMarkdown.ts";

const OBJECT_TYPE_NAMES: Record<LinearObjectType, string> = {
  project: "Project",
  document: "Document",
  initiative: "Initiative",
};

export interface LinearObjectDetail {
  readonly objectType: LinearObjectType;
  readonly title: string;
  readonly url: string;
  /** Label and value pairs shown under the title; null values are left out. */
  readonly facts: ReadonlyArray<readonly [string, string | null]>;
  readonly content: string | null;
  /** Lists such as a project's issues, each with its heading. */
  readonly lists: ReadonlyArray<{
    readonly heading: string;
    readonly items: ReadonlyArray<string>;
  }>;
}

/**
 * Renders a project, document, or initiative as the markdown an agent receives. The header and
 * lists are kept whole and the content fills what is left, as an issue's description does.
 */
export function renderLinearObjectMarkdown(object: LinearObjectDetail, maxChars: number): string {
  const facts = object.facts.flatMap(([label, value]) =>
    value === null || value.trim() === "" ? [] : [`${label}: ${value}`],
  );
  const header = [
    `# ${OBJECT_TYPE_NAMES[object.objectType]}: ${object.title}`,
    object.url,
    ...(facts.length > 0 ? ["", ...facts] : []),
  ].join("\n");
  return renderIssueMarkdown(
    {
      header,
      description: object.content,
      sections: object.lists
        .filter((list) => list.items.length > 0)
        .map((list) => [`## ${list.heading}`, ...list.items.map((item) => `- ${item}`)].join("\n")),
      comments: [],
    },
    maxChars,
  );
}
