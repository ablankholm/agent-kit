# kubectl-guard

An early-release Claude Code hook that catches common kubectl accidents before the Bash tool runs. It requires an explicit context for recognized mutations, asks for confirmation by default, and leaves ordinary reads alone. It covers `kubectl` and `kubecolor`.

The hook never returns `allow` or executes your proposed command. Claude's normal permissions still apply. This is an additional guard against mistakes, not Kubernetes access control or a complete shell analyzer.

## Install and check

Requires Claude Code with plugin support, Bash, and Node.js 18+ on Claude's PATH. No npm runtime dependencies. When a target needs resolving, the hook uses the installed `kubectl` to read local kubeconfig.

```sh
claude plugin marketplace add ablankholm/agent-kit
claude plugin install kubectl-guard@ablankholm
```

Skip the marketplace command if already added. The default installation scope is your user account. Start a new Claude session, then run:

```text
/kubectl-guard:doctor
```

The guard runs automatically before ordinary Bash tool calls. Doctor checks installation, settings, policy, dependencies and synthetic examples, then separately reports whether this session invoked the hook. **Installed**, **self-checks passed**, and **invocation observed** are different claims. A receipt does not prove that Claude enforced a decision.

Doctor uses a regular Bash call, not skill shell injection. It runs no kubectl commands, contacts no cluster, and changes no configuration. Static CLI checks are also available with `node <plugin-directory>/scripts/doctor.mjs --json`; without `--session-id UUID`, current-session invocation is unchecked. Exit codes are 0 for no failing static/self-checks, 1 for failing checks, and 2 for invalid arguments. Missing session evidence does not by itself change the exit code; automation must inspect `sessionObservation.status` separately.

## Default behavior

| Bash command | Guard response |
|---|---|
| `git status` | No extra prompt or kubectl lookup |
| `kubectl get pods` | No extra prompt or kubectl lookup |
| `kubectl get pods -o json \| jq '.items \| length'` | No extra prompt |
| `kubectl get pods \| grep Running \| head -n 10` | No extra prompt |
| `kubectl delete pod example` | Deny: specify `--context` |
| `kubectl delete pod example --context=production` | Ask |
| `kubectl delete pod example --context=kind-demo` | Ask, including local-looking names |
| `kubectl delete pod example \| jq .` | Deny: the mutation lacks an explicit context |
| `kubectl delete pod example --context=production -n payments` | Ask, showing operation, context, namespace and server origin |
| `kubectl delete pod example --context=production --server=other` | Deny: target overridden or ambiguous |
| `kubectl get pods --kubeconfig=other.yaml` | Ask |
| `kubectl get pods; rm -rf ./data` | Ask for the whole command |
| `kubectl exec pod/example --context=kind-demo -- sh` | Ask |

Target summaries distinguish explicit selectors, kubeconfig defaults and unresolved information. Manifests can select multiple namespaces or cluster-scoped resources, so `-f`/`-k` commands without an explicit namespace report their namespace as unresolved. A namespace selector does not constrain cluster-scoped resources. The summary omits raw arguments, credentials and server URL paths. Inspect the full command before approving.

Recognized reads: `get`, `describe`, `logs`, `top`, `explain`, `api-resources`, `api-versions`, `version`, `events`, and argument-free `cluster-info` with supported leading global flags.

Recognized mutations: `delete`, `apply`, `create`, `replace`, `patch`, `edit`, `scale`, `drain`, `cordon`, `uncordon`, `taint`, `rollout`, `set`, `autoscale`, `annotate`, `label`, `run`, `expose`, and `certificate`. These require an explicit, unambiguous context when parsed as a literal command, including literal stages inside pipelines. Complex wrappers or shell syntax that cannot be parsed ask for review of the whole command. This is deliberately conservative and can prompt for harmless commands too.

`exec`, `attach`, `cp`, `proxy`, `port-forward`, `debug`, `config`, `diff`, `cluster-info dump`, unknown operations, editors and profiling flags remain guarded. Commands with connection, authentication or configuration overrides cannot use trust exceptions. Unknown `create` forms, including `create -f`, remain guarded because kubectl can dispatch external plugins under `create`.

### Read pipelines

A bounded parser accepts literal words, quotes and escapes, with up to eight pipeline stages. Every stage after a recognized read must be a supported stdin filter:

