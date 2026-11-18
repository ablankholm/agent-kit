# Comparing concrete designs: within an iteration and across iterations

Specs and sketches only go so far. Once directions are built, compare **real, running implementations** side by side under identical conditions, and keep a lineage so you and the user can see how the design evolved, what improved, and what regressed.

## Vocabulary

- **Iteration:** one round of make → capture → judge → decide. Numbered 1, 2, 3…
- **Variant:** one concrete implementation within an iteration. Its ID is the lineage letter plus the iteration number: `A1`, `B1`, `C1`; `A2` is A's next version.
- **Lineage:** a variant's ancestry. `A2.parent = A1`. A merge records its sources: `M2.merged_from = [A1, C1]`.
- **Champion:** the current best variant. **Challengers:** the new variants trying to beat it.
- **Parity set:** the fixed conditions every variant is captured under: same data fixtures, states, breakpoints, themes, viewport and auth/user role.

## 1. Make variants coexist in code (cheap to switch, easy to delete)

Pick the lightest isolation that fits how different the variants are:

| Isolation | Use when | How |
|---|---|---|
| **In-app variant switch** (default) | Variants of one screen or component sharing data and routes | Each variant is its own component file under one throwaway folder (e.g. `src/**/__variants__/<feature>/A.tsx`) registered with `workspace.sh scratch` the moment you create it, selected by a dev-only switch (`?variant=A`, a dev toolbar, or a flag). The parent renders `variants[current]`. Nothing ships unless chosen. |
| **Storybook stories** | Component-level work in a repo that already uses Storybook | One story per variant × state; capture from Storybook URLs |
| **Git worktrees / branches** | Structural differences (routing, data loading, layout shell) that can't coexist in one build | `git worktree add ../<repo>-B design/<feature>/B`, then `workspace.sh scratch --worktree ../<repo>-B` so teardown removes it; run each on its own port |

Rules:
- Variants must not break the main build or tests. Keep the switch dev-only.
- Add **state fixtures** so every variant can be put into each parity state on demand, e.g. `?state=empty|loading|error|overflow|default` backed by mock data. Without this, the comparison isn't fair.
- **Keep every variant out of git.** `workspace.sh scratch <dir>` drops a `.gitignore` containing `*` into the directory, so the variants compile and render but never appear in `git status` and never reach a commit. Over a long session this is the difference between a readable diff and forty untracked files for designs you discarded.
- **One hazard to watch:** the variant switch usually lives in a tracked parent component, and a tracked file importing an ignored variant breaks the build for anyone else who checks the branch out. `workspace.sh status` flags exactly this. Keep the switch behind a dev-only guard and remove it at finalization.
- **Clean up at finalization:** fold the winner into the real code path, then, with the user's approval, run `workspace.sh clean --keep-shots --yes` to delete the losing variants, the switch files, the fixtures and any variant worktrees in one step. Screenshots, the board and the log stay for the final review. At hand-off, approved `workspace.sh clean --yes` removes screenshots and the board but keeps `log.json`; `--all` removes the log too.

## 2. Capture under parity

Every variant in an iteration is captured with the identical parity set. Default: breakpoints `375, 768, 1280`; states `default, empty, error` (+ `loading`, `overflow` where relevant); theme `light` (+ `dark` if supported).

- **Automated:** `node <skill-dir>/scripts/capture.mjs <workspace>/log.json --iteration N`. It uses Playwright and writes `shots/iter-NN/<variant>/<bp>-<state>[-<theme>].png` from each variant's URL template, where `{state}` and `{theme}` are substituted.
- **Manual / host browser tools:** take the same shots and save them to the same paths. The board finds them by filename.
- When the parity set changes (say a state is added), re-capture the **champion** under the new set so it stays comparable.

## 3. The design workspace

Create it with `bash <skill-dir>/scripts/workspace.sh init <feature>` before any council file is written, and start `log.json` from `assets/log.example.json`.

**Where it lives follows where the skill is installed**, which `init` resolves and prints:

