#!/usr/bin/env bash
# ui-ux-design-council scratch workspace manager.
#
# Keeps every throwaway artifact the council produces (variant code, fixtures,
# screenshots, boards, prototype builds) out of git from the first file written,
# and tears it all down with one command at the end of a session.
#
# Usage (run from the project root, or pass --project DIR):
#   workspace.sh init <feature>            # create the self-ignoring workspace
#   workspace.sh path [feature]            # print the workspace path
#   workspace.sh scratch PATH [PATH...]    # register a throwaway dir in the source tree
#   workspace.sh scratch --worktree PATH   # register a variant git worktree
#   workspace.sh status                    # what exists, how big, what leaked into git
#   workspace.sh prune [--keep N] [--min MB] [--yes]   # drop shots older than the last N iterations
#   workspace.sh clean [--keep-shots|--all] [--yes] [--force]
#   workspace.sh policy [--expire DAYS|never] [--prune off|offer]   # record the user's standing choices
#   workspace.sh gc [--older-than DAYS] [--yes]        # sweep workspaces for dead repos or expired scratch
#
# Where artifacts land follows where the skill is installed:
#   skill inside the repo   -> <repo>/.ui-ux-design-council/   (shared tooling, shared artifacts)
#   skill installed globally -> $XDG_STATE_HOME/ui-ux-design-council/<repo>-<hash>/  (artifacts outside the repo)
# Override per run with --local or --global, or permanently with UIUX_COUNCIL_WORKSPACE.
# Variant source code always stays in the repo's source tree: it has to compile
# against the app. `scratch` keeps it ignored and registered for teardown.
#
# clean prints a plan and deletes nothing without --yes.
# Tracked scratch directories are skipped unless --force; registered worktrees
# are removed in full by approved clean, including their tracked files.
# Set UIUX_COUNCIL_WORKSPACE to put the workspace outside the repo entirely.
#
# bash 3.2 compatible. Never edits the repo's own .gitignore.

set -u

SELF="$(basename "$0")"
fail() { echo "$SELF: $*" >&2; exit 2; }
need_value() {
  [ "$#" -ge 2 ] && [ -n "${2:-}" ] || fail "missing value for $1"
  case "$2" in --*) fail "missing value for $1" ;; esac
}
valid_name() {
  case "$1" in
    [A-Za-z0-9]*) ;;
    *) fail "invalid name: $1 (start with a letter or digit)" ;;
  esac
  case "$1" in
    *[!A-Za-z0-9._-]*) fail "invalid name: $1 (letters, digits, dot, underscore, hyphen only)" ;;
  esac
  case "$1" in
    *..*) fail "invalid name: $1" ;;
  esac
}

CMD="${1:-}"
[ -n "$CMD" ] || fail "usage: $SELF <init|path|scratch|status|prune|clean|policy|gc> [args]"
shift

SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)" || fail "cannot locate the script directory"
PROJECT="$PWD"; FEATURE=""; YES=0; ALL=0; KEEP_SHOTS=0; FORCE=0; KIND="scratch"; KEEP=2; MIN=0; SCOPE=""; OLDER=""; EXPIRE=""; PRUNE_SET=""
TARGETS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --project) need_value "$@"; PROJECT="$2"; shift 2 ;;
    --feature) need_value "$@"; FEATURE="$2"; shift 2 ;;
    --worktree) KIND="worktree"; shift ;;
    --yes|-y) YES=1; shift ;;
    --all) ALL=1; shift ;;
    --keep-shots) KEEP_SHOTS=1; shift ;;
    --keep) need_value "$@"; KEEP="$2"; shift 2 ;;
    --min) need_value "$@"; MIN="$2"; shift 2 ;;
    --local) SCOPE="local"; shift ;;
    --global) SCOPE="global"; shift ;;
    --older-than) need_value "$@"; OLDER="$2"; shift 2 ;;
    --expire) need_value "$@"; EXPIRE="$2"; shift 2 ;;
    --prune) need_value "$@"; PRUNE_SET="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -*) fail "unknown arg: $1" ;;
    *) TARGETS="${TARGETS}$1