- `jq`: field/index paths such as `.items[].metadata.name`, optionally piped within the expression to another path or `length`, `keys`, `keys_unsorted`, `values`, `to_entries`, `type`, or `empty`. Common output flags `-r`, `-c`, `-e`, `-s`, `-S`, `-M`, `-j` and their long forms are accepted. General jq programs, module imports, environment access and file operands require review.
- `grep`: one literal pattern with common matching flags (`-i`, `-v`, `-E`, `-F`, `-w`, `-x`, `-n`, `-c`, `-q`, or their long forms). No file operands or recursion.
- `head` / `tail`: no arguments, or a nonnegative line count with `-n` / `--lines`.
- `wc`: line, word, character or byte counts, without file operands.

Arbitrary filters, alternate executable paths, `xargs`, `tee`, output redirections, substitutions, assignments, globbing and command lists do not receive this exemption. Filters and installed binaries are trusted programs; the hook does not sandbox their startup configuration or environment.

## Optional exact trust exceptions

There are **no built-in local exceptions**. A name such as `kind-demo` does not establish that a cluster is disposable.

If you want selected disposable clusters to skip the extra mutation prompt, create `kubectl-guard.json` in the configuration directory:

```json
{
  "schemaVersion": 1,
  "trustedTargets": [
    { "context": "kind-demo", "server": "https://127.0.0.1:6443" }
  ]
}
```

Use the actual server from your kubeconfig. Both the explicit context name and resolved, normalized server URL must match. A renamed context, changed endpoint or failed lookup removes the exception. No wildcards, implicit current-context exceptions or automatic migration. URLs with userinfo, query strings or fragments are rejected. Policy is bounded to 32 unique pairs and 64 KiB; unknown fields and invalid policy block mutations that require policy evaluation.

Exceptions apply only to supported single-command mutations with no ambiguity or external-effect flags. `edit`, external editor forms and unknown `create` forms remain guarded. Supported `create` examples include `configmap`, `namespace`, `secret generic`, and `service clusterip`. Mutation pipelines remain guarded even with a matching pair. Matching the URL does not verify cluster identity, DNS, credentials or resource scope; use exceptions only where you accept that risk.

Configuration directory precedence: `KUBECTL_GUARD_CONFIG_DIR`, then `CLAUDE_CONFIG_DIR`, then `~/.claude`. Policy, the disable flag, legacy patterns and observation receipts use this directory. The plugin never creates trust exceptions or edits your configuration.

## Update and migration

```sh
claude plugin marketplace update ablankholm
claude plugin update kubectl-guard@ablankholm
```

Restart Claude and run `/kubectl-guard:doctor` after updating. Version **2.0.0** intentionally changes the defaults:

- Mutations no longer inherit trust from the current context or local-looking names.
- `kubectl-guard-local-contexts` patterns are retained but inert. Doctor warns about active entries. Add exact context/server pairs only if you want exceptions.
- Recognized literal mutations require `--context` and reject conflicting target selectors.
- Reviewed read pipelines avoid extra prompts; other shell composition remains guarded.
- A minimal local invocation receipt supports doctor; see its contents below.

