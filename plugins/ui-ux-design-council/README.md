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

1. **Understands your product:** starts with your existing components, styles and constraints, and asks only what it can't infer.
2. **Explores alternatives:** builds different working designs, usually three, so you can compare directions before choosing one.
3. **Challenges the designs:** brings specialist perspectives to usability, accessibility and visual quality, and shows the alternatives side by side on a comparison board.
4. **Improves your chosen direction:** uses your feedback to refine the design, checks the result, and offers to clean up the discarded alternatives.

It uses your existing OpenSpec or Haft workflow when available and offers to install missing specialist skills with your approval.

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

- Bash. On Windows, use a compatible environment such as WSL.
- Node.js 18 or newer. No build step or `npm install` is needed to use the skill.
- Playwright in the target project for automated screenshots. The agent's own browser tools can capture them instead.
- Optional specialist skills: Impeccable, Nielsen Heuristics Audit, UI/UX Pro Max, and an available frontend skill. The council detects them, offers installation when needed, and includes fallbacks for missing seats. They are separate third-party projects, not bundled here. See the [dependency registry](skills/ui-ux-design-council/references/skill-registry.md).
- OpenSpec and Haft/Quint integration follows the project's existing setup. Neither is required.

## Artifacts and cleanup

Design sessions create working alternatives, screenshots and a comparison board. The council tells you where the artifacts are stored and offers cleanup when you finish.

- **Storage:** a global install keeps artifacts in a project-specific directory under `$XDG_STATE_HOME/ui-ux-design-council/`, defaulting to `~/.local/state/ui-ux-design-council/`. A repo-local install uses `<repo>/.ui-ux-design-council/`, which is ignored by Git. Set `UIUX_COUNCIL_WORKSPACE` to choose another storage root.
- **Project edits:** temporary design variants and the chosen implementation can change project files, regardless of where screenshots and boards are stored.
- **Cleanup:** deletion requires your approval. Inactive workspaces become eligible for cleanup after 14 days; nothing is deleted automatically. Ordinary expiry cleanup keeps the scores, feedback and design log. If the project is gone or the workspace no longer identifies its project, cleanup can remove the whole workspace, including its logs. The council explains the planned deletion before asking.
- **Keeping your work:** ask to keep a session indefinitely to disable its expiry policy.

Screenshots, logs, feedback and boards can contain private product information. Review them before sharing. An `--inline` board embeds every screenshot in the HTML, so it inherits their sensitivity.

## Access and generated files

This plugin contains instructions and local helpers. It has no hooks, MCP servers, credentials or telemetry, and needs no GitHub authentication after installation from this public repository.

- Dependency detection reads skill locations and project configuration, then writes a local cache.
- Design work can edit project files.
- Screenshot capture visits the application URLs supplied in the iteration log. The board generator reads local screenshots and writes HTML; it does not upload anything.
- Installing another skill is a separate action requiring consent. Review its source and permissions before installing it.
