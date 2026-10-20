# Electron session

## Start once

Run from the repository root after seeding stopped state and getting desktop
verification authorization. Check `lsof -nP -iTCP:47999 -sTCP:LISTEN` first; if the
hook port is occupied, identify the existing session rather than starting another.
The hook uses fixed port 47999 and binds only to `127.0.0.1`.

```bash
session_dir=$(mktemp -d /tmp/t3-desktop.XXXXXX)
NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require $PWD/.agents/skills/test-t3-desktop/scripts/electron-hook.cjs" \
  vp run dev:desktop >"$session_dir/dev.log" 2>&1 &
echo $! > "$session_dir/dev.pid"
```

Keep the session directory and PID file. Inspect the log without publishing its
pairing credentials. Read actual ports from `[dev-runner]`, wait for
`[electron-hook] 127.0.0.1:47999`, then inspect:

```bash
curl --fail-with-body -sS http://127.0.0.1:47999/list
```

The dev-only hook intercepts `Module._load`, installing on the first
`require("electron")` returning an object with `.app`, only when
`process.versions.electron` is set. Directly requiring Electron at preload time
fails with `Cannot find module 'electron'`; `NODE_OPTIONS` also reaches plain-Node
dev processes. On `app`'s `ready` event it wraps `globalShortcut.register` to
retain successful accelerator callbacks. Never load this hook in production.

## Hook routes

Use a local CLI client; browser-originated requests are rejected. `/list` is GET;
all other routes are POST. URL-encode query parameters (curl `--url-query` does
this). Choose a **unique URL substring** from `/list`, never an assumed window
order; missing or ambiguous matches fail.

| Route                                                | Input and result                                                                                                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/list`                                              | All BrowserWindows with id, URL, visibility, and bounds.                                                                                                                   |
| `/toggle?acc=<accelerator>`                          | Invoke the remembered global shortcut callback. This exercises callback behaviour, not OS shortcut delivery.                                                               |
| `/capture?which=<substring>&out=<absolute PNG path>` | `webContents.capturePage()` writes PNG without OS permissions; transparent windows retain alpha.                                                                           |
| `/eval?which=<substring>`                            | POST JavaScript body to `webContents.executeJavaScript`.                                                                                                                   |
| `/maineval`                                          | POST an async function body with `electron` in scope; use `return` for a result. `require` is unavailable; use `/capture` for file output and the shell for other file IO. |
| `/input?which=<substring>`                           | POST a JSON array of Electron `sendInputEvent` objects.                                                                                                                    |

For example, replace the selector and accelerator with values from this build:

```bash
which='unique-window-url-fragment'
curl --fail-with-body -sS -X POST --url-query 'acc=Alt+/' \
  http://127.0.0.1:47999/toggle
curl --fail-with-body -sS --url-query "which=$which" \
  --data-binary '({hidden: document.hidden, style: document.body.getAttribute("style")})' \
  http://127.0.0.1:47999/eval
curl --fail-with-body -sS -X POST --url-query "which=$which" \
  --url-query "out=$session_dir/window.png" http://127.0.0.1:47999/capture
```

Show/hide or inspect a specific window with `/maineval`, using the id from the
latest `/list` (ids change after Electron restarts):

```javascript
const win = electron.BrowserWindow.fromId(123);
win.webContents.setBackgroundThrottling(false);
win.show(); // Steals the developer's focus; keep this interval brief.
return win.getBounds();
```

Use `win.hide()` when done. Avoid changing throttling before recording the
original behaviour if occlusion itself is under test.

## Send real input

Synthetic `element.click()` does not open Base UI menus/comboboxes: they listen
for pointer events. Use the helper (Python 3 standard library):

```bash
python3 .agents/skills/test-t3-desktop/scripts/click.py "$which" '#target-id'
```

It reads `getBoundingClientRect()`, multiplies the centre by
`webContents.getZoomFactor()`, and sends `mouseDown`/`mouseUp` with `button: "left"`
and `clickCount: 1`. If a selector is ambiguous, first tag the intended element
via `/eval`, for example:

```javascript
const matches = [...document.querySelectorAll("button")].filter(
  (el) => el.textContent.trim() === "Choose project",
);
if (matches.length !== 1) throw new Error("Ambiguous button");
matches[0].id = "desktop-test-target";
```

Then click `#desktop-test-target`. Send Escape with `/input`:

