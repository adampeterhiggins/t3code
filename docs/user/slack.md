# Slack

Connect Slack, then attach Slack messages and threads to messages as context for the agent.
T3 Code reads Slack as you, with read-only access, and never posts.

## Choose a Slack app

If an app is already configured for your environment, click **Connect Slack** and sign in with
your account. You don't need to create an app. Use **Change app** to connect through another app.
Your workspace may require an owner to approve the app before you can authorize it.

If no app is configured, enter the client ID of a shared app supplied by your server operator,
or create an app in your workspace:

1. Open **Settings > Integrations** and find **Slack**. Click **Copy manifest**.
2. At [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App > From a
   manifest**, pick your workspace, and paste the manifest.
3. Copy the app's **Client ID** from **Basic Information** and paste it into **Settings >
   Integrations > Slack**.

The manifest asks only for read scopes and turns on PKCE, so T3 Code never needs the app's client
secret. If your workspace requires approval for new apps, ask a workspace owner to approve it.

A shared app must be configured by its operator to accept installations in other workspaces.
For commercially distributed apps without Slack Marketplace approval, Slack limits thread reads
to one request per minute with up to 15 messages per request. Internal customer-built apps and
Marketplace-approved apps have higher limits. See [Slack's thread-reading limits](https://docs.slack.dev/reference/methods/conversations.replies/).

### Configure an app for an environment

Server operators can set `T3CODE_SLACK_CLIENT_ID` to the app's client ID before starting the
server. This supplies the app for users who have not connected one before. A client ID previously
saved through Settings takes precedence; use **Change app** to switch it.

For a shared app, enable public distribution in Slack's app settings. Register
`http://localhost:47832/callback` as a redirect URL, enable PKCE, and configure the read-only
user scopes from T3 Code's copied manifest. T3 Code does not need a client secret. App registration,
distribution, and Marketplace approval are managed separately in Slack; setting a client ID does
not enable them automatically.

## Connect an account

1. Click **Connect Slack**, then **Open Slack** to open the approval page. On desktop, it opens
   automatically.
2. Click **Allow**.

The account belongs to the T3 Code server you're connected to, not to one device. Every client
that uses that server (desktop, web, or mobile) can attach messages from it. Set up and connect
from the desktop or web app; mobile can attach once the server is connected.

### Approving from another device

Slack sends your browser back to `http://localhost:47832/callback` on the machine running the
server. If you approve on a different device, such as a laptop connected to a remote server, that
page won't load. Copy its full URL from the address bar and paste it into **Approving from another
device?** under the Slack setting.

Sign-in needs port 47832 free on the server machine while you approve.

## Attach a message or thread

- Paste or type a Slack message link (**Copy link** on a message in Slack) into the composer on
  web or desktop. It turns into a chip once the thread loads. A link to a channel stays a link.
- Click the paperclip and choose **Slack message**. Search with Slack's own syntax, like
  `in:#eng from:@priya retry`. Right-click a result and choose **Attach only this message** to
  leave out the rest of its thread.
- Type `#` and a word, then switch to the **Slack** tab. It appears once Slack is connected.
- On web and desktop, run **Attach Slack message** from the command palette.
- On mobile, tap **+** in the composer and choose **Slack message**.

A message that is part of a thread, or that has replies, attaches the whole thread, with the
message you picked marked. The chip shows the channel and that message's author. Hover or tap it
to see what the agent receives. Mentions are shown as names. Files are listed by name and not
downloaded. Long threads keep the first message, the one you picked, and the latest replies.

The thread is copied when you attach it, so later replies don't change a message you already
sent. Chips in an unsent draft don't survive a reload; attach the message again.

If T3 Code can't read a pasted link, it stays as text. The first time that happens because Slack
isn't connected, a notice says so.

## Disconnect

Click **Disconnect** under **Settings > Integrations > Slack**. T3 Code revokes its token at
Slack and deletes it. The client ID stays, so reconnecting is one click. Messages already attached
stay as they were.

If Slack revokes access, the setting shows **Reconnect Slack**.
