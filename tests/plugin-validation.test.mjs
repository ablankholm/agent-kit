import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { validatePlugins } from "../scripts/lib/validate-plugins.mjs";

const hostDirectories = { Claude: ".claude-plugin", Codex: ".codex-plugin" };
class Fixture {
  constructor(t) {
    this.root = realpathSync(mkdtempSync(join(tmpdir(), "agent-kit plugins ")));
    t.after(() => rmSync(this.root, { recursive: true, force: true }));
    this.catalogs = { Claude: { plugins: [] }, Codex: { plugins: [] } };
  }
  write(path, content) {
    const target = join(this.root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof content === "string" ? content : JSON.stringify(content));
  }
  plugin(name, hosts, component = "skill") {
    const directory = `plugins/${name}`;
    for (const host of hosts) {
      const source = `./${directory}`;
      this.catalogs[host].plugins.push({ name, source: host === "Claude" ? source : { source: "local", path: source } });
      this.write(`${directory}/${hostDirectories[host]}/plugin.json`, {
        name, version: "1.0.0", ...(host === "Codex" && component === "skill" ? { skills: "./skills/" } : {}),
      });
    }
    if (component === "skill") this.write(`${directory}/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: Fixture.\n---\n`);
    if (component === "hook") this.write(`${directory}/hooks/hooks.json`, {
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo fixture" }] }] },
    });
    return directory;
  }
  validate() {
    this.write(".claude-plugin/marketplace.json", this.catalogs.Claude);
    this.write(".agents/plugins/marketplace.json", this.catalogs.Codex);
    const walk = (path) => readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
      const target = join(path, entry.name);
      return entry.isDirectory() ? walk(target) : [target];
    });
    const failures = [];
    const readJSON = (path) => {
      try { return JSON.parse(readFileSync(path, "utf8")); }
      catch (error) { failures.push(`${relative(this.root, path)}: ${error.message}`); return {}; }
    };
    const claudePaths = validatePlugins({ root: this.root, files: walk(this.root), readJSON, fail: (message) => failures.push(message) });
    return { failures, claudePaths };
  }
}

test("Claude-only hook and shared skill coexist; native validation includes only Claude plugins", (t) => {
  const f = new Fixture(t);
  f.plugin("shared", ["Claude", "Codex"]);
  f.plugin("guard", ["Claude"], "hook");
  f.plugin("codex-only", ["Codex"]);
  const result = f.validate();
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.claudePaths.map((path) => relative(f.root, path)).sort(), ["plugins/guard", "plugins/shared"]);
});

test("each supported host's manifest is required", (t) => {
  const f = new Fixture(t);
  const directory = f.plugin("shared", ["Claude", "Codex"]);
  rmSync(join(f.root, directory, ".codex-plugin/plugin.json"));
  assert.ok(f.validate().failures.some((failure) => failure.includes(".codex-plugin/plugin.json")));
});

test("removing a host's catalog entry leaves a rejected orphan manifest", (t) => {
  const f = new Fixture(t);
  f.plugin("shared", ["Claude", "Codex"]);
  f.catalogs.Codex.plugins = [];
  assert.ok(f.validate().failures.some((failure) => failure.includes("not registered in the Codex marketplace")));
});

test("removing every catalog entry still rejects the shipped manifests", (t) => {
  const f = new Fixture(t);
  f.plugin("shared", ["Claude", "Codex"]);
  f.catalogs.Claude.plugins = [];
  f.catalogs.Codex.plugins = [];
  assert.equal(f.validate().failures.filter((failure) => failure.includes("not registered")).length, 2);
});

test("shared plugin versions must stay aligned", (t) => {
  const f = new Fixture(t);
  const directory = f.plugin("shared", ["Claude", "Codex"]);
  f.write(`${directory}/.codex-plugin/plugin.json`, { name: "shared", version: "2.0.0", skills: "./skills/" });
  assert.ok(f.validate().failures.some((failure) => failure.includes("versions differ")));
});

test("shared plugins cannot use different source directories", (t) => {
  const f = new Fixture(t);
  f.plugin("shared", ["Claude"]);
  f.plugin("different", ["Codex"]);
  f.catalogs.Codex.plugins[0].name = "shared";
  f.write("plugins/different/.codex-plugin/plugin.json", { name: "shared", version: "1.0.0", skills: "./skills/" });
  assert.ok(f.validate().failures.some((failure) => failure.includes("source paths differ")));
});

test("a hook directory without a real configuration is not a component", (t) => {
  const f = new Fixture(t);
  const directory = f.plugin("empty", ["Claude"], "none");
  mkdirSync(join(f.root, directory, "hooks"));
  assert.ok(f.validate().failures.some((failure) => failure.includes("no skills or configured hooks")));
});

test("empty or malformed hook registrations are rejected", async (t) => {
  for (const config of [
    { PreToolUse: [] },
    { hooks: {} },
    { hooks: [] },
    { hooks: { PreToolUse: [] } },
    { hooks: { PreToolUse: [{ hooks: [] }] } },
    { hooks: { PreToolUse: [{ hooks: [{}] }] } },
    { hooks: { PreToolUse: [{ hooks: [{ type: "unknown" }] }] } },
    { hooks: { PreToolUse: [{ hooks: [{ type: "prompt" }] }] } },
    { hooks: { PreToolUse: [{ hooks: [{ type: "command", command: " " }] }] } },
  ]) {
    await t.test(JSON.stringify(config), (st) => {
      const f = new Fixture(st);
      const directory = f.plugin("guard", ["Claude"], "hook");
      f.write(`${directory}/hooks/hooks.json`, config);
      assert.ok(f.validate().failures.length > 0);
    });
  }
});

test("invalid hooks are rejected even alongside valid skills", (t) => {
  const f = new Fixture(t);
  const directory = f.plugin("shared", ["Claude", "Codex"]);
  f.write(`${directory}/hooks/hooks.json`, "not JSON");
  assert.ok(f.validate().failures.some((failure) => failure.includes("hooks/hooks.json")));
});

test("manifest names and release versions are checked on host-specific plugins", (t) => {
  const f = new Fixture(t);
  const directory = f.plugin("guard", ["Claude"], "hook");
  f.write(`${directory}/.claude-plugin/plugin.json`, { name: "wrong-name", version: "latest" });
  const result = f.validate();
  assert.ok(result.failures.some((failure) => failure.includes("different name")));
  assert.ok(result.failures.some((failure) => failure.includes("major.minor.patch")));
});

test("catalogs reject duplicate entries and nonlocal sources", (t) => {
  const f = new Fixture(t);
  f.plugin("shared", ["Claude", "Codex"]);
  f.catalogs.Claude.plugins.push(f.catalogs.Claude.plugins[0]);
  f.catalogs.Codex.plugins[0].source.source = "github";
  const result = f.validate();
  assert.ok(result.failures.some((failure) => failure.includes("duplicate plugin")));
  assert.ok(result.failures.some((failure) => failure.includes("local marketplace source")));
});

test("source and skills paths cannot escape the package", (t) => {
  const f = new Fixture(t);
  const directory = f.plugin("codex-only", ["Codex"]);
  f.write(`${directory}/.codex-plugin/plugin.json`, { name: "codex-only", version: "1.0.0", skills: "./../../../" });
  f.catalogs.Claude.plugins.push({ name: "outside", source: "./../" });
  const result = f.validate();
  assert.ok(result.failures.some((failure) => failure.includes("outside: Claude marketplace source")));
  assert.ok(result.failures.some((failure) => failure.includes("codex-only: skills")));
});
