#!/usr/bin/env bash
# Keep the disable controls usable even when the evaluator cannot start.
guard_config_dir="${KUBECTL_GUARD_CONFIG_DIR:-${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}}"
if [ "${KUBECTL_GUARD:-}" = off ] || [ -f "$guard_config_dir/kubectl-guard.disabled" ]; then
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'kubectl-guard: Node.js 18+ is required. Install Node or disable the plugin. Command blocked.' >&2
  exit 2
fi

# Claude treats ordinary nonzero hook exits as nonblocking errors. Convert evaluator
# failures to its blocking exit code, including missing files and unsupported Node.
if ! node "${BASH_SOURCE[0]%/*}/guard.mjs"; then
  printf '%s\n' 'kubectl-guard: evaluation failed. Repair or disable the plugin before retrying. Command blocked.' >&2
  exit 2
fi
