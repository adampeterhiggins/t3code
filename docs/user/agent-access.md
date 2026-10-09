# Agent access

Let an agent outside T3 Code read what you've done in it, or work in it alongside you. A scheduled
Claude Code run, for example, can find the threads you worked in today, what you asked for, what
the agents changed, and which pull requests came out of it. With a token that can drive threads,
it can also start threads, message them, and wait for their results.

## Create a token

1. Open **Settings → Connections** and find **Agent access**.
2. Click **Create token**, give it a label, and choose its access and when it expires. **Read
   history** can't change anything. **Read and drive threads** can also start and message threads.
3. Copy the token, or the ready-made `claude mcp add` command. T3 Code shows the token only once.

From a terminal on the server, `t3 auth session issue --read-only --label "EOD brief" --ttl 365d`
does the same. Use `--operate` instead of `--read-only` for a token that can drive threads.

## Connect an agent

A read token connects to `/mcp/query` on the same address as the app, for example
`http://127.0.0.1:3773/mcp/query` on a desktop install. A token that can drive threads connects to
`/mcp/operate`, which has the same history tools and the thread tools. Send the token as a bearer
token:

```bash
claude mcp add --transport http t3-code-history http://127.0.0.1:3773/mcp/query \
  --header "Authorization: Bearer <token>"
```

For a scheduled run, keep the token out of the command line. Claude Code expands environment
variables in MCP config, so the config file can carry `"Authorization": "Bearer ${T3_QUERY_TOKEN}"`.
The desktop app picks a new port when 3773 is taken. The current address is `origin` in
`~/.t3/userdata/server-runtime.json` while the server runs.

An agent on another machine can use any address the server is reachable on, such as its Tailscale
name, with the same path.

## What an agent can read

The agent sees what you see in the app. It can read projects, threads and their tabs, turns,
messages, the work log of tool calls and subagents, plans, the files each turn changed and its
patch, linked pull requests, and usage. Deleted threads are gone; archived threads are still
there. Reasoning is left out unless the agent asks for it. Terminal output and attachment
contents are not available. Threads carried over from before T3 Code's current orchestrator only
have their messages: no turns, work log, plans, or diffs.

Every list takes a time range. An agent that passes an end time sees nothing after it, which lets
you replay a past day. Titles, archive state, and pull request state are always current.

## Drive threads from outside

An agent connected to `/mcp/operate` has the history tools plus the thread, project, and
environment tools an agent inside T3 Code has. It can start a thread in any project with
`t3_thread_launch`, message a thread with `t3_thread_send`, wait for it with `t3_thread_wait`, and
stop its turn with `t3_thread_interrupt`. It can rename a thread, change its model, archive,
settle, pin, snooze, hide, group, or mark it read or unread, delete it with `t3_thread_delete`,
answer its questions with `t3_pending_request_respond` and its approvals with
`t3_approval_respond`, and add or change projects. It acts as you would: the
threads it starts appear in your sidebar with a bot icon, their header names the token, and they
run in whichever permission mode it asks for.

## Let agents start threads

An agent working in a thread can start other threads with `create_threads` or `t3_thread_launch`,
hand a task to a child agent with `delegate_task`, message threads, and wait for their results,
for example to split a large change into parallel pieces. There is nothing to turn on. It can
also open a chat tab beside any thread with `t3_thread_tab_open`: empty, or continuing a tab's
conversation, on any model, with an optional first message. `t3_thread_tabs` lists a thread's tabs.

A child agent works in its parent's checkout unless the agent asks for a worktree of its own. Then
the child gets a new worktree (or an existing one), set up like a thread's worktree with your
setup script, before it starts, so parallel children do not edit the same files. It still shows
under its parent in Lineage and the Agents panel. Only a thread in full-access, non-plan mode can
ask for one.

Threads and tabs an agent starts appear in your sidebar with a bot icon, and their header shows which
thread started them; click it to open that thread. An agent cannot give a thread more freedom
than its own permission mode allows. It can start threads two levels deep, and keep at most five
of its own going at once: a thread or tab it started counts until it settles or you archive it, a
delegated task until it finishes. It cannot message, wait on, or stop its own thread with these
tools, and it cannot answer another thread's approvals; those still come to you. It can archive
threads but never delete them.

## Revoke a token

Click **Revoke** next to the token under **Agent access**. The agent loses access immediately.
Tokens also appear under **Authorized clients** when network access is on, and
`t3 auth session list` and `t3 auth session revoke` manage them from a terminal.

Treat a token like a password. Anyone with it can read your threads, and a token that can drive
threads can start work on your machine.
