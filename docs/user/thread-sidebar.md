# Working with threads

Use a new thread for a separate task. Choose **New worktree** when its code changes
need a separate branch and working directory.

## Start a thread

On web and desktop, a new thread keeps the current project and carries your model
and mode selections, unless the destination project has its own model default.
Its branch and workspace mode come from your configured defaults. To continue in
an existing worktree, use **New thread in this worktree** from the branch toolbar.

To set up a thread before you know what to ask, leave the composer empty and click **Create
worktree** (**Create thread** in Local mode), or press Enter. The thread opens right away while
the worktree and its setup script get ready without starting the agent, so you can add files or
context first; sending waits until the setup is done. Your first message then names the thread and
its branch. This is not available on mobile.

When you change a new thread's project, T3 Code stays in the current environment
if that project exists there. Otherwise it selects an environment that has it.

### Continue in another tab

Click the tab name at the end of the header breadcrumb (`project / thread / tab`) and choose
**New tab** to open a separate chat in the same workspace. The same menu switches between tabs.
You can also hover a chat's sidebar row and click **+**, or right-click it and choose **New tab**.
Each tab has its own provider and conversation. Closing a tab archives it, so undo or
**Settings → Archived threads** brings it back. By default the sidebar shows one row per chat,
with a count of its tabs, and opening that row returns to the tab you last had open. Clicking the
chat's row while one of its tabs is already open leaves that tab selected.

On web and desktop, press `Cmd+Option+T` on macOS or `Ctrl+Alt+T` on Windows and Linux to list
each tab under its chat instead, with its own status, provider, and time. Clicking the tabs
button in the sidebar header does the same. Right-click it for a menu that hides tabs, lists every
tab, or lists up to a number of them per chat. Past that number the rest fold behind a **more** row, which also shows when a hidden tab is
working or needs you. Hover the collapsed row to see those tabs, and click one to open it. Expand
the row to list them in the sidebar; it folds again when you open a tab or thread. The
tab you have open always stays listed. Click a listed tab to switch to it. The same shortcut switches between hiding tabs and your
last choice, and the command palette and **Settings → General → Tabs in sidebar** set it too.

The same menu, or **Settings → General → Sort tabs by**, orders tabs by latest response, when
they were created, or when you last opened them, newest or oldest first. A new tab counts as the
newest, so it lands at the top of a newest-first list. These orders update as replies arrive, but hold still while your pointer is over the list. Drag a tab to put it where you
want; that switches to **Manual** order, and the notice that appears can undo the switch. Manual
order is kept in this browser or desktop app.

To switch tabs without listing them, hover the tab count on a chat's row and click a tab. To list
or fold one chat's tabs on their own, click the tab count. Changing the view for
every chat resets those choices. Moving, pinning, or settling the chat's row applies to the row,
and its tabs stay under it. Hover a listed tab and click **×**, or right-click it and choose
**Close tab**, to close it.

To bring in another tab's conversation, type `@` in the composer and pick the tab; its summary
lands as a chip at the cursor. On web and desktop, the same menu also lists other threads on that
server, from any project, by title, so you can pull in a chat that was never a tab here. You can
also choose **Thread** from the composer's attachment menu, or **Attach thread** from the command
palette, to search other unarchived threads on that server. Filter by project or provider, sort
by update time, creation time, or title, and hover a result to preview the summary you will attach.
A thread's tabs are listed together. Search by the thread's or the tab's title to find a tab,
then select the tab whose conversation you want to attach.
Before the first message in a new tab, you can also click a sibling
under **Include context from**; hover one first to preview its summary. The siblings follow the
sidebar's tab order and limit, so the tabs past the limit sit behind a **more** pill;
hover it to see which tabs those are. Move or delete
the chip like any other context.
The summary covers that chat's recent conversation, the commands and tools its agent ran, errors,
files it changed, and its latest plan, trimmed to fit.
The summary is captured when you click, so later changes in that chat do not change it. Tabs in
the same workspace can edit the same files, so review the current checkout before restoring
changes.

To retry a message with another model or provider on web or desktop, hover the message and click
**Fork into new tab**. The new tab's composer holds a summary of the chat up to that message,
followed by the message itself and its attachments. Pick a model, edit if you like, and send.
To continue from an agent response, use its **Fork from this response** action. The new tab
carries the conversation through that response, on the same model, ready for your follow-up.
Files the original chat changed after that message stay changed, since tabs share the workspace.

