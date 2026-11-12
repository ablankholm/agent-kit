# Integrating with OpenSpec and Haft / Quint

These are the repo's process frameworks. When they're in use, the council works through them instead of creating parallel freeform documents. Command names below are from the projects' docs as of late 2026. Check the installed skills and `--help` output, and follow those if they differ.

## Detection meaning (from `detect_deps.sh`)

- **IN-USE (repo):** the repo shows evidence such as `openspec/`, `.haft/`, `.quint/`, project-local skills, MCP config entries, or mentions in `AGENTS.md`/`CLAUDE.md`. **Use it; it's how this team works.**
- **AVAILABLE (global):** installed for the user but not used in this repo. Ask once whether to use it for this work. If declined, record it with `--decline`.
- **ABSENT:** ignore.

If both OpenSpec and Haft/Quint are in use, they divide the work:

- **OpenSpec owns the artifacts:** proposal, specs, design, tasks.
- **Haft/Quint owns the reasoning records:** problem framing, variant diversity, parity comparison, binding decisions, evidence and verification.

Cross-link them: reference the Haft decision ID in `design.md`, and the OpenSpec change ID in the Haft record.

---

## OpenSpec (OPSX workflow)

Layout: `openspec/config.yaml` (schema, context, per-artifact rules), `openspec/specs/` (current truth), `openspec/changes/<id>/` with `proposal.md`, `specs/` (delta specs), `design.md`, `tasks.md`. The default schema is `spec-driven`: proposal → specs + design → tasks. A repo may use a custom schema under `openspec/schemas/`; check `openspec schemas` and follow whatever artifacts it defines.

Core profile commands: `/opsx:propose`, `/opsx:explore`, `/opsx:apply`, `/opsx:sync`, `/opsx:archive`. The expanded profile adds `/opsx:new`, `/opsx:continue`, `/opsx:ff`, `/opsx:verify`, `/opsx:update`, `/opsx:onboard`. Generated skills live at `.claude/skills/openspec-*` or the equivalent.

### How the council maps onto OpenSpec

| Council step | OpenSpec action | What goes where |
|---|---|---|
| Intake + divergence thinking | `/opsx:explore` (writes no artifacts) | The council's intake questions, repo findings and early direction sketches happen here, as a collaboration between explore and the council seats |
| Brief | `/opsx:propose` (or `/opsx:new` → `/opsx:continue`) | `proposal.md`: **intent** (user problem and jobs), **scope** (in/out screens and flows), **approach** (the chosen UX direction, once picked; before that, "direction to be selected, see design.md") |
| UX behavior | specs artifact | `specs/<capability>/spec.md`: requirements with scenarios for user-visible behavior: states (empty/loading/error/overflow), responsive rules, keyboard/focus, a11y level, content rules. Use Given/When/Then if `config.yaml` asks for it |
| Directions + judging | design artifact | `design.md`: design-system note, the direction set (with count rationale), the comparison table and scores, Nielsen findings per direction, the arbitration decisions, the chosen or merged direction and why |
| Build + review | tasks artifact → `/opsx:apply` | `tasks.md`: build tasks plus explicit review tasks (screenshot at breakpoints, impeccable audit, Nielsen audit, fix loop) |
| Verify | `/opsx:verify` (expanded) or `openspec validate` | Implementation checked against the UX specs |

### Rules

- **Get structure from OpenSpec, not from memory:** `openspec status --change <id> --json` shows which artifacts are ready, and `openspec instructions <artifact> --change <id> --json` gives the template and injected context/rules.
- **Honor `config.yaml`:** its `context` and `rules` (e.g. "include rollback plan", "Given/When/Then") apply to the artifacts the council writes.
- **Validate** after writing or updating artifacts: `openspec validate <id> --strict` (confirm the flag with `openspec validate --help`). Fix all errors before showing the user.
- **Update vs. new change:** refining the same UX intent means `/opsx:update`. A fundamentally different intent or a scope explosion means a new change (follow OpenSpec's own heuristic).
- **Related active change:** if one already covers this UI, extend it rather than creating a duplicate. Ask if unsure.
- **Archiving:** don't archive unless the user asks.
- **Impeccable's files coexist:** `PRODUCT.md` / `DESIGN.md` are long-lived product and design-system context. OpenSpec changes are per-change. Link to them from `design.md`; don't duplicate them.

---

## Haft (current name of Quint Code)

Haft is a local FPF (First Principles Framework) governance layer. Repo evidence: `.haft/` (markdown carriers), `haft` entries in `.mcp.json` or `.codex/config.toml`, `<!-- haft:start -->` sections in `CLAUDE.md`/`AGENTS.md`, and `h-*` skills. Install with `haft init --claude` / `--codex` (add `--local` for repo-local skills).

| Council step | Haft skill / tool | Notes |
|---|---|---|
| Intake / framing | `h-frame` | Shapes the problem and acceptance criteria conversationally. Persists a ProblemCard only when the user wants it saved or later work will rely on it |
| Divergence | `h-explore` | Generates distinct variants with a diversity check. Use it to test whether the council's directions really differ |
| Judging | `h-compare` | Compares under declared parity, the same dimensions for all, and returns a Pareto front rather than a single winner. Present it alongside the weighted rubric |
| Decision | `h-decide` | Binds a DecisionRecord **only on a direct, unambiguous request from the user** naming the option and scope. Your recommendation is not authority. Ask: "Want me to record this as a decision?" |
| Verification | `h-verify` | After build, check the decision's predictions (e.g. "task completion in ≤3 clicks") against evidence |
| Context | `h-status`, `haft_query` | Before designing, check for existing decisions or invariants governing these files |

Small, reversible reasoning stays in conversation. Write Haft records only when later work needs to rely on them.

## Quint Code (legacy, pre-Haft)

Repo evidence: `.quint/` and `/q0-init` … `/q5-decide` commands. The mapping is roughly: `/q1-hypothesize` (frame + variants) → `/q2-verify` (logical check) → `/q3-validate` (evidence) → `/q4-audit` → `/q5-decide` (Design Rationale Record). Use them in the same seats as the Haft equivalents. If the user is open to it, mention that Quint Code has become Haft (`haft init` migrates), but don't push.
