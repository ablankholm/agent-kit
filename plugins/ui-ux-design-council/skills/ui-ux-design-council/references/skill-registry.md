# Skill registry

What each council seat is good at, where it falls short, how to detect it and how to install it.

> These are separate third-party projects, not bundled dependencies. Before offering an install, verify the command and license in the source repository, inspect the skill and its scripts, and describe any external access it needs. Ask before installing; use the fallback if the source cannot be verified or the user declines.

## Where skills live

| Host | Repo-local | Global (user) | Other |
|---|---|---|---|
| Claude Code | `<repo>/.claude/skills/<name>/SKILL.md` | `~/.claude/skills/<name>/SKILL.md` | Plugins: `~/.claude/plugins/**/skills/<name>/SKILL.md` |
| Codex | `.agents/skills/<name>/` in CWD and each parent up to repo root | `~/.agents/skills/<name>/` | Legacy `~/.codex/skills/`; admin `/etc/codex/skills/`; built-in system skills |

Both hosts use the same `SKILL.md` format (agentskills.io), so one copy can serve both. Symlinks work in both.

The cross-agent installer `npx skills add <source> --skill <name>` supports `-a claude-code` / `-a codex` to target an agent, `-g` for global and `-y` to skip prompts. Run `npx skills --help` to confirm flags.

## Scope: repo-local vs global

