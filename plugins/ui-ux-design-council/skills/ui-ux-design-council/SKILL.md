---
name: ui-ux-design-council
description: Guide UI/UX design, redesign, and usability critique in Codex and Claude Code. Ground decisions in the project, compare working variants, and coordinate installed specialist skills or built-in fallbacks. Use for screens, components, and user flows; exclude backend, API, and system architecture design.
---

# UI/UX Design Council

You chair a council of UI/UX specialist skills. You route work to them, have them propose competing directions, judge those directions against the user's goals, the repo's existing design system and established usability principles, then build and review the winner.

The output is **reasoned UI/UX**: every significant decision traces to a user goal, a constraint, an existing repo pattern or a named principle. "It looks modern" is never a reason.

Scope: interface and experience design (screens, flows, components, visual system, interaction, content hierarchy). Not backend, API, data-model or system architecture design. If a request is mostly the latter, say so and don't trigger the full council.

## The council

| Seat key | Skill | Role | Required? |
|---|---|---|---|
| `craft-lead` | `impeccable` | Product/design context, shaping, building, anti-pattern detection, critique, polish | Core |
| `usability` | `nielsen-heuristics-audit` | Judges directions and builds against Nielsen's 10 heuristics | Core |
| `style-catalog` | `ui-ux-pro-max` | Styles, palettes, font pairings, UX guidelines matched to product type and stack | Core |
| `native-builder` | `frontend-design` / `frontend-skill`, when installed | Available frontend skill; bold visual thesis, implementation | Core |
| `flow-a11y` | `review-ux-ui` | Nielsen + WCAG 2.1 + user-flow analysis | Optional: complex flows, accessibility-critical work |
| `mobile` | `ss-audit` | Nielsen + mobile checks, A+ to F grade | Optional: mobile or responsive-first work |

Process frameworks the council plugs into when the repo uses them:

| Key | Framework | Used for |
|---|---|---|
| `openspec` | OpenSpec (OPSX: `/opsx:explore`, `/opsx:propose`, …) | **System of record** for the brief, design and tasks; validation |
| `haft` | Haft (current name of Quint Code) | Problem framing, diverse variants, parity comparison, decision records, verification |
| `quint` | Quint Code (legacy: `.quint/`, `/q1` through `/q5`) | Same role as Haft, for repos that haven't migrated |

Details: `references/skill-registry.md` (seats, install, scope) and `references/spec-integration.md` (OpenSpec, Haft, Quint).

## Step 0: Preflight (cached; cheap after the first run)

1. **Load dependency state once per session:** `bash <skill-dir>/scripts/detect_deps.sh` from the project root.
   - The script caches per repo. Later runs just print the cache, so there's no rescan cost.
   - Don't run it again in the same session. Keep the result in working memory.
   - Use `--refresh` only if the user asks, or after installs or uninstalls.
2. **Trust cached presence.** If the cache says a seat is INSTALLED, invoke it without re-checking. Only if invoking it actually fails (skill not found, path missing) run `--recheck <key>`, and offer to install if it's really gone.
3. **Report briefly:** one compact table on the first run in a repo; on cached runs, a single line (e.g. "Council: 4/4 core seats ready; OpenSpec in use; Haft available globally").
4. **Offer installs for MISSING core seats** that aren't listed as `declined`. Give the exact command, a recommended scope (repo vs global) and a one-line rationale (`references/skill-registry.md`). Mention optional seats only when the task touches their area.
   - Never install without explicit consent. Note that these are third-party skills the agent will execute.
   - After installing, run `--recheck <key>` (or `--refresh` after several installs). Some hosts need a restart to see new skills.
   - If the user declines, run `--decline <key>` so you don't ask again in this repo, then use the seat's fallback from `references/fallbacks.md`.
