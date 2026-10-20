import { defineRule } from "@oxlint/plugins";

/*
 * Hover previews drift when a surface renders a kind's preview body itself, so the bodies are
 * reachable only through the context presentation registry. Modules map to the exports that
 * are preview bodies; `null` means every component the module exports.
 */
const PREVIEW_MODULES = new Map<string, ReadonlySet<string> | null>([
  ["ThreadHoverCard", null],
  ["contextPreviews", null],
  ["AgentFleetRow", new Set(["AgentPreviewContent"])],
]);

const COMPONENT_NAME = /^[A-Z]/u;

const moduleBasename = (source: string) =>
  source
    .split("/")
    .at(-1)
    ?.replace(/\.(tsx?|jsx?)$/u, "");

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require hover previews to come from the context presentation registry, so a kind previews the same everywhere.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type") return;
        const source = typeof node.source.value === "string" ? node.source.value : null;
        const basename = source === null ? undefined : moduleBasename(source);
        if (basename === undefined || !PREVIEW_MODULES.has(basename)) return;
        const restricted = PREVIEW_MODULES.get(basename) ?? null;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          if (specifier.importKind === "type") continue;
          const imported =
            specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : String(specifier.imported.value);
          const isPreview =
            restricted === null ? COMPONENT_NAME.test(imported) : restricted.has(imported);
          if (!isPreview) continue;
          context.report({
            node: specifier,
            message: `${imported} is a hover preview body. Draw previews with ContextPreviewHover or ContextPreviewBody from contextPresentationRegistry, adding a placement or preview input there if a surface needs one.`,
          });
        }
      },
    };
  },
});