To carry on with a different model instead, open the model picker after the first message and
click the fork button on a model. A new tab opens on that model, with a summary of the chat and
a copy of what you had typed. Models the chat cannot switch to in place stay listed too, but
clicking their row does nothing; use its fork button. Picking another account in the composer's
account picker works the same way, and those accounts are marked **New tab**.
On mobile, tap **Hand off** beside the tab switcher and pick a provider and model.

### View two chats side by side

On web and desktop, you can show two chats next to each other, for example an implementation tab
beside its review tab. Each side is a full chat with its own timeline, composer, and right panel.

- **Open.** In the tab menu, hover a tab and click the split button. You can also right-click any
  thread in the sidebar and choose **Open in split view**, or press `Cmd+\` on macOS or `Ctrl+\`
  on Windows and Linux to open the tab you used most recently beside the current one.
  In the sidebar, you can also drag a tab onto another tab and hold it there until the row lights
  up, then let go.
- **Focus.** The focused side has a colored line along its top, and shortcuts act on that side.
  Click the other side, or press `Cmd+Option+\` / `Ctrl+Alt+\`, to move focus there.
- **Swap and resize.** Drag the small handle at the top of either side onto the other side to swap
  them. Drag the line between them to resize, or double-click it to make them equal again.
- **In the sidebar.** Both chats show a side-by-side icon, and the one you're not focused on has a
  lighter highlight.
- **Close.** Click **×** in either side's header to close that side. `Cmd+\` / `Ctrl+\`, the command
  palette, or **Close split view** in the sidebar menu closes the other side and keeps the focused one.

Each side's tab menu switches only that side. Opening a chat that is not in the split shows it on
its own, and going back to either chat brings the split back. Split view needs a wide window;
narrower windows and the mobile app show one chat at a time.

### Start without a project

A thread does not need a project. To start one without a project, click **or
start without a project** under a new thread's heading, pick **No project** from
the project menu in that heading or from **New thread in...** in the command
palette, or press `mod+alt+n`. On mobile, pick **No project** from the project
list. It starts on your current machine; before sending, pick another machine
from the machine menu to move it there. To move a draft into a project, pick the
project in the heading.

Each thread without a project works in its own folder under `~/.t3/scratch` (the
`scratch` folder of your T3 data directory), named after its date, the first words
of its first message, and a short id, like
`2026-09-25-convert-these-pngs-to-webp-a1b2c3d4`. Deleting a thread keeps its
folder, so the files the agent wrote stay until you delete them. Branch, worktree, and diff controls stay hidden because
these folders are not Git repositories. This is unavailable when the data
directory itself sits inside a Git checkout.

### Start in the background

In a desktop browser or the desktop app, press `Cmd+Enter` on macOS or `Ctrl+Enter`
on Windows and Linux to start a new thread and immediately open another draft. The
next draft keeps the workspace mode and base branch you selected. With **New
worktree**, each background submission creates its own worktree.

To send the same prompt to several models on web or desktop, **Shift-click** models
in a new thread's model picker to add or remove them. A regular click returns to a
single model. Choose a base branch and send. Each selection starts a separate thread
and worktree while you stay in the new thread composer. This requires a Git project.

## See what needs you

On web and desktop, the inbox button appears in the sidebar header while a thread needs you. It
lists threads from every project and chat tab that are waiting for an approval or an answer, that
failed, or that finished since you last opened them. Click an entry to open that exact tab. Use
the check mark to mark a failure or completion read; **Mark unread** in the thread menu brings a
completion back. Approvals and questions stay listed until you answer them. Snoozed threads stay
out until they wake or ask for you. Press `Cmd+Option+Shift+N` on macOS or `Ctrl+Alt+Shift+N` on Windows
and Linux, or search the command palette for **Needs attention**, to see the same list.

## Pin and reorder threads

Pin a thread from its menu to keep it above your active work.

On web and desktop, unpinning, settling, snoozing, and archiving a thread each show
a notification with **Undo** for five seconds. Undo restores the thread's previous
state, including its pinned position, and reopens an archived thread you were
viewing. Discarding an unsent draft from the sidebar works the same way: Undo brings
back its text and attachments. `mod+z` triggers the most recent Undo when no text field is focused; see
[Keybindings](./keybindings.md#commands-with-special-behavior).

On web and desktop, you can also drag files from your computer onto any thread row:
the thread opens and the files are attached in its composer, ready for
your next message. The same per-message file limits apply as when attaching
files directly; see [Attach files](./composer.md#attach-files).

On web and desktop, pinning or unpinning a thread keeps the sidebar at your current
scroll position instead of following the thread to its new place in the list.

Pinning does not prevent automatic settlement. Settling a thread removes its pin.

The thread list shows live work. To also see snoozed, hidden, or settled threads, open the filter
button in the sidebar header on web and desktop, or the thread list's filter menu on mobile, and
pick them under **Show**. Pick as many as you like, or **Only** to show one; each appears as its
own titled group below your live threads. On web and desktop, click a group's title to collapse
it, and click again to expand it. **Organisations** narrows the list to repositories
owned by the people or organisations you pick, read from each project's Git remote, and
**Projects** narrows it to the projects you pick. On web and desktop, the filter button shows how
many filters are on, hovering it lists the ones that are selected, and each one appears as a pill
under the search bar: click its × to remove it, or **Clear all** to go back to the default list.

On web and desktop, while only **Threads** is shown, drag a thread up into the pinned section to
pin it at the spot you drop it; drag a pinned thread down into the active list to unpin it. Dragging a pinned thread out of the pinned section does not
ask for unpin confirmation. Pinned and active boundary labels appear only while dragging, without
moving the rows. The other rows slide aside to show where the thread will land. When you cross
into the other section, the dragged thread shows **Pin** or **Unpin**. Its status and hover
actions hide during the drag. Reordering within the same section shows no badge. When there are
no pins, drag to the top edge to pin a thread.

Drag within the pinned or active section to change its order. Other rows slide aside to show the
spot where the thread will land. Drops into either section keep the position you choose. On
mobile, open a thread's menu and choose **Arrange threads**. Drag a handle within or between
**Pinned** and **Active** to reorder, pin, or unpin. Drop onto the **Settled** divider to
settle a thread. The dragged card shows the action before you release it. Expand **Snoozed**
or **Settled** to drag a parked thread back into either live section. Each drop saves; **Done** returns to the thread list.
**Move up** and **Move down** are also available in the thread menu. The server
saves the order, so it survives a refresh and appears on your other connected devices.

On web and desktop, the list also animates section changes made with thread actions such as
**Pin**, **Settle**, and **Snooze**. These transitions respect your system's reduced-motion
preference. While dragging, rows follow the insertion gap without replaying a second transition
after the drop.

New threads appear above the active threads you have arranged. Settling clears a thread's active
position, so using **Un-settle** returns it to the top. Pinning and snoozing preserve its active
position until you move it again. Thread activity does not change the order. Settled threads are
listed by settlement time.

If dragging is unavailable for one environment, update the T3 Code server running in that
environment. Pinned and active reordering require server support. Threads from older servers keep
their default order until the server is updated.

To generate a fresh title from the conversation, open a thread's menu and choose
**Regenerate title**. The action is unavailable while title generation is in progress
or when the connected environment needs a server update.

Agents connected through T3 Code can use the same server-owned metadata workflow to
rename a thread, regenerate its title, or link and unlink a pull request. These changes
appear on web, desktop, and mobile without requiring the originating browser to remain
open.

### Fold working threads (beta)

Turn on **Settings → General → Working section (beta)** on web and desktop, or **Settings →
Thread behavior → Working section** on iOS and Android, to move threads that are working or
monitoring into a collapsed **Working** section below the active list. A thread returns to the top
of the active list when it finishes, fails, or needs an approval or answer. The Working section
lists the thread you last sent work to first. Pinned threads stay in the pinned section. Each
device keeps its own choice.

While this is on, the active list is ordered by when each thread last came back to you, so you
cannot drag or move threads within it. Your saved order returns when you turn it off.

## Settle finished work

Choose **Settle thread** from its menu to move finished work out of the active list
without deleting the conversation. **Un-settle thread** restores it to active work
and prevents automatic settlement until new activity resumes the usual rules.
Manually settling an idle thread dismisses unanswered async questions without
sending an answer or restarting the agent. Settling also closes the thread's
terminals that wait at an idle prompt, and keeps their output. A terminal that
runs a command, such as a dev server, stays open.

To reclaim disk space from settled work, turn on **Run in the thread's worktree when the
thread settles** for one of the project's actions, or set `"runOnSettle": true` on a
`t3.json` script, for example `cargo clean`. It runs each time a thread in its own
worktree settles, manually or automatically, even if a terminal there still runs a
command such as a dev server. Threads in the project's main checkout skip it. Its terminal
closes when the command succeeds and stays open when it fails.

On web and desktop, press a thread's **Settle** button and drag up or down to
settle every thread in that section between it and the one you release on.
The **Un-settle** and **Wake** buttons work the same way in their sections.
Press `Escape` while dragging to cancel.

By default, environments settle inactive threads after three days and settle
threads whose pull request merged. A closed pull request can also settle an idle
thread. Work in progress, pending questions or approvals, and live background work
prevent automatic settlement. An open pull request does not prevent inactivity
settlement, but an old closed or merged pull request does not settle work you
resumed after it closed. Only your own messages count as resuming. A turn that
finished background work or a pull request watch starts on its own does not.

To keep one thread from settling on its own no matter how long it sits idle, open its menu,
choose **Auto-settle behavior**, and pick **Disabled**. The current option is checked. Pick
**Enabled** to return to the usual rules. Manual settle, snooze, and archive still work while it
is disabled.

Change these rules in **Settings → General** on web and desktop, or **Settings → Thread behavior** on mobile.
They continue to run when your apps are closed. On web and desktop, choose an environment at the
top to change only its rules, or **All environments** to update connected environments together.
Mixed values show where the selected environments disagree. Mobile applies these
rules to connected environments that support shared settings. Offline environments
and older servers keep their previous values. Changing a rule does not reopen
already settled threads.

## Link a pull request

The server finds the PR for each unsettled thread's saved branch, even when your
apps are closed. Settled threads keep their saved links. Update the server if
automatic branch links do not appear.

On web and desktop, right-click a pull request link in a thread and choose
**Link to thread** to select a different PR. Use **Unlink from thread** on the
same link to return to the branch PR, if one exists.
The linked pull request participates in automatic settlement.

## Find and reference work

On web and desktop, open the command palette with `Cmd/Ctrl+K` to search threads
across connected environments. Message search starts after two characters and
includes your messages and final agent responses.

Use **Settings → Keybindings** to find or customize shortcuts for searching files
and copying a thread reference. A copied reference uses the thread's pull request
link when available, otherwise its thread ID. See [keybindings](./keybindings.md)
for custom configuration.

## Export a transcript

On web and desktop, right-click a thread or tab and choose **Export transcript…**, or run
**Export transcript** from the command palette, to bring a conversation into another app. If the
chat has more than one tab, pick which tab to export at the top of the preview. Choose
**Concise** for just the prompts and replies, or **Full** to also include the commands, tool calls,
file edits, and plans. Turn off **Header** to drop the project, branch, and model details at the
top. **Save…** saves a Markdown file on the device you are using, even when the thread runs on a
remote server; **Copy** puts the same Markdown on your clipboard.

## Import a CLI conversation

On web and desktop, run **Import conversation…** from the command palette, or right-click a
project in the legacy sidebar and choose **Import conversation…**, to bring in a Claude Code or
Codex conversation you started in a terminal. The list covers all your projects; use **Filters**
to narrow it to one project or source. It shows conversations from the last 30 days
that ran in the project's folder on the computer hosting it, newest first, with their first
prompt, message count, and age. Choosing one creates a thread with its messages. Your next message
continues the same Claude or Codex session, so the agent keeps its full context. Close the CLI
session first so both sides do not write to it at once.

Conversations that already have a thread, including ones T3 Code started itself, show **Open**
instead. An archived thread does not count, so importing makes a fresh one. Imported history keeps the first prompt and the newest 200 messages, without tool
activity or attachments. Other providers and the mobile app do not offer import.

## Import a Conductor workspace

The same picker lists the project's active Conductor workspaces when Conductor is installed on the
Mac hosting the project. Choosing one brings the workspace's open tabs over as chat tabs of one
thread, on the same branch and in the same worktree, so your files, changes, and Conductor notes
are where Conductor left them. Images and files you sent come along, and diff comments you sent to
the agent appear in their message. Claude Code and Codex tabs continue their agent session; Cursor
tabs start a new session that is given the earlier conversation. Terminal history does not come
along. Conductor itself is not changed.

**Import all Conductor** brings in every active workspace shown for the projects you're viewing.
You can stop it and run it again; workspaces that already have threads are left as they are. Turn
on **Include archived** to also bring in workspaces you archived in Conductor. Those become settled
threads, so they stay out of the live list until you show settled threads. Conductor has usually
deleted an archived workspace's folder, so the thread keeps the conversation but not a working copy.

The worktree of an active workspace still belongs to Conductor. Stop using that workspace in
Conductor once you move it, and do not archive it there, or Conductor deletes the folder the thread
runs in.

## Inspect agent work

**Limited** means the provider stopped on a usage or rate limit. The conversation
keeps the provider's explanation. Retry after the limit resets, or switch to
another provider instance.
On web and desktop, press **Resume** in an empty composer to continue a limited
or interrupted turn manually.
Queued messages stay saved while the limit blocks the thread. They run after
the continuation finishes. If the queue was held by a restart, resume it then.

When the provider reports a reset time, choose **Resume at reset** to schedule a
continuation. You can cancel it from the thread. Enable **Auto-resume limited
threads** in **Settings → General** on web and desktop, or **Settings → Thread
behavior** on mobile, to schedule limit stops by default.
The environment must be running when the reset arrives; it resumes overdue
continuations after a restart. Sending a new message, archiving, or settling the
thread prevents a pending continuation from starting.

Choose **Snooze until reset** to hide the thread until its allowance returns.
Snooze and auto-resume are independent: snooze alone wakes the thread without
sending a message; enabling both wakes and continues it. **Wake now** cancels
the snooze. Enable **Snooze limited threads** in thread behavior settings to
snooze limit stops by default. Providers without a reset time offer manual
retry and the normal snooze choices.

Each subagent runs in its own thread. On web and desktop there are two places to follow them:

- **Agents** in the side panel lists every agent of the thread, including agents that an agent
  started, indented under it. Open it from the side panel's launcher or **+** menu, the command
  palette (**Show agents**), or the button in the **Lineage** header. In the conversation, choose
  **Details** on an agent's row to open the panel on that agent, or the bot button next to it for
  the whole list; clicking the row itself still opens the agent's thread. Right-click an agent in
  the conversation or in Lineage and choose **Show in Agents panel** to do the same. The footer
  counts agents by status and adds up the usage they reported; hover a number for its label, or
  the total for the full breakdown. The launcher's badge counts working agents, including agents
  started by agents.
- **Lineage** in the thread details panel lists the agents this thread started, next to its forks;
  click one to open its thread and read its whole conversation. The Agents panel's Lineage button
  brings you back here.

With two or more agents you can search either list, filter it by status, or sort it by status,
tokens, or duration; both lists share the same filter and sort. Agents are listed in the order they
started, and token and duration sorts keep working agents at the top in that order, so rows don't
jump while you read them. A working agent's row shows its latest tool call, with `…` while the call
runs and **waiting** when the agent needs you, and a failed agent's row its error. Hover an agent in
the Agents panel to preview its model, prompt, result, latest tool calls, and usage; the preview
stays open while you move onto it, so you can hover a tool call inside it to see the whole call.
Click the preview to open the agent, or click a tool call to open the agent with that call expanded.
Hover an agent in Lineage to preview its model, status, result, and token usage.

Click an agent in the Agents panel to see what it is doing without leaving the panel. You get its
status, model and reasoning effort, how many times it has run, and its running time; the prompt it
was given (choose **Show all** for a long one); its result or error; any files or remote session it
left under **Artifacts**; and the agents it started. Click one of those to look inside it too.
**Back** goes up one level, and from the top back to the list. Below the header, **Tool calls** lists
the agent's tool calls (click the heading to switch to **Transcript**); hover or click one to see its command, output, or diff. **Transcript**
follows the agent live: its messages, the reasoning it shares, and each tool call as it runs, each
with its time. Click a call or thought to expand its command, output, or diff. While you are at
the bottom, new activity scrolls into view; scroll up to read and it stays put. **Tools** lists
calls newest first; filter them by status or tool, or sort oldest first or by duration. Search either view; a search or filter shows how many entries it kept. Paths read
relative to the checkout the agent works in, including a separate worktree it was given. The
footer shows the agent's token usage, and its runs and retries when there were several; hover a
number for its label, or the total for the full breakdown.

An agent that has not started its own thread yet still opens, with its prompt, result, and usage;
its activity appears once it starts.

**Stop agent** shows when the agent's own thread can be interrupted. Some subagents, such as
Claude's, stop only when you stop the parent thread. Stop on a thread also stops the subagents it
delegated to.

To keep an agent beside the list, choose **Open in new tab** in its detail, or right-click it
anywhere and choose the same. The agent gets its own tab in the side panel with the same view.
The detail's buttons also open the agent's own thread. The Agents panel and agent tabs belong to
the current thread and are restored when you reopen the app; the agent you had open inside the
panel is not. Close a tab with its close button and open it again the same way.

To use what an agent found in your next message, choose **Attach result to chat** in its detail or
from the right-click menu. T3 Code adds the agent's task and result to the composer; a long result
becomes a pasted attachment.

To pick up an agent's line of work in its own conversation, choose **Continue in chat**. A new chat
tab opens with the agent's task, result, and tool calls attached, so you can ask follow-up questions
or push the investigation further. The new chat starts fresh with that context; it does not resume
the agent itself.

Claude and Codex report each agent's token usage. A delegated task's usage appears once it
finishes, on any provider that reports usage for its own turns (Claude, Codex, Cursor, and
OpenCode). Agents built into other providers show the usage as not reported.
When a provider doesn't report an agent's tool calls, **Tools** says so and shows the agent's
latest progress while it works.

Subagent threads started by the agent can't take messages; message the parent
thread instead. When such a subagent needs an approval or an answer, the parent
thread asks for it.

Expand a tool call in the conversation to see its full command and output.
Summaries shorten shell wrappers and can still describe the latest call after it
finishes; the call's own result shows its status.

## Snooze until later

Choose **Snooze → Custom…** from a thread's menu to pick a date and time in your
local time zone, or a duration in minutes, hours, or days. Durations start when
you confirm; one day means 24 hours. On web and desktop, you can also snooze
several selected threads together. Choose **Wake thread** to bring a thread back early.

## Hide a thread

Choose **Hide thread** from a thread's menu to take it out of your thread list without settling,
snoozing, or archiving it. A thread with chat tabs hides and unhides together, so every tab
leaves the list and comes back with it. The thread keeps working and still turns up in search.
New activity does not bring it back, but a hidden thread that needs an approval or an answer still
appears in the inbox. Pick **Hidden** under **Show** in the filter menu, described in
[Pin and reorder threads](#pin-and-reorder-threads), to see hidden threads. Choose **Unhide
thread** from a thread's menu, or the eye on its row on web and desktop, to put it back. Hidden threads are saved on the server, so they stay
hidden on your other devices.

On web and desktop, **Settings → General → Thread views** lets you choose detailed cards or
compact rows separately for active, pinned, working, grouped, hidden, snoozed, and settled
threads. Hidden threads start with detailed cards so their project and branch remain visible.

## Group threads

Make your own groups, such as "Research" or "Later", to file threads away from your live list.
Choose **Move to group → New group…** from a thread's menu to create one and move the thread into
it, or **New group…** under **Show** in the filter menu to create an empty one. Each group has a
name, an optional icon, and an accent colour. A grouped thread leaves your live thread list and
keeps working. Pick a group under **Show** to list it, alone or alongside other groups and your
live threads. Groups stay until you delete them, even when empty.

To file a project's new threads automatically, open the project's settings and pick a group under
**New threads → Thread group**. Every new thread in that project starts in the group, however it
was started, including by agents and scheduled tasks. A fork starts in the same group as the thread
it came from.

On web and desktop, click the pencil on a group's title, or right-click it, to rename it, change
its look, or delete it. Renaming moves every thread in it; deleting returns its threads to your
live list. Choose **Move to group → Remove from group** to bring one thread back. Groups are saved
on your servers, so they appear on your other devices.
