# Cursor

Cursor provider instances wrap the `cursor-agent` CLI and ACP adapter.

## Settings

### Cursor binary

Path to the `cursor-agent` executable. Leave empty to use the `cursor-agent`
found on `PATH`. Instances can share a single install — separate accounts do
not need separate binaries; isolate them with the config directory below.

### CURSOR_CONFIG_DIR path

A custom Cursor config directory for the instance — the value is exported to
`cursor-agent` as `CURSOR_CONFIG_DIR`. This keeps the instance's sign-in,
`auth.json` credentials, and CLI settings isolated from the default
`~/.cursor` directory and from other Cursor instances.

Set a different directory per instance to run multiple Cursor accounts side
by side (for example `~/.cursor-work` and `~/.cursor-personal`). On macOS the
instance automatically uses file-based credential storage
(`AGENT_CLI_CREDENTIAL_STORE=file`) so the login lands in that directory
instead of the shared keychain. Then use each instance's own
**Sign in with browser** action — whichever account you authenticate in the
browser is stored under that instance's directory, and its model list,
threads, and usage-limit probe all run under that account.

You can also set `CURSOR_CONFIG_DIR` directly in the instance's
**Environment variables** (leading `~` expands to your home directory) or set
`CURSOR_API_KEY` to authenticate with an API key instead of an account login.

### API endpoint

Optional Cursor API endpoint override.

### Custom models

Cursor exposes only its own model aliases through ACP. To use a custom model
endpoint (for example an OpenAI-compatible gateway), enable
`CURSOR_API_MODE` on the instance, select the matching API base URL from the
model picker, and define the model name here.
