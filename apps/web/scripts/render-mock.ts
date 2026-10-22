// @effect-diagnostics nodeBuiltinImport:off - plain Node script that agents run by hand.
/**
 * Builds a mock of a T3 Code feature from the web app's real components and
 * stylesheet, for html_preview and html_render. The mock file default-exports
 * a React component and imports app code through `~/`, for example
 * `import { Button } from "~/components/ui/button"`. It can live anywhere,
 * such as a scratch directory outside the worktree.
 *
 *   node apps/web/scripts/render-mock.ts <mock.tsx>
 *
 * Writes `<mock>.js`, `<mock>.css`, and `<mock>.html` next to the mock and
 * prints the page. The page links the bundle by absolute path, and html_render
 * inlines it, so the page passed to the tool stays a few lines long.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { HTML_RENDER_ASSET_MARKER } from "@t3tools/shared/htmlRender";
import { build, type Plugin } from "vite";

const webRoot = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const webEntry = NodePath.join(webRoot, "src/main.tsx");

const mockArgument = process.argv[2];
if (!mockArgument) {
  console.error("Usage: node apps/web/scripts/render-mock.ts <mock.tsx>");
  process.exit(1);
}
const mockPath = NodePath.resolve(mockArgument);
const outBase = mockPath.replace(/\.[jt]sx?$/, "");
const buildDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-mock-"));

// Tailwind only emits classes it finds in scanned sources; the mock is outside them.
const entryCss = NodePath.join(buildDir, "entry.css");
await NodeFSP.writeFile(
  entryCss,
  [
    `@import ${JSON.stringify(NodePath.join(webRoot, "src/index.css"))};`,
    `@source ${JSON.stringify(mockPath)};`,
    // The app fills the window and scrolls inside it; a page in a frame grows to fit instead.
    "html, body { min-height: 0; height: auto; overflow: visible; }",
  ].join("\n"),
);

// The page wears the reader's theme, which html_render's theme style carries
// under the app's own --app-theme-* names, and falls back to the default
// palette and the system appearance outside a frame.
const entryPath = NodePath.join(buildDir, "entry.js");
await NodeFSP.writeFile(
  entryPath,
  `
import ${JSON.stringify(entryCss)};
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import Mock from ${JSON.stringify(mockPath)};

const theme = document.getElementById("t3-theme");
const applyAppearance = () => {
  const text = theme?.textContent ?? "";
  const dark = theme
    ? !/color-scheme:\\s*light/.test(text)
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  // As the app does for a chosen theme; index.css then maps the palette onto its tokens.
  if (text.includes("--app-theme-canvas:")) root.dataset.themeId = "html-render";
  else delete root.dataset.themeId;
  // The app's theme module, which many components import, applies the system
  // appearance and any stored theme inline when it loads.
  for (const property of [...root.style]) {
    if (property.startsWith("--app-theme-")) root.style.removeProperty(property);
  }
  root.style.removeProperty("background-color");
  document.body.style.removeProperty("background-color");
};
applyAppearance();
if (theme) new MutationObserver(applyAppearance).observe(theme, { childList: true, characterData: true, subtree: true });

createRoot(document.getElementById("t3-mock-root")).render(createElement(Mock));
`,
);

const isBare = (source: string) => !/^(?:[./~\0]|[a-z]:[\\/]|\/)/i.test(source);

const mockEntry = (): Plugin => ({
  name: "t3-mock-entry",
  enforce: "pre",
  resolveId(source, importer, options) {
    // A mock outside the web app has no node_modules of its own; resolve its
    // packages as the app would.
    if (
      importer !== undefined &&
      isBare(source) &&
      !importer.startsWith(NodePath.dirname(NodePath.dirname(webRoot)))
    ) {
      return this.resolve(source, webEntry, { ...options, skipSelf: true });
    }
    return null;
  },
});

try {
  await build({
    configFile: false,
    root: webRoot,
    logLevel: "warn",
    plugins: [mockEntry(), react({ compiler: true }), tailwindcss()],
    resolve: {
      tsconfigPaths: true,
      // tsconfig paths only cover files the web tsconfig includes, which a scratch mock is not.
      alias: [{ find: /^~\//, replacement: `${NodePath.join(webRoot, "src")}/` }],
      dedupe: ["react", "react-dom"],
    },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: buildDir,
      emptyOutDir: false,
      copyPublicDir: false,
      lib: {
        entry: entryPath,
        formats: ["iife"],
        name: "T3Mock",
        fileName: () => "mock.js",
        cssFileName: "mock",
      },
    },
  });

  const [js, css] = await Promise.all([
    NodeFSP.readFile(NodePath.join(buildDir, "mock.js"), "utf8"),
    NodeFSP.readFile(NodePath.join(buildDir, "mock.css"), "utf8"),
  ]);
  await NodeFSP.writeFile(`${outBase}.js`, `${HTML_RENDER_ASSET_MARKER}\n${js}`);
  // The terminal's icon font is most of the stylesheet once inlined, and no mock needs it.
  const pageCss = css.replace(/@font-face\{[^}]*Symbols Nerd Font[^}]*\}/g, "");
  await NodeFSP.writeFile(`${outBase}.css`, `${HTML_RENDER_ASSET_MARKER}\n${pageCss}`);
  const page = [
    "<!doctype html>",
    `<html><head><link rel="stylesheet" href="${outBase}.css"></head>`,
    `<body><div id="t3-mock-root"></div><script src="${outBase}.js"></script></body></html>`,
  ].join("\n");
  await NodeFSP.writeFile(`${outBase}.html`, page);
  const kib = (text: string) => `${Math.round(Buffer.byteLength(text) / 1024)} KiB`;
  console.error(`[render-mock] ${outBase}.js ${kib(js)}, ${outBase}.css ${kib(pageCss)}`);
  console.log(page);
} finally {
  await NodeFSP.rm(buildDir, { recursive: true, force: true });
}
