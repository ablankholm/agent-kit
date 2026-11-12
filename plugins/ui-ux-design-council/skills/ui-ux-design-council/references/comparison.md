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
| **In-app variant switch** (default) | Variants of one screen or component sharing data and routes | Each variant is its own component file under a clearly temporary folder (e.g. `src/**/__variants__/<feature>/A.tsx`), selected by a dev-only switch (`?variant=A`, a dev toolbar, or a flag). The parent renders `variants[current]`. Nothing ships unless chosen. |
| **Storybook stories** | Component-level work in a repo that already uses Storybook | One story per variant × state; capture from Storybook URLs |
| **Git worktrees / branches** | Structural differences (routing, data loading, layout shell) that can't coexist in one build | `git worktree add ../<repo>-B design/<feature>/B`; run each on its own port |

Rules:
- Variants must not break the main build or tests. Keep the switch dev-only.
- Add **state fixtures** so every variant can be put into each parity state on demand, e.g. `?state=empty|loading|error|overflow|default` backed by mock data. Without this, the comparison isn't fair.
- **Clean up at finalization:** delete losing variants and the switch, and fold the winner into the real code path. Screenshots and the log stay.

## 2. Capture under parity

Every variant in an iteration is captured with the identical parity set. Default: breakpoints `375, 768, 1280`; states `default, empty, error` (+ `loading`, `overflow` where relevant); theme `light` (+ `dark` if supported).

- **Automated:** `node <skill-dir>/scripts/capture.mjs <workspace>/log.json --iteration N`. It uses Playwright and writes `shots/iter-NN/<variant>/<bp>-<state>[-<theme>].png` from each variant's URL template, where `{state}` and `{theme}` are substituted.
- **Manual / host browser tools:** take the same shots and save them to the same paths. The board finds them by filename.
- When the parity set changes (say a state is added), re-capture the **champion** under the new set so it stays comparable.

## 3. The design workspace

Per feature: `.ui-ux-design-council/<feature>/` in the repo root. Start from `assets/log.example.json`.

Variant IDs, states, and themes must begin with a letter or digit and contain only letters, digits, dots, underscores, and hyphens. Iteration IDs must be nonnegative integers. Helpers reject paths or symlinks that escape the workspace. Board output defaults to `board.html`; a custom `--out` path is relative to the log directory and must stay inside it.

```
.ui-ux-design-council/<feature>/
  log.json        # the lineage ledger (source of truth for comparisons)
  board.html      # generated comparison board
  shots/iter-01/A1/375-default.png …
```

Ask once whether to commit it; the default is to gitignore `shots/` and commit `log.json`. With OpenSpec, also put a short iteration summary (champion, what changed, scores trend) in the change's `design.md` and link the log. With Haft, link any DecisionRecord IDs from the relevant iteration.

Review screenshots, feedback, and logs for private product information before committing or sharing them. `build_board.py --inline` embeds screenshots in a single HTML file, so the board inherits their sensitivity.

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
3. **Build the board:** `python3 <skill-dir>/scripts/build_board.py <workspace>/log.json`. It shows a grid of variants (columns) × state/breakpoint (rows), a score table, and an A/B overlay for any two shots.
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
