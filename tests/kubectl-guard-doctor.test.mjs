import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runDoctor, selfCheck } from "../plugins/kubectl-guard/scripts/doctor.mjs";
import { pluginIdentity, readObservation, writeObservation } from "../plugins/kubectl-guard/scripts/observations.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginId = "kubectl-guard@ablankholm";
const sessionId = "12345678-1234-1234-1234-123456789abc";
const otherSession = "12345678-1234-1234-1234-123456789def";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "guard-doctor-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const pluginRoot = join(directory, "plugin"), cwd = join(directory, "project"), configDir = join(directory, "guard-config"), userDir = join(directory, "claude-config");
  for (const path of [join(pluginRoot, ".claude-plugin"), join(pluginRoot, "hooks"), join(pluginRoot, "scripts"), join(cwd, ".git"), join(cwd, ".claude"), configDir, userDir]) mkdirSync(path, { recursive: true });
  writeFileSync(join(pluginRoot, ".claude-plugin/plugin.json"), JSON.stringify({ name: "kubectl-guard", version: "2.0.0" }));
  writeFileSync(join(pluginRoot, "hooks/hooks.json"), JSON.stringify({ hooks: { PreToolUse: [] } }));
  writeFileSync(join(pluginRoot, "scripts/guard.mjs"), "// Fixture source only.\n");
  const env = { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: userDir, KUBECTL_GUARD_CONFIG_DIR: configDir };
  const installation = { id: pluginId, version: "2.0.0", enabled: true, installPath: pluginRoot, scope: "user" };
  const calls = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "bash") return { status: 0, stdout: "GNU bash" };
    if (command === "claude") return { status: 0, stdout: JSON.stringify([installation]) };
    throw new Error("No other executable is permitted by the test fixture");
  };
  const now = Date.now();
  const options = { env, cwd, configDir, pluginRoot, sessionId, execute, now };
  const observation = { sessionId, cwd, configDir, pluginRoot, now, permissionMode: "default", outcome: "pass" };
  const state = join(configDir, "kubectl-guard-state");
  const receipt = join(state, `${createHash("sha256").update(sessionId).digest("hex")}.json`);
  const settings = (scope, value) => {
    const path = scope === "user" ? join(userDir, "settings.json") : join(cwd, `.claude/settings${scope === "local" ? ".local" : ""}.json`);
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  };
  return { directory, pluginRoot, cwd, configDir, userDir, env, installation, calls, options, observation, state, receipt, settings };
}

const result = (report, name) => report.checks.find((entry) => entry.name === name);
const hookSettings = (command) => ({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command }] }] } });