"; shift ;;
  esac
done

PROJECT="$(cd "$PROJECT" 2>/dev/null && pwd -P)" || fail "project directory does not exist"
REPO_ROOT="$(git -C "$PROJECT" rev-parse --show-toplevel 2>/dev/null || echo "$PROJECT")"
IN_GIT=0; git -C "$PROJECT" rev-parse --git-dir >/dev/null 2>&1 && IN_GIT=1
case "$REPO_ROOT" in
  /|"$HOME") fail "refusing to use $REPO_ROOT as the project root; run from inside the project" ;;
esac

SKILL_DIR="$(dirname "$SCRIPT_DIR")"
GLOBAL_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/ui-ux-design-council"
REPO_KEY="$(basename "$REPO_ROOT")-$(printf '%s' "$REPO_ROOT" | cksum | cut -d' ' -f1)"

# The skill's own install scope decides where artifacts live, unless told otherwise.
if [ -z "$SCOPE" ]; then
  case "$SKILL_DIR/" in
    "$REPO_ROOT"/*) SCOPE="local" ;;
    *) SCOPE="global" ;;
  esac
fi
if [ -n "${UIUX_COUNCIL_WORKSPACE:-}" ]; then
  GLOBAL_ROOT="$UIUX_COUNCIL_WORKSPACE"
  SCOPE="global"
fi
if [ "$SCOPE" = "local" ]; then
  BASE="$REPO_ROOT/.ui-ux-design-council"
  BASE_IN_REPO=1
else
  BASE="$GLOBAL_ROOT/$REPO_KEY"
  BASE_IN_REPO=0
fi
MANIFEST="$BASE/.scratch-manifest"

size_of() {
  if [ -e "$1" ]; then du -sh "$1" 2>/dev/null | awk '{print $1}'; else echo "-"; fi
}
rel_to_repo() {
  case "$1" in "$REPO_ROOT"/*) printf '%s' "${1#$REPO_ROOT/}" ;; *) printf '%s' "$1" ;; esac
}
abs_path() { # physical path; the leaf (and its parents) need not exist yet
  case "$1" in
    /*) p="$1" ;;
    *) p="$PWD/$1" ;;
  esac
  p="$(printf '%s' "$p" | awk -F/ '{n=0; for(i=1;i<=NF;i++){c=$i; if(c==""||c==".")continue; if(c==".."){if(n>0)n--; continue} st[++n]=c} s=""; for(i=1;i<=n;i++) s=s "/" st[i]; if(s=="")s="/"; print s}')"
  [ -n "$p" ] && [ "$p" != "/" ] || return 1
  rest=""; d="$p"
  while [ ! -d "$d" ]; do
    rest="$(basename "$d")${rest:+/$rest}"
    d="$(dirname "$d")"
    [ "$d" = "/" ] && break
  done
  d="$(cd "$d" 2>/dev/null && pwd -P)" || return 1
  printf '%s' "${d%/}${rest:+/$rest}"
}
tracked_in() { # tracked files under a path, "" when none or not a repo
  [ "$IN_GIT" -eq 1 ] || return 0
  git -C "$REPO_ROOT" ls-files -- "$1" 2>/dev/null | head -5
}
write_self_ignore() {
  [ -d "$1" ] || return 0
  [ -f "$1/.gitignore" ] && grep -qx '\*' "$1/.gitignore" 2>/dev/null && return 0
  cat > "$1/.gitignore" <<'IGNORE_EOF'
# Created by ui-ux-design-council. Everything in here is scratch: variant code,
# fixtures, screenshots, boards, prototype builds. Nothing is tracked, so the
# repo's own .gitignore stays untouched and git status stays quiet.
# To keep one file deliberately:  git add -f <path>
*
IGNORE_EOF
}
POLICY_DEFAULT_EXPIRE=14   # inactive days before eligibility for approved gc
policy_get() { # key, default
  v=""
  [ -f "$BASE/.policy" ] && v="$(grep -m1 "^$1=" "$BASE/.policy" 2>/dev/null | cut -d= -f2-)"
  [ -n "$v" ] && printf '%s' "$v" || printf '%s' "$2"
}
policy_set() { # key value (in $2's workspace, defaults to $BASE)
  base="${3:-$BASE}"
  mkdir -p "$base" || fail "cannot write policy"
  tmp="$base/.policy.tmp.$$"
  { [ -f "$base/.policy" ] && grep -v "^$1=" "$base/.policy"; printf '%s=%s\n' "$1" "$2"; } > "$tmp" 2>/dev/null
  mv "$tmp" "$base/.policy"
}
ensure_manifest() {
  mkdir -p "$BASE" || fail "cannot create workspace at $BASE"
  [ -f "$MANIFEST" ] || : > "$MANIFEST"
}
register() { # kind path
  ensure_manifest
  line="$(printf '%s\t%s' "$1" "$2")"
  grep -qxF "$line" "$MANIFEST" 2>/dev/null || printf '%s\n' "$line" >> "$MANIFEST"
}

case "$CMD" in

path)
  f="$(printf '%s' "$TARGETS" | head -1)"
  [ -n "$f" ] && { valid_name "$f"; echo "$BASE/$f"; } || echo "$BASE"
  ;;

init)
  f="$(printf '%s' "$TARGETS" | head -1)"; [ -n "$f" ] || f="$FEATURE"
  [ -n "$f" ] || fail "usage: $SELF init <feature>"
  valid_name "$f"
  mkdir -p "$BASE/$f/shots" || fail "cannot create $BASE/$f"
  if [ "$BASE_IN_REPO" -eq 1 ]; then
    write_self_ignore "$BASE"
  else
    printf '%s\n' "$REPO_ROOT" > "$BASE/.repo"
  fi
  ensure_manifest
  [ -f "$BASE/.policy" ] || { policy_set expire_days "$POLICY_DEFAULT_EXPIRE"; policy_set prune offer; }
  register workspace "$BASE/$f"
  echo "workspace  $BASE/$f"
  if [ "$BASE_IN_REPO" -eq 1 ] && [ "$IN_GIT" -eq 1 ]; then
    if git -C "$REPO_ROOT" check-ignore -q -- "$BASE/$f/probe.tmp" 2>/dev/null; then
      echo "git        ignored from the first file (self-ignoring .gitignore in $(rel_to_repo "$BASE"))"
    else
      echo "git        WARNING: $(rel_to_repo "$BASE") is not ignored; check for a negating rule in the repo .gitignore"
    fi
  else
    echo "git        nothing lands in the repo except variant code you register with 'scratch'"
    echo "scope      skill installed outside this repo, so artifacts live in $GLOBAL_ROOT"
  fi
  exp="$(policy_get expire_days "$POLICY_DEFAULT_EXPIRE")"
  echo "teardown   $SELF clean --yes   (or --all to drop log.json too)"
  if [ "$exp" = "never" ]; then
    echo "expiry     never; this workspace is kept until someone removes it"
  else
    echo "expiry     inactive for ${exp}d makes artifacts eligible for cleanup; 'gc' previews, '--yes' deletes"
  fi
  ;;

scratch)
  [ -n "$TARGETS" ] || fail "usage: $SELF scratch PATH [PATH...]"
  ensure_manifest
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    p="$(abs_path "$t")" || fail "cannot resolve path: $t"
    [ -n "$p" ] || fail "cannot resolve path: $t"
    [ "$p" = "/" ] && fail "refusing to register /"
    [ "$p" = "$REPO_ROOT" ] && fail "refusing to register the repo root"
    [ "$p" = "$HOME" ] && fail "refusing to register \$HOME"
    if [ "$KIND" = "worktree" ]; then
      if [ "$IN_GIT" -eq 1 ] && ! git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null | grep -qxF "worktree $p"; then
        fail "$p is not a git worktree of this repo (create it with: git worktree add $t <branch>)"
      fi
      register worktree "$p"
      echo "worktree   $p (removed by clean via git worktree remove)"
      continue
    fi
    case "$p" in
      "$REPO_ROOT"/*|"$BASE"/*) ;;
      *) fail "scratch paths must live inside the repo or the workspace: $p" ;;
    esac
    tr="$(tracked_in "$p")"
    if [ -n "$tr" ]; then
      echo "$SELF: refusing: git already tracks files under $(rel_to_repo "$p"):" >&2
      printf '  %s\n' $tr >&2
      exit 2
    fi
    mkdir -p "$p" || fail "cannot create $p"
    write_self_ignore "$p"
    register scratch "$p"
    echo "scratch    $(rel_to_repo "$p") (ignored; deleted by clean)"
  done <<TARGETS_EOF
$TARGETS
TARGETS_EOF
  ;;

status)
  [ -d "$BASE" ] || { echo "no workspace at $BASE"; exit 0; }
  echo "workspace  $BASE  ($(size_of "$BASE"))"
  echo "  policy   expire $(policy_get expire_days "$POLICY_DEFAULT_EXPIRE") day(s) untouched, mid-session prune $(policy_get prune offer)"
  for d in "$BASE"/*/; do
    [ -d "$d" ] || continue
    n="$(basename "$d")"
    shots="$(find "$d/shots" -name '*.png' 2>/dev/null | wc -l | tr -d ' ')"
    echo "  feature  $n  ($(size_of "$d"), $shots shots)"
  done
  heavy="$(find "$BASE" -maxdepth 4 -type d \( -name node_modules -o -name dist -o -name .vite -o -name .next \) -prune 2>/dev/null | head -10)"
  if [ -n "$heavy" ]; then
    echo "  build output inside the workspace (clean removes it):"
    printf '%s\n' "$heavy" | while IFS= read -r h; do [ -n "$h" ] && echo "    $(size_of "$h")  $(rel_to_repo "$h")"; done
  fi
  leaked=0
  if [ -f "$MANIFEST" ]; then
    while IFS="$(printf '\t')" read -r kind p; do
      [ -n "${p:-}" ] || continue
      [ "$kind" = "workspace" ] && continue
      state="missing"; [ -e "$p" ] && state="$(size_of "$p")"
      ign="ignored"
      [ "$kind" = "worktree" ] && ign="separate checkout"
      if [ "$kind" = "scratch" ] && [ "$IN_GIT" -eq 1 ] && [ -e "$p" ]; then
        git -C "$REPO_ROOT" check-ignore -q -- "$p/probe.tmp" 2>/dev/null || { ign="NOT IGNORED"; leaked=1; }
      fi
      echo "  $kind  $(rel_to_repo "$p")  ($state, $ign)"
      if [ "$kind" = "scratch" ] && [ "$IN_GIT" -eq 1 ] && [ -e "$p" ]; then
        refs="$(git -C "$REPO_ROOT" grep -l -F -- "$(basename "$p")" -- . ":!$(rel_to_repo "$p")" 2>/dev/null | head -5)"
        if [ -n "$refs" ]; then
          echo "    tracked files reference this scratch dir; remove the hook before committing:"
          printf '      %s\n' $refs
        fi
      fi
    done < "$MANIFEST"
  fi
  if [ "$IN_GIT" -eq 1 ]; then
    dirty="$(git -C "$REPO_ROOT" status --porcelain | wc -l | tr -d ' ')"
    echo "  git status: $dirty changed path(s) in the repo"
  fi
  [ "$leaked" -eq 1 ] && echo "  WARNING: a scratch root is visible to git; re-run init or add a .gitignore containing '*' to it"
  exit 0
  ;;

