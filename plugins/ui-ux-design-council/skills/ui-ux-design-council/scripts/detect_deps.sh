#!/usr/bin/env bash
# ui-ux-design-council dependency detector with per-repo cache.
#
# Usage (run from the project root, or pass --project DIR):
#   detect_deps.sh                 # print cached result; full scan only if no cache exists
#   detect_deps.sh --refresh       # force a full rescan and rewrite the cache
#   detect_deps.sh --recheck KEY   # rescan and print only KEY's line (e.g. after a cached skill failed to load)
#   detect_deps.sh --decline KEY   # remember that the user declined installing KEY (no re-offers)
#   detect_deps.sh --undecline KEY
#   detect_deps.sh --cache-path    # print the cache file location
#
# KEY is a seat (craft-lead, usability, style-catalog, native-builder, flow-a11y, mobile)
# or a framework (openspec, haft, quint).
#
# Read-only apart from the cache file. Never installs anything. Compatible with bash 3.2.

set -u
umask 077
PROJECT="$PWD"; MODE="cached"; ARG=""
fail() { echo "$*" >&2; exit 2; }
need_value() {
  [ "$#" -ge 2 ] && [ -n "$2" ] && [[ "$2" != --* ]] || fail "missing value for $1"
}
valid_key() {
  case "$1" in
    craft-lead|usability|style-catalog|native-builder|flow-a11y|mobile|openspec|haft|quint) ;;
    *) fail "unknown KEY: $1" ;;
  esac
}
while [ $# -gt 0 ]; do
  case "$1" in
    --project) need_value "$@"; PROJECT="$2"; shift 2 ;;
    --refresh) MODE="refresh"; shift ;;
    --recheck|--decline|--undecline)
      need_value "$@"; MODE="${1#--}"; ARG="$2"; valid_key "$ARG"; shift 2 ;;
    --cache-path) MODE="cachepath"; shift ;;
    *) fail "unknown arg: $1" ;;
  esac
done

PROJECT="$(cd "$PROJECT" 2>/dev/null && pwd -P)" || fail "project directory does not exist"
H="${HOME:-}"
CODEX_DIR="${CODEX_HOME:-$H/.codex}"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$H/.claude}"
REPO_ROOT="$(git -C "$PROJECT" rev-parse --show-toplevel 2>/dev/null || echo "$PROJECT")"
CACHE_DIR="${XDG_CACHE_HOME:-$H/.cache}/ui-ux-design-council"
CACHE="$CACHE_DIR/$(printf '%s' "$REPO_ROOT" | cksum | cut -d' ' -f1).cache"

[ "$MODE" = "cachepath" ] && { echo "$CACHE"; exit 0; }

write_cache() {
  mkdir -p "$CACHE_DIR" || fail "cannot create cache directory"
  cache_tmp="$(mktemp "$CACHE_DIR/.cache.XXXXXX")" || fail "cannot create cache file"
  if ! printf '%s\n' "$1" > "$cache_tmp" || ! mv "$cache_tmp" "$CACHE"; then
    rm -f "$cache_tmp"
    fail "cannot write cache file"
  fi
}

if [ "$MODE" = "decline" ] || [ "$MODE" = "undecline" ]; then
  previous=""
  [ -f "$CACHE" ] && previous="$(grep -v "^declined $ARG\$" "$CACHE")"
  if [ "$MODE" = "decline" ]; then
    previous="${previous}${previous:+
}declined $ARG"
  fi
  write_cache "$previous"
  echo "ok: $MODE $ARG"; exit 0
fi

# Ignore cache entries from older detector versions after an upgrade.
if [ "$MODE" = "cached" ] && [ -s "$CACHE" ] && grep -qx '# detector-cache-version 2' "$CACHE" && grep -q '^# scanned' "$CACHE"; then
  cat "$CACHE"; exit 0
fi