test("receipts contain only minimal private metadata and hash the session ID", (t) => {
  const f = fixture(t);
  assert.equal(writeObservation({ ...f.observation, outcome: { decision: "ask", reason: "private command must not persist" } }), true);
  assert.equal(statSync(f.state).mode & 0o777, 0o700);
  assert.equal(statSync(f.receipt).mode & 0o777, 0o600);
  const text = readFileSync(f.receipt, "utf8"), record = JSON.parse(text);
  assert.deepEqual(Object.keys(record).sort(), ["schemaVersion", "version", "fingerprint", "cwd", "permissionMode", "observedAt", "outcome"].sort());
  assert.equal(record.outcome, "ask");
  assert.equal(record.version, "2.0.0");
  assert.match(record.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(!text.includes(sessionId));
  assert.ok(!text.includes("private command"));
  assert.equal(readObservation(f.observation).status, "observed");
  assert.equal(readObservation(f.observation).permissionMode, "default");
  assert.match(readObservation(f.observation).detail, /does not prove.*enforced/);
});

test("receipt evidence is scoped to session, directory, release bytes, and freshness", (t) => {
  const f = fixture(t);
  assert.equal(readObservation(f.observation).status, "missing");
  assert.equal(readObservation({ ...f.observation, sessionId: undefined }).status, "missing-session");
  assert.equal(writeObservation(f.observation), true);
  assert.equal(readObservation({ ...f.observation, sessionId: otherSession }).status, "missing");
  assert.equal(readObservation({ ...f.observation, sessionId: sessionId.toUpperCase() }).status, "observed");
  assert.equal(readObservation({ ...f.observation, cwd: f.directory }).status, "different-cwd");
  assert.equal(readObservation({ ...f.observation, now: f.options.now + 300001 }).status, "stale");
  assert.equal(readObservation({ ...f.observation, now: f.options.now - 30001 }).status, "stale");
  writeFileSync(join(f.pluginRoot, "scripts/guard.mjs"), "// Changed bytes, same version.\n");
  assert.equal(readObservation(f.observation).status, "different-release");
});

test("receipt identity includes manifest, hook registration, and scripts", (t) => {
  const f = fixture(t);
  const original = pluginIdentity(f.pluginRoot).fingerprint;
  writeFileSync(join(f.pluginRoot, "hooks/hooks.json"), "{\"hooks\":{}}\n");
  assert.notEqual(pluginIdentity(f.pluginRoot).fingerprint, original);
  writeObservation(f.observation);
  writeFileSync(join(f.pluginRoot, ".claude-plugin/plugin.json"), JSON.stringify({ name: "kubectl-guard", version: "2.1.0" }));
  assert.equal(readObservation(f.observation).status, "different-release");
  symlinkSync(join(f.pluginRoot, "hooks/hooks.json"), join(f.pluginRoot, "scripts/linked.mjs"));
  assert.equal(writeObservation(f.observation), false);
});

test("invalid session IDs and failed receipt writes are nonfatal and create no evidence", (t) => {
  const f = fixture(t);
  for (const id of ["../../outside", "session", "$(touch /tmp/injected)", "", null]) {
    assert.equal(writeObservation({ ...f.observation, sessionId: id }), false);
    assert.notEqual(readObservation({ ...f.observation, sessionId: id }).status, "observed");
  }
  assert.equal(existsSync(f.state), false);
  assert.equal(writeObservation({ ...f.observation, outcome: "allow" }), false);
  assert.equal(writeObservation({ ...f.observation, now: NaN }), false);
  writeFileSync(f.state, "occupied");
  assert.equal(writeObservation(f.observation), false);
  assert.equal(readFileSync(f.state, "utf8"), "occupied");
  assert.equal(readObservation(f.observation).status, "invalid");
});

test("untrusted receipt files and directories cannot become passing evidence", (t) => {
  const f = fixture(t);
  writeObservation(f.observation);
  const original = readFileSync(f.receipt);
  for (const value of ["not json", "[]", JSON.stringify({ ...JSON.parse(original), command: "secret" }), JSON.stringify({ ...JSON.parse(original), permissionMode: "bad\nmode" })]) {
    writeFileSync(f.receipt, value);
    assert.equal(readObservation(f.observation).status, "invalid");
  }
  writeFileSync(f.receipt, original);
  chmodSync(f.receipt, 0o644);
  assert.equal(readObservation(f.observation).status, "invalid");
  chmodSync(f.receipt, 0o600);
  chmodSync(f.state, 0o755);
  assert.equal(readObservation(f.observation).status, "invalid");
  assert.equal(writeObservation(f.observation), false);
  chmodSync(f.state, 0o700);
  const other = join(f.directory, "unrelated.json");
  writeFileSync(other, original, { mode: 0o600 });
  rmSync(f.receipt);
  symlinkSync(other, f.receipt);
  assert.equal(readObservation(f.observation).status, "invalid");
  assert.deepEqual(readFileSync(other), original);
});

test("receipt directory symlinks are rejected without changing their destination", (t) => {
  const f = fixture(t);
  const elsewhere = join(f.directory, "elsewhere");
  mkdirSync(elsewhere, { mode: 0o700 });
  symlinkSync(elsewhere, f.state);
  assert.equal(writeObservation(f.observation), false);
  assert.equal(readObservation(f.observation).status, "invalid");
  assert.deepEqual(readdirSync(elsewhere), []);
});

test("receipt cleanup expires old records, caps retained sessions, and preserves unrelated files", (t) => {
  const f = fixture(t);
  mkdirSync(f.state, { mode: 0o700 });
  for (let index = 0; index < 132; index++) {
    const path = join(f.state, `${createHash("sha256").update(String(index)).digest("hex")}.json`);
    writeFileSync(path, "fixture", { mode: 0o600 });
    const modified = new Date(f.options.now - 1000 - index);
    utimesSync(path, modified, modified);
  }
  const expired = join(f.state, `${"a".repeat(64)}.json`);
  writeFileSync(expired, "expired");
  const old = new Date(f.options.now - 86400001);
  utimesSync(expired, old, old);
  writeFileSync(join(f.state, "keep.txt"), "unrelated");
  assert.equal(writeObservation(f.observation), true);
  assert.equal(existsSync(expired), false);
  assert.equal(readdirSync(f.state).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).length, 128);
  assert.equal(readFileSync(join(f.state, "keep.txt"), "utf8"), "unrelated");
  assert.equal(readObservation(f.observation).status, "observed");
});

