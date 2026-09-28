---
name: sync-upstream
description: Keep this fork (origin, adampeterhiggins/t3code) up to date with upstream (pingdotgg/t3code). Merges upstream/main on a sync branch, raises the PR, merges it with a merge commit, then builds, serves, and publishes a fork release. Use when asked to sync, update, or catch the fork up with upstream, or to cut a fork release after a sync.
---

# Sync the fork with upstream

`origin` is the fork (`adampeterhiggins/t3code`), `upstream` is `pingdotgg/t3code`. The fork
carries its own features on `main`, so upstream is always **merged**, never rebased or
cherry-picked. Every `gh` call names the repo with `-R adampeterhiggins/t3code`; without it `gh`
can resolve to upstream and open a PR there.

## 1. Branch and merge

```bash
git remote get-url upstream || git remote add upstream https://github.com/pingdotgg/t3code.git
git fetch origin && git fetch upstream
git rev-list --left-right --count origin/main...upstream/main   # fork-only / upstream-only
git switch -c t3code/sync-upstream-$(date +%F) origin/main
git merge --no-ff upstream/main -m "merge upstream/main into fork"
```

If upstream has nothing new, stop and say so. Never force-push `main`, and never resolve a
conflict by discarding a whole side (`-X ours`, `-X theirs`, `checkout --theirs .`).

## 2. Resolve conflicts

Take upstream's structure and re-apply the fork's behavior on top of it. For each conflicted file,
read both sides (`git log --oneline origin/main -- <file>` shows what the fork added) and keep:

- Unions of enums, provider lists, and maps (for example `UsageProviderKind` and the per-provider
  maps in web and mobile). A fork-only provider must survive every upstream list change.
- Upstream's new fields and signatures, with the fork's call sites updated to match.
- Both sides' tests, unless one tests behavior that no longer exists.

Then search for fork features that merged cleanly but are now dead, such as a provider missing from a
newly added upstream switch. `git diff upstream/main -- <path>` shows everything the fork still
differs by.

## 3. Verify

Follow the repository's Verifying rules. Do not run repo-wide checks.

- `vp i` if lockfiles changed.
- Typecheck the packages touched by the conflicts, for example
  `vp run --filter @t3tools/contracts typecheck`, plus `t3` (server), `@t3tools/web`, and
  `@t3tools/mobile` when they conflicted.
- `vp test run <files>` for tests in conflicted files.
- `vp check --fix <files>` on the resolved files, then `git diff --check`.

Commit the resolution into the merge commit (`git add` then `git commit --no-edit`), not as a
follow-up commit, so the merge stays one reviewable unit.

## 4. Raise the PR

```bash
git push -u origin HEAD
gh pr create -R adampeterhiggins/t3code --base main --head "$(git branch --show-current)" \
  --title "merge upstream/main into fork" --body-file <body>
```

The body says how far behind and ahead the fork was, lists each conflict resolution by area, what
you verified, and ends with: "Merge with **Create a merge commit**. It keeps upstream history and
the merge base for the next sync." Close with the model and harness that did the work. Register the
PR with `link_pull_request` when that tool is available.

Fork CI runs on Blacksmith runners the fork does not have, so checks sit queued until they time
out. Do not wait on them; your local verification is the gate. Cancel queued runs from the PR with
`gh run cancel -R adampeterhiggins/t3code <run-id>` if they clutter the checks list.

## 5. Merge with a merge commit

Only merge when the developer asked you to take the sync all the way through; otherwise stop after
the PR and hand over its link.

```bash
gh pr merge <number> -R adampeterhiggins/t3code --merge --delete-branch
```

Always `--merge`. Squash or rebase merges drop upstream's commits from the fork's history, so the
next sync re-conflicts on everything. Branch protection may block the merge while checks are
queued; if so, report that instead of passing `--admin`, unless the developer approves it.

Afterwards, update local `main`: `git fetch origin && git switch main && git merge --ff-only origin/main`.

## 6. Serve it

Build the merged `main` and run the production server against a throwaway home. Never point it at
`~/.t3/userdata` or `~/.t3/dev`.

```bash
vp i && vp run build
T3CODE_HOME="$(mktemp -d)" node apps/server/dist/bin.mjs --port 13999 --no-browser
```

Capture the PID you spawned. Confirm the server starts, prints a pairing URL, and that
`curl -sf http://localhost:13999/` returns the web app. Give the developer the pairing URL if they
want to try it, and stop the process by that PID when done.

## 7. Release it

Upstream's `release.yml` cannot run on the fork (Blacksmith runners, upstream's signing, npm, and
Vercel credentials). Fork releases are built locally and published as GitHub releases on the fork.

Version: take the upstream version in `apps/server/package.json` and append
`-fork.<YYYYMMDD>.<n>`, for example `0.0.42-fork.20260929.1`. It sorts above the previous fork
release and below upstream's next stable version. Avoid `-nightly.` and `-preview.` suffixes, which
change the build's update channel and branding.

```bash
VERSION=0.0.42-fork.$(date +%Y%m%d).1
rm -rf release
T3CODE_DESKTOP_UPDATE_REPOSITORY=adampeterhiggins/t3code node scripts/build-desktop-artifact.ts \
  --platform mac --target dmg --arch arm64 --build-version "$VERSION"
```

`T3CODE_DESKTOP_UPDATE_REPOSITORY` makes the app look for updates on the fork's releases, not
upstream's. The artifacts land in `release/` (gitignored, cleared above so no stale build gets
attached). The build is unsigned unless Apple
credentials are present; say so in the release notes. macOS in-app updates need a signed build, so
either set `T3CODE_DESKTOP_IDENTITY=<keychain identity>` for a local certificate or tell users to
install the DMG by hand.

Publish from the merge commit on `main`, attaching every file in `release/` (the DMG, the `.zip`,
`latest-mac.yml`, and blockmaps; the updater needs all of them):

```bash
gh release create "v$VERSION" -R adampeterhiggins/t3code --target "$(git rev-parse origin/main)" \
  --title "v$VERSION" --generate-notes --latest release/*
```

Only publish a release when the developer asked for one; it is public. Report the release URL.
