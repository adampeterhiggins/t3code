# Granola

Connect Granola to attach meeting notes as context for an agent.

## Connect

In **Settings > Integrations > Granola** on web or desktop, choose **Connect Granola**. T3 Code shows a short code and an **Open Granola** button. Open the sign-in page on any device, sign in to Granola, and confirm the code. The settings page shows the connected account once you approve.

The connection belongs to the environment, so every client connected to it can attach notes, including mobile. Because sign-in uses a code rather than a redirect, it works the same when the environment is remote.

T3 Code reads notes through Granola's MCP server, the same connection Claude and ChatGPT use, so the notes it can see follow your Granola plan and workspace settings. It reads the workspace that is active in the Granola app. On Granola's free plan, only the last 30 days of notes are available.

## Attach notes

- Paste a Granola note link (`https://notes.granola.ai/d/…`, or a shared `https://notes.granola.ai/t/…` link) into the composer on web or desktop. The link becomes a chip once the note loads.
- Choose **Granola note** from the paperclip picker, then search meetings from the last 30 days by title or attendee, or paste a note link for an older one. **Filter** narrows the list by attendee, note taker, or the last 7 days, and hovering a meeting shows its summary.
- Type `#` and choose the **Granola** tab, which appears once connected.
- Run **Attach Granola note** from the command palette on web or desktop.
- On mobile, choose **Granola note** from the composer's **+** menu.

T3 Code captures the meeting's title, date, participants, summary, and your notes when you attach it. Later edits in Granola do not change sent messages, and transcripts are not included. Hover or open a chip to see what the agent received.

## Link a note to a thread

A linked note stays with the thread and all of its chat tabs, so you can see which meeting the work came from. A thread links one note at a time.

- On web and desktop, choose **Link Granola note…** from the thread's menu (the sidebar row or the chat header title), or run **Link Granola note** from the command palette.
- On mobile, choose **Link Granola note** from the chat tab menu, or from **Link** beside **New tab** when the thread has one tab.

The chat header shows the meeting's title; on mobile the chip sits beside the tab switcher. Tap or click it to open the note in Granola, change it, or unlink it.

## Links in messages

A Granola note link left as a link in a message, such as one an agent writes in its reply, shows the meeting's title on web and desktop. Hover it to see the date and who attended.

## Turn off or disconnect

To stop Granola setup prompts and automatic link attachments, turn off **Enable Granola integration** under **Settings > Integrations > Granola**. Granola links stay as links, and Granola attachment actions are hidden on web, desktop, and mobile for that environment. Your connected account is kept.

Choose **Disconnect** to sign T3 Code out of Granola and remove the environment's credential. Notes already attached stay in their messages.
