# Command line

On the machine that runs T3 Code, the `t3` command drives the running server
from a terminal or a script. The commands below need T3 Code to be running;
they sign in for the length of the command and sign out afterwards, so there
is nothing to pair. Every command takes `--json` for scripts, and
`--base-dir` when T3 Code runs from a non-default home.

Wherever a command asks for a project, `.` means the project that contains the
current folder; a project id also works. Ids for scheduled tasks and imports can
be shortened to any unique part.

## Threads

`t3 thread start`, `send`, `show` and `list` are described in
[Scripts on the host](./outside-agents.md#scripts-on-the-host). They also take:

- `--pr <url|number>` on `start`, to work on a pull request's branch.
- `--link <url|ENG-123>` on `start` and `send`, repeatable, to attach an issue,
  pull request, Slack message, Notion page or other link as context.

When `send --wait` exits with code 2, the thread is waiting for you. Run
`t3 thread answer <thread>` to see what it is asking, then answer with
`--approve`, `--deny`, or `--answer "<option or text>"`. Add `--wait` to keep
following the run. `t3 thread resume <thread>` continues a thread that stopped
at a usage limit.

`t3 thread search <query>` finds threads, and `t3 thread export <thread>`
prints the conversation as Markdown (`--full` adds the work log, `-o` writes a
file). `stop`, `rename`, `fork`, `move`, `archive`, `hide`, `settle` and their
reverses manage threads as the thread menu does. `rollback` and `delete` need
`--yes`.

`t3 draft create|list|send|delete` stages a message on a thread so you can
review it before sending.

## Scheduled tasks

```sh
t3 schedule create "Summarise yesterday's pull requests" --at 09:00 --weekdays weekdays
t3 schedule create "Check the deploy" --every 30m --project ~/code/api
t3 schedule list
```

`--at` takes `--weekdays` (`1,3`, `mon,wed`, `weekdays`, `weekends` or
`daily`) and `--catch-up` to run a missed time later the same day. `--webhook`
creates a task that runs on each request to the URL it prints. `update` takes
the same flags; `enable`, `disable`, `run`, `delete --yes`, `webhook rotate`
and `webhook deliveries` do what they say.

## Settings and providers

```sh
t3 settings show worktreeCleanup
t3 settings set stopAtSubscriptionLimit true
t3 settings set branchNamePrefix adam/ --project .
t3 settings unset branchNamePrefix --project .
```

`show` with no keys lists every setting by the name `set` accepts. Values are
read as JSON when they parse and as text otherwise. `--project` reads or writes
that project's override. Secrets are never printed.

`t3 provider list` shows each provider's status, sign-in and version.
`t3 provider refresh` checks them again, and `enable` or `disable <instance>`
turns one on or off.

## Desktop network access

`t3 app network-access on` lets other devices on your network reach the desktop
app's server, as **Settings → Connections → Network access** does; `off` limits
it to this machine again, and no argument shows the current state. Changing it
restarts the desktop app. Then run `t3 pair` for a link to open on the other
device. This talks to the desktop app on this machine, not the server, so it
needs the desktop app running and does not work over SSH.

## Integrations

`t3 integration status` shows which integrations are connected.
`t3 integration login linear` (or `slack`, `notion`, `granola`) prints a
sign-in link, opens it when it can, and waits until you approve; Ctrl-C
cancels. If you approve in a browser on another machine and it ends on a page
that does not load, paste that page's address into the terminal and press
Enter. Slack takes `--client-id <id>` from your Slack app; Notion takes
`--client-id <id> --client-secret -` and reads the secret from the terminal.

`t3 integration discord connect` reads the bot token from the terminal, so it
stays out of your shell history. `discord servers` and `discord leave <id>`
manage the servers the bot is in. `t3 integration logout <name>` disconnects.

## Usage

`t3 usage` shows how much of each subscription's limits you have used, when
they reset, and any provider outage. `t3 usage tokens` and `t3 usage cost`
total this machine's provider history by model; `--since 7d`, `today` or a
date narrows the range.

## Import conversations

`t3 import list` shows recent Claude Code, Codex and Conductor conversations
for the project in the current folder, marking ones already imported.
`t3 import <id>` imports one and prints its thread id.

## Worktrees

`t3 worktree list --size` lists the worktrees T3 Code manages with their
threads, local changes, pull request and size. `t3 worktree remove <path> --yes`
removes one but keeps its branch and threads, and refuses worktrees with local
changes or running work. `t3 worktree cleanup` shows the last storage cleanup
report; `--run` runs cleanup now with the rules in **Settings → Storage**.