5. **Open the scratch workspace before anything is written to disk:** `bash <skill-dir>/scripts/workspace.sh init <feature>` from the project root.
   - **Where artifacts land follows where the skill is installed.** Installed inside the repo, they go to `<repo>/.ui-ux-design-council/` behind a self-ignoring `.gitignore` (`*`). Installed globally, they go to `${XDG_STATE_HOME:-~/.local/state}/ui-ux-design-council/<repo>-<hash>/`. Project edits can happen with either storage location. `init` prints the path. Override with `--local` / `--global`, or set `UIUX_COUNCIL_WORKSPACE`.
   - **Variant source code is the exception: it always lives in the repo's source tree**, because it has to compile against the real app with the real tokens. Register each throwaway directory the moment you create it, with `bash <skill-dir>/scripts/workspace.sh scratch src/components/__variants__/<feature>` or `scratch --worktree ../<repo>-B`. That ignores it and queues it for teardown. Unregistered scratch is scratch nobody will clean up.
   - Say where artifacts are going and that 14 inactive days makes them eligible for later cleanup. Nothing is deleted automatically. Record a request to keep them with `workspace.sh policy --expire never`.
   - Run `bash <skill-dir>/scripts/workspace.sh gc` once at preflight. If it proposes cleanup, explain the plan and run `gc --yes` only on an explicit yes. Expiry cleanup keeps each feature's `log.json`; removing a workspace whose repo is gone or whose `.repo` marker is missing deletes the whole workspace, including its logs. Call out that loss before asking. Don't ask the user to add ignore rules by hand.
6. **Frameworks:**
   - `IN-USE` (repo evidence) → you must use it; see Step 2.
   - `AVAILABLE` (global only, no repo evidence) → ask once whether to use it for this work. Cache a "no" with `--decline <key>`.
   - `ABSENT` → don't mention it.

## Step 1: Ground in the repo

Learn what exists before proposing or asking anything:

- With `impeccable` (or its fallback), run its init/extract flow so `PRODUCT.md` and `DESIGN.md` exist. If they already exist, reuse them.
- If OpenSpec is in use: read `openspec/config.yaml` (context and rules), relevant `openspec/specs/`, and any active change related to this work.
- If Haft/Quint is in use: query existing decisions and problems touching this area (e.g. `haft_query`, `/h-status`) so you don't contradict a recorded decision.
- Inventory tokens, component library, type/spacing scales, layout patterns, iconography, product vocabulary and stack. Mark what's **load-bearing** vs **incidental**.

Output a ≤15-line "Design system as it exists" note.

## Step 2: Intake: get enough to design from

Users are often terse ("redo the settings page"). Don't design from a guess, and don't interrogate them either. Follow `references/intake.md`:

1. Infer everything the repo and context can answer (Step 1). Never ask what you could discover.
2. Check the **design-readiness checklist**: users & jobs, core tasks, success criteria, constraints, scope, trade-off stance.
3. For the gaps that matter, ask **one batch of 2 to 5 targeted questions**, each with a recommended default and why. Use the host's structured question tool if it has one (e.g. AskUserQuestion); otherwise use a numbered list.
4. If the user says "just go" or doesn't answer, proceed on the defaults and list them as explicit assumptions in the brief.

## Step 3: Write the brief in the system of record

**If OpenSpec is in use, don't write a freeform brief.** Work with OpenSpec's own flow (details in `references/spec-integration.md`):

- Use `/opsx:explore` (or the `openspec-explore` skill) as the shared thinking space for intake and divergence. Explore writes no artifacts.
- Create the change with `/opsx:propose` (or `/opsx:new` + `/opsx:continue` / `/opsx:ff` on the expanded profile). The proposal's intent/scope/approach carries the brief. UX behavior (states, a11y, responsive rules) goes in `specs/` as requirements with scenarios. The direction comparison and the chosen direction's rationale go in `design.md`, and the build/review steps in `tasks.md`.
- Get templates from `openspec instructions <artifact> --change <id> --json` rather than inventing structure, and honor `config.yaml` rules.
- Validate with `openspec validate <id> --strict` (check `openspec --help` for current flags) and `openspec status --change <id>`.

**If Haft/Quint is in use**, use `h-frame` (Quint: `/q1-hypothesize`) to frame the problem and success criteria. Persist a record only when later work will rely on it, and cross-link it from OpenSpec's `design.md` if both are present.

**If neither**, write the brief yourself: users & jobs, core tasks ranked, IA (objects, relationships, primary actions), constraints (default WCAG 2.1 AA), trade-offs to decide, success criteria, assumptions.

In every case, show the brief or proposal to the user and get corrections before Step 4.

## Step 4: Competing directions (count adapts to the problem)

Explore genuinely different directions, grounded in the brief and the repo note. **Three is a sensible default, not a rule.** Choose the count deliberately and say why:

- **1**, with the alternative you rejected stated briefly: a tightly constrained change (a small component, a strict existing system, a pattern the repo already settles).
- **2**: one dominant trade-off (e.g. dense table vs. guided wizard).
- **3** (default): typical feature or screen work.
- **4 to 6, or a matrix**: several independent design axes. Identify the axes (e.g. IA model × interaction model × visual stance × density), list 2 to 4 options per axis, prune infeasible or clashing combinations, and pick combinations that cover the space with maximum spread.

