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

## Custom file applications

Settings → Integrations → Open in can add, edit, and remove applications for one environment,
choose a default for chat file links, and override it by file extension. Custom applications
appear in the workspace Open in picker and file Open with menus. Commands run on the environment
hosting the file. Remote workspace menus offer custom applications on that host alongside
editors that support SSH links.

See [the user guide](user/composer.md#opening-file-links),
[settings](../apps/web/src/components/settings/OpenInSettings.tsx), and
[launcher](../apps/server/src/process/externalLauncher.ts).

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
model. Codex only switches in place between instances that share the thread's home. After the
first message on a server thread, other accounts stay listed and are marked **New tab**; choosing
one forks the chat into a new tab on that account (see [Chat tabs](#chat-tabs)). Where forking is
unavailable, an account that can no longer be switched stays visible as a label. This is web and
desktop.

Code: `apps/web/src/components/chat/ProviderAccountPicker.tsx` and
`apps/web/src/components/chat/providerAccountSelection.ts`. User guide:
[providers-codex.md](./user/providers-codex.md#switch-accounts-in-an-existing-thread).

## Cursor subagents in Agents

Cursor subagents show up in the Agents panel and the conversation's agent launch row, like
Claude's. Upstream never asks Cursor for subagent updates, so Cursor threads leave Agents empty.
The server opts in with `clientCapabilities._meta.subagents` and maps Cursor's
`subagent_spawned`, `subagent_state_update`, and child-session updates onto `task.*` events.
`effect-acp` delivers `session/update` kinds its schema does not define as extension
notifications instead of closing the connection.

Code: `apps/server/src/provider/acp/CursorSubagents.ts`, the subagent handlers in
`apps/server/src/provider/Layers/CursorAdapter.ts`, and `isUnknownSessionUpdate` in
`packages/effect-acp/src/protocol.ts`. User guide:
[providers-cursor.md](./user/providers-cursor.md#subagents).

## Agents panel drilldowns

The Agents panel has search, a status filter, sorting, compact rows that show a working agent's
latest tool call, and hover previews of each agent. Each agent opens a detail view with
its launch prompt, full result or error, searchable and filterable tool calls or an on-demand
transcript, and a usage footer. On web and desktop, **Open in new tab** keeps an agent in its own
thread-scoped sidebar tab alongside the fleet and other agents. Agent tabs can be closed and
reopened from the detail view, and are restored when the app restarts.
Upstream's panel is a fixed list with one summary line per agent. To feed it:

- Adapters put the launch prompt on `task.started` (`prompt`) and emit a subagent's own tool calls
  as `item.*` events tagged with `agentId`, as Claude already did upstream. Codex, Cursor,
  OpenCode, and Devin do this in the fork.
- OpenCode child sessions, Grok subagents, and Devin subagents join the panel at all; upstream
  shows none of them. Devin reports subagents inside the root ACP session as `_meta` markers on
  tool call notifications (`cognition.ai/subagent_started`, `subagent_completed`, and
  `subagent_context` on the child's calls); `DevinSubagents.ts` maps them onto `task.*` events.
- `orchestration.getSubagentTranscript` reads a subagent's history through the adapter's
  `readSubagentTranscript` (Claude, Codex, OpenCode), only while the session is running.

Code: `apps/web/src/components/AgentsPanel.tsx`, `AgentDetailView.tsx`,
`apps/web/src/rightPanelStore.ts`, `packages/client-runtime/src/state/agentPanelView.ts`,
`apps/server/src/provider/acp/DevinSubagents.ts`, and `apps/server/src/provider/subagentTranscript.ts`. User guide:
[thread-sidebar.md](./user/thread-sidebar.md#inspect-agent-work).

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
  (`apps/web/src/threadTabRecencyStore.ts`). With tabs hidden on web and desktop, the row shows
  that tab’s title, model, and details (`apps/web/src/components/Sidebar.tsx`). On web and desktop, **Settings → General → Show tabs
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
  first message, click one under **Include context from** (hovering one previews its summary).
  Either path inserts a `thread-tab`
  context chip at the caret, which can be moved like any other chip. The kind lives in
  `packages/contracts/src/composerContext.ts` and is formatted for providers in
  `packages/shared/src/composerContextReferences.ts`. The summary covers the recent conversation,
  tools, reasoning, errors, changed files, and the latest plan (`apps/server/src/threadTabs/summary.ts`).
  It is captured when chosen (or when first previewed), so later changes in that chat do not
  change it.
- **Forking.** On web and desktop, a started chat can fork into a new tab (`forkThreadTab` in
  `ThreadTabs.tsx`). The new tab's draft starts with a `thread-tab` summary chip.
  - A user message's hover actions include **Fork into new tab**. The summary stops before that
    message (`beforeMessageId` on the handoff request), and the message's text and attachments
    follow it.
  - A completed agent response has the same fork action. Its summary includes that response
    (`afterMessageId` on the handoff request); the new draft holds only the summary attachment,
    ready for a follow-up.
  - Each model picker row has a hover fork button. The new tab runs that model, the whole chat is
    summarized, and the current draft (text, attachments, and context chips) is copied after it.
    Other providers, and models the provider cannot switch to mid-chat, stay listed instead of
    being hidden. Their rows show a not-allowed cursor and a tooltip, and only the fork button
    opens them, so a stray click never forks (`matchesModelPickerLock` in `ModelPickerContent.tsx`).
  - The account picker forks the same way when the chosen account cannot take over the tab.
- **Mobile.** A switcher menu switches, creates, and closes tabs
  (`apps/mobile/src/features/threads/ThreadTabs.tsx`). An empty tab can attach sibling context when
  sending. Mobile does not have the header crumb, the `@` chip, forking, or the sidebar tab list.

User guide: [thread-sidebar.md](./user/thread-sidebar.md#continue-in-another-tab).

## View an open pull request

The git toolbar's primary action becomes **View PR** when the branch already has an open pull
request, on web and mobile. On web and desktop, **Settings → General → Open pull requests in**
chooses the side panel (the default) or the browser. The other destination stays in the actions
menu. The browser is whichever one **Open links in** picks (see below).

Code: `packages/client-runtime/src/state/gitActions.ts`,
`apps/web/src/components/GitActionsControl.tsx`, and `pullRequestOpenTarget` in
`packages/contracts/src/settings.ts`.

## Pull request host links follow Open links in

Upstream's pull request panel always sends its links to the system browser. In the fork, those
links follow **Settings → Integrations → Browser → Open links in** when the panel is next to a
thread. That covers "Open on GitHub", the PR number, the repository name, author profiles, comment
timestamps, activity links, attachments, and the "Open on GitHub" button on the load-error
screen. Cmd/Ctrl-click still opens the system browser. The pull requests page has no thread, so
its links still open in the system browser.

Code: `useLinkClickHandler` in `apps/web/src/browser/useOpenLink.ts` and
`apps/web/src/components/pullRequest/PullRequestMarkdownContext.ts`.

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
The name is generated while the worktree is checked out, so the agent and setup script start on
the final branch; upstream renames the `t3code/<id>` placeholder after the first turn has started.
The placeholder remains only when naming outlasts checkout by more than a few seconds.

Code: `generateWorktreeBranchName` in `apps/server/src/git/worktreeBranchName.ts`, its bootstrap
call in `apps/server/src/ws.ts`, and `worktreeBranchPrefix` in `packages/contracts/src/settings.ts`. User guide:
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

## Diagnostics settings tab

Diagnostics has its own entry in the settings sidebar, between Connections and Archive. Upstream
only reaches it from the View diagnostics button in General. This is web and desktop.

Code: `SETTINGS_SECTION_LABELS` in `apps/web/src/components/settings/settingsSearch.ts` and
`SETTINGS_SECTION_ICONS` in `apps/web/src/components/settings/SettingsSidebarNav.tsx`.

## Conductor workspace settings

New worktrees honor a repository's Conductor (`conductor.build`) settings from the project
checkout: gitignored Files to copy (`.worktreeinclude`, `file_include_globs`, default `.env*`),
`scripts.setup` as the setup script when the project has no setup action of its own, and
`scripts.archive` before a worktree is removed, by the user or by storage cleanup. Scripts get
Conductor's `CONDUCTOR_*` variables and `environment_variables`; `CONDUCTOR_PORT` is derived from
the worktree path. This runs on the server, so every client gets it.

Run scripts (`scripts.run`) show in the chat header's actions menu on web and desktop, where the
default one is the header's Run button when the project has no actions of its own, and in the
thread's terminal menu on mobile. Each runs in its own terminal and toggles to Stop while running;
`run_mode = "nonconcurrent"` applies within a thread. The project's **Conductor** settings section
(web, desktop, and mobile's project overview) edits the setup and archive scripts, Files to copy,
and environment variables in `settings.local.toml` or `settings.toml`.

Code: `packages/shared/src/conductorSettings.ts` and `conductorSettingsEditor.ts`,
`packages/client-runtime/src/conductorRunScripts.ts`, `apps/server/src/project/ConductorWorkspace.ts`
(called from `ProjectSetupScriptRunner.ts`, `GitWorkflowService.removeWorktree`, and
`storageCleanup.ts`), `apps/web/src/components/settings/ConductorSettings.tsx`, the run button in
`apps/web/src/components/ProjectScriptsControl.tsx`, and on mobile
`apps/mobile/src/features/settings/components/SettingsConductorSection.tsx` and the terminal menu in
`apps/mobile/src/features/threads/ThreadGitControls.tsx`. User guide:
[project-settings.md](./user/project-settings.md#repositories-set-up-for-conductor).

## Linear integration

**Settings > Integrations > Linear** connects a Linear account to the environment with OAuth
(PKCE, read-only scope, no client secret). The server holds the credential and refreshes it, so
every client of that environment can use it. The browser's redirect lands on a loopback listener
on fixed port 47831, which must match the redirect URI registered on the fork's Linear OAuth app.
When the browser is on another device, the user pastes the redirect URL back instead.
`T3CODE_LINEAR_CLIENT_ID` points a fork at its own Linear app.

Issues attach to messages as a `linear-issue` context chip: from the composer's attach menu (which
now asks between files and a Linear issue), the `#` menu beside pull requests, the command palette,
and the mobile attach menu. The web picker filters by assignee, team, project, milestone, status,
priority, and label, and sorts by the fields Linear's API offers. The server renders the issue to
capped markdown when it is attached, and that snapshot is inlined into the prompt for every
provider. An **Open Linear links in** setting can send issue links to the Linear desktop app
(`linear://`), which the desktop shell's external-URL allowlist permits.

Code: `apps/server/src/linear/`, `packages/contracts/src/linear.ts`, `LinearIssueContextRecord` in
`packages/contracts/src/composerContext.ts`, `packages/client-runtime/src/state/linear.ts`,
`apps/web/src/components/settings/LinearSettings.tsx`,
`apps/web/src/components/chat/LinearIssuePicker.tsx`,
`apps/web/src/components/chat/ComposerAttachMenu.tsx`,
`apps/web/src/components/chat/useComposerLinearIssueItems.ts`,
`apps/web/src/components/chat/LinearIssueFilters.tsx`,
`apps/mobile/src/components/LinearIssuePickerSheet.tsx`, and
`apps/mobile/src/features/settings/SettingsLinearRouteScreen.tsx`. User guide:
[linear.md](./user/linear.md).

## Start a thread from a pull request, branch, or issue

On web and desktop, a new thread's composer has a **⋯** button in its top-right corner. It opens a
picker with PRs, Branches, and Issues tabs. The same picker opens from the command palette and from
`chat.startFrom` (`mod+shift+b`); both of those start a new thread first. The PRs tab filters and
sorts with the pull requests page's filter menu, and the Issues tab with the Linear attach picker's
filter bar, whose view it shares.

- A pull request goes through upstream's pull request checkout dialog, which offers the current
  checkout or a new worktree.
- A branch is worked on where it is already checked out. Any other branch becomes the base of a new
  worktree.
- An issue is attached as a Linear context chip (see [Linear integration](#linear-integration)).
  Only Linear issues are offered.

A pull request or branch that a live thread is already on is marked **In use**. Picking it asks
whether to open that thread or start a second one. The default branch never counts as in use.
Hovering a row previews it: a pull request's description, a branch's full name and where it would
run (both listing threads already on it), or the issue snapshot an attached chip would carry.
Mobile does not have the picker.

Code: `apps/web/src/components/chat/StartFromPicker.tsx`, `StartFromPicker.logic.ts` and
`StartFromPreviews.tsx`, the button
in `ChatComposer.tsx`, and `chat.startFrom` in `packages/contracts/src/keybindings.ts`. User guide:
[source-control.md](./user/source-control.md#start-a-thread-from-a-pull-request-branch-or-issue).

## Create a thread before writing its first message

On web and desktop, a new thread's empty composer shows **Create worktree** (or **Create thread**
in Local mode) in place of the send arrow; Enter does the same. It creates the thread, prepares the
worktree, and runs the setup script without starting a turn, then opens the thread with an empty
composer so context can be added first. The first real message starts the turn and names the thread
and branch. Chat tabs already share a workspace, so they never offer it. A selection of several
models, or a server without the `deferredBootstrapTurn` capability, keeps the plain send arrow.
Mobile does not offer it.

Code: `bootstrap.deferTurn` in `packages/contracts/src/orchestration.ts`, handled by
`dispatchBootstrapTurnStart` in `apps/server/src/ws.ts`; `createThreadWithoutMessage` in
`apps/web/src/components/ChatView.tsx` and the pill in `ComposerPrimaryActions.tsx`. User guide:
[thread-sidebar.md](./user/thread-sidebar.md#start-a-thread).

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
