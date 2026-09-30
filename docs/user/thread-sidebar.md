# Working with threads

Use a new thread for a separate task. Choose **New worktree** when its code changes
need a separate branch and working directory.

## Start a thread

On web and desktop, a new thread keeps the current project and carries your model
and mode selections, unless the destination project has its own model default.
Its branch and workspace mode come from your configured defaults. To continue in
an existing worktree, use **New thread in this worktree** from the branch toolbar.

To set up a thread before you know what to ask, leave the composer empty and click **Create
worktree** (**Create thread** in Local mode), or press Enter. The worktree and its setup script get
ready without starting the agent, so you can add files or context first. Your first message then
names the thread and its branch. This is not available on mobile.

When you change a new thread's project, T3 Code stays in the current environment
if that project exists there. Otherwise it selects an environment that has it.

### Continue in another tab

Click the tab name at the end of the header breadcrumb (`project / thread / tab`) and choose
**New tab** to open a separate chat in the same workspace. The same menu switches between tabs.
You can also hover a chat's sidebar row and click **+**, or right-click it and choose **New tab**.
Each tab has its own provider and conversation. Closing a tab archives it, so undo or
**Settings → Archived threads** brings it back. By default the sidebar shows one row per chat,
with a count of its tabs, and opening that row returns to the tab you last had open.

On web and desktop, press `Cmd+Option+T` on macOS or `Ctrl+Alt+T` on Windows and Linux to list
each tab under its chat instead, with its own status, provider, and time since your last message.
The tabs button in the sidebar header, the command palette, and **Settings → General** toggle the
same view. Moving, pinning, or settling the chat's row applies to the row, and its tabs stay under
it. Hover a listed tab and click **×**, or right-click it and choose **Close tab**, to close it.

To bring in another tab's conversation, type `@` in the composer and pick the tab; its summary
lands as a chip at the cursor. On web and desktop, the same menu also lists other threads on that
server, from any project, by title, so you can pull in a chat that was never a tab here. Before the first message in a new tab, you can also click a sibling
under **Include context from**; hover one first to preview its summary. Move or delete the chip like any other context.
The summary covers that chat's recent conversation, the commands and tools its agent ran, errors,
files it changed, and its latest plan, trimmed to fit.
The summary is captured when you click, so later changes in that chat do not change it. Tabs in
the same workspace can edit the same files, so review the current checkout before restoring
changes.

To retry a message with another model or provider on web or desktop, hover the message and click
**Fork into new tab**. The new tab's composer holds a summary of the chat up to that message,
followed by the message itself and its attachments. Pick a model, edit if you like, and send.
To continue from an agent response, use its **Fork into new tab** action. The new composer holds
only a summary attachment covering the chat through that response, ready for your follow-up.
Files the original chat changed after that message stay changed, since tabs share the workspace.

To carry on with a different model instead, open the model picker after the first message and
click the fork button on a model. A new tab opens on that model, with a summary of the chat and
a copy of what you had typed. Models from other providers are listed too. A chat cannot switch to
them in place, so clicking the row does nothing; use its fork button. Picking another account in
the composer's account picker works the same way, and those accounts are marked **New tab**.

### Start in the background

In a desktop browser or the desktop app, press `Cmd+Enter` on macOS or `Ctrl+Enter`
on Windows and Linux to start a new thread and immediately open another draft. The
next draft keeps the workspace mode and base branch you selected. With **New
worktree**, each background submission creates its own worktree.

To send the same prompt to several models on web or desktop, **Shift-click** models
in a new thread's model picker to add or remove them. A regular click returns to a
single model. Choose a base branch and send. Each selection starts a separate thread
and worktree while you stay in the new thread composer. This requires a Git project.

## Pin and reorder threads

Pin a thread from its menu to keep it above your active work.

