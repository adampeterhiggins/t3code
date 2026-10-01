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
appear in the workspace Open in picker and file Open with menus, and can run through the user's
interactive login shell so shell functions and aliases work. The workspace Open button can be
pinned to any application instead of following the last-used pick. Commands run on the
environment hosting the file. Remote workspace menus offer custom applications on that host
alongside editors that support SSH links.

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

## Custom ACP provider

**Settings → Providers → Add provider → Custom ACP** runs any stdio Agent Client Protocol agent
from an executable and arguments, with credentials in the instance's environment variables. Each
added instance is one agent; there is no default instance.

- The health check opens a short ACP session and lists what the agent advertises: its models
  (the `model` config option, else session models), its other config options as model options,
  and the plan toggle only when it has a plan mode. Slash commands come from its session updates.
- Turns run over the shared ACP runtime. Approvals follow the permission mode and answer with
  the agent's own option ids; form elicitations become questions. T3's MCP endpoint is offered
  only to agents that accept HTTP MCP servers. Resume falls back to a fresh session when the
  agent cannot load the old one.
- No sign-in flow, updates, text generation, rewind, or usage accounting.

Code: `apps/server/src/provider/**/CustomAcp*`, `apps/server/src/provider/acp/AcpCommandCatalog.ts`,
and `CustomAcpSettings` in `packages/contracts/src/settings.ts`. User guide:
[providers-custom-acp.md](./user/providers-custom-acp.md).

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
transcript, and a usage footer. Tool previews include bounded unified edit diffs and line counts,
read ranges, search arguments, working directories, and exit codes when the provider supplies them.
The same details appear in chat tool expansions on web, desktop, and mobile. On web and desktop,
right-click an agent in the list and choose **Open in new tab**, or use the same action in its
detail view, to keep it in its own thread-scoped sidebar tab alongside the fleet and other agents.
Agent tabs can be closed and reopened the same way, and are restored when the app restarts.
Upstream's panel is a fixed list with one summary line per agent. To feed it:

- Adapters put the launch prompt on `task.started` (`prompt`) and emit a subagent's own tool calls
  as `item.*` events tagged with `agentId`, as Claude already did upstream. Codex, Cursor,
  OpenCode, and Devin do this in the fork.
- OpenCode child sessions, Grok subagents, and Devin subagents join the panel at all; upstream
  shows none of them. Devin reports subagents inside the root ACP session as `_meta` markers on
  tool call notifications (`cognition.ai/subagent_started`, `subagent_completed`, and
  `subagent_context` on the child's calls); `DevinSubagents.ts` maps them onto `task.*` events.
- `orchestration.getSubagentTranscript` reads a subagent's history through the adapter's
  `readSubagentTranscript` (Claude, Codex, OpenCode) while the session is running.
  ProviderService keeps the last bounded read per agent in the fork-owned
  `fork_subagent_transcripts` table, captured on `task.completed` and on every live read, and
  serves it with `retainedAt` once the provider can no longer answer.
- **Attach result to chat** (detail view and list right-click) pastes the agent's task and
  result into the composer; `subagentResultChatContext` builds the text.
- **Continue in chat** (detail view and list right-click) opens a new chat tab of the thread whose
  draft carries the agent's task, result or error, and latest tool calls as a chat-summary chip;
  `subagentContinuationContext` builds the text. It starts a fresh conversation rather than
  resuming the agent's provider session.

Code: `apps/web/src/components/AgentsPanel.tsx`, `AgentDetailView.tsx`,
`apps/web/src/rightPanelStore.ts`, `packages/client-runtime/src/state/agentPanelView.ts`,
`apps/server/src/provider/acp/DevinSubagents.ts`, `apps/server/src/provider/subagentTranscript.ts`,
and `apps/server/src/provider/SubagentTranscriptStore.ts`. User guide:
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
  that tab’s title, model, and details (`apps/web/src/components/Sidebar.tsx`). On web and desktop, **Settings → General → Tabs in
  sidebar**, the sidebar header's tabs button (click to toggle, right-click for a menu;
  `sidebar/SidebarTabsMenu.tsx`), the command palette,
  and `Cmd+Option+T` on macOS or `Ctrl+Alt+T` on Windows and Linux list each tab under that row:
  all of them, or up to a chosen number with the rest behind a **more** row that keeps the open tab
  listed. **Sort tabs by** orders them by latest response, creation, or last opened, either way, or
  manually by dragging, which switches to Manual. Manual order is client-local, because the
  server's tab positions also pick the group's row. The row's tab count opens or folds just that
  group; those choices stay in the browser and reset when the setting changes. The row's hover
  actions add a **+** that opens a new tab, and each listed tab has a hover **×** that closes it.