| Skill installed | Workspace | Why |
|---|---|---|
| In the repo (`<repo>/.claude/skills/…`, a plugin vendored into the project) | `<repo>/.ui-ux-design-council/<feature>/` | Tooling the team shares should put its artifacts where the team can see them |
| Globally (`~/.claude/skills/…`, `~/.agents/skills/…`, or a host's plugin cache) | `${XDG_STATE_HOME:-~/.local/state}/ui-ux-design-council/<repo>-<hash>/<feature>/` | Keeps screenshots, boards and logs outside the project |

Force either with `--local` / `--global` on any subcommand, or set `UIUX_COUNCIL_WORKSPACE` to a directory you control. A global workspace records the repo it belongs to in `.repo`, which is what `workspace.sh gc` uses later to find workspaces whose repo is gone.

**Variant source code does not move.** It has to compile against the real app with the real tokens, so it stays in the source tree and `workspace.sh scratch <dir>` keeps it ignored and registered for teardown. The workspace holds artifacts; the source tree holds the throwaway code that produced them.

A repo-local workspace is scratch by construction: `init` writes `.ui-ux-design-council/.gitignore` containing `*`, which ignores the directory's whole contents including itself, so:

- the repo's own `.gitignore` is never edited (no stray diff, no bikeshedding about an ignore rule in review),
- screenshots, boards, prototype `node_modules` and discarded variants never show up in `git status`,
- nothing can be committed by accident; keeping a file is an explicit `git add -f <path>`.

Session lifecycle:

| When | Command | Effect |
|---|---|---|
| Step 0, before any file | `workspace.sh init <feature>` | Self-ignoring workspace, ready to fill |
| When a variant dir or worktree is created | `workspace.sh scratch <dir>` / `scratch --worktree <dir>` | Registered for teardown, ignored by git |
| Any time | `workspace.sh status` | Sizes, what git can see, tracked files still referencing scratch |
| After recording each iteration, from iteration 3 | `workspace.sh prune --keep 2 --min 200` | Prints an offer: the shots of variants older iterations already rejected. Silent under 200MB, deletes nothing |
| When the user answers a reclaim offer | `workspace.sh policy --prune off` / `--expire never` | Records "stop asking" or "keep this workspace", so the answer survives the session |
| Finalization (Step 6), on the user's yes | `workspace.sh clean --keep-shots --yes` | Variants, switch, fixtures, worktrees, prototype builds removed |
| Hand-off (Step 8), on the user's yes | `workspace.sh clean --yes` (or `--all`) | Everything in each feature directory goes except `log.json` (`--all` keeps nothing) |
| Preflight, and occasionally across projects | `workspace.sh gc` | Offers up workspaces whose repo is gone, or that are past their own expiry |

### Who decides what gets deleted

Every destructive command here is a dry run until `--yes`, and the council runs them that way deliberately. The rule is:

1. **The council never deletes design history on its own.** Mid-session reclaims are offered with the figure and the cost, and acted on only with an explicit yes. A non-answer is a no. Someone who wants to re-open `B1` two rounds later should find it there.
2. **At the final decision it recommends cleanup strongly, and still asks.** That is the moment teardown is cheapest: the champion is in the real code path, and the losing variants are dead code that can only mislead the next reader. The user can still say no.
3. **Expiry makes a workspace eligible for cleanup.** The default is 14 inactive days, recorded in `.policy`. Nothing runs automatically: `gc` previews its plan, and the council needs explicit approval before adding `--yes`. For an existing repo, expiry cleanup keeps each feature's `log.json`. If the repo is gone or the workspace has no `.repo` marker, the plan removes the entire workspace, including logs. Explain that loss before requesting approval.
4. **A recorded answer outranks a sweep.** `policy --expire never` survives `gc --older-than 0`; only an explicit `--force` overrides it. `policy --prune off` stops the mid-session offers for good.

`gc` never touches the repo's source tree, only workspaces. Registered variant directories in the source tree are removed by `clean`, which is always a deliberate act.

### Pruning mid-session

A long session is the problem case: twelve iterations at three variants, nine parity shots each, is thousands of PNGs for designs that were rejected in round two. `prune --keep 2` reclaims them without breaking anything the board still draws. It keeps:

- every iteration in the newest N (default 2), untouched, including its challengers;
- every variant recorded as `champion` or `parked`, in any iteration;
- the champion's entire ancestry through `parent` and `merged_from`, because the lineage view renders `A1 → A2 → A3` side by side across iterations;
- anything whose status is missing or unrecognised, on the principle that prune never guesses.

It drops the shots of rejected challengers in older iterations, orphan shot directories with no matching variant, and stray inline board files over 20MB that are not the current `board.html` (an `--inline` board embeds every PNG as base64, so these are the single largest files the council produces). Old boards then show "no shot" in those cells. Scores, feedback and lineage live in `log.json` and are never touched, so the trend table and the decision history stay complete.

`--min MB` is what makes the offer non-annoying: below the threshold prune says so and exits, so the council only raises the subject when the number justifies interrupting. Never run `--yes` without asking.

Treat a feature directory as disposable: `clean` keeps `log.json` unless `--all` is selected, so anything worth keeping (a token, a pattern, a decision) belongs in `DESIGN.md`, the spec or the real code path before teardown. `clean` prints a plan with sizes and a total before it acts, deletes nothing without `--yes`, refuses tracked scratch directories unless `--force`, and prunes the empty parent directories it leaves behind. Set `UIUX_COUNCIL_WORKSPACE` to a path outside the repo to store artifacts there. Project edits and registered scratch directories or worktrees remain separate; `clean` can remove those registered paths wherever artifacts are stored.

Variant IDs, states, and themes must begin with a letter or digit and contain only letters, digits, dots, underscores, and hyphens. Iteration IDs must be nonnegative integers. Helpers reject paths or symlinks that escape the workspace. Board output defaults to `board.html`; a custom `--out` path is relative to the log directory and must stay inside it.

```
.ui-ux-design-council/
  .gitignore            # contains "*", so git sees nothing below
  .scratch-manifest     # registered scratch roots and worktrees, for teardown
  <feature>/
    log.json            # the lineage ledger (source of truth for comparisons)
    board.html          # generated comparison board
    shots/iter-01/A1/375-default.png …
```

Nothing here is committed by default. If the user wants the lineage kept as a durable record, promote the ledger alone with `git add -f .ui-ux-design-council/<feature>/log.json`; the screenshots it references are throwaway. With OpenSpec, also put a short iteration summary (champion, what changed, scores trend) in the change's `design.md` and link the log. With Haft, link any DecisionRecord IDs from the relevant iteration.

Review screenshots, feedback, and logs for private product information before committing or sharing them. `node <skill-dir>/scripts/build_board.mjs <workspace>/log.json --inline` embeds screenshots in a single HTML file, so the board inherits their sensitivity.

### `log.json` schema

```json
{
  "feature": "settings-redesign",
  "brief_ref": "openspec/changes/redesign-settings/proposal.md",
  "rubric": {"brief_fit": 3, "usability": 3, "a11y": 2, "consistency": 2, "distinctiveness": 1, "feasibility": 1},
  "parity": {"breakpoints": [375, 768, 1280], "states": ["default", "empty", "error"], "themes": ["light"]},
  "iterations": [
    {
      "id": 1,
      "date": "2026-11-06",
      "goal": "Explore IA: sidebar vs search-first vs grouped cards",
      "count_rationale": "default 3; one main axis (IA)",
      "variants": [
        {
          "id": "A1", "parent": null, "merged_from": [], "seat": "craft-lead",
          "thesis": "Extend existing left-nav; settings grouped by object",
          "axes": {"ia": "sidebar", "density": "compact"},
          "ref": {"url": "http://localhost:3000/settings?variant=A&state={state}", "branch": null, "commit": "abc123"},
          "scores": {"brief_fit": 4, "usability": 4, "a11y": 4, "consistency": 5, "distinctiveness": 2, "feasibility": 5},
          "nielsen": {"4": 0, "3": 0, "2": 2, "1": 3},
          "slop_flags": 1,
          "status": "champion",
          "notes": "Strong on consistency; weak discoverability for rare settings"
        }
      ],
      "feedback": "User: 'A is safest but I like C's search bar'",
      "decision": "A1 champion; next: A2 adds C1's search-first header",
      "decided_by": "user"
    }
  ]
}
```

`status` takes one of `champion | challenger | merged | dropped | parked`. Use `parked` for "not now, maybe later". Parked variants can be revived in a later iteration with a new ID that keeps the parent link.

## 4. Comparing within an iteration

1. **Capture** all variants under parity.
2. **Judge on the screenshots** with the rubric (`arbitration.md`), the Nielsen seat and impeccable's audit. Where you can, score each variant before re-reading its thesis, so the pitch doesn't bias the score.
3. **Build the board:** `node <skill-dir>/scripts/build_board.mjs <workspace>/log.json`. It shows a grid of variants (columns) × state/breakpoint (rows), a score table, and an A/B overlay for any two shots. Node 18+ is sufficient; the installed skill includes compiled JavaScript and needs no build step or npm dependencies for this command.
4. **Show the user** the board and a ≤5-line verdict: recommended champion, the best idea worth stealing from each loser, and the one question that would decide a close call.
5. **Record** the scores, Nielsen counts, user feedback (verbatim, short) and the decision in `log.json`.

## 5. Comparing across iterations (co-evolution)

Use a champion/challenger loop:

- Each new iteration contains the **refined champion** plus **0 to N challengers**. Challengers can be fresh directions, merges, or a parked variant revived. Zero challengers is fine in late, polish-stage iterations.
- **Always compare against the previous champion's screenshots.** The board's lineage view puts `A1 → A2 → A3` side by side per state/breakpoint, and the A/B overlay works across iterations.
- **Track scores across iterations** in the board's trend table. Flag regressions: if any rubric row drops by ≥1, or a new Nielsen issue of severity ≥3 appears, call it out explicitly even when the total went up.
- **Write a one-line delta** per variant ("A2 = A1 + search-first header + denser rows") so the user can see what caused each change.
- **Prefer one major change per lineage per iteration.** If several things change at once, the comparison can't tell you what helped.
- **Keep the rubric stable.** If the brief changes, update the rubric weights in the log, note it in that iteration's `goal`, and re-score the champion under the new weights so the trend stays honest.

**When to stop iterating:** the user is satisfied; or two consecutive iterations improve the weighted score by <5% with no critical or major issues left; or the remaining differences are taste, not usability. Say which applies.

## 6. User-driven iteration

The user may say "more like B but calmer" or "combine the header from 1 with the list from 3". Translate that into explicit lineage (`M3.merged_from = [B2, A1]`, plus a delta line), confirm in one line, then build. Record their words in `feedback`. Over iterations this builds a readable history of why the design looks the way it does.