On web and desktop, unpinning, settling, snoozing, and archiving a thread each show
a notification with **Undo** for five seconds. Undo restores the thread's previous
state, including its pinned position, and reopens an archived thread you were
viewing. `mod+z` triggers the most recent Undo when no text field is focused; see
[Keybindings](./keybindings.md#commands-with-special-behavior).

On web and desktop, you can also drag files from your computer onto any thread row:
the thread opens and the files are attached in its composer, ready for
your next message. The same per-message file limits apply as when attaching
files directly; see [Attach files](./composer.md#attach-files).

On web and desktop, pinning or unpinning a thread keeps the sidebar at your current
scroll position instead of following the thread to its new place in the list.

Pinning does not prevent automatic settlement. Settling a thread removes its pin.

On web and desktop, drag a thread between sections to change its state. Drag a thread up into
the pinned section to pin it at the spot you drop it; drag a pinned thread down into the active
list to unpin it. Dragging a thread onto the **Settled** header settles it, and dragging a settled
thread into the active list un-settles it. A snoozed thread can be dragged out of the snoozed
shelf, which wakes it, but threads cannot be dragged into the shelf because snoozing needs a wake
time. Dragging a pinned thread out of the pinned section does not ask for unpin confirmation.
Pinned and active boundary labels appear only while dragging, without moving the rows. The
other rows slide aside to show where the thread will land. When you cross into another section,
the dragged thread shows the action the drop performs, with its icon: **Pin**, **Unpin**,
**Settle**, **Un-settle**, or **Wake**. Its status and hover actions hide during the drag. A pinned
thread keeps its pin only while it stays in the pinned section; once it leaves, the badge takes
over. Reordering within the same section shows no badge. When there are no pins, drag to the top
edge to pin a thread. Section labels stay readable for the whole drag, and the section the
thread is over takes the accent color. Section labels also
identify empty sections and a collapsed settled shelf.

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
position until you move it again. Thread activity does not change the order. The settled shelf
continues to use settlement time.

If dragging is unavailable for one environment, update the T3 Code server running in that
environment. Pinned and active reordering require server support. Threads from older servers keep
their default order until the server is updated.

## Settle finished work

Choose **Settle thread** from its menu to move finished work out of the active list
without deleting the conversation. **Un-settle thread** restores it to active work
and prevents automatic settlement until new activity resumes the usual rules.
Manually settling an idle thread dismisses unanswered async questions without
sending an answer or restarting the agent. Settling also closes the thread's
terminals that wait at an idle prompt, and keeps their output. A terminal that
runs a command, such as a dev server, stays open.

By default, environments settle inactive threads after three days and settle
threads whose pull request merged. A closed pull request can also settle an idle
thread. Work in progress, pending questions or approvals, and live background work
prevent automatic settlement. An open pull request does not prevent inactivity
settlement, but an old closed or merged pull request does not settle work you
resumed after it closed.

To keep one thread out of the settled shelf no matter how long it sits idle, open its menu,
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

## Inspect agent work

On web and desktop, use **Agents** to follow work delegated to subagents.
Search the list, filter it by status, or sort it by status, tokens, or
duration. Token and duration sorts rank finished agents; agents still working
stay at the top in launch order, so rows don't jump while you read them.

Each agent is one line. Working agents add their latest tool call underneath
and failed agents their error. Hover an agent to preview its prompt, latest
tool calls, and usage; the preview stays open while you move onto it, so you
can hover a tool call inside it to see the whole call. Click the preview, or
the agent, to open it; clicking a tool call opens the agent with that call
expanded.

Open an agent to see the prompt it was given, its full result or error, the
tool calls it made, and its token usage in the footer (hover a number for its
label, or the total for the full breakdown). In the conversation, expand an
agent in its launch row and choose **Show details** to open it directly.

Right-click an agent in the list and choose **Open in new tab**, or use the
same action in its detail view, to keep it in a dedicated sidebar tab. You can
keep several agents open while using the Agents list to inspect others. Close a
tab with its close button; right-click the agent again, or open its detail
view, to reopen it. **Agents** in a dedicated tab returns to the list.
Tabs belong to the current thread and are restored when you reopen the app.

Tool calls list newest first. Search them, filter by status or tool, or sort
oldest first or by duration. Hover a call to preview all of it; click to keep
it open. The menu on the **Tool calls** heading switches to the **Transcript**,
the agent's own conversation fetched from the provider, which you can search,
filter, and sort the same way. Transcripts work while the thread's provider
session is running.

| Provider    | Tool calls | Prompt                | Transcript |
| ----------- | ---------- | --------------------- | ---------- |
| Claude      | Yes        | Yes                   | Yes        |
| Codex       | Yes        | When Codex reports it | Yes        |
| OpenCode    | Yes        | Yes                   | Yes        |
| Cursor      | Yes        | Yes                   | No         |
| Devin       | Yes        | Yes                   | No         |
| Grok        | No         | Yes                   | No         |
| Antigravity | No         | No                    | No         |

Antigravity reports subagents as one row per batch.

Expand a tool call in the conversation to see its full command and output.
Summaries shorten shell wrappers and can still describe the latest call after it
finishes; the call's own result shows its status.

## Snooze until later

Choose **Snooze → Custom…** from a thread's menu to pick a date and time in your
local time zone, or a duration in minutes, hours, or days. Durations start when
you confirm; one day means 24 hours. On web and desktop, you can also snooze
several selected threads together. Choose **Wake thread** to bring a thread back early.
