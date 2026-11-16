# UI/UX Design Council

A UI/UX design skill in the [agent-kit collection](../../README.md), available for Claude Code and Codex. It turns short goals into reasoned, repo-grounded interface design that doesn't look like default agent output. It does this by orchestrating specialist skills and making them compete:

| Seat | Skill | Role |
|---|---|---|
| Craft lead | [impeccable](https://github.com/pbakaus/impeccable) | Product/design context, anti-pattern detection, critique, polish |
| Usability judge | [nielsen-heuristics-audit](https://github.com/mastepanoski/claude-skills) | Nielsen's 10 heuristics, severity-ranked |
| Style catalog | [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | Styles, palettes, font pairings, UX guidelines |
| Native builder | An installed frontend skill, or the included fallback | Bold visual thesis, implementation |
| Optional | [review-ux-ui](https://github.com/pjt222/agent-almanac), [ss-audit](https://github.com/bitjaru/styleseed) | Flows + WCAG; mobile |

## What it does

1. **Preflight (cached per repo):** detects which sub-skills, OpenSpec and Haft/Quint are present. It offers install commands, with a repo-vs-global recommendation, for anything missing.
2. **Grounds in the repo:** inventories existing tokens, components and patterns.
3. **Intake:** asks only what it can't infer, in one batch with recommended defaults.
4. **Brief in your system of record:** an OpenSpec proposal, specs, design and tasks when the repo uses OpenSpec; Haft framing when present; otherwise a freeform brief.
5. **Competing directions:** three by default. It uses fewer for constrained work, or a morphological matrix when there are several independent design axes.
6. **Iteration loop:** builds variants as real code behind a dev-only switch, captures them under identical conditions, judges them (Nielsen, anti-slop, weighted rubric) and records lineage in `log.json`. It generates a comparison board with a score trend, regression flags, per-iteration grids, champion lineage and an A/B overlay.
7. **Finalizes** the champion, recommends removing the losing variants, and reviews the result again.

## Install

First [add the agent-kit marketplace](../../README.md#install). Then install this plugin in your preferred agent.

Codex:

```sh
codex plugin add ui-ux-design-council@ablankholm
```

Claude Code:

```sh
claude plugin install ui-ux-design-council@ablankholm
```

Inside Claude Code, use `/plugin install ui-ux-design-council@ablankholm`.

### Manual installation

To install without the plugin system, clone the repository and copy the skill into either or both agents' skill directories:

```sh
git clone https://github.com/ablankholm/agent-kit.git
mkdir -p ~/.agents/skills ~/.claude/skills
cp -R -n agent-kit/plugins/ui-ux-design-council/skills/ui-ux-design-council ~/.agents/skills/
cp -R -n agent-kit/plugins/ui-ux-design-council/skills/ui-ux-design-council ~/.claude/skills/
```

These copies do not update automatically. Prefer marketplace installation for ongoing use, and avoid installing both a manual copy and a plugin copy in the same agent.

## Usage

Start a new session in your project after installing, then ask for the skill by name (`ui-ux-design-council`) or describe a UI/UX task and let it trigger. For example:

> Use the UI/UX Design Council to redesign this settings screen. Keep our existing components and compare two layout options.

## Requirements

- Bash for the cached dependency detector and the workspace manager. On Windows, use a compatible environment such as WSL.
- Node.js 18 or newer for the comparison board, the screenshot helper and the prune helper. These use only Node's built-in modules and ship as plain JavaScript, so there is no compiler, build step or `npm install` for skill users.
- Playwright in the target project for automated screenshots. The agent's own browser tools can capture them instead.
- Optional specialist skills: Impeccable, Nielsen Heuristics Audit, UI/UX Pro Max, and an available frontend skill. The council detects them, offers installation when needed, and includes fallbacks for missing seats. They are separate third-party projects, not bundled here. See the [dependency registry](skills/ui-ux-design-council/references/skill-registry.md).
- OpenSpec and Haft/Quint integration follows the project's existing setup. Neither is required.

## Artifacts and cleanup

A design session produces throwaway material: competing variants as real code, parity screenshots at several breakpoints and states, and an HTML comparison board. The council manages that itself rather than leaving it in your working tree.

- **Where it goes.** Artifacts follow the skill's install scope. Installed globally, they live in `$XDG_STATE_HOME/ui-ux-design-council/<repo>-<hash>/` and your project is never written to. Installed inside a repo, they live in `<repo>/.ui-ux-design-council/` behind a self-ignoring `.gitignore`, so they stay out of `git status` without touching the repo's own ignore rules. Override with `--local`, `--global` or `UIUX_COUNCIL_WORKSPACE`.
- **Variant code is the exception.** It has to compile against the real app with the real tokens, so it stays in the source tree. The council registers each throwaway directory on creation, keeps it ignored, and removes it at teardown. It also flags any tracked file still importing a variant, which would otherwise break the build for everyone else.
- **You decide what gets deleted.** Mid-session reclaim offers are dry runs that delete nothing; the council acts only on an explicit yes, and a non-answer is a no. At the final decision it recommends teardown strongly, and still asks.
- **Nothing accumulates silently.** Each workspace carries an expiry (14 untouched days by default). A session that is abandoned or forgotten has its screenshots reclaimed by a later sweep, while `log.json`, which holds the scores, feedback and lineage, is kept. `workspace.sh policy --expire never` makes a workspace permanent, and that answer outranks any later sweep.

Screenshots, logs, feedback and boards can contain private product information. Review them before sharing. An `--inline` board embeds every screenshot in the HTML, so it inherits their sensitivity.

## Access and generated files

This plugin contains instructions and local helpers. It has no hooks, MCP servers, credentials or telemetry, and needs no GitHub authentication after installation from this public repository.

- Dependency detection reads skill locations and project configuration, then writes a local cache.
- Design work can edit project files.
- Screenshot capture visits the application URLs supplied in the iteration log. The board generator reads local screenshots and writes HTML; it does not upload anything.
- Installing another skill is a separate action requiring consent. Review its source and permissions before installing it.

## Files

The paths below are relative to `skills/ui-ux-design-council/`.

- `SKILL.md`: the orchestration workflow
- `references/`: skill registry, intake, OpenSpec/Haft integration, arbitration rules, comparison method, fallbacks
- `scripts/detect_deps.sh`: cached dependency detection
- `scripts/workspace.sh`: workspace creation, scratch registration, status, prune, teardown, policy and cross-project sweeps
- `scripts/prune.mjs`: lineage-aware mid-session reclaim, used by `workspace.sh prune`
- `scripts/capture.mjs`: parity screenshots via Playwright
- `scripts/build_board.mjs`: comparison board (compiled from the repository's `src/build_board.mts`)
- `assets/log.example.json`: example iteration log