```bash
curl --fail-with-body -sS --url-query "which=$which" \
  --data-binary '[{"type":"keyDown","keyCode":"Escape"},{"type":"keyUp","keyCode":"Escape"}]' \
  http://127.0.0.1:47999/input
```

For a React-controlled textarea, run via `/eval`:

```javascript
const el = document.querySelector("textarea");
Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, "Test draft");
el.dispatchEvent(new Event("input", { bubbles: true }));
```

For attachments, build a `File`, put it in a `DataTransfer`, then dispatch a drop
on the actual drop target (replace the selector):

```javascript
const transfer = new DataTransfer();
transfer.items.add(new File(["Test attachment"], "fixture.txt", { type: "text/plain" }));
document
  .querySelector("#drop-target")
  .dispatchEvent(
    new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
  );
```

Do not proceed to send a turn from seeded projects without explicit agreement.

## Inspect misleading captures

- Check `document.hidden` and `document.getAnimations()` via `/eval` if a floating
  or transparent window captures empty. Chromium can treat it as occluded;
  animations/rAF stall and popover pixels remain near alpha zero. A shown window
  should normally use `webContents.setBackgroundThrottling(false)`.
- Wait about one second after state changes, or re-capture, before trusting pixels:
  immediate captures can be stale. This is visual settling, not a backend test wait.
- Inspect html/body `getAttribute("style")` and computed `backgroundColor`.
  Theme code such as `syncBrowserChromeTheme` can write inline backgrounds that
  override stylesheet rules.
- Vite HMR can remount components and clear state mid-session. Re-apply test input.
- For dark shots, save the current theme value, then set
  `localStorage["t3code:theme"] = "dark"` via `/eval` in the main window. Other
  windows of the same origin follow storage events. Remove the key afterwards
  to restore the default, or restore the prior value if one existed.

## Stop and recover

```bash
bash .agents/skills/test-t3-desktop/scripts/stop-dev.sh "$session_dir/dev.pid"
lsof -nP -iTCP:47999 -sTCP:LISTEN
# Repeat lsof for every backend/web port recorded from dev-runner.
```

The Bash helper walks descendants with `pgrep -P`, records their start times to
avoid signalling reused descendant PIDs, sends TERM to parents first, waits,
escalates to KILL, and prints remaining PIDs (must be none). Retain its captured
PID output. Inspect the root with `ps -p <recorded-pid> -o pid,ppid,lstart,command`
before using an old PID file; a stale root PID may have been reused.

Do not use `kill $pids` with a newline-joined string in zsh: zsh does not
word-split it, so it sends no signals and stopping silently fails. Use this Bash
helper or a zsh array and verify every PID is gone. Port checks must also show no
listeners; an exited root does not prove its descendants stopped.

Surviving `apps/desktop/scripts/dev-electron.mjs` runners can `pkill` other
Electron instances for the same worktree on restart and relaunch their own after
it dies. Leftover runners cause windows to open/close in a loop; two servers
using one worktree's `.t3` can show **"This T3 home is unavailable"**. Do not
launch another instance to recover.

List processes with `ps -axo pid,ppid,command` and inspect command lines containing
`<worktree>/apps/`. This is an inventory, never permission to kill by pattern.
Confirm each belongs to this worktree and reconcile explicit PIDs against your
captured process tree, including orphaned `vp` / `vp pack --watch` task runners
whose argv may omit `apps/`. Stop confirmed session processes by explicit PID;
never use `pkill -f`, `pgrep | kill`, or kill a PID just because its argv matches.
If ownership cannot be established, report the PIDs to the developer instead.
Re-check all PIDs and ports before restarting.
