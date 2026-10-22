# Discord

Connect Discord, then attach Discord messages and threads to messages as context for the agent.
T3 Code reads Discord through a bot you create, with read-only access, and never posts.

## Set up the bot

Discord doesn't let apps read messages through a personal sign-in, so T3 Code reads as a bot you
add to your servers. You make it once:

1. At [discord.com/developers/applications](https://discord.com/developers/applications),
   choose **New Application** and name it.
2. Open **Bot**. Turn on **Message Content Intent**, then click **Reset Token** and copy the
   token.
3. In **Settings > Integrations > Discord**, paste the token and click **Connect Discord**.
4. Click **Add bot to a server** and pick each server you want to attach messages from. The bot
   asks only to view channels and read message history.

The bot reads only the servers it's in and the channels it can see. Direct messages can't be
attached. **Servers** in the same settings section lists the servers the bot is in. It updates when
you return to T3 Code after adding the bot; click **Remove** to make the bot leave a server.

The connection belongs to the T3 Code server you're connected to, not to one device. Every client
that uses that server (desktop, web, or mobile) can attach messages from it. Set up and connect
from the desktop or web app; mobile can attach once the server is connected.

## Attach a message or thread

- Paste or type a Discord message link (**Copy Message Link** on a message in Discord) into the
  composer on web or desktop. It turns into a chip once the message loads. A link to a channel
  stays a link.
- Click the paperclip and choose **Discord message**. Search with plain words; T3 Code searches
  every server the bot is in. Right-click a result and choose **Attach only this message** to
  leave out the rest of its thread.
- Type `#` and a word, then switch to the **Discord** tab. It appears once Discord is connected.
- On web and desktop, run **Attach Discord message** from the command palette.
- On mobile, tap **+** in the composer and choose **Discord message**.

A message in a Discord thread, or one that started a thread, attaches the whole thread, with the
message you picked marked. A reply in a channel attaches with the message it answers. The chip
shows the channel and that message's author. Hover or tap it to see what the agent receives.
Files are listed by name and not downloaded. Long threads keep the first message, the one you
picked, and the latest replies.

The thread is copied when you attach it, so later replies don't change a message you already
sent. Chips in an unsent draft don't survive a reload; attach the message again.

A Discord link that stays a link in a message, such as one in an agent's reply, shows the channel
and author instead of its URL on web and desktop while Discord is connected. Hover it to read the
thread, as you would on its chip.

Discord can take a little while to index a server the bot just joined, so new servers may not
show up in search straight away. Pasted links work immediately.

## Link a thread to a T3 Code thread

A linked Discord thread stays with the thread and all of its chat tabs. A thread links one
Discord thread at a time.

- On web and desktop, choose **Link > Discord thread…** from the thread's menu (the sidebar row or
  the chat header title), or run **Link Discord thread** from the command palette, or use **+** on the thread details panel's **Links** section.
- On mobile, choose **Link > Link Discord thread** from the chat tab menu, or from **Link** beside **New
  tab** when the thread has one tab.

On web and desktop, the thread details panel's **Links** section shows the linked message and its channel; on
mobile a chip sits beside the tab switcher. Tap or click it to open the message in Discord, change it, or unlink it. The channel,
author, and first line are copied when you link and don't update.

### Wake the agent when it changes

Choose **Watch for changes** from the linked Discord thread's menu, or ask the agent to watch it. T3 Code reads it about once a minute and sends the agent a message saying what changed: who replied and what they wrote, and which messages were edited. Changes that land while the agent is working arrive together when it finishes. An eye marks a watched link. The server does the watching, so it continues with every client closed. Watching stops when you choose **Stop watching**, unlink or change the link, or archive the thread, and after 20 updates.

## Turn off or disconnect

To hide Discord attachment actions and stop resolving pasted links, turn off **Enable Discord
integration** under **Settings > Integrations > Discord**. Your connection and messages already
attached are kept.

Click **Disconnect** to delete the stored bot token. To stop the bot reading entirely, also reset
its token or remove it from your servers in Discord. If Discord rejects the token, the setting
asks you to paste a new one.

## Start a thread when you are mentioned

In **Settings > Integrations > Discord** on web or desktop, choose a mention project, then turn on
**Start threads from Discord mentions**. It is off by default. By default it watches @mentions of
the bot; enter your own Discord user ID to watch mentions of you instead (turn on Developer Mode
in Discord, then right-click your name and choose **Copy User ID**). You can limit it to channel
names or IDs (threads under a listed channel count), require a keyword, set the instructions to
send, and choose a provider and model.

The environment checks once a minute in every server the bot is in. Each matching mention starts a
thread in the project's root workspace with the Discord thread attached, using the selected model
or the project's default and the project's permission mode. T3 Code does not reply in Discord.

Mentions from before you enable the trigger are ignored. Turning it off and back on, or changing
who it watches, starts a fresh baseline. Restarting the server keeps the baseline and processed
mentions; failed reads and launches retry. Each check reads the newest 25 mentions per server, and
Discord's search indexing can delay a mention by a minute or so.
