/** Separate generated execution metadata from the useful tool preview content. */
export function splitToolCallPreviewMetadata(text: string | undefined) {
  const content: string[] = [];
  const metadata: Array<{ label: "Working directory" | "Exit code"; value: string }> = [];
  for (const block of text?.split("\n\n") ?? []) {
    const match = /^(Working directory|Exit code): ([^\n]+)$/.exec(block);
    if (match) {
      metadata.push({
        label: match[1] === "Working directory" ? "Working directory" : "Exit code",
        value: match[2]!,
      });
    } else {
      content.push(block);
    }
  }
  return { body: content.join("\n\n"), metadata };
}
