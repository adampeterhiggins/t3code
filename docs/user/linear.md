# Linear

Connect a Linear account, then attach Linear issues to messages as context for the agent.

## Connect an account

1. Open **Settings > Integrations** and find **Linear**. On mobile, open **Settings > Linear**.
2. Click **Connect Linear**. Linear's approval page opens in your browser.
3. Choose your workspace and click **Approve**.

The account belongs to the T3 Code server you're connected to, not to one device. Every client
that uses that server (desktop, web, or mobile) can attach issues from it. T3 Code asks for
read-only access.

### Approving from another device

Linear sends your browser back to `http://127.0.0.1:47831/callback` on the machine running the
server. If you approve on a different device, such as a laptop connected to a remote server or
your phone, that page won't load. Copy its full URL from the address bar and paste it into
**Approving from another device?** under the Linear setting.

Sign-in needs port 47831 free on the server machine while you approve.

## Attach an issue

Attach a Linear issue to a message so the agent gets its details without you pasting them in:

- Click the paperclip in the composer and choose **Linear issue**. Search your issues, or paste an
  identifier like `ENG-123` or an issue link. With no search, it lists your open assigned issues.
- Type `#` in the composer. Linear issues appear beside pull requests; `#ENG-123` jumps to that
  issue, and a bare number like `#42` only matches pull requests.
- On web and desktop, run **Attach Linear issue** from the command palette.
- On mobile, tap **+** in the composer and choose **Linear issue**.

The picker's filter menus narrow the list by assignee, team, project, milestone, status, priority,
and label, and **Sort** orders it by last update, creation, priority, due date, status, or title. It
starts on your open assigned issues and remembers your filters on each device. Search text applies
on top of the filters and ranks results by relevance unless you sort by created or updated time.
Statuses and labels match by name across teams. **Reset** returns to the defaults.

The issue appears as a chip in your message. Hover or tap it to see what the agent receives: the
title, state, priority, assignee, labels, description, sub-issues, links, and recent comments.
Long issues are trimmed, dropping the oldest comments first.

The issue is copied when you attach it, so later edits in Linear don't change a message you
already sent. Chips in an unsent draft don't survive a reload; attach the issue again.

## Link an issue to a thread

A linked issue stays with the thread and all of its chat tabs, so you can see which issue the work
is for and find that work again later. A thread links one issue at a time.

- On web and desktop, choose **Link Linear issue…** from the thread's menu (the sidebar row or
  the chat header title), or run **Link Linear issue** from the command palette.
- Starting a new thread from an issue with the composer's **⋯** picker links that issue too.
- On mobile, tap **Link issue** beside the tab switcher, or choose **Link Linear issue** from the
  tab menu.
- Agents can link or unlink the issue for their thread themselves, for example when you ask them
  to pick up `ENG-123`.

The chat header (on mobile, the tab switcher) then shows the issue's identifier and its current
Linear status. Click or tap it to open the issue, change it, or unlink it. The status is read
from Linear, so it can lag for up to a minute after a change there.

When you start a thread from an issue that another thread is already linked to, the picker marks
it **In use** and asks whether to open that thread or start a new one.

## Start threads when issues are assigned to you

T3 Code can start a thread on its own when a Linear issue is newly assigned to you. It's off until
you add a rule.

1. Open **Settings > Integrations > Linear** and click **Add rule** under **Start threads from
   assignments**.
2. Pick the project the work belongs in and the model to run it with. Optionally narrow the rule
   to one Linear team or one label, and write the prompt the thread starts with.
3. Click **Save**.

Each matching issue starts one thread in a new worktree, with the issue attached to the first
message and linked to the thread. The server checks Linear every 2 minutes, so a thread can take
that long to appear. The server has to be running; assignments made while it's off are picked up
when it starts again.

Issues already assigned to you when you add a rule never start threads, and neither do issues
already assigned when you change a rule's team or label, switch Linear accounts, or turn the
last rule off and on again. An issue starts at most one thread, even if several rules match or you
unassign and reassign it. An issue assigned without the rule's label starts a thread once it gets
the label. Completed and canceled issues are skipped.

Adding or changing rules needs permission to run tasks on the server, like scheduled tasks. On
mobile, **Settings > Linear** lists each server's rules so you can remove them; add and edit rules
from desktop or web.

## Open issues in the Linear app

The **Open in Linear** link on an issue chip follows **Open links in** by default. To open issues in
the Linear desktop app instead, set **Settings > Integrations > Linear > Open Linear links in** to
**Linear app**. If the app isn't installed, the desktop app opens the issue in your browser.

## Disconnect

Click **Disconnect** under **Settings > Integrations > Linear**. T3 Code revokes its access at
Linear and deletes the stored credential. Issues already attached to messages stay as they were.

If Linear revokes access or the credential expires, the setting shows **Reconnect Linear**.
