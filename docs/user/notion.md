# Notion

Connect Notion to attach page contents as context for an agent.

## Connect

Notion signs in through an OAuth connection you create. At [notion.so/profile/integrations](https://www.notion.so/profile/integrations), make a new connection, choose **OAuth**, and register `http://localhost:47833/callback` as its redirect URI.

In **Settings > Integrations > Notion** on web or desktop, enter the connection's client ID and client secret, choose **Connect Notion**, open the sign-in link, and select the workspace and pages to share. The environment saves the credentials once sign-in succeeds, so reconnecting later needs only **Connect Notion**. The secret stays on the environment. Every client connected to that environment can attach those pages. Mobile uses the environment's existing connection.

To use a different connection, disconnect and enter its client ID and secret. A headless server can instead set `T3CODE_NOTION_CLIENT_ID` and `T3CODE_NOTION_CLIENT_SECRET`; credentials saved from Settings take precedence.

If you approve from another device, Notion redirects to a page that may not load. Copy its full address into **Approving from another device?** in the Notion settings to finish sign-in.

## Attach pages

- Paste a `notion.so`, `notion.com`, or `notion.site` page link into the composer on web or desktop. A readable page becomes a chip. A page that isn't shared with your connection stays as text, and a notice offers **Open in Notion**: add the connection from the page's **•••** menu → **Connections**, then choose **Retry** to turn the link into a chip.
- Choose **Notion page** from the paperclip picker, then search by title or paste a page link.
- Type `#` and choose the **Notion** tab, which appears once connected.
- Run **Attach Notion page** from the command palette on web or desktop.
- On mobile, choose **Notion page** from the composer's **+** menu.

T3 Code captures the title, source link, and page Markdown when you attach it. Later edits in Notion do not change sent messages. Large or inaccessible portions of pages can be incomplete; the captured content says when Notion reports truncation or the snapshot reaches its size limit. Embedded media stays as links. Remove a chip to remove it from your draft, or open it to inspect the captured contents.

## Link a page to a thread

A linked page stays with the thread and all of its chat tabs, so you can see which page the work is for. A thread links one page at a time.

- On web and desktop, choose **Link Notion page…** from the thread's menu (the sidebar row or the chat header title), or run **Link Notion page** from the command palette.
- On mobile, choose **Link Notion page** from the chat tab menu, or from **Link** beside **New tab** when the thread has one tab.

The chat header shows the page's title; on mobile the chip sits beside the tab switcher. Tap or click it to open the page in Notion, change it, or unlink it. The title is copied when you link and doesn't follow later renames. Connections without permission to change threads see the chip but can only open it.

## Turn off or disconnect

To stop Notion setup prompts and automatic link attachments, turn off **Enable Notion integration** under **Settings > Integrations > Notion**. Notion links stay as links, and Notion attachment actions are hidden on web, desktop, and mobile for that environment. Your connected account and pages already attached are kept. Turn the setting back on to use Notion again without reconnecting.

Choose **Disconnect** in the Notion settings to revoke and remove the environment's credential. Previously attached snapshots remain in their messages.
