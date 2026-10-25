# Google Drive and Calendar

Connect Google to attach Drive files, folders, Docs, Sheets, Slides and Calendar events as context, link a source to a thread, and wake an agent when it changes. Docs headings and Sheets cell ranges retain their locations. The connection belongs to the environment; web, desktop, mobile, and agents use that environment's Google account.

## Connect Google

Create an OAuth client of type **Web application** in [Google Cloud](https://console.cloud.google.com/apis/credentials), enable the Google Drive, Google Docs, Google Sheets and Google Calendar APIs, and register `http://localhost:47834/callback` as an authorized redirect URI. Configure the OAuth consent screen for the read-only Drive and Calendar scopes and add your account as a test user if the app is in testing.

In **Settings > Integrations > Google Drive & Calendar**, enter the client ID and secret and choose **Connect Google**. Approve read-only access in Google. T3 Code can search and read Drive files, folders and events accessible to that account, including file comments. It cannot edit them. Existing Drive-only connections need to disconnect and connect again to approve Calendar access. Credentials stay on the environment, and mobile uses the existing connection.

The CLI also supports `t3 integration login google`, `t3 integration status`, and `t3 integration logout google`.

A headless environment can set `T3CODE_GOOGLE_CLIENT_ID` and `T3CODE_GOOGLE_CLIENT_SECRET`. Credentials saved through Settings take precedence. If you approve from another device and the callback page cannot load, paste its full address into the sign-in settings. Alternatively, register a reachable HTTPS callback at `https://YOUR-SERVER/oauth/google/callback` and set `T3CODE_GOOGLE_REDIRECT_URI` to that exact URL.

## Attach and cite sources

Paste a Google Drive, Docs, Sheets, Slides or Calendar event link into the web or desktop composer, choose **Google** from the paperclip menu, or search the **Google** tab after typing `#`. The command palette also offers **Attach Google file or event**. On mobile, use the attachment menu or search Google files and events with `#`.

The picker has Drive and Calendar tabs. **Filter** narrows Drive files by type, owner or how recently they changed, and its sort menu orders them by date or title. The Calendar tab shows a week at a time from the calendars ticked in Google Calendar: pick a day for its agenda, or pick it again for the whole week. **Filter → Calendars** adds other calendars you can see, or a colleague's by email. Searching lists matching events by day. The `#` menu searches both. Drive text files and Slides include text; folders include their first 100 children. Binary files such as PDFs and images include metadata and comments, with a link to view their contents in Drive. File text reads are bounded to 64,000 characters.

Calendar search covers up to ten calendars, from the past 30 days through the next year. Event snapshots include start/end times and time zones, attendees, organizer, location, description and status. Agents can set `source`, `calendarId`, `timeMin` and `timeMax` on `search_google_files` to target another calendar or date window. Event changes, including cancellation, are visible to watches.

A link can select a Docs heading or tab, or a Sheets tab and cell range. Paste the full location link to retain that selection. Attached content is captured when you select it; later source edits do not change sent messages. Whole-sheet previews include up to ten tabs, 100 rows and 26 columns per tab. To read other cells, use a specific range. Large documents and comment lists may be truncated, with a note in the captured content.

Agents can use `search_google_files` and `read_context_link`, then cite a source with its native Google link, document heading or sheet range. These links show source chips and hover previews on web and desktop. On mobile, tap a source link to inspect it. Link previews read the current source; previously attached message snapshots remain unchanged.

## Link and watch

Use **Link > Google file or event** from the thread menu, **+** in the thread details **Links** section, or the command palette. On mobile, use the chat tab's link menu. A thread and its chat tabs share one Google source link; linking another replaces it.

Choose **Watch for changes** on the linked document to check it every five minutes. File content, comments, folder listings and event changes wake the agent in that thread. The server keeps watching with clients closed. **Stop watching**, unlinking, replacing the document, archiving the thread, or reaching twenty updates ends the watch. Agents reach the same behavior through `link_thread_link`, `watch_thread_link`, and `unwatch_thread_link`.

## Disable or disconnect

Turn off **Enable Google integration** to hide attachment entry points and keep pasted links as ordinary links. The saved connection is retained. Choose **Disconnect** to revoke and remove its credential. Previously attached snapshots remain in their messages.
