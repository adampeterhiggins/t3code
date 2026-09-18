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

Set a different directory per instance to run multiple Cursor accounts side
by side (for example `~/.cursor-work` and `~/.cursor-personal`). The instance
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
