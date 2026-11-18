# agent-kit

An independent collection and GitHub marketplace of reusable skills and hooks. Add the marketplace once, then install the plugins you want. Each plugin documents its supported agents and requirements.

## Available plugins

| Name | Plugin | Hosts | Purpose |
|---|---|---|---|
| [UI/UX Design Council](plugins/ui-ux-design-council/README.md) | `ui-ux-design-council` | Codex, Claude Code | Compare competing interface designs, review usability, and implement the chosen direction. |
| [Kubectl Guard](plugins/kubectl-guard/README.md) | `kubectl-guard` | Claude Code | Request confirmation for risky or ambiguous kubectl commands while preserving native permissions. |

Each plugin's README covers what it does, how to install it, what it requires, and what it reads and writes.

## Install

Git is required to add this marketplace. Run the command for your agent, then follow the install instructions in the plugin's own README. Each agent's catalog lists only its supported plugins. Adding the marketplace does not install any plugin.

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

These commands were checked with Codex 0.166.0 and Claude Code 2.1.236. If your CLI has no `plugin` command, update it or consult the plugin's README for alternatives.

## Development

```sh
git clone https://github.com/ablankholm/agent-kit.git
cd agent-kit
npm ci
npm run validate
```

Validation checks that generated JavaScript matches its TypeScript source, then checks each host's catalog and package manifests, hook configuration, skill metadata and references, helper syntax, and regression tests. If Claude Code is installed, it also runs the host's strict validators on the Claude marketplace and its plugins. Development uses Node and Bash; Python is not required.

The design council's board generator is authored in `src/build_board.mts`. After editing it, run `npm run build`, then `npm run validate`, and commit both the source and generated `plugins/ui-ux-design-council/skills/ui-ux-design-council/scripts/build_board.mjs`. TypeScript and Node type definitions are development-only dependencies. To run the package checks and tests without installing the compiler, use `node scripts/validate.mjs` (or `bash scripts/validate.sh`); this skips the source-to-output comparison.

Plugins live under `plugins/<plugin-name>/`, with skills in `skills/<skill-name>/` and Claude hooks in `hooks/hooks.json`. Include a manifest and catalog entry for each supported agent, add a row to the index above, and document the plugin in its own README. Host-specific plugins need only their supported host's manifest and entry. Plugins shared by both agents must use the same source directory and version in both manifests. Validation rejects unregistered host manifests, so removing a catalog entry cannot silently drop an existing host's distribution.

## License

MIT. See [LICENSE](LICENSE). Referenced third-party skills retain their own licenses and are not redistributed by this repository.