# ----------------------------------------------------------------------------
# Full scan
# ----------------------------------------------------------------------------
ROOTS=""
add_root() { [ -d "$2" ] && ROOTS="${ROOTS}$1	$2
"; }

dir="$PROJECT"
while :; do
  add_root repo "$dir/.claude/skills"
  add_root repo "$dir/.agents/skills"
  add_root repo "$dir/.codex/skills"
  add_root repo-plugin "$dir/.claude/plugins"
  add_root repo-plugin "$dir/.codex/plugins"
  add_root repo-plugin "$dir/.agents/plugins"
  [ "$dir" = "$REPO_ROOT" ] && break
  parent="$(dirname "$dir")"; [ "$parent" = "$dir" ] && break; dir="$parent"
done
add_root global "$CLAUDE_DIR/skills"
add_root global "$H/.agents/skills"
add_root global "$CODEX_DIR/skills"
add_root admin  "/etc/codex/skills"
add_root plugin "$CLAUDE_DIR/plugins"
add_root plugin "$CODEX_DIR/plugins"
add_root plugin "$H/.agents/plugins"

# INDEX lines: scope<TAB>frontmatter-name<TAB>dirname<TAB>path
INDEX=""
while IFS='	' read -r scope root; do
  [ -z "${root:-}" ] && continue
  depth=3; case "$scope" in plugin|repo-plugin) depth=10 ;; esac
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    d="$(basename "$(dirname "$f")")"
    n="$(sed -n '1,15p' "$f" 2>/dev/null | grep -m1 -E '^name:' | sed -E 's/^name:[[:space:]]*//; s/["'"'"']//g; s/[[:space:]]*$//')"
    INDEX="${INDEX}${scope}	${n}	${d}	${f}
"
  done <<EOF
$(find -L "$root" -maxdepth "$depth" -name SKILL.md -type f 2>/dev/null)
EOF
done <<EOF
$ROOTS
EOF

# skills matching an exact alias list
match_exact() { for a in $1; do printf '%s' "$INDEX" | awk -F'\t' -v a="$a" '$2==a || $3==a'; done | sort -u; }
# skills whose name/dir matches a regex, filtered by scope regex
match_re() { printf '%s' "$INDEX" | awk -F'\t' -v r="$1" -v s="$2" '($2 ~ r || $3 ~ r) && $1 ~ s {print ($2!=""?$2:$3)}' | sort -u | tr '\n' ',' | sed 's/,$//'; }

OUT="# detector-cache-version 2
# scanned $(date -u +%Y-%m-%dT%H:%MZ) repo=$REPO_ROOT
# format: seat KEY SKILL STATUS SCOPE PATH | fw KEY STATUS SCOPE EVIDENCE | tool NAME yes/no | declined KEY"

seat() { # key required aliases
  m="$(match_exact "$3")"
  if [ -n "$m" ]; then
    # prefer repo > repo-plugin > plugin > global > admin
    best="$(printf '%s\n' "$m" | awk -F'\t' '{p=($1=="repo")?1:($1=="repo-plugin")?2:($1=="plugin")?3:($1=="global")?4:5; print p"\t"$0}' | sort -n | head -1 | cut -f2-)"
    others=$(( $(printf '%s\n' "$m" | wc -l) - 1 ))
    sc="$(printf '%s' "$best" | cut -f1)"; nm="$(printf '%s' "$best" | cut -f2)"; dn="$(printf '%s' "$best" | cut -f3)"; pa="$(printf '%s' "$best" | cut -f4)"
    extra=""; [ "$others" -gt 0 ] && extra=" (+$others more copies)"
    OUT="$OUT
seat $1 ${nm:-$dn} INSTALLED $sc $pa$extra"
  else
    st=MISSING; [ "$2" = optional ] && st=MISSING-OPTIONAL
    OUT="$OUT
seat $1 $(echo "$3" | tr ' ' '/') $st - -"
  fi
}
seat craft-lead     core     "impeccable"
seat usability      core     "nielsen-heuristics-audit"
seat style-catalog  core     "ui-ux-pro-max ui-ux-pro-max-skill"
seat native-builder core     "frontend-design frontend-skill"
seat flow-a11y      optional "review-ux-ui"
seat mobile         optional "ss-audit"

instr_mentions() { # regex -> list of instruction files in repo mentioning it
  for f in AGENTS.md CLAUDE.md .claude/CLAUDE.md; do
    [ -f "$REPO_ROOT/$f" ] && grep -qiE "$1" "$REPO_ROOT/$f" 2>/dev/null && printf '%s,' "$f"
  done
}

fw() { # key repo_evidence global_evidence
  if [ -n "$2" ]; then OUT="$OUT
fw $1 IN-USE repo ${2%,}${3:+ | global:${3%,}}"
  elif [ -n "$3" ]; then OUT="$OUT
fw $1 AVAILABLE global ${3%,}"
  else OUT="$OUT
fw $1 ABSENT - -"; fi
}

