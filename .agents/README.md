# Agent skills

`.agents/skills/` is the source of truth for skills shared across coding agents.
Each subdirectory is one skill: a `SKILL.md` plus any supporting files. Codex and
Antigravity read it directly.

Other tools only discover skills in their own directory, so each gets a committed
mirror of per-skill symlinks pointing back at `../../.agents/skills/<name>`:

- `.claude/skills/` for Claude Code
- `.cursor/skills/` for Cursor
- `.grok/skills/` for Grok

After adding, renaming, or removing a skill, regenerate the mirrors and commit
the symlinks with the skill change:

```bash
vp run skills:sync
```

CI runs `vp run skills:check` and fails if a mirror is missing a skill, has a
link with no source, or points at the wrong target.
