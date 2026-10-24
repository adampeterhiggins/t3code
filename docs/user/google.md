# Google Docs and Sheets

Connect Google to attach Docs and Sheets as context, link a document to a thread, cite headings and cell ranges, and wake an agent when a linked document changes. The connection belongs to the environment; web, desktop, mobile, and agents use that environment's Google account.

## Connect Google

Create an OAuth client of type **Web application** in [Google Cloud](https://console.cloud.google.com/apis/credentials), enable the Google Drive, Google Docs, and Google Sheets APIs, and register `http://localhost:47834/callback` as an authorized redirect URI. Configure the OAuth consent screen for the read-only Drive scope and add your account as a test user if the app is in testing.

In **Settings > Integrations > Google Docs & Sheets**, enter the client ID and secret and choose **Connect Google**. Approve read-only access in Google. T3 Code can search and read native Docs and Sheets accessible to that account, including comments. It cannot edit them. Credentials stay on the environment, and mobile uses the existing connection.

The CLI also supports `t3 integration login google`, `t3 integration status`, and `t3 integration logout google`.

A headless environment can set `T3CODE_GOOGLE_CLIENT_ID` and `T3CODE_GOOGLE_CLIENT_SECRET`. Credentials saved through Settings take precedence. If you approve from another device and the callback page cannot load, paste its full address into the sign-in settings. Alternatively, register a reachable HTTPS callback at `https://YOUR-SERVER/oauth/google/callback` and set `T3CODE_GOOGLE_REDIRECT_URI` to that exact URL.

## Attach and cite documents

Paste a Google Docs or Sheets link into the web or desktop composer, choose **Google Docs & Sheets** from the paperclip menu, or search the **Google** tab after typing `#`. The command palette also offers **Attach Google document**. On mobile, use the attachment menu or search Google documents with `#`.

A link can select a Docs heading or tab, or a Sheets tab and cell range. Paste the full location link to retain that selection. Attached content is captured when you select it; later source edits do not change sent messages. Whole-sheet previews include up to ten tabs, 100 rows and 26 columns per tab. To read other cells, use a specific range. Large documents and comment lists may be truncated, with a note in the captured content.

Agents can use `search_google_files` and `read_context_link`, then cite a source with a Markdown link to the document heading or sheet range. These links show source chips and hover previews on web and desktop. On mobile, tap a source link to inspect it. Link previews read the current source; previously attached message snapshots remain unchanged.

## Link and watch

Use **Link > Google document** from the thread menu, **+** in the thread details **Links** section, or the command palette. On mobile, use the chat tab's link menu. A thread and its chat tabs share one Google document link; linking another replaces it.

Choose **Watch for changes** on the linked document to check it every five minutes. Content and comment changes wake the agent in that thread. The server keeps watching with clients closed. **Stop watching**, unlinking, replacing the document, archiving the thread, or reaching twenty updates ends the watch. Agents reach the same behavior through `link_thread_link`, `watch_thread_link`, and `unwatch_thread_link`.

## Disable or disconnect

Turn off **Enable Google integration** to hide attachment entry points and keep pasted links as ordinary links. The saved connection is retained. Choose **Disconnect** to revoke and remove its credential. Previously attached snapshots remain in their messages.
