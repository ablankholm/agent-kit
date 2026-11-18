# agent-kit

My collection of agent skills, hooks and config examples, shared in case you find them useful. Add the GitHub marketplace once, then install the plugins you want. Each plugin documents its supported agents and requirements.

## Available plugins

| Name | Plugin | Hosts | Purpose |
|---|---|---|---|
| [UI/UX Design Council](plugins/ui-ux-design-council/README.md) | `ui-ux-design-council` | Codex, Claude Code | Compare competing interface designs, review usability, and implement the chosen direction. |
| [Kubectl Guard](plugins/kubectl-guard/README.md) | `kubectl-guard` | Claude Code | Require explicit mutation targets, confirm risky kubectl commands, and check installation health. |

## Configs

| Template | Purpose |
|---|---|
| [AGENTS.md](configs/agents/AGENTS.example.md) | Personal preferences for communication, delegation, tools and verification. |
| [OpenSpec config](configs/openspec/config.example.yaml) | Planning rules and guidance for implementation and archiving. |

Review and merge these examples into your own setup. Follow the [configuration guide](configs/README.md) for scope, compatibility and adoption. Installing a plugin does not install these templates.

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

## License

MIT. See [LICENSE](LICENSE). Referenced third-party skills retain their own licenses and are not redistributed by this repository.
