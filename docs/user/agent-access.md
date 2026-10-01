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
contents are not available.

Every list takes a time range. An agent that passes an end time sees nothing after it, which lets
you replay a past day. Titles, archive state, and pull request state are always current.

## Drive threads from outside

An agent connected to `/mcp/operate` can start a thread in any project with `create_thread`, send a
thread a message, wait for it to finish, and stop its turn. It can rename a thread or change its
model, archive, settle, pin, or snooze it, answer the approvals and questions a thread is waiting
on, and add a folder as a new project or change a project's defaults. It acts as you would: the threads it
starts appear in your sidebar marked with the token's name, in whichever permission mode it asks
for.

## Let agents start threads

An agent working in a thread can also start other threads, message them, and wait for their
results, for example to split a large change into parallel pieces. Turn on **Agent thread
control** in **Settings → Integrations**, or for one project with that project selected. It is
off by default and applies when an agent session next starts.

Threads an agent starts appear in your sidebar like any other, and their header shows which thread
started them. An agent cannot give a thread more
freedom than its own permission mode allows. It can start threads two levels deep, and keep at
most five of its own going at once until they settle or you archive them. It can rename,
settle, archive, pin, or snooze other threads, but it cannot answer their approvals or questions;
those still come to you.

## Revoke a token

Click **Revoke** next to the token under **Agent access**. The agent loses access immediately.
Tokens also appear under **Authorized clients** when network access is on, and
`t3 auth session list` and `t3 auth session revoke` manage them from a terminal.

Treat a token like a password. Anyone with it can read your threads, and a token that can drive
threads can start work on your machine.
