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

## Open issues in the Linear app

The **Open in Linear** link on an issue chip follows **Open links in** by default. To open issues in
the Linear desktop app instead, set **Settings > Integrations > Linear > Open Linear links in** to
**Linear app**. If the app isn't installed, the desktop app opens the issue in your browser.

## Disconnect

Click **Disconnect** under **Settings > Integrations > Linear**. T3 Code revokes its access at
Linear and deletes the stored credential. Issues already attached to messages stay as they were.

If Linear revokes access or the credential expires, the setting shows **Reconnect Linear**.
