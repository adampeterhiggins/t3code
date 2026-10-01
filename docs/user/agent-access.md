# Agent access

Let an agent outside T3 Code read what you've done in it. A scheduled Claude Code run, for
example, can find the threads you worked in today, what you asked for, what the agents changed,
and which pull requests came out of it. It can't change anything.

## Create a token

1. Open **Settings → Connections** and find **Agent access**.
2. Click **Create token**, give it a label, and choose when it expires.
3. Copy the token, or the ready-made `claude mcp add` command. T3 Code shows the token only once.

From a terminal on the server, `t3 auth session issue --read-only --label "EOD brief" --ttl 365d`
does the same.

## Connect an agent

The server is at `/mcp/query` on the same address as the app, for example
`http://127.0.0.1:3773/mcp/query` on a desktop install. Send the token as a bearer token:

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

## Let agents start threads

An agent working in a thread can also start other threads, message them, and wait for their
results, for example to split a large change into parallel pieces. Turn on **Agent thread
control** in **Settings → Integrations**, or for one project with that project selected. It is
off by default and applies when an agent session next starts.

Threads an agent starts appear in your sidebar like any other. An agent cannot give a thread more
freedom than its own permission mode allows. It can start threads two levels deep, and keep at
most five of its own going at once until they settle or you archive them. It cannot answer
approvals or questions in other threads; those still come to you.

## Revoke a token

Click **Revoke** next to the token under **Agent access**. The agent loses access immediately.
Tokens also appear under **Authorized clients** when network access is on, and
`t3 auth session list` and `t3 auth session revoke` manage them from a terminal.

Treat a token like a password. Anyone with it can read your threads.
