# Custom ACP agents

Run any coding agent that speaks the [Agent Client Protocol](https://agentclientprotocol.com)
over stdio, even one T3 Code has no built-in provider for.

## Add an agent

1. Install the agent on the machine running your environment and sign in with its own CLI.
2. Open **Settings → Providers**, choose **Add provider**, and pick **Custom ACP**.
3. Set **Agent executable** to the command that starts the agent, and **Arguments** to whatever
   puts it in ACP mode, one argument per line. The agent's docs name that flag or subcommand.
4. Add any API keys or configuration the agent reads as **Environment variables** on the
   provider card. Mark secrets as sensitive.

Add one instance per agent. Give each a name so it is easy to tell apart in the model picker.

The provider card shows whether the agent started. T3 Code checks by opening a short ACP session,
so an agent that needs an account reports that you need to sign in until you do so with its CLI
and refresh the provider status.

## What T3 Code uses

Everything comes from what the agent advertises when a session starts:

- **Models.** The picker lists the agent's models. An agent that advertises none runs its own
  default, shown as **Agent default**.
- **Model options.** Other session options the agent offers, such as reasoning effort, appear
  as model options.
- **Plan mode.** The plan toggle appears only when the agent has a plan mode.
- **Slash commands.** Commands the agent advertises appear once a thread has started.

After changing the agent or its configuration, use **Refresh provider status** to update the list.

## Approvals

[Permission modes](./permission-modes.md) apply to the agent's approval requests. **Full access**
approves them, **Auto-accept edits** approves file edits, and the other modes ask you. When the
agent has matching session modes, such as Accept Edits, Bypass Permissions, or Plan, T3 Code
switches to them too.

## Limits

- Custom ACP agents are not offered for text generation, so commit messages, pull request text,
  branch names, and thread titles keep using another provider.
- T3 Code's tools reach the agent only if it accepts HTTP MCP servers.
- Images are sent only to agents that accept image prompts. Other attachments arrive as file paths.
- Conversation rewind is not supported. Resuming a thread reloads the agent's session when the
  agent supports it, and starts a new session otherwise.
