#!/usr/bin/env bash
# Compatibility wrapper. Node performs package validation without Python.
set -euo pipefail
exec node "$(dirname "$0")/validate.mjs" "$@"