**Install repo-local when:**
- The skill's behavior or output should be versioned with the project, so teammates and CI get the same version.
- It writes project-specific context (e.g. impeccable's `PRODUCT.md` / `DESIGN.md`).
- You want to pin a version and review upgrades in PRs.

**Install global when:**
- It's project-agnostic personal tooling (audits, reference catalogs).
- It's large and you don't want it in every repo's diff.
- You're working solo or across many repos.

**Default recommendation table** (adjust for a solo user vs. a team):

| Skill | Recommended scope | Rationale |
|---|---|---|
| `impeccable` | **Repo** | It generates and reads per-project `PRODUCT.md` / `DESIGN.md`. A pinned version keeps the team's design language consistent. |
| `nielsen-heuristics-audit` | **Global** | Generic, stable, project-agnostic. |
| `ui-ux-pro-max` | **Global** | Large reference catalog, useful in every repo, noisy in diffs. Use repo scope if a team wants identical style recommendations. |
| `frontend-design` / `frontend-skill` | **Global** (or the host's plugin/installer) | Use an available frontend skill whose source and behavior you have verified. |
| `review-ux-ui` | **Global**, optional | Occasional deep reviews. |
| `ss-audit` | **Repo** for mobile apps, else **global** or skip | Only relevant where mobile UX matters. |
| `ui-ux-design-council` (this skill) | **Repo** if the team adopts it, else **global** | Same reasoning as impeccable. |
| OpenSpec / Haft | **Follow the repo's existing setup** | These are team process tools. Don't introduce them into a repo unprompted. If only installed globally, ask before using them here. |

## Detection and caching

`scripts/detect_deps.sh` indexes every `SKILL.md` under the locations above, matching on frontmatter `name:` or directory name. It also detects OpenSpec, Haft and Quint usage (repo evidence vs. global install) and tools (npx, git, playwright). Results are cached per repo at `${XDG_CACHE_HOME:-~/.cache}/ui-ux-design-council/<hash>.cache`.

- **Default run:** prints the cache, or scans once if there's no cache.
- **`--recheck <key>`:** use only when a cached-present skill fails to load.
- **`--refresh`:** after installs or uninstalls, or when the user asks.
- **`--decline <key>` / `--undecline <key>`:** record install offers the user turned down. Declines clear automatically once the item is detected.

## Framework installs (offer only if the user wants to adopt them)

- **OpenSpec:** `npm install -g @fission-ai/openspec@latest`, then `openspec init` in the repo, which generates skills and `openspec/`. The expanded commands come from `openspec config profile` + `openspec update`.
- **Haft:** install the binary using the installer in the m0n0x41d/haft README, then `haft init --claude` or `--codex`. Add `--local` for repo-local skills; `--all` sets up both hosts. Read the script before piping it to a shell.

---

## impeccable: craft lead

- **Source:** [pbakaus/impeccable](https://github.com/pbakaus/impeccable). Consult its own license before installing or redistributing it.
- **What it is:** one skill with many subcommands (e.g. `init`, `shape`, `craft`, `extract`, `document`, `audit`, `critique`, `distill`, `polish`). Includes deterministic detectors for AI-generated design anti-patterns and live browser iteration. Built on Anthropic's original `frontend-design`.
- **Strengths:** repo/product grounding through `PRODUCT.md` + `DESIGN.md`; anti-slop detection; strong polish and critique.
- **Blind spots:** can be conservative and push toward refinement rather than bold new directions. Its critique is craft-focused, so use the Nielsen seat for formal usability.
- **Detect:** directory or `name:` = `impeccable`
- **Install:**
  - Native (project root): `npx impeccable skills install`
  - Cross-agent: `npx skills add pbakaus/impeccable --skill impeccable -a claude-code -a codex` (add `-g` for global)

## nielsen-heuristics-audit: usability judge

- **Source:** github.com/mastepanoski/claude-skills
- **What it is:** audits an interface against Nielsen's 10 usability heuristics. Produces a violation report, prioritized findings and remediation steps.
- **Strengths:** formal and explainable; findings come with severity; works on specs as well as built UI.
- **Blind spots:** says nothing about aesthetics or brand. Heuristics can be over-applied to expressive surfaces such as marketing pages.
- **Detect:** `nielsen-heuristics-audit`
- **Install:** `npx -y skills add mastepanoski/claude-skills --skill nielsen-heuristics-audit -a claude-code -a codex` (add `-g` for global)

## ui-ux-pro-max: style catalog

- **Source:** [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill); consult its own license
- **What it is:** a design-intelligence catalog: dozens of styles, ~190 palettes, ~70 font pairings, ~120 UX guidelines and ~20 stack profiles, with search across them.
- **Strengths:** broad, concrete options matched to product type and stack; good at breaking the model's default palette and fonts.
- **Blind spots:** picking from a catalog can become its own kind of generic. It's weaker on repo context. Its picks must be justified against the brief and lose to existing tokens unless the work is a rebrand.
- **Detect:** `ui-ux-pro-max`
- **Install:** `npx skills add https://github.com/nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max -a claude-code -a codex` (add `-g` for global)

## frontend-design (Claude) / frontend-skill (Codex): native builder

- **Claude:** Anthropic's `frontend-design` skill (anthropics/skills, also distributed as a Claude Code plugin). Pushes distinctive typography, color and layout and avoids generic defaults.
  - Install: `/plugin install frontend-design@claude-plugins-official` inside Claude Code, or `npx skills add anthropics/skills --skill frontend-design -a claude-code -g`
- **Codex:** use an installed frontend skill, or inspect the current official skill catalog with `$skill-installer` before recommending one. `frontend-skill` is a detection alias, not a promise that an official skill with that name exists. If none is available, use the native-builder fallback.
- **Strengths:** bold, opinionated visual direction; integrates well with the host.
- **Blind spots:** can put aesthetics ahead of task efficiency. Usability rules apply to core flows.
- **Detect:** `frontend-design` or `frontend-skill`

## review-ux-ui: flow & accessibility reviewer (optional)

- **Source:** github.com/pjt222/agent-almanac
- **What it is:** comprehensive UX/UI review: Nielsen heuristics, WCAG 2.1 accessibility audit and user-flow analysis.
- **Use when:** multi-step flows (onboarding, checkout, settings), forms, or accessibility-critical work.
- **Detect:** `review-ux-ui`
- **Install:** `npx skills add pjt222/agent-almanac --skill review-ux-ui -a claude-code -a codex -g`

## ss-audit: mobile auditor (optional)

- **Source:** github.com/bitjaru/styleseed
- **What it is:** Nielsen heuristics plus mobile UX checks: touch targets, safe areas, dark patterns. Gives an A+ to F grade.
- **Use when:** mobile apps, responsive web where mobile is primary, PWAs.
- **Detect:** `ss-audit`
- **Install:** `npx skills add bitjaru/styleseed --skill ss-audit -a claude-code -a codex`

---

## Security note

Each external skill has its own publisher and trust boundary, including skills distributed through a host catalog. They contain instructions, and sometimes scripts, that the agent will follow. Before installing, suggest the user skim each `SKILL.md` and any `scripts/`. Prefer pinning to a commit for repo-local installs.
