# Slack

Connect Slack, then attach Slack messages and threads to messages as context for the agent.
T3 Code reads Slack as you, with read-only access, and never posts.

## Set up the Slack app

Slack signs in through an app in your own workspace. You make it once, and it takes a minute:

1. Open **Settings > Integrations** and find **Slack**. Click **Copy manifest**.
2. At [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App > From a
   manifest**, pick your workspace, and paste the manifest.
3. Copy the app's **Client ID** from **Basic Information** and paste it into **Settings >
   Integrations > Slack**.

The manifest asks only for read scopes and turns on PKCE, so T3 Code never needs the app's client
secret. If your workspace requires admin approval for new apps, approve the app first.

Use an app made in your own workspace, not one shared across workspaces. Slack limits apps
installed in other workspaces to reading 15 thread messages a minute, which is too few to attach
threads.

## Connect an account

1. Click **Connect Slack**. Slack's approval page opens in your browser.
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

A Slack link that stays a link in a message, such as one in an agent's reply, shows the channel and
author instead of its URL on web and desktop while Slack is connected. Hover it for the message's
first line.

If T3 Code can't read a pasted link, it stays as text. The first time that happens because Slack
isn't connected, a notice says so.

## Disconnect

To stop Slack setup prompts and automatic link attachments, turn off **Enable Slack integration**
under **Settings > Integrations > Slack**. Slack links stay as links, and Slack attachment actions
are hidden on web, desktop, and mobile for that server. Your connected account and messages already
attached are kept. Turn the setting back on to use Slack again without reconnecting.

Click **Disconnect** under **Settings > Integrations > Slack**. T3 Code revokes its token at
Slack and deletes it. The client ID stays, so reconnecting is one click. Messages already attached
stay as they were.

If Slack revokes access, the setting shows **Reconnect Slack**.

## Start a thread when you are mentioned

In **Settings > Integrations > Slack** on web or desktop, choose a mention project and enter the
channel names or IDs to watch. You can also include direct and group messages, require a keyword,
set the instructions to send, and choose a provider and model. Then turn on **Start threads from
Slack mentions**. It is off by default. Changing these settings requires permission to write
settings and operate threads on the selected environment.

The environment checks once a minute for explicit @mentions of its connected Slack account in
messages that account can read. Each matching mention starts a thread in the project's root
workspace with a Slack thread snapshot and link. It uses the selected model, or the project's
default model, and the project's permission mode. The resulting threads are available on mobile
as well. T3 Code does not reply to Slack.

Mentions from before you enable the trigger are ignored. Turning it off and back on, or changing
the connected account, starts a fresh baseline. Changing filters does not replay mentions already
checked. Restarting the server retains the baseline and processed mentions; failed reads and
launches retry with the same thread request. The server must be running, and each poll reads the
newest 50 search results, so a larger backlog can miss older messages. Search visibility, indexing
delays, retention, and rate limits are controlled by Slack. This watches one account and workspace
per environment, not every workspace you use.

Turn off the trigger to stop starting new threads. Turning off the Slack integration also stops
polling. Threads already started continue normally.
