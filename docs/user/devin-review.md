# Devin Review

See what Devin Review found on your pull requests, start reviews, and hand findings to an agent.

With a Devin login, T3 Code reads Devin's findings from Devin itself, including security findings
your organization's Devin settings keep off GitHub. Those show **Not on GitHub**: there is no
review thread to resolve, so fix them or close them in Devin Review. Without a Devin login, findings
are read from the review comments Devin posts on GitHub, which works as soon as the GitHub CLI is
signed in but misses findings Devin didn't post there. Signing in to Devin also adds each review's
status and lets you start a review.

## Sign in to Devin

In **Settings > Integrations > Devin Review** on web or desktop, choose **Sign in with Devin**.
T3 Code uses the `devin` CLI's login on the environment, so if you have already run
`devin auth login` there it connects straight away. Otherwise it starts Devin's browser sign-in:
choose **Open Devin sign-in** and finish in your browser. The Devin CLI must be installed on the
environment, and the sign-in returns to that machine, so finish it from a browser there.

Signing out of the Devin CLI also signs T3 Code out. Choose **Disconnect** to stop using the login
without signing the CLI out.

To use a service user key instead, choose **Use a service key**. Create a service user under
**Settings > Service users** in Devin with **ViewReview** (and **UseReviewManual** to start
reviews), then paste its `cog_…` key and your organization ID (`org-…`).

## The Devin Reviews page

On the **Pull requests** page, choose **Devin Reviews** beside the filters, or run **Open Devin
Reviews** from the command palette. **Pull requests** in the page's title goes back. The page lists
your open pull requests: **Authored**, **Reviewing** (review requested from you), or both. Each row
shows Devin's status and how many findings are still open.

Select a pull request to read its findings, grouped by file and ordered by severity. Resolved
findings, and findings on code that has since changed, are collapsed at the bottom.

- **Run review** asks Devin to review the latest commit. It needs a connected key with
  UseReviewManual, and spends your Devin organization's ACUs.
- **Attach to message** opens a new thread in the project for that repository and attaches the
  review to its composer.
- **Add to composer** on a finding does the same with that one finding as text.

The page uses the primary environment. A repository needs to be added as a project before you can
attach its review.

## In a pull request

A GitHub pull request open in a thread's right panel, or on the **Pull requests** page, has a
**Devin Review** tab beside **Code**. It shows the same status, findings and **Run review**.
**Attach to message** attaches the review to the thread's composer, and **Add to chat** on a
finding adds Devin's comment the way other pull request comments are added.

When you are signed in to Devin, the tab also shows:

- **Walkthrough**: Devin's overview of the change, with its sections folded underneath.
- Each finding's impact, and whether Devin itself dismissed or resolved it, with Devin's reason.
  Findings Devin closed are collapsed with the resolved ones.
- **Fix with agent** on findings where Devin suggests a fix. It puts Devin's fix instructions, with
  a line pointing at the finding, in the thread's composer for you to read over and send. On the
  Devin Reviews page it opens a new thread instead.
- **Progress** while a review runs: what Devin's reviewer is doing, such as the files it reads and
  the searches it runs, updated every couple of seconds.
- **Review runs**: each time Devin reviewed the pull request, full or incremental, and on which
  commit.

These, and the findings themselves, come from Devin's own review data, which isn't part of
Devin's public API and can change. Without a Devin login, or if Devin can't be read, the tab shows
only the findings from GitHub.

In a thread, **Devin Review** (R) in the right panel's **+** menu opens the thread's pull request on
that tab. When the thread has several linked GitHub pull requests, it lists them so you can choose
one. The **Linked pull requests** list shows Devin's status and open finding count beside each
GitHub pull request Devin has reviewed; choose the badge to open its Devin Review tab.

## Attach a review

Paste a Devin Review link (`https://app.devin.ai/review/<owner>/<repo>/pull/<number>`) into the
composer. It becomes a chip holding the review's status and findings as they were when you
attached it. Hover the chip to see what the agent received.

## Agents

Agents with pull request access can use `list_devin_reviews`, `get_devin_review`, and
`trigger_devin_review`, and can read or attach a Devin Review link like any other context link
(see [Agent access](./agent-access.md#attach-links-as-context)). They use the environment's
connection, so they need no Devin MCP server of their own.
