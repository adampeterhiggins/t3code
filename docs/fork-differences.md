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

## Devin provider

Adds Devin as a provider, driven through the local `devin` CLI's ACP server (`devin acp`).

- Sessions, steering, interrupts, permission requests, and form-mode elicitations run over the
  shared ACP runtime. T3 runtime modes map onto Devin's session modes.
- Models come from `devin models list`. Devin encodes effort, speed, and context in each model id,
  so the catalog groups variants into one picker row per model with effort/speed/context options.
- T3's MCP endpoint, `devin skills list` (`$skill` dispatch), token usage, and pricing are wired
  in, so the context meter and the usage page cover Devin. Conversation rewind is not supported.
- Devin also generates commit messages, PR content, branch names, and thread titles.
- The welcome wizard lists Devin with an **Enable** action, since the provider is opt-in.

Code: `apps/server/src/provider/**/Devin*`, `apps/server/src/provider/devinModelCatalog.ts`,
`apps/server/src/textGeneration/DevinTextGeneration.ts`, `apps/server/src/usage/devinAccountUsage.ts`,
and `DevinSettings` in `packages/contracts/src/settings.ts`. User guide:
[providers-devin.md](./user/providers-devin.md).

## Provider sign-in methods

Each provider's **Settings > Providers** card gets a sign-in section with a method picker: the
provider's CLI login flow, saved credentials, or a pasted key. The chosen method is persisted.
Codex defaults to the browser flow.

Code: `apps/web/src/components/settings/ProviderAuthSection.tsx`,
`apps/server/src/provider/Services/ProviderAuthService.ts`, and
`packages/contracts/src/providerSetup.ts`.

## Chat tabs

A thread can have several chat tabs that share one workspace (same checkout and worktree). Each tab
is its own conversation and provider.

- **Storage.** Every tab is a normal thread. Tab membership lives in the fork-owned
  `fork_thread_tabs` table, created by `ensureThreadTabsSchema` in
  `apps/server/src/threadTabs/schema.ts`. It is versioned in a separate `fork_schema_migrations`
  table so upstream's numbered migrations are never touched.
- **Server.** `apps/server/src/threadTabs/http.ts` serves the `threadTabs` HTTP group: list a
  group, list all memberships, create a tab, and summarize sibling tabs. Checkpointing lets tab
  siblings share a worktree (`sharedWorkspace.ts`, `CheckpointReactor.ts`). A turn started in any
  tab unsettles the group's settled tabs, since the group shows as one sidebar row
  (`settlement.ts`).
- **Sidebars.** Child tabs are hidden from the thread lists; only the original thread's row shows,
  and it stays highlighted while any of its tabs is open. This applies to the web sidebar, the
  legacy project sidebar, and both mobile thread lists (`useHiddenTabThreads`).
- **Web header.** The breadcrumb reads `project / thread / tab`. The thread crumb keeps the thread
  action menu and acts on the original thread; the tab crumb opens a menu to switch tabs or create
  one (`apps/web/src/components/chat/ThreadTabs.tsx`, `ChatHeader.tsx`).
- **Context from other tabs.** In an empty tab, pills above the composer list sibling tabs.
  Clicking one captures that tab's summary as a `thread-tab` context chip at the caret, which can
  be moved like any other chip. It is a new known kind in
  `packages/contracts/src/composerContext.ts`, formatted for providers in
  `packages/shared/src/composerContextReferences.ts`, and rendered in the composer and in sent
  messages.
- **Mobile.** Mobile has the older tab bar and send-time context selection
  (`apps/mobile/src/features/threads/ThreadTabs.tsx`); it does not yet have the header crumb or
  context chips.

User guide: [thread-sidebar.md](./user/thread-sidebar.md#continue-in-another-tab).

## Desktop mock-update loop

A `Makefile` at the repository root drives a local auto-update test loop for the desktop app:
create a trusted self-signed certificate once, build signed mock-feed payloads, serve the feed, and
install the first build into `/Applications`. `T3CODE_DESKTOP_IDENTITY` makes
`scripts/build-desktop-artifact.ts` sign with any keychain identity, because the updater refuses to
install ad hoc–signed builds. Run `make` targets from the repository root, starting with
`make update-cert`.

## Keeping this page current

Add a section when the fork gains a user-visible difference, and remove it when upstream adopts the
change or the fork drops it. Link to the code rather than describing it line by line.