policy)
  ensure_manifest
  if [ -n "$EXPIRE" ]; then
    case "$EXPIRE" in never|[0-9]*) ;; *) fail "--expire takes a number of days or 'never'" ;; esac
    policy_set expire_days "$EXPIRE"
  fi
  if [ -n "$PRUNE_SET" ]; then
    case "$PRUNE_SET" in off|offer) ;; *) fail "--prune takes 'off' or 'offer'" ;; esac
    policy_set prune "$PRUNE_SET"
  fi
  echo "workspace    $BASE"
  echo "expire_days  $(policy_get expire_days "$POLICY_DEFAULT_EXPIRE")   # inactive days before cleanup eligibility; gc previews, --yes deletes"
  echo "prune        $(policy_get prune offer)   # 'off' means the council stops offering mid-session reclaims"
  exit 0
  ;;

gc)
  # Previews abandoned workspace cleanup; --yes applies the plan.
  # Leaves registered source-tree scratch alone. A never policy needs --force.
  case "${OLDER:-0}" in ""|*[!0-9]*) fail "--older-than takes a whole number of days" ;; esac
  now="$(date +%s)"
  mtime_of() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0; }
  policy_of() { # dir key default
    v=""
    [ -f "$1/.policy" ] && v="$(grep -m1 "^$2=" "$1/.policy" 2>/dev/null | cut -d= -f2-)"
    [ -n "$v" ] && printf '%s' "$v" || printf '%s' "$3"
  }
  PLAN=""; TAB="$(printf '\t')"
  consider() {
    d="$1"
    [ -d "$d" ] || return 0
    repo="$2"
    [ -z "$repo" ] && [ -f "$d/.repo" ] && repo="$(head -1 "$d/.repo")"
    exp="$(policy_of "$d" expire_days "$POLICY_DEFAULT_EXPIRE")"
    newest="$(mtime_of "$d")"
    for f in "$d"/*/; do
      [ -d "$f" ] || continue
      m="$(mtime_of "${f%/}")"
      [ "$m" -gt "$newest" ] 2>/dev/null && newest="$m"
    done
    age=$(( (now - newest) / 86400 ))
    label="$(basename "$d")"
    # A recorded "keep this" outranks any sweep flag; only --force overrides it.
    if [ "$exp" = "never" ] && [ "$FORCE" -eq 0 ]; then
      echo "keep   $(size_of "$d")  $label  (${age}d, kept by policy; --force overrides)"
      return 0
    fi
    [ -n "$OLDER" ] && exp="$OLDER"
    if [ -z "$repo" ]; then
      PLAN="${PLAN}rm${TAB}$d${TAB}no .repo marker, orphaned
"
    elif [ ! -d "$repo" ]; then
      PLAN="${PLAN}rm${TAB}$d${TAB}repo gone: $repo
"
    elif [ "$exp" = "never" ]; then
      echo "keep   $(size_of "$d")  $label  (${age}d, kept by policy)"
    elif [ "$age" -ge "$exp" ] 2>/dev/null; then
      PLAN="${PLAN}trim${TAB}$d${TAB}untouched ${age}d, policy says ${exp}d; log.json kept
"
    else
      echo "keep   $(size_of "$d")  $label  (${age}d of ${exp}d, $repo)"
    fi
  }
  [ "$BASE_IN_REPO" -eq 1 ] && consider "$BASE" "$REPO_ROOT"
  if [ -d "$GLOBAL_ROOT" ]; then
    for d in "$GLOBAL_ROOT"/*/; do consider "${d%/}" ""; done
  fi
  if [ -z "$PLAN" ]; then
    echo "nothing to collect"
    exit 0
  fi
  echo "plan:"
  while IFS="$TAB" read -r act d why; do
    [ -n "${d:-}" ] || continue
    verb="remove"; [ "$act" = "trim" ] && verb="reclaim scratch from"
    echo "  $verb  $(size_of "$d")  $d  # $why"
  done <<GC_EOF
$PLAN
GC_EOF
  if [ "$YES" -eq 0 ]; then
    echo "dry run. re-run with --yes to delete. Set a workspace to 'policy --expire never' to keep it."
    exit 0
  fi
  while IFS="$TAB" read -r act d why; do
    [ -n "${d:-}" ] || continue
    case "$d" in
      "$GLOBAL_ROOT"/*) ;;
      "$REPO_ROOT"/.ui-ux-design-council) ;;
      *) echo "skip (not a council workspace): $d" >&2; continue ;;
    esac
    if [ "$act" = "rm" ]; then
      rm -rf "$d" && echo "collected $(basename "$d")"
    else
      for feature in "$d"/*/; do
        [ -d "$feature" ] || continue
        for e in "$feature"* "$feature".[!.]*; do
          [ -e "$e" ] || continue
          [ "$(basename "$e")" = "log.json" ] && continue
          rm -rf "$e"
        done
      done
      echo "reclaimed scratch from $(basename "$d") (log.json kept)"
    fi
  done <<GC_EOF
$PLAN
GC_EOF
  exit 0
  ;;

prune)
  [ -d "$BASE" ] || { echo "no workspace at $BASE"; exit 0; }
  command -v node >/dev/null 2>&1 || fail "prune needs node (the runtime capture.mjs and build_board.mjs already use)"
  if [ "$(policy_get prune offer)" = "off" ] && [ "$YES" -eq 0 ]; then
    echo "prune is set to off for this workspace (the user declined); not offering again"
    exit 0
  fi
  case "$KEEP" in ""|*[!0-9]*) fail "--keep takes a whole number of iterations" ;; esac
  case "$MIN" in ""|*[!0-9]*) fail "--min takes a whole number of megabytes" ;; esac
  found=0
  for d in "$BASE"/*/; do
    [ -d "$d" ] || continue
    d="${d%/}"
    if [ -n "$FEATURE" ] && [ "$(basename "$d")" != "$FEATURE" ]; then continue; fi
    [ -f "$d/log.json" ] || continue
    found=1
    if [ "$YES" -eq 1 ]; then
      node "$SCRIPT_DIR/prune.mjs" "$d/log.json" --keep "$KEEP" --min "$MIN" --yes || exit $?
    else
      node "$SCRIPT_DIR/prune.mjs" "$d/log.json" --keep "$KEEP" --min "$MIN" || exit $?
    fi
  done
  [ "$found" -eq 0 ] && echo "no feature with a log.json to prune under $BASE"
  exit 0
  ;;

clean)
  [ -d "$BASE" ] || { echo "nothing to clean: no workspace at $BASE"; exit 0; }
  PLAN=""
  TAB="$(printf '\t')"
  add_plan() {
    case "$PLAN" in *"$TAB$2$TAB"*) return 0 ;; esac
    PLAN="${PLAN}$1$TAB$2$TAB$3
"; }

  if [ -f "$MANIFEST" ]; then
    while IFS="$(printf '\t')" read -r kind p; do
      [ -n "${p:-}" ] || continue
      case "$kind" in
        scratch) [ -e "$p" ] && add_plan rm "$p" "variant/fixture scratch" ;;
        worktree) [ -e "$p" ] && add_plan worktree "$p" "variant worktree" ;;
      esac
    done < "$MANIFEST"
  fi

  if [ "$ALL" -eq 1 ]; then
    add_plan rm "$BASE" "whole workspace, log.json included"
  else
    # everything in a feature directory is scratch except the ledger
    for d in "$BASE"/*/; do
      [ -d "$d" ] || continue
      d="${d%/}"
      for e in "$d"/* "$d"/.[!.]*; do
        [ -e "$e" ] || continue
        b="$(basename "$e")"
        [ "$b" = "log.json" ] && continue
        if [ "$KEEP_SHOTS" -eq 1 ]; then
          case "$b" in shots|board.html) continue ;; esac
        fi
        why="session artefact"
        case "$b" in
          shots) why="screenshots" ;;
          board.html) why="generated board" ;;
          node_modules|dist|.vite|.next|.turbo) why="prototype build output" ;;
        esac
        add_plan rm "$e" "$why"
      done
    done
    while IFS= read -r h; do
      [ -n "$h" ] && add_plan rm "$h" "prototype build output"
    done <<HEAVY_EOF
$(find "$BASE" -maxdepth 4 -type d \( -name node_modules -o -name dist -o -name .vite -o -name .next -o -name .turbo \) -prune 2>/dev/null)
HEAVY_EOF
  fi

  if [ -z "$PLAN" ]; then
    echo "nothing to clean (log.json kept; use --all to remove the workspace entirely)"
    exit 0
  fi

  echo "plan:"
  printf '%s' "$PLAN" | while IFS="$(printf '\t')" read -r act p why; do
    [ -n "${p:-}" ] || continue
    echo "  $act  $(size_of "$p")  $(rel_to_repo "$p")  # $why"
  done
  [ "$ALL" -eq 0 ] && echo "  keep   each feature's log.json (the lineage ledger)"
  tot="$( { while IFS="$TAB" read -r act p why; do [ -n "${p:-}" ] && [ -e "$p" ] && du -sk "$p" 2>/dev/null; done <<TOTAL_EOF
$PLAN
TOTAL_EOF
  } | awk '{t+=$1} END{if(t>=1024) printf "%.0fM", t/1024; else printf "%dK", t+0}')"
  [ -n "$tot" ] && echo "  frees  ~$tot"
  if [ "$YES" -eq 0 ]; then
    echo "dry run. re-run with --yes to delete."
    exit 0
  fi

  while IFS="$(printf '\t')" read -r act p why; do
    [ -n "${p:-}" ] || continue
    case "$p" in
      ""|"/"|"$HOME"|"$REPO_ROOT") echo "skip (unsafe): $p" >&2; continue ;;
    esac
    [ "$act" = "worktree" ] || [ -e "$p" ] || continue
    if [ "$act" = "worktree" ]; then
      if git -C "$REPO_ROOT" worktree remove --force "$p" 2>/dev/null; then
        echo "removed worktree $p"
      else
        echo "could not remove worktree $p; run: git worktree remove --force $p" >&2
      fi
      continue
    fi
    tr="$(tracked_in "$p")"
    if [ -n "$tr" ] && [ "$FORCE" -eq 0 ]; then
      echo "skip (git tracks files under $(rel_to_repo "$p"); use --force to override)" >&2
      continue
    fi
    rm -rf "$p" && echo "removed $(rel_to_repo "$p")"
    parent="$(dirname "$p")"
    while [ "$parent" != "$REPO_ROOT" ] && [ "$parent" != "/" ] && [ "$parent" != "$BASE" ]; do
      rmdir "$parent" 2>/dev/null || break
      echo "removed empty $(rel_to_repo "$parent")"
      parent="$(dirname "$parent")"
    done
  done <<PLAN_EOF
$PLAN
PLAN_EOF

  # drop removed entries from the manifest
  if [ -f "$MANIFEST" ]; then
    kept=""
    while IFS="$(printf '\t')" read -r kind p; do
      [ -n "${p:-}" ] || continue
      [ -e "$p" ] && kept="${kept}$(printf '%s\t%s' "$kind" "$p")
"
    done < "$MANIFEST"
    printf '%s' "$kept" > "$MANIFEST" 2>/dev/null || true
  fi

  if [ "$IN_GIT" -eq 1 ]; then
    echo "git status now: $(git -C "$REPO_ROOT" status --porcelain | wc -l | tr -d ' ') changed path(s)"
  fi
  ;;

*) fail "unknown command: $CMD (expected init|path|scratch|status|prune|clean|policy|gc)" ;;
esac
