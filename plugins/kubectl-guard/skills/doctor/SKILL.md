---
name: doctor
description: Inspect kubectl-guard installation, configuration, synthetic checks, and current-session hook observations without changing anything.
disable-model-invocation: true
---

Run the following command once with the regular Bash tool. Do not use shell injection or substitute a model-based assessment. A regular Bash call lets the installed PreToolUse hook record its invocation before the checker reads it.

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" --session-id "${CLAUDE_SESSION_ID}" --json
```

Report the returned checks and current-session observation accurately, including failures and uncertainty. Installation and synthetic checks do not prove that a running session loaded the hook. A matching receipt proves invocation was observed, not that the host enforced its decision.

Do not change settings, install packages, remove registrations, or run kubectl commands. If the Bash tool cannot run, state that the check could not be completed. Do not infer a passing result. Use no user-provided arguments in the command.
