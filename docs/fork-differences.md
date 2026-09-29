# Fork differences

This repository is a fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code). This page
lists what the fork adds or changes, so each difference can be found, kept working across upstream
syncs, or offered back upstream. Everything not listed here matches upstream.

Remotes: `origin` is this fork, `upstream` is `pingdotgg/t3code`. Upstream is merged in periodically
(`t3code/sync-upstream-*` branches). To see the fork-only commits:

```bash
git fetch upstream
git log --oneline --no-merges upstream/main..HEAD
```

Agents update this page in the same change that adds, changes, or removes a difference. The rule
is in [AGENTS.md](../AGENTS.md#fork-differences).

## Devin provider

Adds Devin as a provider, driven through the local `devin` CLI's ACP server (`devin acp`).

- Sessions, steering, interrupts, permission requests, and form-mode elicitations run over the
  shared ACP runtime. T3 runtime modes map onto Devin's session modes.
- Models come from `devin models list`. Devin encodes effort, speed, and context in each model id,
  so the catalog groups variants into one picker row per model with effort/speed/context options.
  Fusion is one row: lead and sidekick are chosen by model family, lead effort is the one Devin
  advertises for that lead, and sidekick effort is selectable.
- T3's MCP endpoint, `devin skills list` (`$skill` dispatch), token usage, and pricing are wired
  in, so the context meter and the usage page cover Devin. The page can export the current window
  as CSV. Conversation rewind is not supported. Usage prefers the CLI's `sessions.db`, which
  includes sessions run outside T3. When that history is missing, T3 falls back to its own event
  logs for sessions it drove. A `cog_...` service key with `ViewOrgConsumption` and `DEVIN_ORG_ID`
  can show organization ACUs in a separate section; those are not mixed into token-cost estimates.
- Devin also generates commit messages, PR content, branch names, and thread titles.
- The welcome wizard lists Devin with an **Enable** action, since the provider is opt-in.

Code: `apps/server/src/provider/**/Devin*`, `apps/server/src/provider/devinModelCatalog.ts`,
`apps/server/src/textGeneration/DevinTextGeneration.ts`, `apps/server/src/usage/devinAccountUsage.ts`,
`apps/server/src/usage/devinUsageReader.ts`, `apps/web/src/components/usage/usageExport.ts`, and
`DevinSettings` in `packages/contracts/src/settings.ts`. User guides:
[providers-devin.md](./user/providers-devin.md) and [usage.md](./user/usage.md).

## Provider sign-in methods

Each provider's **Settings > Providers** card gets a sign-in section with a method picker: the
provider's CLI login flow, saved credentials, or a pasted key. The chosen method is persisted.
Codex defaults to the browser flow.

An added instance with a blank home gets a private directory under T3's data (`provider-homes`),
so a second login does not replace the default. The default instance keeps the CLI's normal home.
Cursor ignores `CURSOR_CONFIG_DIR` for its login, so its private home is a shadow `HOME`:
`.cursor` (and `.config/cursor` on Linux) stays private, and everything else is symlinked back to
the real home. Devin and OpenCode use `XDG_DATA_HOME`. Cursor usage reads each instance's own CLI
login; the same account still counts once.

Code: `apps/web/src/components/settings/ProviderAuthSection.tsx`,
`apps/server/src/provider/Services/ProviderAuthService.ts`,
`apps/server/src/provider/ProviderInstanceEnvironment.ts`,
`apps/server/src/provider/Drivers/CursorHome.ts`, and
`packages/contracts/src/providerSetup.ts`. User guides:
[providers-cursor.md](./user/providers-cursor.md), [providers-devin.md](./user/providers-devin.md),
and [providers-opencode.md](./user/providers-opencode.md).

## Provider account picker

When more than one enabled instance of a provider can serve the thread, the composer has an
account picker separate from the model picker. The model list stays one row per provider and
model. Codex only offers instances that share the thread's home. After the first message, an
account that can no longer be switched stays visible as a label. This is web and desktop.

Code: `apps/web/src/components/chat/ProviderAccountPicker.tsx` and
`apps/web/src/components/chat/providerAccountSelection.ts`. User guide:
[providers-codex.md](./user/providers-codex.md#switch-accounts-in-an-existing-thread).

## Chat tabs

A thread can have several chat tabs that share one workspace (same checkout and worktree). Each tab
is its own conversation and provider.

- **Storage.** Every tab is a normal thread. Tab membership lives in the fork-owned
  `fork_thread_tabs` table, created by `ensureThreadTabsSchema` in
  `apps/server/src/threadTabs/schema.ts`. It is versioned in a separate `fork_schema_migrations`
  table so upstream's numbered migrations are never touched.
- **Server.** `apps/server/src/threadTabs/http.ts` serves the `threadTabs` HTTP group: list a
  group, list all memberships, create a tab, and summarize sibling tabs. Checkpointing lets tab
  siblings share a worktree (`sharedWorkspace.ts`, `CheckpointReactor.ts`).
- **Settlement.** The group shows as one sidebar row, so it settles as a unit while upstream's
  settle commands and auto-settle policy stay per thread. `settlement.ts` mirrors them: a turn or
  unsettle in any tab wakes the group, and a settle in any tab settles the rest. A settle is undone
  while another tab is working, or, for an automatic settle, while another tab has an open pull
  request.
- **Sidebars.** By default child tabs are hidden from the web sidebar, the legacy project sidebar,
  and both mobile thread lists (`useHiddenTabThreads`). The group's row stays highlighted while any
  of its tabs is open, and opening it returns to the tab last left open
  (`apps/web/src/threadTabRecencyStore.ts`). On web and desktop, **Settings → General → Show tabs
  in sidebar** — also the sidebar button, the command palette, and `Cmd+Option+T` on macOS or
  `Ctrl+Alt+T` on Windows and Linux — lists each tab under that row. The row's hover actions add a
  **+** that opens a new tab, and each listed tab has a hover **×** that closes it.
- **Menus.** The thread right-click menu in both sidebars and the header's thread menu offer
  **New tab**. The sidebar's menu also offers **Close tab** on a thread that has a sibling tab.
  Closing archives the tab's thread and lands on its neighbour (`useThreadTabActions` in
  `apps/web/src/components/chat/ThreadTabs.tsx`).
- **Web header.** The breadcrumb reads `project / thread / tab`. The thread crumb keeps the thread
  action menu and acts on the original thread. The tab crumb switches, creates, and closes tabs. A
  chat with one tab shows a **New tab** button instead of repeating the title. A tab can also be
  closed from the hover control on its menu row (`apps/web/src/components/chat/ThreadTabs.tsx`,
  `ChatHeader.tsx`).
- **Context from other tabs.** Type `@` in the composer and pick a sibling tab, or, before the
  first message, click one under **Include context from**. Either path inserts a `thread-tab`
  context chip at the caret, which can be moved like any other chip. The kind lives in
  `packages/contracts/src/composerContext.ts` and is formatted for providers in
  `packages/shared/src/composerContextReferences.ts`. The summary covers the recent conversation,
  tools, reasoning, errors, changed files, and the latest plan (`apps/server/src/threadTabs/summary.ts`).
  It is captured when chosen, so later changes in that chat do not change it.
- **Fork from a message.** On web and desktop, a user message's hover actions include **Fork into
  new tab**. It opens a new tab whose draft holds a `thread-tab` chip summarizing the chat before
  that message (`beforeMessageId` on the handoff request), then the message's text and attachments,
  so it can be resent with another model or provider (`forkThreadTab` in `ThreadTabs.tsx`).
- **Mobile.** A switcher menu switches, creates, and closes tabs
  (`apps/mobile/src/features/threads/ThreadTabs.tsx`). An empty tab can attach sibling context when
  sending. Mobile does not have the header crumb, the `@` chip, forking, or the sidebar tab list.

User guide: [thread-sidebar.md](./user/thread-sidebar.md#continue-in-another-tab).

## View an open pull request

The git toolbar's primary action becomes **View PR** when the branch already has an open pull
request, on web and mobile. On web and desktop, **Settings → General → Open pull requests in**
chooses the side panel (the default) or the browser. The other destination stays in the actions
menu.

Code: `packages/client-runtime/src/state/gitActions.ts`,
`apps/web/src/components/GitActionsControl.tsx`, and `pullRequestOpenTarget` in
`packages/contracts/src/settings.ts`.

## Worktree cleanup ignored names

Automatic worktree cleanup still refuses to delete a checkout that has uncommitted work.
Regenerable caches such as `node_modules`, virtualenvs, and `__pycache__` no longer count as that
work. **Settings → Storage → Ignored names that do not block cleanup** adds more file and directory
names, applied to every project on that machine. **Suggest from projects** asks the selected model,
or the environment's text-generation model when that control is off, to propose ignored directories
that appear in more than one project. Credential paths such as `.env` and `.ssh` stay blocking.

Code: `apps/server/src/storageCleanup.ts` and
`apps/web/src/components/settings/StorageSettings.tsx`. User guide:
[project-settings.md](./user/project-settings.md#storage-cleanup).

## Worktree branch prefix

Generated worktree branch names use a configurable prefix instead of a fixed `t3code/`.
**Settings → General → Branch prefix** takes any namespace, or none, and projects can override it.
The short-lived `t3code/<id>` placeholder branch a worktree starts on is unchanged.

Code: `buildGeneratedWorktreeBranchName` in `packages/shared/src/git.ts` and `worktreeBranchPrefix`
in `packages/contracts/src/settings.ts`. User guide:
[project-settings.md](./user/project-settings.md#defaults-and-inheritance).

## Sidebar resource pill

The sidebar titlebar shows how much memory T3 uses on the primary environment's machine. That
covers the server, provider and terminal processes, and on desktop the Electron processes. Clicking
the pill opens a process tree with per-process CPU and memory, plus a link to Settings >
Diagnostics. The pill is hidden when the resource monitor has no sample and when the sidebar is
narrow. This is web and desktop.

The pill polls `server.getResourceUsage`, which reads the monitor's background history, so an
always-visible pill does not raise the sampling rate. The popover holds the live
resource-telemetry stream only while it is open.

Code: `apps/web/src/components/sidebar/SidebarResourcePill.tsx` and `readUsage` in
`apps/server/src/resourceTelemetry/ResourceTelemetry.ts`.

## Conductor workspace settings

New worktrees honor a repository's Conductor (`conductor.build`) settings from the project
checkout: gitignored Files to copy (`.worktreeinclude`, `file_include_globs`, default `.env*`),
`scripts.setup` as the setup script when the project has no setup action of its own, and
`scripts.archive` before a worktree is removed. Scripts get Conductor's `CONDUCTOR_*` variables and
`environment_variables`; `CONDUCTOR_PORT` is derived from the worktree path. Conductor run scripts
are not supported yet. This runs on the server, so every client gets it. On web and desktop, the
project's **Conductor** settings section edits the setup and archive scripts, Files to copy, and
environment variables in `settings.local.toml` or `settings.toml`.

Code: `packages/shared/src/conductorSettings.ts`, `apps/server/src/project/ConductorWorkspace.ts`
(called from `ProjectSetupScriptRunner.ts` and `GitWorkflowService.removeWorktree`), and
`apps/web/src/components/settings/ConductorSettings.tsx`. User guide:
[project-settings.md](./user/project-settings.md#repositories-set-up-for-conductor).

## Desktop mock-update loop

A `Makefile` at the repository root drives a local auto-update test loop for the desktop app:
create a trusted self-signed certificate once, build signed mock-feed payloads, serve the feed, and
install the first build into `/Applications`. `T3CODE_DESKTOP_IDENTITY` makes
`scripts/build-desktop-artifact.ts` sign with any keychain identity, because the updater refuses to
install ad hoc–signed builds. Run `make` targets from the repository root, starting with
`make update-cert`.

## Keeping this page current

Update this page in the same change that adds, changes, or removes a user-visible fork-only
behavior. Rewrite the affected section so it describes the behavior as it is now. Link the code,
and the user guide when one exists. Do not append a changelog entry or describe the implementation
line by line.

Remove a section when upstream adopts the change or the fork drops it. An upstream sync includes
this check. A bugfix or refactor that leaves the described behavior the same does not need an
entry.

`README.md` only points here. Do not add a second feature list there.
