# agent-kit

Shared agent skills for Codex and Claude Code.

**UI/UX Design Council** turns an interface-design request into competing designs, a usability review, and an implementation. It uses your project's components and design conventions, compares variants under the same conditions, and keeps a visual record of the decisions.

## Install

Git is required to install this GitHub marketplace. Run the commands for your agent:

### Codex

```sh
codex plugin marketplace add ablankholm/agent-kit
codex plugin add ui-ux-design-council@ablankholm
```

### Claude Code

```sh
claude plugin marketplace add ablankholm/agent-kit
claude plugin install ui-ux-design-council@ablankholm
```

Inside Claude Code, the equivalent commands are:

```text
/plugin marketplace add ablankholm/agent-kit
/plugin install ui-ux-design-council@ablankholm
```

Start a new session in your project after installing. For example:

> Use the UI/UX Design Council to redesign this settings screen. Keep our existing components and compare two layout options.

The installation commands were checked with Codex 0.166.0 and Claude Code 2.1.236. If your CLI has no `plugin` command, update it or use the manual installation below.

### Manual installation

Clone the repository, then copy the skill into either or both agents' skill directories:

```sh
git clone https://github.com/ablankholm/agent-kit.git
mkdir -p ~/.agents/skills ~/.claude/skills
cp -R -n agent-kit/plugins/ui-ux-design-council/skills/ui-ux-design-council ~/.agents/skills/
cp -R -n agent-kit/plugins/ui-ux-design-council/skills/ui-ux-design-council ~/.claude/skills/
```

These copies do not update automatically. Prefer marketplace installation for ongoing use. Avoid installing both a manual copy and a plugin copy in the same agent.

## Requirements and dependencies

- Bash and Python 3.9 or newer. On Windows, use a compatible environment such as WSL.
- Node.js 18 or newer and Playwright in the target project for automated screenshots. The agent's browser tools can capture screenshots instead.
- Optional specialist skills: Impeccable, Nielsen Heuristics Audit, UI/UX Pro Max, and an available frontend skill. The council detects them, offers installation when needed, and includes fallbacks for missing seats. They are separate third-party projects, not bundled here.
- OpenSpec and Haft/Quint integration follows the project's existing setup. Neither is required.

See the [plugin guide](plugins/ui-ux-design-council/README.md) and [dependency registry](plugins/ui-ux-design-council/skills/ui-ux-design-council/references/skill-registry.md) for details.

## Access and generated files

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

The shared skill lives in `plugins/ui-ux-design-council/skills/ui-ux-design-council/`. Both marketplace catalogs point at the same plugin. Keep the version in both plugin manifests aligned when releasing updates.

## License

MIT. See [LICENSE](LICENSE). Referenced third-party skills retain their own licenses and are not redistributed by this repository.
