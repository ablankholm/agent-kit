# agent-kit

An independent collection and GitHub marketplace of reusable skills for Codex and Claude Code. Add the marketplace once, then install the plugins you want. Each plugin packages one or more skills and documents its own requirements.

## Available skills

| Skill | Plugin | Purpose |
|---|---|---|
| [UI/UX Design Council](#uiux-design-council) | `ui-ux-design-council` | Compare interface designs, review usability, and implement the chosen direction. |

## Install

Git is required to add this marketplace. Run the command for your agent, then use a plugin's installation instructions below. Adding the marketplace does not install every plugin.

### Codex

```sh
codex plugin marketplace add ablankholm/agent-kit
```

### Claude Code

```sh
claude plugin marketplace add ablankholm/agent-kit
```

Inside Claude Code, the equivalent command is:

```text
/plugin marketplace add ablankholm/agent-kit
```

The installation commands were checked with Codex 0.166.0 and Claude Code 2.1.236. If your CLI has no `plugin` command, update it or use a skill's manual installation instructions.

## UI/UX Design Council

**UI/UX Design Council** turns an interface-design request into competing designs, a usability review, and an implementation. It uses your project's components and design conventions, compares variants under the same conditions, and keeps a visual record of the decisions.

### Install this plugin

After adding the marketplace, install the council in your preferred agent.

Codex:

```sh
codex plugin add ui-ux-design-council@ablankholm
```

Claude Code:

```sh
claude plugin install ui-ux-design-council@ablankholm
```

Inside Claude Code, use `/plugin install ui-ux-design-council@ablankholm`.

### Usage

Start a new session in your project after installing. For example:

> Use the UI/UX Design Council to redesign this settings screen. Keep our existing components and compare two layout options.

### Manual installation

To install the design council without the plugin system, clone the repository and copy its skill into either or both agents' skill directories:

```sh
git clone https://github.com/ablankholm/agent-kit.git
mkdir -p ~/.agents/skills ~/.claude/skills
cp -R -n agent-kit/plugins/ui-ux-design-council/skills/ui-ux-design-council ~/.agents/skills/
cp -R -n agent-kit/plugins/ui-ux-design-council/skills/ui-ux-design-council ~/.claude/skills/
```

These copies do not update automatically. Prefer marketplace installation for ongoing use. Avoid installing both a manual copy and a plugin copy in the same agent.

### Requirements and dependencies

- Bash for the dependency detector. On Windows, use a compatible environment such as WSL.
- Python 3.9 or newer for `build_board.py`, which turns the iteration log and screenshots into the HTML comparison board. It uses only the Python standard library; no pip packages are needed. Installing or loading the skill does not require Python.
- Node.js 18 or newer and Playwright in the target project for automated screenshots. The agent's browser tools can capture screenshots instead.
- Optional specialist skills: Impeccable, Nielsen Heuristics Audit, UI/UX Pro Max, and an available frontend skill. The council detects them, offers installation when needed, and includes fallbacks for missing seats. They are separate third-party projects, not bundled here.
- OpenSpec and Haft/Quint integration follows the project's existing setup. Neither is required.

See the [plugin guide](plugins/ui-ux-design-council/README.md) and [dependency registry](plugins/ui-ux-design-council/skills/ui-ux-design-council/references/skill-registry.md) for details.

### Access and generated files

This plugin contains instructions and local helpers. It has no hooks, MCP servers, credentials, or telemetry, and does not require GitHub authentication after installation from this public repository.

- Dependency detection reads skill locations and project configuration, then writes a local cache.
- Design work can edit project files. Comparison artifacts go under `.ui-ux-design-council/` in that project.
- Screenshot capture visits the application URLs supplied in the iteration log. The board generator reads local screenshots and writes HTML; it does not upload them.
- Installing another skill is a separate action requiring consent. Review its source and permissions before installing it.

Generated screenshots, logs, feedback, and boards can contain private product information. Review them before sharing. This repository ignores those generated artifacts.

## Development

```sh
git clone https://github.com/ablankholm/agent-kit.git
cd agent-kit
bash scripts/validate.sh
```

Validation checks the package manifests, skill metadata and references, helper syntax, and regression tests. If Claude Code is installed, it also runs the host's strict plugin validators. Python and Bash are required; Node is required to validate screenshot capture.

Plugins live under `plugins/<plugin-name>/`, with their skills in `skills/<skill-name>/`. Both marketplace catalogs point at the same plugin directories. To add a plugin, include manifests for both agents, register it in both catalogs, and document its skills and requirements in this README and its own guide. Keep the version in both of a plugin's manifests aligned when releasing updates.

## License

MIT. See [LICENSE](LICENSE). Referenced third-party skills retain their own licenses and are not redistributed by this repository.