Map seats to directions as fits, not strictly one each:

- **`craft-lead`**: the direction that stays faithful to the repo.
- **`style-catalog`**: catalog-matched style, palette and type, each pick justified against the brief.
- **`native-builder`**: a bolder direction with a stated visual thesis.
- **Haft `h-explore`** (if available): checks that the directions are actually diverse.

Each direction states its thesis, IA/layout sketch, key interactions and all states (empty, loading, error, overflow, first-run), use of existing tokens and components, the trade-offs it favors, and known weaknesses. Directions must differ in structure, not just color and font. If the host supports parallel subagents, build the directions in parallel from the same brief to avoid anchoring.

**Paper or code?** Screen spec on paper first when directions differ mainly in IA (cheap to reject). As soon as two or more survive, or the user wants to *see* them, build them as **concrete variants**: prototype-grade, real stack, real tokens, side by side in the app (`references/comparison.md` §1).

## Step 5: The iteration loop: build → capture → judge → decide

Run this loop for every iteration. Follow `references/comparison.md` for the mechanics.

1. **Build variants so they coexist.** Use an in-app dev-only variant switch by default, Storybook stories where the repo has them, and worktrees only for structural differences. Add state fixtures so every variant can show each parity state.
2. **Capture under parity.** Use `node <skill-dir>/scripts/capture.mjs <ws>/log.json --iteration N` (Playwright), or the host's browser tools writing to the same paths. Every variant gets the same breakpoints, states, themes and data.
3. **Judge.**
   - Run `nielsen-heuristics-audit` and `impeccable`'s audit/critique on the screenshots, plus `flow-a11y` and `mobile` when in play.
   - Check the slop list and score against the rubric (`references/arbitration.md`). Score before re-reading each thesis.
   - If Haft is in use, run `h-compare` under parity for a Pareto view.
   - Resolve disagreements between seats with the precedence order and name the rule that decided each one.
4. **Board.** Run `node <skill-dir>/scripts/build_board.mjs <ws>/log.json` (add `--inline` for a single shareable file). It shows the variant grid, the score table, the champion lineage, an A/B overlay across any two shots, and a score trend with regression flags. The JavaScript is bundled with the skill; no compiler or npm installation is needed for board generation.
5. **Decide with the user.** Give a ≤5-line verdict: the recommended champion, the best idea worth stealing from each other variant, and the one question that would settle a close call. **The user chooses**, or asks for a merge or tweak.
6. **Record** scores, Nielsen counts, user feedback (verbatim, short), status (`champion`/`challenger`/`merged`/`dropped`/`parked`) and lineage (`parent`, `merged_from`, one-line delta) in `<ws>/log.json`.
   - OpenSpec: add an iteration summary to `design.md` and re-validate.
   - Haft: bind a DecisionRecord via `h-decide` only on the user's direct request.
7. **Offer a reclaim, never decide one.** From iteration 3, run `bash <skill-dir>/scripts/workspace.sh prune --keep 2 --min 200` right after recording. It is a dry run: it prints a plan and deletes nothing. It also stays silent below 200MB, so it only speaks up when the figure is worth the user's attention.
   - When it prints a plan, put the choice to the user in one line with the figure and the cost: "the losing variants from iterations 1 to 4 are 1.4G; reclaim them? the last two iterations and the whole champion lineage stay, but B1 and D2 screenshots go for good." Use the host's structured question tool if it has one.
   - **Run `prune --yes` only on an explicit yes.** No answer is a no. Mid-session history is exactly what a user may want to re-open two rounds later ("show me B1 again"), and a surprise deletion there is the failure mode worth protecting against, not a few hundred megabytes.
   - If they decline, record it with `workspace.sh policy --prune off` so the council stops raising it for this workspace, and say that it will stop asking.
   - Declining leaves the files in place. Any later cleanup still requires approval.

**Across iterations (co-evolution):** the next iteration carries the refined champion plus 0 to N challengers, which can be fresh ideas, merges, or revived parked variants. Always compare against the previous champion's shots. Prefer one major change per lineage per iteration, and flag regressions even when the total score improves. Keep the rubric stable; if the brief changes, re-score the champion. Stop when the user is satisfied, when gains are <5% over two iterations with no critical or major issues, or when the remaining differences are taste rather than usability.