- **Menus.** The thread right-click menu in both sidebars and the header's thread menu offer
  **New tab**. The sidebar's menu also offers **Close tab** on a thread that has a sibling tab.
  Closing archives the tab's thread and lands on its neighbour (`useThreadTabActions` in
  `apps/web/src/components/chat/ThreadTabs.tsx`).
- **Web header.** The breadcrumb reads `project / thread / tab`. The thread crumb keeps the thread
  action menu and acts on the original thread. The tab crumb switches, creates, and closes tabs. A
  chat with one tab shows a **New tab** button instead of repeating the title. A tab can also be
  closed from the hover control on its menu row (`apps/web/src/components/chat/ThreadTabs.tsx`,
  `ChatHeader.tsx`).
- **Right panel.** Each tab keeps its own right-panel surfaces, but the panel stays open or closed
  as you move between tabs, including new, forked, and closed-into tabs
  (`useRightPanelFollowsTabSwitch` in `ThreadTabs.tsx`).
- **Context from other chats.** Type `@` in the composer and pick a sibling tab, or, before the
  first message, click one under **Include context from** (hovering one previews its summary).
  The `@` menu also lists other unarchived threads in the environment, matched by title
  (`apps/web/src/components/chat/composerThreadReferences.ts`), and works in a new draft thread
  too. On web and desktop, **Attach → Thread** and **Attach thread** in the command palette open
  a searchable picker of those threads. A thread's tabs sit together behind a side rule, and
  searching a thread title finds its tabs too. Rows show the project, provider, status, and
  last activity as the sidebar does. It has project and provider filters
  and sorting by updated time, creation time, or title. Hovering a row previews how the chat
  started, the latest exchange, and changed files; attaching reuses that snapshot
  ([`ThreadAttachPicker.tsx`](../apps/web/src/components/chat/ThreadAttachPicker.tsx)). These paths insert a `thread-tab`
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
  sending. A started chat's **Hand off** menu forks it into a new tab on any provider's model, the
  same way as the web model picker's fork button. Mobile does not have the header crumb, the `@`
  chip, forking from a message, or the sidebar tab list.