When migrating directly from the [original gist](https://gist.github.com/ablankholm/1ed736c04afd043e34d8e9958c523282), back up Claude settings and remove only the old `hooks.PreToolUse` registration for `kubectl-safety-hook.sh`, including an empty matcher if necessary. Preserve other hooks/settings. Check user, project and local scopes if you registered it more than once. Install this plugin, restart, and check `/hooks` and doctor for duplicate registrations. The original script, pattern file and helper scripts remain yours; the plugin does not remove them. Unlike the gist, harmless commands return no decision, so normal Claude permissions may still prompt.

## Disable and uninstall

```sh
claude plugin disable kubectl-guard@ablankholm
```

To remove the plugin:

```sh
claude plugin uninstall kubectl-guard@ablankholm
```

The original controls remain available:

- `KUBECTL_GUARD=off` in Claude's environment disables the guard.
- A `kubectl-guard.disabled` file in the configuration directory disables it until removed.
- Existing `kubectl-guard-off`, `kubectl-guard-on`, and `kubectl-guard-status` helpers still work with the default `~/.claude` directory. The plugin does not install or modify these helpers.

Disabling restores normal Claude permission handling. It does not approve commands. Uninstallation leaves your configuration, legacy files and diagnostic receipts in place. Receipts can be removed by deleting only `kubectl-guard-state` inside the configuration directory.

## Coverage and limitations

Keep Kubernetes RBAC, appropriately scoped credentials and Claude permissions in place. A user or agent able to edit settings, policy or hook files can disable this guard.

Scripts, aliases such as `k`, shell functions, Python/client libraries, encoded or dynamically assembled executables, MCP tools and direct terminal use can fall outside its visibility. Skill `!` shell injection bypassed `PreToolUse` in the tested Claude version. `--bare`, `--safe-mode`, disabled hooks and host failures can skip the hook entirely. Text mentioning kubectl may conservatively prompt even when it does not execute it.

The hook trusts installed binaries, inherited environment and kubeconfig. Target resolution runs only `kubectl config view --minify --output=json` with an optional explicit context, no shell, a 1.5-second timeout and bounded output. It reads local configuration, makes no cluster request and does not run credential plugins. It does not use `--raw`. Missing kubectl or failed lookup cannot earn a trust exception. Kubeconfig can change between the check and execution; exact matching is not a lock or cluster-identity check.

Once the Bash launcher starts, missing/crashed Node, malformed input and evaluator failures block with exit code 2. A missing launcher or host hook timeout can fail open under Claude's permissions. Doctor detects static problems where possible; it cannot guarantee future execution.

For effective permission modes `default`, `acceptEdits`, `plan`, `bypassPermissions` and `dontAsk`, confirmation uses Claude's `ask` response; missing or ambiguous mutation targets still deny. Noninteractive runs tested below stopped rather than executing unapproved commands. A requested `auto` mode fell back to `default` in the test host, so true auto behavior is unverified. If the hook receives `auto`, a missing mode or an unknown mode, it converts an `ask` decision into `deny`. Plain reads and explicitly trusted mutations still defer to native permissions.

### Local diagnostic data

The hook writes a best-effort receipt on valid Bash invocations. It contains plugin version and fingerprint, working directory, effective permission mode, timestamp and outcome (`pass`, `ask` or `deny`). It stores no command arguments, cluster target, credentials or tool result. The filename hashes the session ID. Nothing is uploaded; there is no telemetry or MCP server.

Receipts live in `kubectl-guard-state`, with directory mode 0700 and file mode 0600. Doctor accepts evidence only for the same session, directory and plugin fingerprint within five minutes. Cleanup on hook calls normally retains at most 128 receipts and removes entries older than 24 hours; cleanup scans are bounded, and inactive installations do not run cleanup. Receipt errors never weaken a guard decision. These user-editable records establish observed invocation only.

## Provenance and testing

Derived from Anders Blankholm's [kubectl-guard gist](https://gist.github.com/ablankholm/1ed736c04afd043e34d8e9958c523282). The original gist remains unchanged. This plugin is published under this repository's MIT license.

From the repository root:

```sh
npm ci
npm run validate
npm run test:claude
```

Canonical validation checks packaging, syntax and synthetic regressions. The live suite is opt-in and requires Claude Code on PATH. It uses isolated temporary configuration, a dummy kubectl and a loopback fake model API. It exercises the actual host without paid model calls, real cluster access or personal configuration changes.

Tested with **Claude Code 2.1.236**:

| Host path | Observed result |
|---|---|
| Noninteractive default, acceptEdits, plan, bypassPermissions, dontAsk | Unapproved guarded command did not reach the stub |
| Interactive SDK stdio permission callback | Denial stopped the command; explicit approval executed it |
| Actual Agent subagent | Inherited guard ran and stopped the unapproved command |
| Exact trust pair / changed server | Match deferred to native permissions; mismatch remained guarded |
| Supported read pipeline / unsafe composition | Read pipeline ran; unsafe composition was guarded |
| Plugin install, enable, disable, uninstall | Registration and behavior followed lifecycle changes |
| Missing/crashed Node after launcher started | Command blocked |
| Missing launcher / skill shell injection | Guard bypass possible; documented boundary |
| Local-marketplace doctor through regular Bash | Self-checks passed and current-session invocation was observed; source/cache path difference correctly reported |
| True auto mode / terminal approval UI rendering | Not verified |

Passing these tests does not make the guard foolproof or establish behavior on other Claude versions. Contributions with reproducible bypasses or false positives are welcome; run reproductions against a stub or disposable environment.
