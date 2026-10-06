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
choose a default for chat file links, and override it by file extension. Each custom application
can use an application logo or a general icon in the workspace Open button and picker. Custom applications
appear in the workspace Open in picker and file Open with menus, and can run through the user's
interactive login shell so shell functions and aliases work. The workspace Open button can be
pinned to any application instead of following the last-used pick. Commands run on the
environment hosting the file. Remote workspace menus offer custom applications on that host
alongside editors that support SSH links.

See [the user guide](user/composer.md#opening-file-links),
[settings](../apps/web/src/components/settings/OpenInSettings.tsx), and
[launcher](../apps/server/src/process/externalLauncher.ts).

## Devin provider

Adds a dedicated `devin` provider driven through the local `devin` CLI's ACP server
(`devin acp`). Upstream can also run Devin as a generic ACP Registry agent; the dedicated driver
uses the same shared ACP adapter and Devin protocol handling (subagent markers, message grouping,
client-owned terminals) and adds the rest.

- Each instance has its own binary path and, when added, a private `XDG_DATA_HOME` (see
  [Provider sign-in methods](#provider-sign-in-methods)). T3 runtime modes map onto Devin's
  `--permission-mode` at spawn and onto its session modes; plan turns switch to Devin's Plan mode.
- Models come from `devin models list`. Devin encodes effort, speed, and context in each model id,
  so the catalog groups variants into one picker row per model with effort/speed/context options,
  and the session is switched to the matching variant. Fusion is one row: lead and sidekick are
  chosen by model family, lead effort is the one Devin advertises for that lead, and sidekick
  effort is selectable. The context meter uses the catalog's window when Devin does not report one.
- T3's MCP tools reach Devin through the shared ACP stdio bridge. `devin skills list` feeds the
  skill picker, and `$skill` mentions are sent as Devin's `@skills:name`.
- The usage page covers Devin from the CLI's `sessions.db`, which includes sessions run outside
  T3, priced from the provider snapshot. The page can export the current window as CSV. A
  `cog_...` service key with `ViewOrgConsumption` and `DEVIN_ORG_ID` can show organization ACUs
  in a separate section; those are not mixed into token-cost estimates. Conversation rewind is
  not supported.
- Devin also generates commit messages, PR content, branch names, and thread titles, updates
  through `devin update`, and signs in by browser, saved login, or a pasted API key.
- The welcome wizard lists Devin with an **Enable** action, since the provider is opt-in.

Code: [`DevinDriver.ts`](../apps/server/src/provider/Drivers/DevinDriver.ts),
[`DevinAdapterV2.ts`](../apps/server/src/orchestration-v2/Adapters/DevinAdapterV2.ts),
[`DevinAcpSupport.ts`](../apps/server/src/provider/acp/DevinAcpSupport.ts),
`apps/server/src/provider/**/Devin*`, `apps/server/src/provider/devinModelCatalog.ts`,
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
  and the plan toggle only when it has a `plan` or `architect` mode. Slash commands come from its
  session updates, per workspace.
- Turns run over the shared ACP adapter, so T3's MCP tools (stdio bridge), approvals with the
  agent's own option ids, form elicitations as questions, and fresh-session recovery when a
  session cannot be resumed work as for upstream's ACP agents. The selected model is applied
  through the `model` config option or `session/set_model`, and T3 runtime modes map onto the
  agent's matching session modes.
- No sign-in flow, updates, text generation, rewind, or usage accounting.

Code: [`CustomAcpDriver.ts`](../apps/server/src/provider/Drivers/CustomAcpDriver.ts),
[`CustomAcpAdapterV2.ts`](../apps/server/src/orchestration-v2/Adapters/CustomAcpAdapterV2.ts),
`apps/server/src/provider/**/CustomAcp*`, `apps/server/src/provider/acp/AcpCommandCatalog.ts`,
and `CustomAcpSettings` in `packages/contracts/src/settings.ts`. User guide:
[providers-custom-acp.md](./user/providers-custom-acp.md).

## Provider sign-in methods

Each provider's **Settings > Providers** card gets a sign-in section with a method picker: the
provider's CLI login flow, saved credentials, or a pasted key. The chosen method is persisted.
Codex defaults to the browser flow.

An added instance with a blank home gets a private directory under T3's data (`provider-homes`),
so a second login does not replace the default. The default instance keeps the CLI's normal home.
Grok uses `GROK_HOME`; Devin and OpenCode use `XDG_DATA_HOME`. Cursor is not covered: upstream signs each
Cursor instance in through the Cursor SDK and keeps every instance's sign-in separately.

Cursor usage follows each instance's own sign-in. Upstream reads limits only from the host's shared
CLI login and shows none for an SDK sign-in. In the fork, each instance trades its SDK key (or
`CURSOR_API_KEY`) for an access token, as the SDK does, and reads its own limits; only the default
instance may fall back to the CLI login. The usage page reads every instance's account as well as the
CLI login, and one account counts once. Code:
[`cursorUsageLimits.ts`](../apps/server/src/provider/Layers/cursorUsageLimits.ts),
`readCursorSdkCredential` in
[`CursorCredentialStore.ts`](../apps/server/src/provider/CursorCredentialStore.ts), and the Cursor
scan in [`UsageService.ts`](../apps/server/src/usage/UsageService.ts). User guide:
[usage.md](./user/usage.md).

Cursor turns also record their token usage. Upstream's Cursor adapter ignores the usage the SDK
returns with each finished run, so Cursor provider turns carry none. The fork maps it onto the
turn's `turnTokenUsage` (cache reads and writes counted inside input, as for Claude), which feeds
turn analytics and the usage of delegated tasks run on Cursor
([`CursorTurnTokenUsage.ts`](../apps/server/src/provider/CursorTurnTokenUsage.ts)). It is a sum
over the run's model calls, not context occupancy, so Cursor threads still have no context meter.
The usage page keeps reading Cursor's account history, so nothing is counted twice.

Code: `apps/web/src/components/settings/ProviderAuthSection.tsx`,
`apps/server/src/provider/Services/ProviderAuthService.ts`,
`apps/server/src/provider/ProviderInstanceEnvironment.ts`, and
`packages/contracts/src/providerSetup.ts`. User guides:
[providers-devin.md](./user/providers-devin.md) and
[providers-opencode.md](./user/providers-opencode.md).

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

## Cursor long-context tiers use Max Mode

Choosing a Cursor context tier above 300K (Grok 4.7 at 500K, or 1M on other models) turns on
Cursor's Max Mode for the request, as Cursor's own CLI does. Upstream sends these tiers without
Max Mode, so Grok 4.7 at 500K fails with "Invalid parameters for registry model" and 1M tiers
silently run at about 300K. Max Mode is billed per token on usage-based Cursor plans.

This is a port of upstream PR [#15884](https://github.com/pingdotgg/t3code/pull/15884) for
[#15788](https://github.com/pingdotgg/t3code/issues/15788). Remove this section when upstream merges
it. Code: `apps/server/src/provider/cursorSdk.ts`.

## Cursor turns send the picker's defaults

Cursor gets every model option the picker shows, not only the ones the user changed. Cursor treats
an omitted option as the model's standard tier, so upstream runs an untouched composer, a delegated
task, a launched thread, or a scheduled task at about 300K while the picker shows 1M (500K for
Grok 4.7). Fast is the exception: it stays off unless chosen, as in the composer. With the
long-context change above, these defaults run in Max Mode.

`delegate_task` on the parent's own provider and model keeps the parent's options and overrides
only the ones it names, for every provider. Upstream replaces them, so an effort-only child loses
the parent's context window.

Fixes upstream [#16149](https://github.com/pingdotgg/t3code/issues/16149); remove this section when
upstream fixes it. Code: `withCursorDefaultParameters` in
`apps/server/src/provider/cursorSdkModel.ts`, applied in
`apps/server/src/provider/Drivers/CursorDriver.ts`, and `resolveTarget` in
`apps/server/src/mcp/OrchestratorMcpService.ts`.

## Agents panel drilldowns

Upstream makes every subagent a child thread, lists a thread's subagents under **Lineage** in the
thread details panel, one row each, newest first, and removed the right-panel Agents surface
(its store migration dropped persisted `agents` tabs). The fork keeps Lineage and brings the
**Agents** panel back beside it, both over the child threads:

- **Agents panel.** A right-panel surface with the thread's whole fleet: one line per agent with a
  status dot, token total, elapsed time, and start time, a second line with a working agent's latest tool call
  (a static `…` while it runs, a `waiting` badge when the agent waits on the user) or a failed
  agent's error, and hover previews (status, compact model with reasoning effort and `run N`,
  prompt, result or error, the latest five tool calls, usage). Clicking a tool call in a preview
  opens the agent on that call, expanded and scrolled into view (`agentDrillStore.ts`
  `focusToolCall`). Agents spawned by an agent sit indented under it, found through child-thread
  lineage in the thread shells (`deriveThreadAgentFleet`); a filter keeps a non-matching agent as
  context when one below it matches. An agent recorded before its child thread exists still opens
  (its prompt, result, and usage, without activity) and has the right-click menu. Spawn order is
  the child thread's creation, so a resumed agent never moves (`subagentSpawnedAt`). The footer
  counts agents by status and sums the usage they reported (input, cached share, output,
  reasoning, tool calls; `summarizeAgentFleet`). Agents spawned by agents add no usage there:
  their records live on their owners' projections, which the list does not subscribe to. Open the
  panel from the right panel's launcher or **+** menu (badged with working agents, nested agents
  and live follow-up runs included), the command palette (**Show agents**), the Lineage header, an
  agent tab, **Details** or the bot button on an agent row in the conversation, or **Show in Agents
  panel** in an agent's right-click menu. Clicking a row or its preview opens the agent's detail.
  The panel links back to Lineage. Upstream's v14 right-panel migration dropped `agents`; v15
  keeps it, so the surface is restored on restart again. Rows page in 50 at a time, and only
  working rows on screen and open previews read a child thread.
- **Lineage.** With two or more subagents, Lineage gets the same search, status filter, and sorting
  by spawn order (the default, so rows never jump while they work), status, tokens, or duration,
  and the same compact rows. Lineage and the panel share one filter and sort, kept per device
  (`agentListViewStore.ts`), so switching between them shows the same list.
- **Conversation rows.** Upstream's agent rows open the agent's thread. The fork adds **Details**,
  which opens the Agents panel on that agent, and a bot button that opens the fleet
  ([`V2LifecycleRow.tsx`](../apps/web/src/components/chat/V2LifecycleRow.tsx)).
- **Record fields.** `OrchestrationV2Subagent` gains optional fork fields kept in the record's
  payload JSON (no migration): `usage` (for a Claude subagent, the
  input, cached, and output tokens summed over its own calls, since the SDK's `total_tokens` is
  only the latest call, with the SDK's tool calls and time added up across resumed runs; the
  running token total of a Codex child thread; and, for app-owned tasks such as `delegate_task`
  children on any provider, the sum of their own thread's provider-turn usage plus its tool calls,
  written when the task finishes; `subagentUsageFromChildTurns` in
  [`SubagentProjection.ts`](../apps/server/src/orchestration-v2/SubagentProjection.ts)),
  `outputFile` (Claude's task output file), and `sessionUrl` (the http(s) remote session link a
  Claude Workflow tool result names for its task). Every agent view (detail footer, rows, hover
  cards, fleet footer) reads this one field. A running delegated task shows usage once it finishes,
  and tasks that finished before this existed show none. Other native subagents leave these empty.
- **Agent detail.** Clicking an agent in the Agents panel inspects it in place, with **Back** to
  the fleet. The header has the agent's status, compact model with effort (from its child thread's
  model selection), `run N` past its first run, elapsed time, the prompt clamped to four lines
  with **Show all**, the result or error, **Artifacts** (output file, **Open remote session**), and
  agents it started (click one to drill a level further; Back returns one level). Below it is the
  agent's activity from its child thread: its **Tools** (the default), with status and kind
  filters and sorting, or a live **Transcript** of its messages, reasoning summaries, tool calls,
  and notices in order, each with its time. Both can be searched, and a narrowed view says
  **Showing N of M**. Paths in both read relative to the checkout the agent works in: a Claude
  `.claude/worktrees/agent-<id>` worktree or a sibling checkout its calls use
  (`subagentWorkspaceRoot`). An empty Tools view says whether the agent made no calls or its
  provider records none, showing progress while it works (`subagentEmptyToolCallsText`). The usage
  breakdown adds **Runs** and **Attempt** from the child thread's runs and run attempts
  (`subagentRunStats`). The transcript reuses the chat's timeline derivation
  (`deriveTimelineEntriesFromVisibleTurnItemsWithState`), work-log rows, and `V2ItemInspector` for
  expanded calls (output, diffs). It is virtualized and follows new activity only while scrolled
  to the end. **Stop agent** appears when the agent's own thread has an interruptible run. It is
  the same interrupt that thread offers in chat; native Claude subagents have none. The drill-in
  is per thread and session-only (`agentDrillStore.ts`). **Show in Agents panel** opens the panel
  on the agent. The child thread is read only while its detail is shown.
- **Agent tab.** **Open in new tab** in the detail view, or right-click an agent in the panel, in
  Lineage, or in the conversation, keeps it in a thread-scoped right-panel tab beside the fleet,
  with the same detail view. Agent tabs close like other tabs, reopen the same way, and are
  restored when the app restarts.
- **Attach result to chat** (right-click or the agent detail) pastes a finished agent's task and
  result into the composer; `subagentResultChatContext` builds the text.
- **Continue in chat** (right-click or the agent detail) opens a new chat tab of the thread whose
  draft carries the agent's task, result or error, and latest tool calls as a chat-summary chip;
  `subagentContinuationContext` builds the text. It starts a fresh conversation rather than
  resuming the agent's provider session.

Tool previews include bounded unified edit diffs and line counts, read ranges, search arguments,
and exit codes when the provider supplies them, in the agent detail and in chat tool expansions on
web, desktop, and mobile. Timelines carry an edit without its diff, so an expanded edit or its hover card fetches the
stored item for its preview (`fileChangePreviewText`); the fork's `projectTurnItemForDetail` returns
an edit's stored diff, bounded, where upstream withholds it there too. Claude's Edit results are only a
success message, so the fork builds a Claude edit's diff and line counts from the tool's input
(`claudeFileChangeDiff`), where upstream stores the message as the diff. Codex sends a new or deleted
file as raw contents and an update as bare hunks; the fork stores every change in the item as one
unified patch with line counts (`codexFileChangeDiff`), where upstream kept the first change's raw
text. A file read shows the file itself, syntax-highlighted on web and desktop and numbered from
the line the read started at, instead of the JSON, wrapper tags or line-number prefixes each
provider reports it in (`turnItemReadFile`, [`ReadFileView.tsx`](../apps/web/src/components/chat/ReadFileView.tsx));
the agent views fetch a read's stored output when its call is hovered or expanded. In the agent views a tool's preview also
carries what it reported back, such as an `Error:` line, when its output came with the timeline;
v2 command items record no working directory, so none is shown. On web and desktop, collapsed tool calls in
the main chat also preview on hover; clicking still expands them inline. The card shows the tool
heading, the workspace-relative syntax-highlighted command or full label, then the same details the
row expands to (output loads only once the card opens, and a non-zero exit code shows with it), with
time and status in a compact footer. Syntax highlighting for commands and tool arguments is
limited to hover previews; expanded chat rows show plain text. Thoughts and answered questions do not preview
([`MessagesTimeline.tsx`](../apps/web/src/components/chat/MessagesTimeline.tsx),
[`toolCallPreview.ts`](../apps/web/src/lib/toolCallPreview.ts)).

Code: [`agentListView.ts`](../packages/client-runtime/src/state/agentListView.ts),
[`agentFleet.ts`](../packages/client-runtime/src/state/agentFleet.ts),
[`AgentsPanel.tsx`](../apps/web/src/components/chat/AgentsPanel.tsx),
[`ThreadRelationshipsControl.tsx`](../apps/web/src/components/chat/ThreadRelationshipsControl.tsx),
[`AgentDetailPanel.tsx`](../apps/web/src/components/chat/AgentDetailPanel.tsx),
[`agentTranscript.ts`](../apps/web/src/components/chat/agentTranscript.ts),
[`agentDrillStore.ts`](../apps/web/src/agentDrillStore.ts),
[`agentChatActions.ts`](../apps/web/src/components/chat/agentChatActions.ts), the `agents` and
`agent` surfaces in [`rightPanelStore.ts`](../apps/web/src/rightPanelStore.ts), the record
field mapping in `ClaudeAdapterV2.ts` and `CodexAdapterV2.ts`, and `finalizeAppOwnedSubagent` in
[`Orchestrator.ts`](../apps/server/src/orchestration-v2/Orchestrator.ts). User guide:
[thread-sidebar.md](./user/thread-sidebar.md#inspect-agent-work).

## Chat tabs

A thread can have several chat tabs that share one workspace (same checkout and worktree). Each tab
is its own conversation and provider.

- **Storage.** Every tab is a normal thread. Tab membership lives in the fork-owned
  `fork_thread_tabs` table, created by `ensureThreadTabsSchema` in
  `apps/server/src/threadTabs/schema.ts`. It is versioned in a separate `fork_schema_migrations`
  table so upstream's numbered migrations are never touched.
- **Server.** The `ThreadTabs` service (`apps/server/src/threadTabs/ThreadTabs.ts`) lists a group
  and all memberships, creates a tab, forks a response into a tab, and summarizes other chats;
  `http.ts` serves it as the `threadTabs` HTTP group. A new tab is an orchestration `thread.create`
  on the source's branch and worktree. Each tab keeps its own checkpoints in the shared worktree.
  Orchestration v2 does not follow a worktree's checked-out branch for any thread, so tabs keep
  the branch they were created with.
- **Settlement.** The group shows as one sidebar row, so it settles as a unit while upstream's
  settle commands and auto-settle policy stay per thread. `settlement.ts` follows the stored
  orchestration events and mirrors them: a new run or unsettle in any tab wakes the group, and a
  settle in any tab settles the rest. A settle is undone while another tab is working, waiting on
  you, or holding background work, or, for an automatic settle, while another tab has an open pull
  request.
- **Sidebars.** By default child tabs are hidden from the web sidebar, the legacy project sidebar,
  and both mobile thread lists (`useHiddenTabThreads`). The group's row stays highlighted while any
  of its tabs is open. Opening it from another thread returns to the tab last left open; clicking
  it while one of its tabs is already open leaves that tab selected
  (`threadTabGroupHeaderTarget` in `packages/client-runtime/src/threadTabs.ts`,
  `apps/web/src/threadTabRecencyStore.ts`). With tabs hidden on web and desktop, the row shows
  that tab’s title, model, and details (`apps/web/src/components/Sidebar.tsx`). On web and desktop, **Settings → General → Tabs in
  sidebar**, the sidebar header's tabs button (click to toggle, right-click for a menu;
  `sidebar/SidebarTabsMenu.tsx`), the command palette,
  and `Cmd+Option+T` on macOS or `Ctrl+Alt+T` on Windows and Linux list each tab under that row:
  all of them, or up to a chosen number with the rest behind a **more** row that keeps the open tab
  listed. Hovering the collapsed row lists those tabs, and clicking one opens it. **Sort tabs by**
  orders them by latest response (a tab with no response counts from its creation), creation, or
  last opened, either way, or manually by dragging, which switches to Manual. Manual order is client-local, because the
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
  Those pills follow the sidebar's tab order and limit and show each tab's status, time, and
  provider as its sidebar row does, with the rest behind a **more** pill that lists them on hover
  (`apps/web/src/components/sidebar/SidebarTabSummary.tsx`).
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
  - A completed agent response's **Fork from this response** opens upstream's native fork as a
    new tab (`forkResponseIntoTab`, the `fork` endpoint), so the tab carries the conversation
    itself rather than a summary. Against a server without tabs it forks a separate thread, as
    upstream does.
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

## Open the thread's pull request in the browser

On web and desktop, **Settings → General → Open pull requests in** chooses where the thread's own
pull request opens: the thread details panel's pull request rows, the composer's pull request badge,
and the **View PR** button on the toast after a pull request is created. **Side panel** (the
default) is upstream's behaviour, where Cmd/Ctrl-click opens the browser. **Browser** swaps them: a
click opens the browser that **Open links in** picks (see below), and Cmd/Ctrl-click opens the side
panel. Other pull request links are unaffected.

Code: `usePreferredOpenPrLink` in
[`openPullRequestLink.ts`](../apps/web/src/lib/openPullRequestLink.ts),
[`BranchToolbarBranchSelector.tsx`](../apps/web/src/components/BranchToolbarBranchSelector.tsx), and
`pullRequestOpenTarget` in `packages/contracts/src/settings.ts`.

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

## Worktree branch named before setup

New worktree branches use upstream's naming (**Settings → Source Control → Worktree branch
naming**), but the name is generated while the worktree is checked out, so the setup script and
agent start on the final branch; upstream renames the `t3/<id>` placeholder after the first
turn has started. The placeholder remains only when naming outlasts checkout by more than a few
seconds, and is then renamed in the background as upstream does. A static prefix the model repeats
in its answer is not doubled. The fork's earlier **Branch prefix** setting (global and per project)
moves into the static prefix once, the first time the server loads its settings.

Code: `prepareInBackground` in `apps/server/src/orchestration-v2/ThreadLaunchService.ts`,
`formatGeneratedBranchName` in `packages/shared/src/git.ts`, and `foldLegacyWorktreeBranchPrefix`
in `apps/server/src/serverSettings.ts`. User guide:
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

## Sidebar project filter picks several projects

The sidebar's project filter is multi-select: each project row toggles on or off and the popup
stays open, and **All projects** clears the filter. **Only**, on the highlighted row, picks just
that project and closes the popup. With more than one project picked, the trigger
shows a generic folders icon with a count, and its tooltip lists the picked projects. A thread's **Filter by project** menu item still narrows
the list to that one project. This is web and desktop; mobile has no sidebar project filter.

Code: the project scope `Combobox` in `apps/web/src/components/Sidebar.tsx`,
`resolveSidebarProjectScopeKeys` in `apps/web/src/components/Sidebar.logic.ts`, and
`sidebarProjectScopeKeys` in `apps/web/src/uiStateStore.ts`.

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

Code: `makeSubagentWorktreeSetupHooks` in
[`ClaudeAdapterV2.ts`](../apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts) and
[`SubagentWorktreeSetup.ts`](../apps/server/src/project/SubagentWorktreeSetup.ts). User guide:
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
link. Right-clicking a row offers **Attach a comment…**, which lists that pull request's comments
(Backspace on an empty search goes back) and attaches the picked one as the same chip a pasted
comment link makes.

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

## Slack messages and threads

**Settings > Integrations > Slack** connects a Slack account to the environment with OAuth (PKCE,
read-only user scopes, no client secret). There is no built-in Slack app: Slack limits apps that
are distributed without Marketplace approval to one `conversations.replies` call a minute, 15
messages each. Each workspace makes its own app from a manifest the settings section copies
(`slackAppManifest` in `packages/contracts/src/slack.ts`), and the user enters its client ID. The
server keeps that client ID across disconnects, and `T3CODE_SLACK_CLIENT_ID` can supply one. The
redirect is `http://localhost:47832/callback`, since Slack only treats `localhost` as a desktop
redirect, with the same paste-back path as Linear for remote browsers.

A message or its whole thread attaches as a `slack-thread` context chip: from a pasted or typed
permalink, the attach menu's picker (Slack search syntax, right-click for the message alone), a
`#` menu tab shown once Slack is connected, the command palette, and the mobile attach menu. The
server renders the thread to capped markdown when it is attached. That markdown always keeps the
first message and the linked one, fills the rest newest first, and resolves mentions to names.
The snapshot is inlined into the prompt for every provider. Slack has no thread links.

A bare Slack message link left in any rendered message on web or desktop (an agent's reply, a
paste-as-text, a message sent from mobile) shows `#channel · Author` once `slack.getLinkPreview`
reads it, with the message's first line on hover. It shows its URL while Slack is off, disconnected,
or the read fails. The server keeps each preview as a file under the caches directory
(`slack-link-previews`), so a link is read from Slack once; it holds no reply count, since that
would go stale. Mobile shows the URL.

Turning off **Enable Slack integration** in that setting keeps pasted Slack links as links without
setup prompts and hides Slack attachment actions on web, desktop, and mobile for the environment.
The connected account and existing attachments are kept, so turning it back on needs no new login.

Code: `apps/server/src/slack/`, `packages/contracts/src/slack.ts`, `SlackThreadContextRecord` in
`packages/contracts/src/composerContext.ts`, `packages/client-runtime/src/state/slack.ts`,
`apps/web/src/components/settings/SlackSettings.tsx`,
`apps/web/src/components/chat/SlackMessagePicker.tsx`,
`apps/web/src/components/chat/useComposerSlackItems.ts`, and
`apps/mobile/src/components/SlackMessagePickerSheet.tsx`. User guide: [slack.md](./user/slack.md).

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

Upstream's pull request watch (`watch_pull_request`, or the row menu) wakes the agent with news.
The fork adds to it:

- The wake tells the agent what to do about failing checks, a merge conflict, and requested
  changes (fix and push, rebase, address the review), with how to inspect the pull request.
  A "changes requested" review decision is news of its own, raised once until it clears.
- Wakes that ask for a fix spend a budget of 3 follow-ups, alongside upstream's limit on
  comment-only wakes. When a fourth is needed the watch pauses instead.
- **Pause watching** and **Resume watching** sit beside **Stop watching**. A paused watch reads
  nothing; resuming restores the budget and reports what changed meanwhile.
- Settled threads stay watched, and a wake brings the thread back; upstream ends a watch when its
  thread settles. Archiving the thread or pressing Stop still ends it.
- Each watched row on web shows a status line ("Waiting for checks", "Checks failed", "Changes
  requested", ...) and the follow-ups used. Mobile's Git overview shows "Watching" or "Watch paused".

The state rides on upstream's `ThreadPullRequestWatch` (`changesRequested`, `followUps`, `paused`)
and `thread.pull-request.watch` takes `paused`, behind the `threadPullRequestWatchPause` capability.
Watches from the fork's old `fork_pull_request_watches` table move onto their links at startup,
without their follow-up counts. Code:
[`pullRequestWatch.ts`](../apps/server/src/orchestration-v2/pullRequestWatch.ts),
[`PullRequestWatchReactor.ts`](../apps/server/src/orchestration-v2/PullRequestWatchReactor.ts),
[`pullRequestWatch.ts`](../packages/shared/src/pullRequestWatch.ts) (status line), and
[`ThreadPullRequestsPanel.tsx`](../apps/web/src/components/pullRequest/ThreadPullRequestsPanel.tsx).
See [the user guide](user/source-control.md#watch-a-pull-request).

## Create a thread before writing its first message

On web and desktop, a new thread's empty composer shows **Create worktree** (or **Create thread**
in Local mode) in place of the send arrow; Enter does the same. It launches the thread without a
message: the thread opens right away with an empty composer and the setup card while the worktree
is checked out and the setup script runs, and no turn starts. Sending waits until that setup is
done, and the server also holds a first message that arrives earlier, from any client. The first
real message starts the turn, names the thread, and renames the temporary `t3/<id>` branch.
Chat tabs already share a workspace, so they never offer it. A selection of several models, or a
server without the `deferredBootstrapTurn` capability, keeps the plain send arrow. Mobile does not
offer it.

Code: `bootstrap.deferTurn` in `packages/client-runtime/src/operations/commands.ts`;
`prepareMessageWorkspace` and `nameTemporaryBranch` in
`apps/server/src/orchestration-v2/ThreadLaunchService.ts`, called from `dispatchCommand` in
`apps/server/src/orchestration-v2/ThreadMessageIntake.ts`; `createThreadWithoutMessage` in
`apps/web/src/components/ChatView.tsx` and the pill in `ComposerPrimaryActions.tsx`. User guide:
[thread-sidebar.md](./user/thread-sidebar.md#start-a-thread).

## Export a transcript

On web and desktop, **Export transcript…** in a thread's menu (sidebar row, sidebar tab row, chat
header) or the command palette opens a dialog that previews the thread as Markdown. A thread with
several chat tabs gets a tab picker, starting on the tab it was opened from. **Concise** keeps
the prompts and replies; **Full** adds the work log (tool calls, commands, file edits) and proposed
plans in the order the thread's timeline shows them. Reasoning is always left out. **Header** adds front matter with the project,
branch, provider, model, and dates. **Save…** writes a `.md` file on the device running the client:
the native save dialog on desktop, the browser's save picker in Chromium, and a download elsewhere.
**Copy** puts the same Markdown on the clipboard. The dialog loads the whole thread projection over
HTTP (`loadFullThreadSnapshot`), so it works for threads that are not open. Mobile does not offer
it.

Code: [`threadTranscript.ts`](../apps/web/src/lib/threadTranscript.ts),
[`TranscriptExportDialog.tsx`](../apps/web/src/components/TranscriptExportDialog.tsx), and
`saveTextFile` in [`window.ts`](../apps/desktop/src/ipc/methods/window.ts). User guide:
[thread-sidebar.md](./user/thread-sidebar.md#export-a-transcript).

## Import a CLI conversation

Upstream imports recent Claude Code and Codex history only in bulk, from the welcome wizard. The
fork adds a picker on web and desktop: **Import conversation…** in the command palette, which
lists every project, and in the legacy sidebar's project menu, which starts on that project. Its
**Filters** menu narrows the list to one project or one source. `agentSessions.list`
returns the project's conversations from the last 30 days (newest 50, with first prompt, message
count, and dates, and `truncated` when there are more). Each is marked with the thread already
holding it, so the picker opens that thread instead: an earlier import, found by upstream's
`import:<instance>:<session>` thread id, or any unarchived thread whose active provider thread
resumes that session, including threads T3 started itself. `agentSessions.import` takes an
optional `session` to import just one through upstream's importer, from a fresh scan, and returns
its thread in `threadIds`. The thread binds to the original session exactly like the wizard's
import, so the next turn resumes it. The server advertises the picker with the
`agentSessionPicker` capability. Cursor, Grok, OpenCode, Antigravity, Devin, and mobile have no
import.

Code: `listProjectAgentSessions` in
[`AgentSessionImporter.ts`](../apps/server/src/project/AgentSessionImporter.ts), the
`recentThreads` options in [`AgentSessionScanner.ts`](../apps/server/src/project/AgentSessionScanner.ts),
and [`ImportConversationDialog.tsx`](../apps/web/src/components/ImportConversationDialog.tsx).
User guide: [thread-sidebar.md](./user/thread-sidebar.md#import-a-cli-conversation).

## Import a Conductor workspace

The import picker also lists the project's active Conductor (`conductor.build`) workspaces: those
whose Conductor repository has the project's root or `origin` remote, whose worktree still exists,
and that have at least one sent prompt. Importing one turns each open tab into a thread on the
workspace's branch and worktree, grouped as [chat tabs](#chat-tabs), with the workspace's pin on
the first tab. The threads land active, as if un-settled, because the workspace is still in use. History comes from Conductor's own database, read-only, so it matches what Conductor
showed: prompts and reply text, without tool activity. Images and files sent with a prompt are
copied into T3's attachment store from the workspace's `.context/attachments`; Conductor deletes
some of those, so a missing one is named in the message instead. Diff comments sent to the agent
appear in their prompt as quoted review comments. Claude Code and Codex tabs bind to their agent
session and resume it. Conductor keeps Cursor sessions in a private store, so a Cursor tab's
history is handed to its next turn instead. Thread ids are `conductor:<session>`, so the picker
opens an earlier import. Only macOS hosts have the database; mobile has no import.

Some workspace state stays where it is. Notes (`.context/notes.md`, `todos.md`) are files in the
worktree the threads run in. Pull request review comments, which make up almost all of Conductor's
diff comments, come from the pull request T3 finds for the branch. Conductor encrypts terminal
scrollback, so terminal history is not imported, and neither are unsent diff comments or archived
workspaces.

Imported Claude sessions resume on their first turn because the provider thread records
`nativeMetadata.importedNativeId`; Claude rejects a new session under an id that already exists.

Code: [`ConductorImporter.ts`](../apps/server/src/conductor/ConductorImporter.ts),
[`conductorDatabase.ts`](../apps/server/src/conductor/conductorDatabase.ts), `adopt` in
[`ThreadTabs.ts`](../apps/server/src/threadTabs/ThreadTabs.ts), and
[`ImportConversationDialog.tsx`](../apps/web/src/components/ImportConversationDialog.tsx).
User guide: [thread-sidebar.md](./user/thread-sidebar.md#import-a-conductor-workspace).

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
something else. On a new launch this runs as a step of the setup card, before the setup script,
and the outcomes reach the already recorded message as its run is released. Otherwise it runs
before the message is recorded, with a one-step setup card showing progress. Each record's clone
outcome and git status are written back onto the message. The chip shows them, and the agent's prompt includes them, so the
agent knows what is there. A failed clone is a warning and the agent still starts. The server adds
the folder to the repository's `info/exclude` so checkpoints and diffs ignore the clones. The
default owner and the folder are server settings in **Settings > General**. Mobile's attach menu
has the same picker, without the recently attached ranking.

Code: `apps/server/src/contextRepositories/ContextRepositories.ts`,
`packages/contracts/src/contextRepositories.ts`, `RepositoryContextRecord` in
`packages/contracts/src/composerContext.ts`,
`apps/server/src/contextRepositories/messageContextRepositories.ts` (called from
`apps/server/src/orchestration-v2/ThreadLaunchService.ts`), the `context` of `prepared-run.release`
in `packages/contracts/src/orchestrationV2.ts` and its message restatement in
`apps/server/src/orchestration-v2/Orchestrator.ts`,
`packages/client-runtime/src/contextRepositories.ts`, and
`apps/web/src/components/chat/RepositoryAttachPicker.tsx`,
`apps/web/src/components/chat/useComposerRepositoryItems.ts`, and
`apps/mobile/src/components/RepositoryPickerSheet.tsx`. User guide:
[composer.md](./user/composer.md#attach-repositories).

## Pasted and typed links become chips

Pasting a Linear issue, GitHub issue, pull request, GitHub repository root, or Slack message link
into the web or desktop composer, or typing one followed by whitespace, turns it into the chip its attach picker
makes. A pull request link to one comment (`#issuecomment-…`, `#discussion_r…`, `#r…`) becomes a
chip for that comment instead, anchored to its line with the earlier replies when it is in a review
thread; a comment the read did not return falls back to the pull request chip. A link to lines of
one file (`#diff-<hash>L4-L14`) becomes a chip for those lines of the diff, and stays a link when
the diff does not show them. The text goes in as
usual, then each link becomes a chip once its object loads. A link that
cannot be read, or that was edited away meanwhile, stays as text. Paste-as-text (`Cmd+Shift+V`)
skips it, and typing never retries a link the draft already converted or tried, so undo and a
deleted chip stick. Mobile does not convert links.

A bare link of one of those kinds that is still a link when the message renders, in any message on
web, desktop, or mobile, shows its short name instead of the URL: `owner/repo#162` for a pull
request or GitHub issue (with `L4-L14` appended for a link to lines), `ENG-123` for a Linear issue, and
`owner/repo` for a repository. It still opens, previews, and copies as the full URL. Link text the
writer chose is left alone. A bare Slack link is not one of these: it names the message only when
Slack is on and connected (see [Slack messages and threads](#slack-messages-and-threads)).

Code: `packages/client-runtime/src/composerObjectLinks.ts`,
`apps/web/src/components/chat/useResolveComposerObjectLink.ts`, and `convertObjectLinks` in
`apps/web/src/components/chat/ChatComposer.tsx`. User guide:
[composer.md](./user/composer.md#context-in-your-message).

## Pasted file paths become chips

Pasting text that is only file paths, one per line, into the web or desktop composer turns each
path into the same file chip the `@` picker makes. Absolute, `~/`, Windows drive, and `./` or
`../` paths count, as does a relative path whose last part has an extension; quoted paths and
shell-escaped spaces work. A paste with any other text in it, such as a sentence or a command that
mentions a path, stays as text, and so does a paste with `Cmd+Shift+V`. Mobile does not convert
paths.

Code: `pastedFilePathsAsComposerFileLinks` in `packages/shared/src/composerTrigger.ts`, called from
`apps/web/src/components/composerInlineTokenPaste.ts`.

## Desktop mock-update loop

A `Makefile` at the repository root drives a local auto-update test loop for the desktop app:
create a trusted self-signed certificate once, build signed mock-feed payloads, serve the feed, and
install the first build into `/Applications`. `T3CODE_DESKTOP_IDENTITY` makes
`scripts/build-desktop-artifact.ts` sign with any keychain identity, because the updater refuses to
install ad hoc–signed builds. Run `make` targets from the repository root, starting with
`make update-cert`.

## Commands and file paths shown relative to the workspace

Tool calls in the web, desktop, and mobile timelines, and subagent tool calls in the web and
desktop agent tabs and agents list, show paths inside the thread's working directory as relative.
For commands, a leading `cd` to that directory is dropped. Rewriting a
command stops at the first `cd` somewhere else, because relative paths after it would point
somewhere else. File, image, and other tool labels (`Read: src/index.ts`) get the same path
treatment. A subagent working in a sibling checkout of that directory — another folder next to
the thread's worktree, which is where Cursor runs a task while still passing absolute file
paths — is shown relative to the sibling once more than one of its calls uses it. Claude Code's
private agent worktree (`.claude/worktrees/agent-<id>`) is recognized from the path even when
the agent never reports it. Cross-worktree file targets render as a worktree chip followed by
wrapping path breadcrumbs, with a full-path copy tooltip on web and desktop and a tap-to-copy
prompt on mobile. Roots are resolved from that environment's thread records, with T3 and Claude
private-worktree layouts as fallbacks; unknown roots are labeled External. A repository linked to
a message and cloned into the default `.context/<name>` folder gets its own chip named after the
clone, with a repository icon on web and desktop. Shell command rows
and approval prompts still show the exact command, on one truncated line. The shared runtime
instructions also tell every provider that shell commands already start in that directory.

Code: `packages/client-runtime/src/work-log/commandDisplay.ts`, used by
`apps/web/src/components/chat/MessagesTimeline.logic.ts` and by `buildThreadFeed` and
`workEntryRowLabel` in `apps/mobile/src/lib/threadActivity.ts`;
[`agentListView.ts`](../packages/client-runtime/src/state/agentListView.ts);
[`toolPaths.ts`](../packages/client-runtime/src/work-log/toolPaths.ts);
[`ToolPathText.tsx`](../apps/web/src/components/chat/ToolPathText.tsx); and
`apps/server/src/provider/RuntimeInstructions.ts`.

## Agent access over MCP

Two more MCP servers serve agents outside T3 Code. `/mcp/query` gives read-only access to the
environment's history: projects, threads, turns, messages, the work log, plans, turn diffs, linked
pull requests, and usage. Its tools page with cursors, take `since`/`until` bounds, and cap text.
It reads the orchestration v2 projections; threads imported from before v2 carry only their
messages. `/mcp/operate` adds upstream's orchestrator, thread, project, and environment tools,
acting as a client caller labelled with the token's name, plus `t3_approval_respond` for
answering a thread's approvals (upstream's `t3_pending_request_respond` answers questions but
refuses approvals). It acts as the user, in any permission mode, without the spawn limits, and
threads it starts with `t3_thread_launch` record the token's label.
Both authenticate with an environment bearer token, never a cookie: `/mcp/query` needs
`orchestration:read`, `/mcp/operate` also `orchestration:operate`.

Tokens come from **Settings → Connections → Agent access** (`POST /api/auth/agent-access-tokens`,
`access: "read" | "operate"`) or `t3 auth session issue --read-only` / `--operate`. Each token is a
normal client session, so revoking it works like revoking any client. Web and desktop only.

Code: [`AgentAccessMcpServer.ts`](../apps/server/src/mcp/AgentAccessMcpServer.ts),
[`mcp/query/`](../apps/server/src/mcp/query/),
[`toolkits/approval/`](../apps/server/src/mcp/toolkits/approval/), the `agentAccessToken`
handler in [`auth/http.ts`](../apps/server/src/auth/http.ts), `AuthReadOnlyClientScopes` and
`AuthAgentOperateScopes` in [`contracts/src/auth.ts`](../packages/contracts/src/auth.ts), and
[`AgentAccessSettings.tsx`](../apps/web/src/components/settings/AgentAccessSettings.tsx).
User guide: [agent-access.md](./user/agent-access.md).

## Agents start and drive threads

Upstream gives every thread's agent its orchestration tools (`create_threads`, `delegate_task`,
`t3_thread_launch`, `t3_thread_send`, and the rest). The fork adds limits for an agent inside a
thread: chains of agent-started threads stop two levels deep, a thread keeps at most five started
threads going at once (a started thread counts until it settles or is archived, a delegated task
while its child runs), and `t3_thread_send`, `t3_thread_wait`, and `t3_thread_interrupt` refuse
the caller's own thread. Metadata tools such as `t3_thread_update` still default to the caller's
own thread, as upstream intends. A thread's agent never answers another thread's approvals.

A thread an agent starts with `create_threads` or `t3_thread_launch` records `startedBy` (the
starting thread, or the agent access token's label). The chat header on web, desktop, and mobile
names the starting thread (and opens it) or the token, and web sidebar rows mark the thread with a
bot icon. A client cannot set `startedBy`; only the server's MCP paths do.

Code: [`spawnPolicy.ts`](../apps/server/src/mcp/spawnPolicy.ts), its callers in
[`OrchestratorMcpService.ts`](../apps/server/src/mcp/OrchestratorMcpService.ts) and
[`toolkits/project/handlers.ts`](../apps/server/src/mcp/toolkits/project/handlers.ts),
`OrchestrationV2ThreadStartedBy` in
[`orchestrationV2.ts`](../packages/contracts/src/orchestrationV2.ts),
[`state/startedBy.ts`](../packages/client-runtime/src/state/startedBy.ts),
[`StartedByChip.tsx`](../apps/web/src/components/chat/StartedByChip.tsx), and
[`ThreadStartedByChip.tsx`](../apps/mobile/src/features/threads/ThreadStartedByChip.tsx). User
guide: [agent-access.md](./user/agent-access.md#let-agents-start-threads).

## Delegated subagents in their own worktree

Upstream's `delegate_task` always runs the child in the calling thread's checkout; only
`t3_thread_launch` can choose a worktree, and it makes an ordinary top-level thread. The fork adds
an optional `workspaceStrategy` to `delegate_task` with `t3_thread_launch`'s `worktree` (from
`baseRef`, optional `branch` and `startFromOrigin`) and `existing_worktree` shapes; there is no
`root` option, and omitting it still shares the caller's checkout. The child stays the caller's
subagent (Lineage, the Agents panel, completion delivery, spawn limits, and usage are unchanged),
but its first run waits in preparing while the server prepares the workspace the way a launch does:
worktree creation, the branch named before setup, Files to copy and the setup script, and setup
progress on the child thread. The child thread is then bound to the worktree and its agent starts
there. A preparation failure fails the child run and reaches the caller as a failed task whose
summary carries the reason, and a worktree the child never recorded is removed. Like
`t3_thread_launch`, it requires a full-access/default calling thread.

Code: `delegateTask` in [`OrchestratorMcpService.ts`](../apps/server/src/mcp/OrchestratorMcpService.ts),
`dispatchDelegatedTaskRequest` in [`Orchestrator.ts`](../apps/server/src/orchestration-v2/Orchestrator.ts),
`prepareDeferredRun` in [`ThreadLaunchService.ts`](../apps/server/src/orchestration-v2/ThreadLaunchService.ts),
and `OrchestrationV2DelegatedTaskWorkspaceStrategy` in
[`orchestrationV2.ts`](../packages/contracts/src/orchestrationV2.ts). User guide:
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
(`mod+alt+shift+n`, `attentionInbox.open`).

The inbox is derived on the client from thread shells and the client's existing read markers, so
it adds no server state or payload. Mobile does not show it, because the mobile client does not
track which threads you have read.

Code: [`attentionInbox.ts`](../packages/client-runtime/src/state/attentionInbox.ts),
[`SidebarAttentionInbox.tsx`](../apps/web/src/components/sidebar/SidebarAttentionInbox.tsx), and
the `attention-inbox` view in [`CommandPalette.tsx`](../apps/web/src/components/CommandPalette.tsx).
User guide: [thread-sidebar.md](./user/thread-sidebar.md#see-what-needs-you).

## Usage-limit recovery

Upstream shows a recovery banner when Codex or Claude ends a turn on a usage limit, with **Resume at
reset**, **Cancel auto-resume**, and **Snooze until reset**. The fork adds:

- **Resume now**, on web, desktop, and mobile, which sends the same "Continue where you left off."
  continuation into the same session at once. It is the `thread.usage-limit.resume-now` command, so
  the server owns the message and any client or future agent tool can send it. Servers advertise it
  with the `usageLimitResumeNow` capability; clients hide the button without it.
- **Continue in new tab** on web and desktop, which forks the chat onto another ready account or
  model through the [Chat tabs](#chat-tabs) fork, with the continuation as the new tab's prompt.
- A one-minute grace after the reported reset before an armed auto-resume is sent, since a request
  at the reset can still be refused.
- A notice in the stopped turn when auto-resume is scheduled or cancelled.
- Cursor stops count too. Cursor reports an exhausted allowance only as run error text ("You're out
  of usage…"), which upstream shows as a generic provider error; the fork recognizes it as a usage
  limit, so Cursor threads get the same banner. Cursor gives no reset time, so there is no
  auto-resume for them.

Code: `cursorRunFailure` in
[CursorAdapterV2](../apps/server/src/orchestration-v2/Adapters/CursorAdapterV2.ts), the `thread.usage-limit.resume-now` case and limit-recovery notice in
[Orchestrator](../apps/server/src/orchestration-v2/Orchestrator.ts), the grace in
[UsageLimitRecoveryWorker](../apps/server/src/orchestration-v2/UsageLimitRecoveryWorker.ts),
[UsageLimitRecoveryBanner](../apps/web/src/components/chat/UsageLimitRecoveryBanner.tsx), and
[UsageLimitRecoveryCard](../apps/mobile/src/features/threads/UsageLimitRecoveryCard.tsx). User guides:
[providers-codex.md](./user/providers-codex.md#codex-says-i-hit-a-usage-limit) and
[providers-claude.md](./user/providers-claude.md#usage-limits).

## Notion page context

Web and desktop support Notion OAuth sign-in in Integrations settings, where the user enters their own Notion connection's client ID and secret (kept on the server, with `T3CODE_NOTION_CLIENT_ID` and `T3CODE_NOTION_CLIENT_SECRET` as a fallback), page attachments from the paperclip picker and command palette, a Notion tab in the `#` menu, and conversion of pasted `notion.so`, `notion.com`, and `notion.site` page links to context chips. A pasted link to a page the connection cannot read stays as text, with a notice that opens the page in Notion and retries the conversion once the user shares it. Turning off **Enable Notion integration** in those settings keeps pasted Notion links as links without setup prompts and hides Notion attachment actions on web, desktop, and mobile for the environment, keeping the connected account. Mobile can pick pages using the environment's connection and inspect captured page contents. Pages are captured as bounded Markdown snapshots and sent through the shared context projection to every provider. Remote sign-in supports pasting the OAuth redirect URL back into settings.

Code: [NotionAuth](../apps/server/src/notion/NotionAuth.ts), [NotionApi](../apps/server/src/notion/NotionApi.ts), [NotionPagePicker](../apps/web/src/components/chat/NotionPagePicker.tsx), and [NotionPagePickerSheet](../apps/mobile/src/components/NotionPagePickerSheet.tsx). User guide: [Notion](./user/notion.md).

## Terminal colors, cursor, and line height

Themes carry the terminal's 16 ANSI colors. A VS Code import reads `terminal.ansi*` and fills unset
ones with VS Code's defaults, and the theme editor's advanced view edits them under **Terminal
colors**. Built-in themes keep Ghostty's stock palette. Appearance settings add **Terminal cursor**
(block, bar, or underline) and **Terminal line height**, and terminal text is centred on the
font's line box rather than its ink. This is web and desktop; mobile keeps its own terminal palette
and metrics.

Code: `TERMINAL_ANSI_ROLES` in [themePalettes.ts](../packages/shared/src/themePalettes.ts),
`applyPalette` and `setDefaultCursorStyle` in
[core.ts](../apps/web/src/terminal/ghostty/core.ts), `measureGhosttyCell` in
[renderer.ts](../apps/web/src/terminal/ghostty/renderer.ts), and the ANSI mapping in
[vscodeThemeImport.ts](../apps/web/src/vscodeThemeImport.ts). User guide:
[Appearance](./user/appearance.md#custom-themes).

## Terminals activate Python environments

**Activate Python environment in terminals** (off by default) and **Python interpreter path** make
new and restarted terminals activate a Python environment, like VS Code's
`python.terminal.activateEnvironment` and `python.defaultInterpreterPath`. An empty path finds a
`.venv` or `venv` in the terminal's working directory; a configured interpreter or environment
folder can be a virtual environment or a conda environment (`conda activate`). Both are
project-scoped settings, exposed in web, desktop, and mobile settings and in
`t3_environment_preferences_update`, and a repository can set the path with
`"pythonInterpreterPath"` in its `t3.json`.

Code: [pythonEnvironment.ts](../apps/server/src/terminal/pythonEnvironment.ts), called from
`startSession` in [Manager.ts](../apps/server/src/terminal/Manager.ts), which resolves the path with
`resolveTerminalPythonEnvironment`. User guide:
[Terminal](./user/terminal.md#python-environments).

## Expanded tool calls sit in a panel

An expanded tool call in the web and desktop timeline shows its call and output inside a rounded,
tinted panel, so the output stays visually separate from the assistant text around it. Upstream
renders them flush with the timeline. Inner cards and Input/Output labels stay removed as upstream
has them. Mobile follows upstream.

Code: the `panel` variant of `WorkLogDetails` in
[WorkLog.tsx](../apps/web/src/components/chat/WorkLog.tsx).

## Refresh the open file

The file viewer header has a refresh button, and `mod+r` (command `file.refresh`, when
`fileFocus`) does the same while the viewer has focus. It reads the file again and refetches
media and rendered pages, so a file outside the workspace that never triggers a workspace
mutation can still be brought up to date. See [the user guide](user/keybindings.md#refresh-a-file)
and [`FilePreviewPanel.tsx`](../apps/web/src/components/files/FilePreviewPanel.tsx).

## Type `>` in the file picker for commands

Typing `>` at the start of the file picker's (`mod+p`) search switches to the command palette's
actions-only search with the query kept, and deleting the `>` returns to file search. Upstream keeps
the two surfaces separate. See [the user guide](user/keybindings.md#jump-from-files-to-commands),
[`ProjectFilePicker.tsx`](../apps/web/src/components/files/ProjectFilePicker.tsx), and
[`CommandPalette.tsx`](../apps/web/src/components/CommandPalette.tsx).

## Keeping this page current

Update this page in the same change that adds, changes, or removes a user-visible fork-only
behavior. Rewrite the affected section so it describes the behavior as it is now. Link the code,
and the user guide when one exists. Do not append a changelog entry or describe the implementation
line by line.

Remove a section when upstream adopts the change or the fork drops it. An upstream sync includes
this check. A bugfix or refactor that leaves the described behavior the same does not need an
entry.

`README.md` only points here. Do not add a second feature list there.
