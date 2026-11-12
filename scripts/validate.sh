#!/usr/bin/env bash
# Repo checks: JSON validity, marketplace <-> manifest consistency, SKILL.md frontmatter,
# shell/Python/JS syntax. Runs `claude plugin validate` when the Claude CLI is available.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0; err() { echo "FAIL: $*"; fail=1; }
python3 - <<'PY' || fail=1
import ast, json, pathlib, re, sys
root = pathlib.Path("."); bad = False
def load(p):
    global bad
    try: return json.loads(pathlib.Path(p).read_text())
    except Exception as e: print(f"FAIL: {p}: {e}"); bad = True; return {}
cm = load(".claude-plugin/marketplace.json"); xm = load(".agents/plugins/marketplace.json")
c_names = {p["name"]: p["source"] for p in cm.get("plugins", [])}
x_names = {p["name"]: p["source"]["path"] for p in xm.get("plugins", [])}
if set(c_names) != set(x_names):
    print(f"FAIL: marketplaces list different plugins: claude={sorted(c_names)} codex={sorted(x_names)}"); bad = True
for name, src in c_names.items():
    if x_names.get(name) != src:
        print(f"FAIL: {name}: marketplace source paths differ"); bad = True
    d = root / src
    if not d.resolve().is_relative_to(root.resolve()):
        print(f"FAIL: {name}: plugin path escapes repository"); bad = True; continue
    for mf in (".claude-plugin/plugin.json", ".codex-plugin/plugin.json"):
        m = load(d / mf)
        if m and m.get("name") != name: print(f"FAIL: {d/mf} name {m.get('name')!r} != {name!r}"); bad = True
    cv, xv = load(d/".claude-plugin/plugin.json").get("version"), load(d/".codex-plugin/plugin.json").get("version")
    if cv != xv: print(f"FAIL: {name} version mismatch claude={cv} codex={xv}"); bad = True
    if not re.fullmatch(r"\d+\.\d+\.\d+", str(xv)): print(f"FAIL: {name} version not strict semver: {xv}"); bad = True
    if load(d/".codex-plugin/plugin.json").get("skills") != "./skills/":
        print(f"FAIL: {name}: expected shared skills directory"); bad = True
    if not list(d.glob("skills/*/SKILL.md")) and not (d/"hooks").exists(): print(f"FAIL: {name} has no skills or hooks"); bad = True
for f in root.glob("**/SKILL.md"):
    if ".git" in f.parts: continue
    t = f.read_text(); m = re.match(r"---\n(.*?)\n---\n", t, re.S)
    if not m: print(f"FAIL: {f}: missing frontmatter"); bad = True; continue
    fm = dict(re.findall(r"^(\w+):\s*(.*)$", m.group(1), re.M))
    if fm.get("name") != f.parent.name: print(f"FAIL: {f}: name {fm.get('name')!r} != dir {f.parent.name!r}"); bad = True
    if not fm.get("description"): print(f"FAIL: {f}: no description"); bad = True
    elif len(fm["description"]) > 1024: print(f"FAIL: {f}: description > 1024 chars"); bad = True
for f in root.rglob("*.py"):
    if ".git" in f.parts: continue
    try: ast.parse(f.read_text(), filename=str(f))
    except SyntaxError as e: print(f"FAIL: {f}: {e}"); bad = True
for f in root.glob("plugins/**/SKILL.md"):
    for ref in re.findall(r"`((?:references|scripts|assets)/[^` ]+)`", f.read_text()):
        if not (f.parent/ref).is_file(): print(f"FAIL: {f}: missing reference {ref}"); bad = True
for f in root.rglob("*"):
    if not f.is_file() or ".git" in f.parts or "__pycache__" in f.parts: continue
    if f.is_symlink(): print(f"FAIL: release includes a symlink: {f}"); bad = True
    if f.suffix in {".md", ".json", ".yaml", ".py", ".mjs", ".sh"}:
        if any(c in f.read_text() for c in (chr(0x2014), chr(0x2013))):
            print(f"FAIL: unsupported dash punctuation: {f}"); bad = True
print("json/manifests/frontmatter: " + ("FAIL" if bad else "ok"))
sys.exit(1 if bad else 0)
PY
while IFS= read -r f; do bash -n "$f" || err "bash syntax $f"; done < <(find . -name '*.sh' -not -path './.git/*')
if command -v node >/dev/null; then while IFS= read -r f; do node --check "$f" || err "js syntax $f"; done < <(find . -name '*.mjs' -not -path './.git/*'); else err "Node.js is required to validate screenshot capture"; fi
if command -v claude >/dev/null; then
  claude plugin validate --strict . || err "Claude marketplace validation"
  for plugin in plugins/*; do
    claude plugin validate --strict "$plugin" || err "Claude plugin validation: $plugin"
  done
else
  echo "skip: Claude CLI not found (native plugin validation)"
fi
python3 -B -m unittest discover -s tests -v || err "regression tests"
[ $fail -eq 0 ] && echo "all checks passed" || { echo "checks failed"; exit 1; }
