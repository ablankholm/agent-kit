# kubectl-guard

A Claude Code approval guard for `kubectl` and `kubecolor`. It asks before commands that could change a non-local cluster, and before commands whose target or shell behavior it cannot confidently classify.

Simple reads and recognized mutations against trusted local contexts add no guard prompt. Claude's normal permissions still apply. The hook never returns `allow` or executes your proposed command.

## Install

Requires Claude Code with plugin support, Bash, and Node.js 18 or newer on the PATH used to launch Claude. There are no npm runtime dependencies. `kubectl` is needed only to resolve the current context when a mutation omits `--context`.

```sh
claude plugin marketplace add ablankholm/agent-kit
claude plugin install kubectl-guard@ablankholm
```

Skip the first command if you already added the marketplace. Start a new Claude session after installation. The default install scope is your user account, so the guard applies across projects. It runs automatically before Bash tool calls; there is no skill to invoke. This plugin supports Claude Code only.

Update with:

```sh
claude plugin marketplace update ablankholm
claude plugin update kubectl-guard@ablankholm
```

Restart Claude after updating. Installation and update commands were checked with Claude Code 2.1.236.

## What prompts

| Bash command | Guard response |
|---|---|
| `git status` | No extra prompt or kubectl lookup |
| `kubectl get pods` | No extra prompt or kubectl lookup |
| `kubectl --context=production get pods` | No extra prompt |
| `kubectl delete pod example --context=production` | Ask |
| `kubectl delete pod example --context=kind-demo` | No extra prompt |
| `kubectl delete pod example` | Resolve current context; ask unless trusted local |
| `kubectl get pods --kubeconfig=other.yaml` | Ask because the target is overridden |
| `kubectl get pods \| jq .` | Ask because this is a compound shell command |
| `kubectl get pods; rm -rf ./data` | Ask for the whole command |
| `kubectl --context=kind-demo exec pod/example -- sh` | Ask even on local contexts |

The parser handles literal quotes, escaped executable names, executable paths, and context flags before or after the verb. Repeated context flags, connection/authentication overrides, raw endpoints, wrappers such as `sudo` or `env`, substitutions, redirections, pipelines, and command chains ask. Unknown commands ask even on local contexts.

Recognized reads: `get`, `describe`, `logs`, `top`, `explain`, `api-resources`, `api-versions`, `version`, `events`, and argument-free `cluster-info` (leading recognized global flags are supported).

Known cluster mutations eligible for the local exemption: `delete`, `apply`, supported `create` forms, `replace`, `patch`, `scale`, `drain`, `cordon`, `uncordon`, `taint`, `rollout`, `set`, `autoscale`, `annotate`, `label`, `run`, `expose`, and `certificate`.

`create` requires an immediately following recognized built-in subcommand, such as `configmap`, `namespace`, `secret generic`, or `service clusterip`. Unknown forms, including `create -f`, ask because kubectl can dispatch external plugins under `create`.

`exec`, `attach`, `cp`, `proxy`, `port-forward`, `debug`, all `config` operations, `edit`, `apply edit-last-applied`, `diff`, and `cluster-info dump` always ask. Commands with edit or profiling flags also ask. These operations extend beyond a simple cluster read or mutation, or are outside the supported list. Editors and external diff programs can execute local code; profiling can overwrite a local output file.

## Local contexts

The built-in local patterns are:

```text
docker-desktop
minikube
kind-*
k3d-*
colima*
orbstack*
rancher-desktop
k3s-default
microk8s
```

Local trust is based on the **context name**, not an inspection of the cluster's server. Keep these names associated with disposable clusters. A context named `kind-demo` can still point at a real cluster if someone configured it that way.

Add your own disposable contexts in `~/.claude/kubectl-guard-local-contexts`:

```text
# Only clusters you are happy to mutate without an extra guard prompt.
my-lab-*
sandbox-?
```

One pattern per line. `*` matches zero or more characters and `?` matches one character; other characters are literal. Surrounding whitespace and `#` comments are ignored. Bracket patterns and backslashes are unsupported and cause mutations to ask, including mutations against built-in local names. Matching is bounded: more than 128 custom patterns, a pattern longer than 256 characters, or a context longer than 512 characters causes a prompt. Invalid UTF-8, NUL bytes, unreadable files, and files over 64 KiB block mutations that need the configuration.

