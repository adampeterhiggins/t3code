# Notion

Connect Notion to attach page contents as context for an agent.

## Connect

In **Settings > Integrations > Notion** on web or desktop, choose **Connect Notion**, open the sign-in link, and select the workspace and pages to share. Every client connected to that environment can attach those pages. Mobile uses the environment's existing connection.

The environment needs a public Notion integration with **Read content** enabled. Register `http://localhost:47833/callback` as its OAuth redirect URI. The person running the environment sets `T3CODE_NOTION_CLIENT_ID` and `T3CODE_NOTION_CLIENT_SECRET` there and restarts it. Keep the client secret on the server.

If you approve from another device, Notion redirects to a page that may not load. Copy its full address into **Approving from another device?** in the Notion settings to finish sign-in.

## Attach pages

- Paste a `notion.so` or `notion.site` page link into the composer on web or desktop. A readable page becomes a chip; an unreadable link stays as text.
- Choose **Notion page** from the paperclip picker, then search by title or paste a page link.
- Type `#` and choose the **Notion** tab, which appears once connected.
- Run **Attach Notion page** from the command palette on web or desktop.
- On mobile, choose **Notion page** from the composer's **+** menu.

T3 Code captures the title, source link, and page Markdown when you attach it. Later edits in Notion do not change sent messages. Large or inaccessible portions of pages can be incomplete; the captured content says when Notion reports truncation or the snapshot reaches its size limit. Embedded media stays as links. Remove a chip to remove it from your draft, or open it to inspect the captured contents.

Choose **Disconnect** in the Notion settings to revoke and remove the environment's credential. Previously attached snapshots remain in their messages.