test("doctor separates installation, pure self-checks, and missing session evidence", (t) => {
  const f = fixture(t);
  const report = runDoctor(f.options);
  assert.equal(report.failures, 0);
  assert.equal(result(report, "installation").status, "pass");
  assert.equal(report.selfTests.passed, report.selfTests.total);
  assert.equal(report.sessionObservation.status, "missing");
  assert.equal(existsSync(f.state), false);
  assert.deepEqual(f.calls.map(({ command, args }) => [command, args]), [["bash", ["--version"]], ["claude", ["plugin", "list", "--json"]]]);
  for (const { options } of f.calls) {
    assert.equal(options.shell, false);
    assert.equal(options.killSignal, "SIGKILL");
    assert.ok(options.timeout <= 3000);
    assert.ok(options.maxBuffer <= 1048576);
  }
  assert.match(report.limitations.join(" "), /not proof of host enforcement/);
});

test("doctor reads matching effective-mode evidence without writing files", (t) => {
  const f = fixture(t);
  assert.equal(writeObservation({ ...f.observation, permissionMode: "dontAsk", outcome: "deny" }), true);
  const before = readFileSync(f.receipt), modified = statSync(f.receipt).mtimeMs;
  const report = runDoctor(f.options);
  assert.equal(report.sessionObservation.status, "observed");
  assert.equal(report.sessionObservation.permissionMode, "dontAsk");
  assert.equal(report.sessionObservation.outcome, "deny");
  assert.deepEqual(readFileSync(f.receipt), before);
  assert.equal(statSync(f.receipt).mtimeMs, modified);
});

test("guard disable controls override existing recent receipts", (t) => {
  const f = fixture(t);
  writeObservation(f.observation);
  const markers = [{ KUBECTL_GUARD: "off" }];
  for (const name of ["CLAUDE_CODE_SAFE_MODE", "CLAUDE_CODE_SIMPLE"]) {
    for (const value of ["1", "true", "yes", "on", " TRUE ", " Yes ", "ON"]) markers.push({ [name]: value });
  }
  for (const marker of markers) {
    const report = runDoctor({ ...f.options, env: { ...f.env, ...marker } });
    assert.equal(result(report, "controls").status, "fail");
    assert.equal(report.sessionObservation.status, "disabled");
  }
  for (const value of ["0", "false", "no", "off", "", "disabled"]) {
    const report = runDoctor({ ...f.options, env: { ...f.env, CLAUDE_CODE_SAFE_MODE: value, CLAUDE_CODE_SIMPLE: value } });
    assert.equal(result(report, "controls").status, "pass");
    assert.equal(report.sessionObservation.status, "observed");
  }
  const flag = join(f.configDir, "kubectl-guard.disabled");
  writeFileSync(flag, "");
  assert.equal(runDoctor(f.options).sessionObservation.status, "disabled");
  rmSync(flag);
  mkdirSync(flag);
  assert.equal(runDoctor(f.options).sessionObservation.status, "observed", "A directory does not activate the wrapper's -f disable control");
});

test("merged user/project/local hook controls take precedence and invalidate old receipts", (t) => {
  const f = fixture(t);
  writeObservation(f.observation);
  f.settings("user", { disableAllHooks: true });
  assert.equal(runDoctor(f.options).sessionObservation.status, "disabled");
  f.settings("project", { disableAllHooks: false });
  assert.equal(result(runDoctor(f.options), "settings").status, "pass");
  f.settings("local", { enabledPlugins: { [pluginId]: false } });
  assert.equal(runDoctor(f.options).sessionObservation.status, "disabled");
  f.settings("local", { enabledPlugins: { [pluginId]: true } });
  assert.equal(runDoctor(f.options).sessionObservation.status, "observed");
  f.settings("project", "{");
  assert.equal(result(runDoctor(f.options), "settings").status, "fail");
  f.settings("project", { disableAllHooks: "true" });
  assert.equal(result(runDoctor(f.options), "settings").status, "fail");
});

