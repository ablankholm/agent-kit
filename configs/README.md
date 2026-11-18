# Agent configs

Personal agent preferences and OpenSpec config for concise communication, deliberate changes, useful verification and clear permission boundaries. Review them and keep the parts that fit how you work.

| Template | Purpose | Where to adopt it |
|---|---|---|
| [AGENTS.md](agents/AGENTS.example.md) | Communication style, delegation, tool use and verification habits | Your agent's global or project instructions |
| [OpenSpec config](openspec/config.example.yaml) | Rules for proposals, specs, designs and tasks, plus apply/archive guidance | The selected OpenSpec root's `openspec/config.yaml` |

These are editable examples. Adding the marketplace or installing a plugin does not install them. Their `.example` filenames are not standard instruction/configuration discovery names. There is no installer or automatic update of adopted copies.

## AGENTS.md

The preferences apply across agents; where to put them depends on your tool. Use `AGENTS.md` with agents that support it, or merge the preferences into your agent's equivalent instruction file.

1. Read [AGENTS.example.md](agents/AGENTS.example.md), then choose which preferences to adopt.
2. Choose the scope. For example, Codex uses `$CODEX_HOME/AGENTS.md` for personal defaults if that variable is set, otherwise `~/.codex/AGENTS.md`. Use the repository's `AGENTS.md` for project guidance.
3. Back up any existing file and merge selected sections. Preserve your existing organization and project instructions.
4. Check your agent's instruction precedence. In Codex, an `AGENTS.override.md` in the same scope takes precedence over `AGENTS.md`, and more specific project instructions can affect the result. Start a new session after editing.

For a quick check, ask a new session which instruction files it loaded and inspect those sources. See [Codex's AGENTS.md guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md) for its discovery rules, including custom fallback filenames.

## OpenSpec config

1. Use an existing OpenSpec project or initialize your intended project with `openspec init`. From that project, run `openspec context --json` to check which root is selected. A named store has its own root and configuration; use `--store <id>` consistently when targeting one.
2. Back up the selected root's existing `openspec/config.yaml` (or `config.yml`). Merge the sections you want from [config.example.yaml](openspec/config.example.yaml), preserving unrelated settings. Do not create a competing `config.yaml` beside an existing `config.yml`.
3. Replace the `context` placeholder with actual project facts: purpose, stack, conventions, commands, constraints and links to authoritative documentation. Avoid secrets. The example uses `schema: spec-driven`; adapt artifact names if you use a different schema.
4. Review the rules before adopting them. They are opinionated about discovery, open questions, narrow scope, verification and archiving. Keep only the rules your team intends to follow.

Tested with **OpenSpec 2.1.0**:

- `context` supplies project facts across the workflow.
- `rules.proposal`, `rules.specs`, `rules.design` and `rules.tasks` apply to their respective artifacts.
- `operations.apply.guidance` and `operations.archive.guidance` guide implementation and archiving.

If settings seem to be ignored, check which context and guidance OpenSpec loads for an existing change:

```sh
openspec instructions apply --change YOUR_CHANGE --json
```

Replace `YOUR_CHANGE` with your change name; append `--store <id>` when using a named store. Use `proposal` or `archive` in place of `apply` to inspect those inputs. These commands do not apply or archive the change.

If the expected settings are missing, check the selected root, your CLI version and the [OpenSpec customization documentation](https://github.com/Fission-AI/OpenSpec/blob/main/docs/customization.md). These settings guide the agent; they do not enforce permissions or guarantee compliance.

## Updating or undoing adoption

Pulling agent-kit updates the examples only. Review the diff and merge any changes you want into your own configuration. To undo adoption, restore your backup or revert the sections you merged. Existing plugins do not depend on either template.

These templates are covered by agent-kit's [MIT license](../LICENSE).
