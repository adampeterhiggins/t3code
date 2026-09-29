# Cursor

Cursor provider instances wrap the `cursor-agent` CLI and ACP adapter.

## Settings

### Cursor binary

Path to the `cursor-agent` executable. Leave empty to use the `cursor-agent`
found on `PATH`. Instances can share a single install — separate accounts do
not need separate binaries; isolate them with the home directory below.

### Home directory

A private home directory for the instance. `cursor-agent` stores its login at
`~/.cursor` (and `~/.config/cursor` on Linux) regardless of
`CURSOR_CONFIG_DIR`, so T3 Code runs the instance with this directory as its
`HOME` to keep sign-ins separate. Everything outside `.cursor` and
`.config/cursor` is symlinked back to your real home, so agent tools such as
`git` and `ssh` keep working with your normal configuration.

Leave it empty and each Cursor instance you add gets its own private home in
T3 Code's data directory, so a second account never signs in over the first.
The default Cursor instance keeps using your existing `~/.cursor` login. Set a
directory yourself to choose where an account lives (for example
`~/.cursor-work` and `~/.cursor-personal`). The instance
automatically uses file-based credential storage
(`AGENT_CLI_CREDENTIAL_STORE=file`) so the login lands in the instance
directory instead of the shared macOS keychain. Then use each instance's own
**Sign in with browser** action — whichever account you authenticate in the
browser is stored under that instance's home, and its model list, threads,
and usage-limit probe all run under that account.

You can also set `CURSOR_API_KEY` in the instance's **Environment variables**
to authenticate with an API key instead of an account login.

### API endpoint

Optional Cursor API endpoint override.

### Custom models

Cursor exposes only its own model aliases through ACP. To use a custom model
endpoint (for example an OpenAI-compatible gateway), enable
`CURSOR_API_MODE` on the instance, select the matching API base URL from the
model picker, and define the model name here.

## Subagents

When Cursor delegates work to a subagent, the subagent appears in
[Agents](./thread-sidebar.md#inspect-agent-work) with its type, model, the tools
it runs, and its final answer. Cursor does not report per-subagent token usage,
and you cannot open or steer a Cursor subagent from T3 Code.