test("doctor locates project settings from nested working directories", (t) => {
  const f = fixture(t), nested = join(f.cwd, "src/deep");
  mkdirSync(nested, { recursive: true });
  f.settings("project", { disableAllHooks: true });
  f.installation.projectPath = f.cwd;
  assert.equal(result(runDoctor({ ...f.options, cwd: nested }), "settings").status, "fail");
  assert.equal(result(runDoctor({ ...f.options, cwd: nested }), "installation").status, "pass");
});

test("doctor reports duplicate guard hooks without disclosing commands or changing settings", (t) => {
  const f = fixture(t);
  f.settings("user", hookSettings('SECRET=credential bash ~/.claude/hooks/kubectl-guard.sh'));
  f.settings("project", hookSettings('bash /plugins/kubectl-guard/scripts/kubectl-guard.sh'));
  f.settings("local", hookSettings('bash unrelated-safe-hook.sh'));
  const report = runDoctor(f.options);
  assert.equal(result(report, "direct registration").status, "fail");
  assert.match(result(report, "direct registration").detail, /2 direct guard registration/);
  assert.ok(!JSON.stringify(report).includes("credential"));
  assert.match(readFileSync(join(f.userDir, "settings.json"), "utf8"), /SECRET=credential/);
});

test("invalid policy blocks a clean report without exposing its contents", (t) => {
  const f = fixture(t);
  const path = join(f.configDir, "kubectl-guard.json");
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, trustedTargets: [{ context: "lab", server: "https://user:secret@example.invalid" }] }));
  const report = runDoctor(f.options);
  assert.equal(result(report, "policy").status, "fail");
  assert.ok(!JSON.stringify(report).includes("secret"));
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, trustedTargets: [{ context: "lab", server: "https://localhost:6443" }] }));
  assert.match(result(runDoctor(f.options), "policy").detail, /1 explicit trusted target/);
});

test("CLI installation failures and disabled plugins remain distinct from successful self-checks", (t) => {
  const f = fixture(t);
  writeObservation(f.observation);
  f.installation.enabled = false;
  let report = runDoctor(f.options);
  assert.equal(result(report, "installation").status, "fail");
  assert.equal(report.sessionObservation.status, "disabled");
  f.installation.enabled = true;
  f.installation.version = "1.0.0";
  assert.equal(result(runDoctor(f.options), "installation").status, "warn");
  for (const response of [{ status: 0, stdout: "[]" }, { status: 0, stdout: "bad JSON" }, { status: null, error: { code: "ETIMEDOUT" }, stderr: "secret" }]) {
    report = runDoctor({ ...f.options, execute: (command, args, options) => command === "claude" ? response : f.options.execute(command, args, options) });
    assert.equal(result(report, "installation").status, "fail");
    assert.equal(report.selfTests.failures.length, 0);
    assert.ok(!JSON.stringify(report).includes("secret"));
  }
});

test("doctor marks missing Bash and unexpected subprocess failures without crashing", (t) => {
  const f = fixture(t);
  const report = runDoctor({ ...f.options, execute: () => { throw new Error("fixture failure"); } });
  assert.equal(result(report, "Bash").status, "fail");
  assert.equal(result(report, "installation").status, "fail");
});

test("synthetic checks cover strict mutation and explicit trust behavior without subprocesses", () => {
  const checks = selfCheck();
  assert.ok(checks.total >= 8);
  assert.deepEqual(checks.failures, []);
});

test("CLI validates UUID arguments before any installation lookup", (t) => {
  const f = fixture(t), command = join(root, "plugins/kubectl-guard/scripts/doctor.mjs");
  for (const args of [["--session-id", "../../outside"], ["--session-id"], ["--arbitrary", "input"]]) {
    const result = spawnSync(process.execPath, [command, ...args], { env: f.env, cwd: f.cwd, encoding: "utf8", timeout: 3000 });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Invalid doctor arguments/);
    assert.equal(result.stdout, "");
    assert.equal(existsSync(f.state), false);
  }
});

test("doctor skill uses the regular Bash path and fixed supported session substitution", () => {
  const skill = readFileSync(join(root, "plugins/kubectl-guard/skills/doctor/SKILL.md"), "utf8");
  assert.match(skill, /disable-model-invocation: true/);
  assert.match(skill, /regular Bash tool/);
  assert.ok(skill.includes('node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" --session-id "${CLAUDE_SESSION_ID}" --json'));
  assert.ok(!skill.includes("!`"));
  assert.ok(!skill.includes("$ARGUMENTS"));
  assert.ok(!skill.includes("allowed-tools:"));
  assert.match(skill, /Do not change settings/);
});
