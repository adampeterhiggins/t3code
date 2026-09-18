# Devin

Install and authenticate the Devin CLI (`devin auth login`) on the machine
running your environment, then enable it in **Settings > Providers**. See
[provider setup](./install.md#providers). T3 Code talks to `devin acp`, so any
account-signed Devin CLI works — including SWE models such as `swe-2-high`.

## Separate accounts or configurations

Use a separate data directory for each Devin account. The CLI stores its login
in `credentials.toml` under the XDG data directory, so a custom
**XDG_DATA_HOME path** keeps instances signed in side by side.

Keep your existing account in the default directory. On the environment's
machine, create the second login:

```bash
mkdir -p ~/.local/share-devin-personal
XDG_DATA_HOME=~/.local/share-devin-personal devin auth login
```

Or sign in through the instance's own **Sign in with browser** action — the
instance's directory is already part of its environment.

Add another Devin instance in **Settings > Providers**:

| Instance       | Binary path | XDG_DATA_HOME path              |
| -------------- | ----------- | ------------------------------- |
| Devin Work     | `devin`     | Leave empty                     |
| Devin Personal | `devin`     | `~/.local/share-devin-personal` |

An empty setting uses the CLI's normal data directory (`~/.local/share`). The
same variable works as an instance **Environment variable** entry.

## Models

The model list comes from `devin models list` for the signed-in account.
**Adaptive** is the default and routes between models automatically. After
changing login or team model access, use **Refresh provider status** in
**Settings > Providers**.

## Approvals

Devin follows the shared [permission modes](./permission-modes.md), mapped onto
Devin's session modes. **Supervised** runs Devin's default permission policy
and prompts for risky actions; **Auto-accept edits** maps to Code, **Auto** to
Smart, and **Full access** to Bypass Permissions. Plan turns run in Plan mode
and the previous mode is restored afterwards.
