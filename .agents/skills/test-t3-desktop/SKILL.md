---
name: test-t3-desktop
description: Test desktop-only Electron behaviour that T3's Browser panel cannot reach, and capture real-app screenshots of Electron windows. Use test-t3-app for ordinary UI and test-t3-mobile for native mobile.
---

# Test T3 desktop

Use this for global shortcuts, extra BrowserWindows, tray/menu behaviour,
native focus, and IPC between windows. Use [test-t3-app](../test-t3-app/SKILL.md)
for ordinary UI and [test-t3-mobile](../test-t3-mobile/SKILL.md) for native mobile.

## Prepare the session

Get authorization before launching or driving the desktop app. Warn the developer
before showing windows: this is their real screen and every focus steals their
keyboard. Keep shows brief and hide test windows when done. Subagents do not
launch dev servers; leave runtime verification to the primary agent.

Run only **one dev instance per worktree**. Reuse this task's healthy instance;
main-process rebuilds restart Electron automatically. Never start a second one.
With the instance stopped, run `vp run migrate-dev-db` from the repository root
to seed real data into the worktree's gitignored `.t3`. Never run against
`~/.t3/userdata`, or set `VITE_HTTP_URL` or `VITE_WS_URL`.

Pre-set client feature flags before launch by merging a JSON object of setting
keys into `.t3/userdata/client-settings.json`, for example
`{"quickMessageEnabled": true}`. Preserve existing keys and restore changes at
teardown. Seeded projects point at real checkouts: test up to the handoff, never
send a real agent turn unless the developer agrees.

## Drive Electron

Read [references/electron-session.md](references/electron-session.md) for startup,
the in-process hook, real pointer/key input, window inspection, and capture.
Start with `vp run dev:desktop` at the repository root, record the spawned PID
with `echo $! > <pidfile>`, and read actual ports from `[dev-runner]` output.

Use the hook first. Do not send the developer to System Settings: `osascript`
keystrokes and `screencapture` failed even after granting T3 Code (Beta)
Accessibility (recent macOS: Privacy & Security → Device Control and Data Access)
and Screen & System Audio Recording. macOS can attribute requests to a different
process in the agent chain, such as the intervening `claude` CLI binary.

## Capture and clean up

Read [references/evidence.md](references/evidence.md) when preparing PR images.
Crop to the window under test and inspect for private seeded data before upload.
Re-check suspicious focus/blur behaviour with the developer idle before changing
product code: their typing can land in the panel and their clicks can hide it.

Restore theme and test settings, hide test windows, then stop only your recorded
process tree with `bash .agents/skills/test-t3-desktop/scripts/stop-dev.sh <pidfile>`.
Verify every captured PID is gone and every recorded port is free with
`lsof -nP -iTCP:<port> -sTCP:LISTEN`. Read the session reference's recovery section
if runners survive; a successful-looking `kill` is insufficient.
