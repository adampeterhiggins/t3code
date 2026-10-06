# Terminal

## History

Each terminal keeps up to 5,000 lines and 8 MiB of scrollback on its environment
server. T3 Code removes the oldest output when either limit is reached. A long
line can be shortened at the start. New terminal output is not truncated.

These limits apply when you reconnect and when T3 Code restores saved terminal
history. A client can show less scrollback than the server keeps.

## Python environments

Turn on **Activate Python environment in terminals** in **Settings → General** to have new
terminals activate a Python environment, as VS Code does. T3 Code types the activation command once
the shell starts, so it appears at the top of the terminal. It supports bash, zsh, sh, fish, csh,
PowerShell, and cmd.

**Python interpreter path** works like VS Code's `python.defaultInterpreterPath`. Leave it empty to
use the `.venv` or `venv` folder in the terminal's working directory. Otherwise, enter an
interpreter or an environment folder, such as `.venv/bin/python` or `~/miniconda3/envs/app`.
Relative paths start at the terminal's working directory. Conda environments are activated with
`conda activate`, so the shell needs conda set up by `conda init`.

Both settings can be overridden per project. A repository can also set the path for everyone in its
`t3.json`, which applies when neither the project nor the environment sets one:

```json
{ "pythonInterpreterPath": ".venv/bin/python" }
```

See [Defaults and inheritance](./project-settings.md#defaults-and-inheritance) for the full order.
