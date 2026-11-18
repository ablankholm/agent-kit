# Agent configuration templates

Personal Codex preferences and OpenSpec workflow configuration for concise communication, deliberate changes, useful verification and clear permission boundaries. Review them and keep the parts that fit how you work.

| Template | Purpose | Where to adopt it |
|---|---|---|
| [Codex preferences](codex/AGENTS.example.md) | Communication style, delegation, tool use and verification habits | Your Codex home or a chosen repository's `AGENTS.md` |
| [OpenSpec configuration](openspec/config.example.yaml) | Rules for proposals, specs, designs and tasks, plus apply/archive guidance | The selected OpenSpec root's `openspec/config.yaml` |

These are editable examples. Adding the marketplace or installing a plugin does not install them. Their `.example` filenames are not standard instruction/configuration discovery names. There is no installer or automatic update of adopted copies.

## Codex preferences

1. Read [AGENTS.example.md](codex/AGENTS.example.md), then choose which preferences to adopt. They are personal defaults, including a preference for using subagents for verbose work.
2. Choose the scope. For personal defaults, use `AGENTS.md` in your Codex home: `$CODEX_HOME/AGENTS.md` if that variable is set, otherwise `~/.codex/AGENTS.md`. For shared project guidance, use the repository's `AGENTS.md` and review it with the team.
3. Back up any existing file and merge selected sections. Preserve your existing organization and project instructions.
4. Check for an `AGENTS.override.md` in the same scope; it takes precedence over `AGENTS.md`. More specific project instructions can also affect the result. Start a new Codex session after editing.

The example stays passive under standard discovery. If you explicitly configure `AGENTS.example.md` as a fallback filename, it can become an instruction source. See the [official AGENTS.md guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md) for discovery, scope and verification.

For a quick check, ask a new session which instruction files it loaded and inspect those sources. The preferences should encourage focused communication and deliberate tool use. A request to **watch** for a review or CI result should remain passive monitoring; it should not trigger or request the event. These are instructions to the agent, not a guarantee of compliance or a replacement for permissions and deterministic checks.

## OpenSpec configuration

1. Use an existing OpenSpec project or initialize your intended project with `openspec init`. From that project, run `openspec context --json` to check which root is selected. A named store has its own root and configuration; use `--store <id>` consistently when targeting one.
2. Back up the selected root's existing `openspec/config.yaml` (or `config.yml`). Merge the sections you want from [config.example.yaml](openspec/config.example.yaml), preserving unrelated settings. Do not create a competing `config.yaml` beside an existing `config.yml`.
3. Replace the `context` placeholder with actual project facts: purpose, stack, conventions, commands, constraints and links to authoritative documentation. Avoid secrets. The example uses `schema: spec-driven`; adapt artifact names if you use a different schema.
4. Review the rules before adopting them. They are opinionated about discovery, open questions, narrow scope, verification and archiving. Keep only the rules your team intends to follow.

Compatibility was checked with **OpenSpec 2.1.0**, including the actual generated instruction output:

- `context` supplies project facts across the workflow.
- `rules.proposal`, `rules.specs`, `rules.design` and `rules.tasks` apply to their respective artifacts.
- `operations.apply.guidance` and `operations.archive.guidance` supply separate advice for those operations. They do not relabel artifact rules or change permissions.

On an existing change, inspect the inputs without applying or archiving anything:

```sh
openspec instructions proposal --change YOUR_CHANGE --json
openspec instructions apply --change YOUR_CHANGE --json
openspec instructions archive --change YOUR_CHANGE --json
```

Replace `YOUR_CHANGE` with a change in the selected root; append `--store <id>` when using a named store. Check the returned `context`, artifact `rules`, and matching `operationGuidance`. Proposal rules should not appear as design rules, and archive guidance should not appear as apply guidance. Conditional rules, such as visual verification for UI changes, apply only when their condition is relevant.

If your CLI does not emit the expected fields, check its version and the [OpenSpec customization documentation](https://github.com/Fission-AI/OpenSpec/blob/main/docs/customization.md). Successful YAML parsing alone does not establish support. These settings guide the agent; they do not enforce approvals, prove that tests ran, or guarantee compliance.

## Updating or undoing adoption

Pulling agent-kit updates the examples only. Review the diff and merge any changes you want into your own configuration. To undo adoption, restore your backup or revert the sections you merged. Existing plugins do not depend on either template.

These templates are covered by agent-kit's [MIT license](../LICENSE).