# --- OpenSpec ---
r=""; g=""
if [ -d "$REPO_ROOT/openspec" ]; then
  r="${r}openspec/,"
  [ -f "$REPO_ROOT/openspec/config.yaml" ] && r="${r}config.yaml,"
  [ -f "$REPO_ROOT/openspec/project.md" ] && r="${r}project.md(legacy),"
  if [ -d "$REPO_ROOT/openspec/changes" ]; then
    n=$(find "$REPO_ROOT/openspec/changes" -mindepth 1 -maxdepth 1 -type d ! -name archive 2>/dev/null | wc -l | tr -d ' ')
    r="${r}active-changes=$n,"
  fi
  [ -d "$REPO_ROOT/openspec/specs" ] && r="${r}specs/,"
fi
s="$(match_re '^openspec' '^(repo|repo-plugin)$')"; [ -n "$s" ] && r="${r}skills:$s,"
[ -d "$REPO_ROOT/.claude/commands/opsx" ] || [ -d "$REPO_ROOT/.claude/commands/openspec" ] && r="${r}commands,"
m="$(instr_mentions 'openspec')"; [ -n "$m" ] && r="${r}mentioned-in:${m%,},"
command -v openspec >/dev/null 2>&1 && g="${g}cli,"
s="$(match_re '^openspec' '^(global|plugin|admin)$')"; [ -n "$s" ] && g="${g}skills:$s,"
fw openspec "$r" "$g"

# --- Haft (current name of Quint Code) ---
r=""; g=""
[ -d "$REPO_ROOT/.haft" ] && r="${r}.haft/,"
s="$(match_re '^h-(reason|frame|explore|compare|decide|verify|status|spec|note|diagnose|onboard)$' '^(repo|repo-plugin)$')"; [ -n "$s" ] && r="${r}skills:$s,"
for f in .mcp.json .codex/config.toml; do [ -f "$REPO_ROOT/$f" ] && grep -q haft "$REPO_ROOT/$f" 2>/dev/null && r="${r}mcp:$f,"; done
m="$(instr_mentions 'haft:start|haft')"; [ -n "$m" ] && r="${r}mentioned-in:${m%,},"
command -v haft >/dev/null 2>&1 && g="${g}cli,"
s="$(match_re '^h-(reason|frame|explore|compare|decide|verify|status|spec|note|diagnose|onboard)$' '^(global|plugin|admin)$')"; [ -n "$s" ] && g="${g}skills:$s,"
fw haft "$r" "$g"

# --- Quint Code (legacy, pre-Haft: .quint/ + q-commands) ---
r=""; g=""
[ -d "$REPO_ROOT/.quint" ] && r="${r}.quint/,"
ls "$REPO_ROOT"/.claude/commands/q[0-5]-* >/dev/null 2>&1 && r="${r}commands:q0-q5,"
s="$(match_re '^q[0-5]-|quint' '^(repo|repo-plugin)$')"; [ -n "$s" ] && r="${r}skills:$s,"
for f in .mcp.json .codex/config.toml; do [ -f "$REPO_ROOT/$f" ] && grep -q quint "$REPO_ROOT/$f" 2>/dev/null && r="${r}mcp:$f,"; done
m="$(instr_mentions 'quint')"; [ -n "$m" ] && r="${r}mentioned-in:${m%,},"
command -v quint-code >/dev/null 2>&1 && g="${g}cli,"
ls "$CLAUDE_DIR"/commands/q[0-5]-* >/dev/null 2>&1 && g="${g}commands:q0-q5,"
s="$(match_re '^q[0-5]-|quint' '^(global|plugin|admin)$')"; [ -n "$s" ] && g="${g}skills:$s,"
fw quint "$r" "$g"

# --- Tools ---
yn() { if eval "$1" >/dev/null 2>&1; then echo yes; else echo no; fi; }
OUT="$OUT
tool npx $(yn 'command -v npx')
tool git $(yn 'command -v git')
tool playwright $(yn 'command -v playwright || [ -d "$REPO_ROOT/node_modules/playwright" ] || [ -d "$REPO_ROOT/node_modules/@playwright/test" ]')"

# Keep framework adoption declines until this repository actually uses the framework.
# Seat install declines clear once the skill is present.
if [ -f "$CACHE" ]; then
  present="$(printf '%s\n' "$OUT" | awk '($1=="seat" && $4=="INSTALLED") || ($1=="fw" && $3=="IN-USE") {print $2}')"
  d="$(grep '^declined ' "$CACHE" 2>/dev/null | while read -r _ k; do printf '%s\n' "$present" | grep -qx "$k" || echo "declined $k"; done)"
  [ -n "$d" ] && OUT="$OUT
$d"
fi

write_cache "$OUT"

if [ "$MODE" = "recheck" ]; then
  printf '%s\n' "$OUT" | awk -v k="$ARG" '$2==k'
else
  printf '%s\n' "$OUT"
fi