The configuration directory is selected in this order: `KUBECTL_GUARD_CONFIG_DIR`, `CLAUDE_CONFIG_DIR`, then `~/.claude`. The local-contexts file and disable flag both use that directory. Configuration is read when needed and is never overwritten by the plugin.

## Disable and rollback

Disable the plugin through Claude:

```sh
claude plugin disable kubectl-guard@ablankholm
```

The original gist's controls also work:

- Launch Claude from a shell with `KUBECTL_GUARD=off` to disable the guard for that session.
- Create `kubectl-guard.disabled` in the configuration directory to disable the guard for sessions using that directory; remove the flag to re-enable it. Changes take effect on the next hook call.
- Existing `kubectl-guard-off`, `kubectl-guard-on`, and `kubectl-guard-status` helpers remain compatible with the default `~/.claude` directory. The plugin does not install those helpers or change them.

Disabling the guard restores normal Claude permission handling. It never force-approves a command. Uninstall with `claude plugin uninstall kubectl-guard@ablankholm`; your local-contexts file, disable flag, and legacy helpers remain yours.

## Migrating from the gist

Remove the old registration to prevent both guards running:

1. Back up your Claude `settings.json`.
2. In `hooks.PreToolUse`, remove only the command hook pointing to `~/.claude/hooks/kubectl-safety-hook.sh` (usually stored as an expanded absolute path). Preserve every unrelated hook and setting. If the containing matcher entry now has no hooks, remove that empty entry.
3. Install this plugin and start a new Claude session. Check `/hooks` for the plugin's `PreToolUse` Bash registration and confirm the old script is no longer registered.

If you installed the gist somewhere else, remove its matching registration from that scope too. Keep your local context file and toggle helpers. Installation of this plugin does not edit those files, remove your original script, or migrate your settings automatically.

Behavior changes from the gist:

- Harmless commands return **no decision**, instead of `allow`. Existing Claude permissions may therefore still prompt.
- Complex shell commands always ask, including those targeting only local contexts.
- The local exemption applies only to the listed cluster mutations. Unknown operations and execution/tunnelling/file-transfer commands always ask.
- Context flags anywhere in a command are checked. Repeated selectors and alternate kubeconfig/server/authentication flags always ask.
- The runtime uses Node instead of `jq`; the installer and its Python settings editor are unnecessary. Custom glob syntax is limited to `*` and `?`.

## Boundaries and access

This is an approval aid for Claude's Bash tool, not a complete shell analyzer or Kubernetes access-control system. Scripts, aliases such as `k`, functions, encoded commands, dynamically assembled executable names, other tools, and direct terminal use can fall outside its visibility. Text mentioning kubectl inside another command may conservatively prompt. Keep appropriate Kubernetes RBAC and Claude permissions in place.

The guard trusts your installed binaries, inherited environment, and kubeconfig. When needed it runs only `kubectl config current-context`, without a shell, with a 1.5-second timeout. That reads local configuration; it makes no cluster request and does not run credential plugins. Missing kubectl or an unresolved context asks. The proposed command is never executed by the hook.

The hook reads its JSON input, the optional local-contexts file, and the disable flag. It writes no files, stores no commands, uploads nothing, and has no telemetry or MCP server. Confirmation reasons do not repeat command arguments, which may contain credentials.

Once the Bash launcher starts, missing Node, malformed input, unreadable required configuration, or evaluator failure blocks the tool call with exit code 2. Repair the reported input/configuration/runtime problem or disable the plugin before retrying. A missing Bash runtime, host hook timeout, disabled hook, or host failure can prevent the guard from running; this plugin cannot enforce policy outside Claude's hook execution.

## Provenance and verification

Derived from Anders Blankholm's [kubectl-guard gist](https://gist.github.com/ablankholm/1ed736c04afd043e34d8e9958c523282), whose source files are `README.md` and `install-kubectl-guard.sh`. The intended confirmation behavior and user controls were retained, while command parsing and permission responses were rewritten. The original gist remains unchanged. This plugin is published under this repository's MIT license.

From the repository root:

```sh
node --test tests/kubectl-guard.test.mjs
npm ci
npm run validate
```

Tests feed synthetic tool payloads through the registered hook command, including a plugin path containing spaces. A stub kubectl covers local/non-local contexts, lookup failure, and timeouts. Tests also cover flags, shell composition, quoted executables, controls, malformed input/configuration, and missing runtimes. No live cluster or credentials are needed.
