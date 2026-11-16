# agent-kit

An independent collection and GitHub marketplace of reusable skills for Codex and Claude Code. Add the marketplace once, then install the plugins you want. Each plugin packages one or more skills and documents its own requirements.

## Available skills

| Skill | Plugin | Purpose |
|---|---|---|
| [UI/UX Design Council](plugins/ui-ux-design-council/README.md) | `ui-ux-design-council` | Compare competing interface designs, review usability, and implement the chosen direction. |

Each skill's README covers what it does, how to install it, what it requires, and what it reads and writes.

## Install

Git is required to add this marketplace. Run the command for your agent, then follow the install instructions in the skill's own README. Adding the marketplace does not install any plugin.

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

These commands were checked with Codex 0.166.0 and Claude Code 2.1.236. If your CLI has no `plugin` command, update it or use the manual installation instructions in the skill's README.

## Development

```sh
git clone https://github.com/ablankholm/agent-kit.git
cd agent-kit
npm ci
npm run validate
```

Validation checks that generated JavaScript matches its TypeScript source, then checks the package manifests, skill metadata and references, helper syntax, and regression tests. If Claude Code is installed, it also runs the host's strict plugin validators. Development uses Node and Bash; Python is not required.

The design council's board generator is authored in `src/build_board.mts`. After editing it, run `npm run build`, then `npm run validate`, and commit both the source and generated `plugins/ui-ux-design-council/skills/ui-ux-design-council/scripts/build_board.mjs`. TypeScript and Node type definitions are development-only dependencies. To run the package checks and tests without installing the compiler, use `node scripts/validate.mjs` (or `bash scripts/validate.sh`); this skips the source-to-output comparison.

Plugins live under `plugins/<plugin-name>/`, with their skills in `skills/<skill-name>/`. Both marketplace catalogs point at the same plugin directories. To add a plugin, include manifests for both agents, register it in both catalogs, add a row to the skills index above, and document the plugin in its own README. Keep the version in both of a plugin's manifests aligned when releasing updates.

## License

MIT. See [LICENSE](LICENSE). Referenced third-party skills retain their own licenses and are not redistributed by this repository.