User guide: [thread-sidebar.md](./user/thread-sidebar.md#continue-in-another-tab).

## Split view

On web and desktop, two chats can be shown side by side. Each pane is a full `ChatView` with its
own timeline, composer, right panel, and terminal.

- **State.** `apps/web/src/splitViewStore.ts` holds the pair of thread keys, in memory only. The
  split shows while the routed thread is one of the pair, and the routed thread is the focused
  pane, so the header, sidebar, command palette, and global shortcuts follow focus unchanged.
  Focusing a pane replaces the route. Panes are keyed by thread, so moving focus never remounts
  a timeline.
- **Focus.** Window-level shortcuts, paste-to-composer, digit answers, right-panel launcher
  letters, and composer focus grabs skip the unfocused pane (`useSplitPaneFocus` in
  `apps/web/src/components/chat/splitPane.ts`). Each pane uses CSS layout containment so its
  fixed title-bar controls stay inside it (`SplitChatPanes.tsx`).
- **Entry points.** The tab crumb menu's per-tab split button, **Open in split view** / **Close
  split view** in both sidebars' thread menus, the command palette, `splitView.toggle`
  (`mod+\`), and `splitView.focusOther` (`mod+alt+\`). Each pane header has a close button.
- **Mobile.** Not supported. Windows at or below the right-panel sheet breakpoint also show one
  chat.

User guide: [thread-sidebar.md](./user/thread-sidebar.md#view-two-chats-side-by-side).

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
call in `apps/server/src/orchestration/ClientCommandDispatcher.ts`, and `worktreeBranchPrefix` in `packages/contracts/src/settings.ts`. User guide:
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

## Sidebar back and forward buttons

The sidebar titlebar has back and forward buttons after the resource pill. They step through the
app's navigation history, the same as the `navigation.back` and `navigation.forward` shortcuts
(`Mod+[` and `Mod+]` by default). This is web and desktop. The mobile app uses its own navigation.

Code: `SidebarHistoryNavigation` in `apps/web/src/components/sidebar/SidebarChrome.tsx`.

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

## Claude subagent worktrees get the project setup

When a Claude subagent starts in a worktree of its own (`isolation: "worktree"`), the server
prepares that worktree the way it prepares a thread's: Files to copy, then the project's setup
script (the T3 setup action or Conductor's `scripts.setup`) with the Conductor variables and
`environment_variables`, in a `subagent-setup-<agent>` terminal on the parent thread. A non-async
script holds the subagent until it exits. Claude Code still creates and removes the worktree itself,
so no archive script runs. Only the Claude adapter does this.

Code: the `SubagentStart` hook in `apps/server/src/provider/Layers/ClaudeAdapter.ts` and
`apps/server/src/project/SubagentWorktreeSetup.ts`. User guide:
[project-settings.md](./user/project-settings.md#repositories-set-up-for-conductor).

## Linear integration

**Settings > Integrations > Linear** connects a Linear account to the environment with OAuth
(PKCE, read-only scope, no client secret). The server holds the credential and refreshes it, so
every client of that environment can use it. The browser's redirect lands on a loopback listener
on fixed port 47831, which must match the redirect URI registered on the fork's Linear OAuth app.
When the browser is on another device, the user pastes the redirect URL back instead.
`T3CODE_LINEAR_CLIENT_ID` points a fork at its own Linear app.

Issues attach to messages as a `linear-issue` context chip: from the composer's attach menu (which
now asks between files, a Linear issue, and a pull request), the `#` menu beside pull requests, the command palette,
and the mobile attach menu. The web picker filters by assignee, team, project, milestone, status,
priority, and label, and sorts by the fields Linear's API offers. The server renders the issue to
capped markdown when it is attached, and that snapshot is inlined into the prompt for every
provider. An **Open Linear links in** setting can send issue links to the Linear desktop app
(`linear://`), which the desktop shell's external-URL allowlist permits.

A thread's chat-tab group can also be linked to one issue, from the thread menu or the command
palette, and starting a thread from an issue links it. The link lives in the fork-owned
`fork_linear_thread_links` table, keyed by tab group, and streams to clients over
`linear.subscribeThreadLinks`. Only the issue's identity is stored; the chat header chip reads its
status live, and offers open, change, and unlink. Mobile shows the same chip beside the tab
switcher (`apps/mobile/src/features/threads/ThreadLinearLink.tsx`).

The attach menu's pull request option, also in the web command palette, opens a searchable picker
([`PullRequestAttachPicker.tsx`](../apps/web/src/components/chat/PullRequestAttachPicker.tsx)) and
inserts the same context chip as picking the pull request from the `#` menu. It is not a thread
link.

Code: `apps/server/src/linear/`, `packages/contracts/src/linear.ts`, `LinearIssueContextRecord` in
`packages/contracts/src/composerContext.ts`, `packages/client-runtime/src/state/linear.ts`,
`apps/web/src/components/settings/LinearSettings.tsx`,
`apps/web/src/components/chat/LinearIssuePicker.tsx`,
`apps/web/src/components/chat/ComposerAttachMenu.tsx`,
`apps/web/src/components/chat/useComposerLinearIssueItems.ts`,
`apps/web/src/components/chat/LinearIssueFilters.tsx`,
`apps/web/src/components/chat/LinearThreadLink.tsx`,
`apps/server/src/linear/LinearThreadLinks.ts`,
`apps/mobile/src/components/LinearIssuePickerSheet.tsx`, and
`apps/mobile/src/features/settings/SettingsLinearRouteScreen.tsx`. User guide:
[linear.md](./user/linear.md).

## GitHub issues

GitHub issues attach to messages as a `github-issue` context chip, the same way Linear issues do:
from the composer's attach menu, the `#` menu's **GitHub issues** tab, the web command palette, and
the mobile attach menu. They are offered for projects whose remote is on GitHub and read with the
environment's `gh` CLI, listing the repository the
project or worktree is checked out from; a number, `#123`, or issue URL is looked up directly. The
server renders the issue to capped markdown when it is attached: the description, then comments
newest first, dropping hidden (minimized), empty, "+1", and reaction-only comments and marking the
issue author's and maintainers' comments. That snapshot is inlined into the prompt for every
provider.

Starting a thread from a GitHub issue links it to the thread's chat-tab group, in the fork-owned
`fork_github_issue_thread_links` table, streamed over `githubIssues.subscribeThreadLinks`. A group
can hold one GitHub link beside its Linear link. The web chat header and the mobile tab switcher
show `#123` with its live open or closed state, and offer open and unlink. Pickers mark a linked
issue **In use**; the web attach picker's hover preview lists those threads and opens one on click.

Code: `apps/server/src/githubIssues/`, `packages/contracts/src/githubIssues.ts`,
`GitHubIssueContextRecord` in `packages/contracts/src/composerContext.ts`,
`packages/client-runtime/src/state/githubIssues.ts`,
`apps/web/src/components/chat/GitHubIssuePicker.tsx`,
`apps/web/src/components/chat/GitHubIssueThreadLink.tsx`,
`apps/mobile/src/components/GitHubIssuePickerSheet.tsx`, and
`apps/mobile/src/features/threads/ThreadGitHubIssueLink.tsx`. User guide:
[source-control.md](./user/source-control.md#attach-a-github-issue).

## Start a thread from a pull request, branch, or issue

On web and desktop, a new thread's composer has a **⋯** button in its top-right corner. It opens a
picker with PRs, Branches, Issues, and Linear tabs. The same picker opens from the command palette and from
`chat.startFrom` (`mod+shift+b`); both of those start a new thread first. The PRs tab filters and
sorts with the pull requests page's filter menu, the Issues tab lists the project's GitHub issues
by state, and the Linear tab uses the Linear attach picker's filter bar, whose view it shares.

- A pull request is checked out in a new worktree, or the worktree it is already checked out in,
  and the draft is pointed there. Upstream's checkout dialog, with its Local and Worktree choice,
  is skipped. A branch already checked out in the project's own checkout is refused.
- A branch is worked on where it is already checked out. Any other branch becomes the base of a new
  worktree.
- A GitHub or Linear issue is attached as a context chip and linked to the new thread (see
  [GitHub issues](#github-issues) and [Linear integration](#linear-integration)).

A pull request or branch that a live thread is already on, or an issue linked to a live thread,
is marked **In use**. Picking it asks whether to open that thread or start a second one. The
default branch never counts as in use. Hovering a row previews it: a pull request's description,
a branch's full name and where it would run (both listing threads already on it), or the issue
snapshot an attached chip would carry.

On mobile, a new thread's **⋯** button offers **Pull request**, **Linear issue**, and
**GitHub issue**, with the same
checkout, linking, and **In use** rules; the existing branch picker covers branches. The pull
request's worktree is checked out before the thread exists, so mobile does not run the project's
setup script in it. The issue is linked once the draft sends.

Code: `apps/web/src/components/chat/StartFromPicker.tsx`, `StartFromPicker.logic.ts` and
`StartFromPreviews.tsx`, `apps/mobile/src/features/threads/StartFromPullRequestSheet.tsx`, the
`startFrom` targets in `apps/mobile/src/components/LinearIssuePickerSheet.tsx` and
`GitHubIssuePickerSheet.tsx`, the button
in `ChatComposer.tsx`, and `chat.startFrom` in `packages/contracts/src/keybindings.ts`. User guide:
[source-control.md](./user/source-control.md#start-a-thread-from-a-pull-request-branch-or-issue).

## Link pull requests from a picker

**Link pull request**, from the linked pull requests panel or the command palette, opens a
multi-select picker instead of a URL field. It lists the project's pull requests with the start-from
picker's filters, puts the thread's branch first, and pins the thread's current links at the top
with their boxes checked. Pasting a URL or `#123` adds that pull request as a row. Nothing changes
until **Link** (or ⌘/Ctrl+Enter) applies every check and uncheck at once. An environment that holds
a single link keeps one row checked. See
[`LinkPullRequestDialog.tsx`](../apps/web/src/components/pullRequest/LinkPullRequestDialog.tsx) and
[Linked pull requests](user/source-control.md#linked-pull-requests).

## Watch a pull request

A linked pull request's row menu can **Watch and follow up**. The server re-reads a watched thread
when a linked pull request's snapshot syncs or its session changes. If the host reports failing
checks, requested changes, or merge conflicts the agent has not been asked about, and the thread is
idle, it starts a follow-up turn with instructions for that work. Each watch allows 3 follow-ups
until resumed, can be paused or stopped, and ends when the pull request merges or closes. The row
shows what the watch is waiting for.

Watches live in the fork-owned `fork_pull_request_watches` table, versioned in
`fork_schema_migrations`, and are served by the `pullRequestWatches` HTTP group. Code:
[`pullRequestWatch/`](../apps/server/src/pullRequestWatch/reactor.ts),
[`pullRequestWatch.ts`](../packages/shared/src/pullRequestWatch.ts) (when to follow up), and
[`ThreadPullRequestsPanel.tsx`](../apps/web/src/components/pullRequest/ThreadPullRequestsPanel.tsx).
Mobile has no controls yet. See [the user guide](user/source-control.md#watch-a-pull-request).

## Create a thread before writing its first message

On web and desktop, a new thread's empty composer shows **Create worktree** (or **Create thread**
in Local mode) in place of the send arrow; Enter does the same. It creates the thread, prepares the
worktree, and runs the setup script without starting a turn, then opens the thread with an empty
composer so context can be added first. The first real message starts the turn and names the thread
and branch. Chat tabs already share a workspace, so they never offer it. A selection of several
models, or a server without the `deferredBootstrapTurn` capability, keeps the plain send arrow.
Mobile does not offer it.

Code: `bootstrap.deferTurn` in `packages/contracts/src/orchestration.ts`, handled by
`dispatchBootstrapTurnStart` in `apps/server/src/orchestration/ClientCommandDispatcher.ts`; `createThreadWithoutMessage` in
`apps/web/src/components/ChatView.tsx` and the pill in `ComposerPrimaryActions.tsx`. User guide:
[thread-sidebar.md](./user/thread-sidebar.md#start-a-thread).

## Export a transcript

On web and desktop, **Export transcript…** in a thread's menu (sidebar row, sidebar tab row, chat
header) or the command palette opens a dialog that previews the thread as Markdown. A thread with
several chat tabs gets a tab picker, starting on the tab it was opened from. **Concise** keeps
the prompts and replies; **Full** adds the work log (tool calls, commands, file edits) and proposed
plans in time order. Reasoning is always left out. **Header** adds front matter with the project,
branch, provider, model, and dates. **Save…** writes a `.md` file on the device running the client:
the native save dialog on desktop, the browser's save picker in Chromium, and a download elsewhere.
**Copy** puts the same Markdown on the clipboard. The dialog loads the whole thread over HTTP, so it
works for threads that are not open. Mobile does not offer it.

Code: [`threadTranscript.ts`](../apps/web/src/lib/threadTranscript.ts),
[`TranscriptExportDialog.tsx`](../apps/web/src/components/TranscriptExportDialog.tsx), and
`saveTextFile` in [`window.ts`](../apps/desktop/src/ipc/methods/window.ts). User guide:
[thread-sidebar.md](./user/thread-sidebar.md#export-a-transcript).

## Import a CLI conversation

Upstream imports recent Claude Code and Codex history only in bulk, from the welcome wizard. The
fork adds a per-project picker on web and desktop: **Import conversation into …** in the command
palette, and **Import conversation…** in the legacy sidebar's project menu. `agentSessions.list`
returns the project's conversations from the last 30 days (newest 50, with first prompt, message
count, and dates), marking ones a live thread already resumes so the picker opens that thread
instead. `agentSessions.import` takes an optional `session` to import just one, from a fresh scan,
and returns its thread. The thread binds to the original session exactly like the wizard's import,
so the next turn resumes it. The server advertises the picker with the `agentSessionPicker`
capability. Cursor, Grok, OpenCode, Antigravity, Devin, and mobile have no import.

Code: `listProjectAgentSessions` in
[`AgentSessionImporter.ts`](../apps/server/src/project/AgentSessionImporter.ts), the
`recentThreads` options in [`AgentSessionScanner.ts`](../apps/server/src/project/AgentSessionScanner.ts),
and [`ImportConversationDialog.tsx`](../apps/web/src/components/ImportConversationDialog.tsx).
User guide: [thread-sidebar.md](./user/thread-sidebar.md#import-a-cli-conversation).

## Attach repositories as context

The composer's attach menu (and **Attach repository** in the web command palette) picks other
repositories to clone into the workspace's context folder, `.context/` by default, the way the
`ctxclone` shell tool does. The picker lists the default owner's GitHub repositories (via
`gh repo list`), most recently attached first. Typing `org/` lists another owner, and a pasted
`owner/repo` or clone URL also works. Rows for repositories already cloned into the thread's
workspace show their branch, ahead/behind, and changed-file count.

On web and desktop the composer's `#` menu also has a **Repositories** tab over the same list:
`#name` searches the default owner and `#owner/name` another one. `#owner/name`, and a hyphenated
name once a default owner is set, open that tab by default instead of pull requests.

A picked repository becomes a `repository` context chip. When the message sends, the server
clones what is missing before the turn starts. It leaves an existing clone of the same remote
alone (fetching only, so ahead/behind are current) and never overwrites a folder that belongs to
something else. On a new worktree this runs as a step of the setup card, before the setup script.
Otherwise it runs before the turn is recorded, with a work log row showing progress. Each record's clone outcome and git status are
written back onto the message. The chip shows them, and the agent's prompt includes them, so the
agent knows what is there. A failed clone is a warning and the agent still starts. The server adds
the folder to the repository's `info/exclude` so checkpoints and diffs ignore the clones. The
default owner and the folder are server settings in **Settings > General**. Mobile's attach menu
has the same picker, without the recently attached ranking.

Code: `apps/server/src/contextRepositories/ContextRepositories.ts`,
`packages/contracts/src/contextRepositories.ts`, `RepositoryContextRecord` in
`packages/contracts/src/composerContext.ts`, the context-repository step in `apps/server/src/orchestration/ClientCommandDispatcher.ts`,
the persisted-message restatement in `apps/server/src/orchestration/decider.ts`,
`packages/client-runtime/src/contextRepositories.ts`, and
`apps/web/src/components/chat/RepositoryAttachPicker.tsx`,
`apps/web/src/components/chat/useComposerRepositoryItems.ts`, and
`apps/mobile/src/components/RepositoryPickerSheet.tsx`. User guide:
[composer.md](./user/composer.md#attach-repositories).

## Pasted and typed links become chips

Pasting a Linear issue, GitHub issue, pull request, or GitHub repository root link into the web or
desktop composer, or typing one followed by whitespace, turns it into the chip its attach picker
makes. The text goes in as usual, then each link becomes a chip once its object loads. A link that
cannot be read, or that was edited away meanwhile, stays as text. Paste-as-text (`Cmd+Shift+V`)
skips it, and typing never retries a link the draft already converted or tried, so undo and a
deleted chip stick. Mobile does not convert links.

A bare link of one of those kinds that is still a link when the message renders, in any message on
web, desktop, or mobile, shows its short name instead of the URL: `owner/repo#162` for a pull
request or GitHub issue, `ENG-123` for a Linear issue, and `owner/repo` for a repository. It still
opens, previews, and copies as the full URL. Link text the writer chose is left alone.

Code: `packages/client-runtime/src/composerObjectLinks.ts`,
`apps/web/src/components/chat/useResolveComposerObjectLink.ts`, and `convertObjectLinks` in
`apps/web/src/components/chat/ChatComposer.tsx`. User guide:
[composer.md](./user/composer.md#context-in-your-message).

## Desktop mock-update loop

A `Makefile` at the repository root drives a local auto-update test loop for the desktop app:
create a trusted self-signed certificate once, build signed mock-feed payloads, serve the feed, and
install the first build into `/Applications`. `T3CODE_DESKTOP_IDENTITY` makes
`scripts/build-desktop-artifact.ts` sign with any keychain identity, because the updater refuses to
install ad hoc–signed builds. Run `make` targets from the repository root, starting with
`make update-cert`.

## Commands and file paths shown relative to the workspace

Tool calls in the web, desktop, and mobile timelines, and subagent tool calls in the web and
desktop Agents panel, show paths inside the thread's working directory as relative. For commands, a leading `cd` to that directory is dropped. Rewriting a
command stops at the first `cd` somewhere else, because relative paths after it would point
somewhere else. File, image, and other tool labels (`Read: src/index.ts`) get the same path
treatment. Paths outside the directory stay absolute, and approval prompts still show the exact
command. The shared runtime instructions also tell every provider that shell commands already
start in that directory.

Code: `packages/client-runtime/src/work-log/commandDisplay.ts`,
`packages/client-runtime/src/state/agentPanelView.ts`, and
`apps/server/src/provider/RuntimeInstructions.ts`.

## Agent access over MCP

Two more MCP servers serve agents outside T3 Code. `/mcp/query` gives read-only access to the
environment's history: projects, threads, turns, messages, activities, plans, turn diffs, linked
pull requests, and usage. Its tools page with cursors, take `since`/`until` bounds, and cap text.
`/mcp/operate` adds the thread and project tools listed under
[Agents start and drive threads](#agents-start-and-drive-threads), plus `respond_to_request` for
answering a thread's approvals and questions. It acts as the user without the spawn limits, and
threads it starts record the token's label.
Both authenticate with an environment bearer token, never a cookie: `/mcp/query` needs
`orchestration:read`, `/mcp/operate` also `orchestration:operate`.

Tokens come from **Settings → Connections → Agent access** (`POST /api/auth/agent-access-tokens`,
`access: "read" | "operate"`) or `t3 auth session issue --read-only` / `--operate`. Each token is a
normal client session, so revoking it works like revoking any client. Web and desktop only.

Code: `apps/server/src/mcp/query/`, the `agentAccessToken` handler in
`apps/server/src/auth/http.ts`, `AuthReadOnlyClientScopes` and `AuthAgentOperateScopes` in
`packages/contracts/src/auth.ts`, and `apps/web/src/components/settings/AgentAccessSettings.tsx`.
User guide: [agent-access.md](./user/agent-access.md).

## Agents start and drive threads

With **Agent thread control** on (off by default; environment setting with project overrides), a
thread's `t3-code` MCP server also lists the thread tools `create_thread`, `send_message`,
`wait_for_thread`, `interrupt_turn`, `update_thread`, `set_thread_state`, and `list_models`; the
project tools `create_project` and `update_project`; and the history tools `list_projects`,
`list_threads`, `get_thread`, `list_messages`, and `search`. Credentials without it never see them.
Web, desktop, and mobile settings all carry the toggle.

A thread's agent cannot give a thread it starts a runtime mode above its own, chains stop two
levels deep, a thread keeps at most five live children, and it cannot act on its own thread or
answer another thread's approvals or questions. A thread an agent starts records `createdBy`: the
chat header on web, desktop, and mobile names the starting thread (and opens it) or the agent
access token, and web sidebar rows mark it with a bot icon.

Code: `apps/server/src/mcp/toolkits/operate/`, `apps/server/src/mcp/McpActor.ts`,
`ThreadReadToolkit` in `apps/server/src/mcp/query/tools.ts`, `agentAccessCapabilities` in
`apps/server/src/provider/Layers/ProviderService.ts`, `ThreadCreatedBy` in
`packages/contracts/src/orchestration.ts`,
`apps/server/src/orchestration/ClientCommandDispatcher.ts`,
`apps/web/src/components/chat/StartedByChip.tsx`, and
`apps/mobile/src/features/threads/ThreadStartedByChip.tsx`. User guide:
[agent-access.md](./user/agent-access.md#let-agents-start-threads).

## Attention inbox

On web and desktop, an inbox button appears in the sidebar header while any thread needs you, with
a count. Its popover lists those threads across every environment, project, and chat tab, one
entry per thread with its most urgent reason: an approval, a question for you, a failed turn, or
finished work you have not opened yet. Clicking an entry opens that exact tab, not the tab its
sidebar row would return to. Failures and completions leave the inbox once you open the thread or
mark them read; **Mark unread** in the thread menu brings a completion back. Approvals and
questions stay until answered. Archived threads are left out, and so are snoozed ones until they
wake or raise their hand. The same list is **Needs attention** in the command palette
(`mod+alt+n`, `attentionInbox.open`).

The inbox is derived on the client from thread shells and the client's existing read markers, so
it adds no server state or payload. Mobile does not show it, because the mobile client does not
track which threads you have read.

Code: [`attentionInbox.ts`](../packages/client-runtime/src/state/attentionInbox.ts),
[`SidebarAttentionInbox.tsx`](../apps/web/src/components/sidebar/SidebarAttentionInbox.tsx), and
the `attention-inbox` view in [`CommandPalette.tsx`](../apps/web/src/components/CommandPalette.tsx).
User guide: [thread-sidebar.md](./user/thread-sidebar.md#see-what-needs-you).

## Usage-limit recovery

When Codex or Claude ends a turn because the account's usage allowance ran out, the thread shows a
recovery banner instead of the plain error. Upstream only shows the error. The banner offers:

- **Resume when available**, only when the provider reported a reset time. It arms the server to
  send "Continue where you left off." into the same session a minute after the reset, with no
  client connected and across restarts. It covers that one stop and is off until chosen; **Cancel
  auto-resume** disarms it.
- **Resume now**, which sends the same message at once.
- **Continue in new tab** on web and desktop, which forks the chat onto another ready account or
  model through the [Chat tabs](#chat-tabs) fork.

Adapters mark the stop with `usageLimit` (and `resetsAt` when known) on `runtime.error`. Codex uses
`usageLimitExceeded`; Claude uses a rejected rate-limit window or `blocking_limit`. Cursor, Grok,
OpenCode, Antigravity, and Devin do not mark stops, so they keep the plain error. Arming and
cancelling are the `thread.usage-limit.resume` command, recorded as thread activities. Mobile has
the resume actions but not **Continue in new tab**.

Code: `packages/shared/src/usageLimitRecovery.ts`,
`apps/server/src/orchestration/UsageLimitResumeReactor.ts`, the `thread.usage-limit.resume` case in
`apps/server/src/orchestration/decider.ts`, `apps/web/src/components/chat/UsageLimitRecoveryBanner.tsx`,
and `apps/mobile/src/features/threads/UsageLimitRecoveryNotice.tsx`. User guides:
[providers-codex.md](./user/providers-codex.md#codex-says-i-hit-a-usage-limit) and
[providers-claude.md](./user/providers-claude.md#usage-limits).

## Keeping this page current

Update this page in the same change that adds, changes, or removes a user-visible fork-only
behavior. Rewrite the affected section so it describes the behavior as it is now. Link the code,
and the user guide when one exists. Do not append a changelog entry or describe the implementation
line by line.

Remove a section when upstream adopts the change or the fork drops it. An upstream sync includes
this check. A bugfix or refactor that leaves the described behavior the same does not need an
entry.

`README.md` only points here. Do not add a second feature list there.