Workspace: `<workspace>/<feature>/` (`log.json`, `board.html`, `shots/`), created by `workspace.sh init` at the location its install scope dictates, and invisible to git either way. Nothing in it is committed by default, so a long session with a dozen discarded variants produces zero diff noise. If the user wants the ledger kept as a record, promote that one file deliberately at hand-off: `git add -f <path>/log.json` for a repo-local workspace, or copy it in from the global one.

## Step 6: Finalize the champion

- OpenSpec in use: implement through `/opsx:apply`, checking off `tasks.md`.
- Promote the champion into the real code path using the native builder skill, guided by `impeccable`'s craft command. The champion's code is the only thing that leaves the scratch workspace.
- **Recommend teardown, and let the user decide.** Run `bash <skill-dir>/scripts/workspace.sh status` first: it lists every registered scratch root with its size and flags tracked files that still reference one. Such a reference is usually a leftover variant-switch import, which breaks the build for everyone else once the champion is committed, so remove the hook regardless of what the user decides about the rest.
  Then recommend the teardown plainly, because this is the moment it costs least: the decision is made, the champion is in the real code path, and the losing variants are now dead code that can only confuse the next reader. Show the figure from `status`, say what disappears (losing variant code, the switch, fixtures, worktrees, prototype `node_modules`) and what survives (screenshots, boards and `log.json`, kept for Step 7). Run `bash <skill-dir>/scripts/workspace.sh clean --keep-shots --yes` once they agree.
- If they want the variants kept for now, leave them. Expiry only makes workspace artifacts eligible for later approved cleanup; it does not remove registered source directories or worktrees. Offer `workspace.sh policy --expire never` if they want to keep the workspace indefinitely.
- `clean` skips registered scratch directories containing tracked files unless `--force` is supplied. Registered worktrees are removed in full during approved cleanup, so review their contents before requesting approval.
- Check the result: `git status` should now show only the champion's real-code changes.
- Existing tokens and components come first. Every new one needs a one-line justification and must be added to the system properly.
- Build all states, with realistic content.

## Step 7: Final review

Capture the finalized UI as one last iteration with only the champion, so it's compared against its prototype. Run the review panel on it. Merge findings into one deduplicated list ranked by severity × user impact. Fix and re-capture until the critical and major issues are fixed, or for at most 3 loops, then report what remains.

- OpenSpec: `/opsx:verify` (expanded profile) or validate the change against its specs.
- Haft: `h-verify` against the decision's predictions, if a decision was recorded.

## Step 8: Polish and hand off

- Run `impeccable` polish (and distill if the UI is busy). Update `DESIGN.md` with any new tokens or patterns.
- **Close the workspace, with the user's say-so.** Once they have seen the final board, recommend `bash <skill-dir>/scripts/workspace.sh clean --yes`: it drops the screenshots and the board and keeps each feature's `log.json`. Name the figure it reclaims and the fact that boards are regenerable from the ledger plus a re-capture. Offer `--all` if they don't want the ledger either, and `git add -f <path>/log.json` if they want it committed instead.
- If they decline or don't answer, leave everything in place. A later `gc` still requires explicit approval of its cleanup plan.
- OpenSpec: leave the change ready for `/opsx:archive`. Don't archive unless asked.
- Summary:
  - what was built
  - the champion's lineage (e.g. `A1 → A2 (+C1 search) → A3`) and score trend
  - key decisions and the goal or principle each traces to
  - which seat won which argument
  - remaining issues and seats that ran on fallbacks
  - artifacts written, including the board path, and what teardown removed (variants, worktrees, shots, disk reclaimed)

## Invoking skills across hosts

- **Claude Code:** Skill tool or `/name args` (e.g. `/impeccable audit the header`, `/opsx:explore`).
- **Codex:** `$name args` (e.g. `$impeccable audit the header`).
- **Fallback:** read the skill's `SKILL.md` at the cached path and follow it.

Subcommand names change between versions. Check the installed skill's own SKILL.md for its current commands.

## Scaling down

- **Quick critique of existing UI:** Steps 0, 1 (light), 7, 8. Capture the current UI as iteration 0 so later changes can be compared against it.
- **Small component tweak:** Steps 0, 1 (light), 2 (only if critical gaps), one short loop of Step 5 (before vs. after as two variants), then 7 with one reviewer.
- **New feature, screen or redesign:** full flow.

State the mode and why.
