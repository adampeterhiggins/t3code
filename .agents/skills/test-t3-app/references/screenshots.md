# Screenshots and PR evidence

Load this reference when you need images of the app, such as before/after shots for a PR, or when Browser panel captures fail.

## Browser panel problems

- **HTTP 431 on a localhost dev server.** The default profile carries cookies from every other dev server on the machine. Open the tab with `preview_open({ profileId: "incognito", ... })`.
- **`preview_snapshot` times out with `save` or `includeImage`.** A capture needs the tab visible in the user's window. Accessibility snapshots and `preview_evaluate` still work on a hidden tab, so use them to check the state, and capture with Playwright instead.
- **Soft captures.** Panel screenshots are taken at 1× device pixels. Text in a cropped PR image looks blurry. `preview_resize` has no device-scale option.
- **Do not enlarge the viewport to fake 2×.** A 2400px freeform viewport made captures time out. The tab kept that size after a reload and after `{ mode: "fill" }`, and later tabs drew a stale frame of the old layout. If that happens, close those tabs and open a new one.

## Playwright fallback

The web app already depends on Playwright, and its Chromium is usually cached in `~/Library/Caches/ms-playwright`. Use it for screenshots when the panel cannot take them. Install nothing.

Keep the script outside the worktree and resolve Playwright through the web package:

```js
// /tmp/<task>/shot.mjs
import { createRequire } from "node:module";
const require = createRequire("<worktree>/apps/web/package.json");
const { chromium } = require("playwright");

const [pairUrl, threadUrl, out] = process.argv.slice(2);
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
const page = await context.newPage();
await page.goto(pairUrl);
await page.waitForURL((url) => !url.pathname.startsWith("/pair"));
await context.storageState({ path: "/tmp/<task>/state.json" });

await page.goto(threadUrl);
const target = page.getByText("<text in the row you are proving>").first();
await target.waitFor();
await target.scrollIntoViewIfNeeded();
await page.mouse.move(0, 0); // clear hover states
const box = await target.boundingBox();
await page.screenshot({
  path: out,
  clip: { x: box.x - 40, y: box.y - 160, width: 720, height: 320 },
});
await browser.close();
```

- Mint a pairing URL with `node apps/server/src/bin.ts pair --base-dir <worktree>/.t3` once the dev server is up, and check that the URL uses the dev-runner's web port. Without `--base-dir`, or before the server is listening, `pair` can find another T3 server on the machine and print its URL instead. A token is consumed even if the script fails afterwards. Save `storageState` once, then pass `storageState` to `newContext` on later runs instead of pairing again.
- `deviceScaleFactor: 2` gives sharp images. Clip around a `getByText` target instead of cropping a full-page image by hand.
- Thread URLs are `/<environmentId>/<threadId>`. The environment id is in `<worktree>/.t3/userdata/environment-id`. Sidebar rows are not anchors.
- Older turns fold behind "Worked for …" rows, and tool runs fold behind group rows such as "Searched the web N times". Long threads need "Load earlier turns" clicked before their first turns render.
- Real data makes better evidence. Seed it with `vp run migrate-dev-db`, then pick a thread from `orchestration_v2_projection_threads` that shows the state you changed.

## Before and after

For the "before" shot, commit your change, then restore only the changed client files from the branch's parent commit: `git checkout HEAD~1 -- <files>`. Do not use local `main`, which can lag behind the branch base. Vite hot-reloads. Run the same script, then restore with `git checkout HEAD -- <files>` and confirm `git status` is clean.

## Publishing

Inspect each image before upload. Seeded thread titles, project names, and file paths are real data, so crop out anything private. Host the images on a prerelease as described in [test-t3-desktop's evidence reference](../../test-t3-desktop/references/evidence.md), and never commit them. A `| Before | After |` table with `<img width="420">` keeps a pair side by side.

Electron-only windows, global shortcuts, and native focus are out of reach of both the panel and Playwright. Use [test-t3-desktop](../../test-t3-desktop/SKILL.md) for those.
