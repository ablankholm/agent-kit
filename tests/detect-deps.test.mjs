import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const detector = join(root, "plugins/ui-ux-design-council/skills/ui-ux-design-council/scripts/detect_deps.sh");

class Fixture {
  constructor(t) {
    this.base = realpathSync(mkdtempSync(join(tmpdir(), "council detector ")));
    t.after(() => rmSync(this.base, { recursive: true, force: true }));
    this.project = join(this.base, "project with spaces");
    this.userRoot = join(this.base, "user files");
    mkdirSync(this.project);
    mkdirSync(this.userRoot);
    this.env = {
      ...process.env,
      PATH: "/usr/bin:/bin",
      XDG_CACHE_HOME: join(this.base, "cache"),
      DETECTOR_TEST_USER_ROOT: this.userRoot,
      DETECTOR_TEST_ADMIN_ROOT: join(this.base, "admin skills"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: devNull,
    };
    delete this.env.DETECTOR_TEST_CODEX_ROOT;
    delete this.env.DETECTOR_TEST_CLAUDE_ROOT;
    const init = spawnSync("git", ["init", "--quiet", this.project], { env: this.env, encoding: "utf8" });
    assert.equal(init.status, 0, init.stderr);

    // Redirect only filesystem lookup roots in a temporary copy. HOME,
    // CODEX_HOME and installed host configuration are never changed.
    let source = readFileSync(detector, "utf8");
    const rootOverrides = [
      ['H="${HOME:-}"', 'H="${DETECTOR_TEST_USER_ROOT:?}"'],
      ['CODEX_DIR="${CODEX_HOME:-$H/.codex}"', 'CODEX_DIR="${DETECTOR_TEST_CODEX_ROOT:-$H/.codex}"'],
      ['CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$H/.claude}"', 'CLAUDE_DIR="${DETECTOR_TEST_CLAUDE_ROOT:-$H/.claude}"'],
      ['add_root admin  "/etc/codex/skills"', 'add_root admin "$DETECTOR_TEST_ADMIN_ROOT"'],
    ];
    for (const [original, replacement] of rootOverrides) {
      assert.equal(source.split(original).length - 1, 1, `Expected one lookup root: ${original}`);
      source = source.replace(original, replacement);
    }
    this.script = join(this.base, "detect_deps.sh");
    writeFileSync(this.script, source);
  }

  run(args = [], { status = 0, cwd = this.project } = {}) {
    const result = spawnSync("/bin/bash", [this.script, "--project", cwd, ...args], {
      env: this.env,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, status, result.stdout + result.stderr);
    return status === 0 ? result.stdout : result.stderr;
  }

  skill(directory, name, folder = name) {
    const path = join(directory, folder, "SKILL.md");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `---\nname: ${name}\ndescription: Fixture.\n---\n`);
    return path;
  }
}

const line = (output, prefix) => output.split("\n").find((value) => value.startsWith(prefix));

test("repo skill takes precedence and is found from a subdirectory", (t) => {
  const f = new Fixture(t);
  f.skill(join(f.userRoot, ".agents/skills"), "impeccable");
  const local = f.skill(join(f.project, ".agents/skills"), "impeccable");
  const nested = join(f.project, "app", "nested");
  mkdirSync(nested, { recursive: true });
  const found = line(f.run([], { cwd: nested }), "seat craft-lead ");
  assert.ok(found.includes(`INSTALLED repo ${local}`), found);
  assert.ok(found.includes("(+1 more copies)"), found);
});

test("repo plugin is repo evidence", (t) => {
  const f = new Fixture(t);
  f.skill(join(f.project, ".claude/plugins/local/skills"), "openspec-explore");
  assert.ok(f.run().includes("fw openspec IN-USE repo skills:openspec-explore"));
});

test("global plugins are available without adopting frameworks", (t) => {
  const f = new Fixture(t);
  const plugins = join(f.userRoot, ".claude/plugins/cache/vendor/bundle/1.0.0/skills");
  for (const name of ["openspec-explore", "h-spec", "quint-explore"]) f.skill(plugins, name);
  const output = f.run();
  for (const framework of ["openspec", "haft", "quint"]) {
    assert.ok(output.includes(`fw ${framework} AVAILABLE global skills:`), output);
    assert.ok(!output.includes(`fw ${framework} IN-USE`), output);
  }
});

test("custom Codex and Claude roots are discovered", (t) => {
  const f = new Fixture(t);
  const codexRoot = join(f.base, "custom codex");
  const claudeRoot = join(f.base, "custom claude");
  f.env.DETECTOR_TEST_CODEX_ROOT = codexRoot;
  f.env.DETECTOR_TEST_CLAUDE_ROOT = claudeRoot;
  f.skill(join(codexRoot, "plugins/cache/vendor/design/1.0.0/skills"), "frontend-skill");
  f.skill(join(claudeRoot, "skills"), "nielsen-heuristics-audit");
  const output = f.run();
  assert.ok(output.includes("seat native-builder frontend-skill INSTALLED plugin"), output);
  assert.ok(output.includes("seat usability nielsen-heuristics-audit INSTALLED global"), output);
});

test("cached results refresh and support targeted recheck", (t) => {
  const f = new Fixture(t);
  const local = f.skill(join(f.project, ".agents/skills"), "impeccable");
  const first = f.run();
  rmSync(dirname(local), { recursive: true });
  assert.equal(f.run(), first);
  assert.equal(f.run(["--recheck", "craft-lead"]).trim(), "seat craft-lead impeccable MISSING - -");
  f.skill(join(f.project, ".agents/skills"), "impeccable");
  assert.ok(f.run().includes("seat craft-lead impeccable MISSING"));
  assert.ok(f.run(["--refresh"]).includes("seat craft-lead impeccable INSTALLED"));
});

test("declined missing seat persists until installed", (t) => {
  const f = new Fixture(t);
  f.run(["--decline", "craft-lead"]);
  assert.ok(f.run().includes("declined craft-lead"));
  assert.ok(f.run(["--refresh"]).includes("declined craft-lead"));
  f.skill(join(f.project, ".agents/skills"), "impeccable");
  assert.ok(!f.run(["--refresh"]).includes("declined craft-lead"));
});

test("global framework decline persists until repo adoption", (t) => {
  const f = new Fixture(t);
  f.skill(join(f.userRoot, ".agents/skills"), "openspec-explore");
  f.run();
  f.run(["--decline", "openspec"]);
  assert.ok(f.run(["--refresh"]).includes("declined openspec"));
  mkdirSync(join(f.project, "openspec"));
  assert.ok(!f.run(["--refresh"]).includes("declined openspec"));
});

test("undecline removes only the selected key", (t) => {
  const f = new Fixture(t);
  f.run(["--decline", "openspec"]);
  f.run(["--decline", "haft"]);
  f.run(["--undecline", "openspec"]);
  const output = f.run();
  assert.ok(!output.includes("declined openspec"));
  assert.ok(output.includes("declined haft"));
});

test("invalid arguments fail promptly", (t) => {
  const f = new Fixture(t);
  const invalid = [
    ["--project"], ["--recheck"], ["--decline"], ["--undecline"],
    ["--decline", "--refresh"], ["--recheck", "not-a-seat"], ["--decline", ".*"],
    ["--unknown"], ["--project", join(f.base, "missing")],
  ];
  for (const args of invalid) assert.ok(f.run(args, { status: 2 }).trim(), args.join(" "));
});

test("cache path is read-only and legacy cache is refreshed", (t) => {
  const f = new Fixture(t);
  const cache = f.run(["--cache-path"]).trim();
  assert.ok(!existsSync(dirname(cache)));
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, "# scanned legacy\nfw openspec IN-USE repo stale\ndeclined haft\n");
  const output = f.run();
  assert.ok(output.includes("# detector-cache-version 2"));
  assert.ok(!output.includes("stale"));
  assert.ok(output.includes("declined haft"));
});
