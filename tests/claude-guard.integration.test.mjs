import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ClaudeHarness } from "./helpers/claude-harness.mjs";

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), "../plugins/kubectl-guard");
const enabled = process.env.KUBECTL_GUARD_RUN_CLAUDE_TESTS === "1";
const effects = (run) => run.executions.filter((entry) => !entry.lookup);
const before = (run) => run.observations.filter((entry) => entry.event === "PreToolUse");
const denied = (run) => run.results.some((result) => result.permission_denials?.length > 0);

test("real Claude host lifecycle (explicit opt-in; loopback API and dummy tools only)", { skip: !enabled, timeout: 180000 }, async (t) => {
  const fixture = new ClaudeHarness(t, plugin);
  const version = (await fixture.cli(["--version"])).trim();
  t.diagnostic(`Actual host: ${version}; permission callback tests cover SDK stdio approval, not terminal rendering.`);

  await t.test("read executes the dummy tool while an implicit mutation is denied", async () => {
    const read = await fixture.run({ command: "kubectl get pods --context=guard-fixture-remote" });
    assert.equal(effects(read).length, 1);
    assert.ok(read.executions.every((entry) => entry.emptyKubeconfig));
    assert.equal(before(read).length, 1);
    assert.match(JSON.stringify(read.toolResults), /synthetic kubectl output/);
    assert.ok(read.shellInvocations.some((event) => event.profileScriptBlocked), "Native snapshot/profile source command must be rejected by the fixture shell");
    assert.ok(read.shellInvocations.some((event) => event.profileFree && event.loginFlagRemoved), "Actual host fallback must use the fixture shell without login profiles");
    const mutation = await fixture.run({ command: "kubectl delete pod fixture" });
    assert.equal(effects(mutation).length, 0);
    assert.equal(mutation.permissionRequests.length, 0);
    assert.ok(denied(mutation));
  });

  await t.test("only an exact configured context and server pair exempts a mutation", async () => {
    const localName = await fixture.run({ command: "kubectl delete pod fixture --context=kind-guard-fixture" });
    assert.equal(effects(localName).length, 0);
    assert.ok(denied(localName));
    const policyFile = join(fixture.config, "kubectl-guard.json");
    const command = "kubectl delete pod fixture --context=guard-fixture-lab";
    try {
      writeFileSync(policyFile, JSON.stringify({ schemaVersion: 1,
        trustedTargets: [{ context: "guard-fixture-lab", server: "https://127.0.0.1:6443" }] }));
      const matching = await fixture.run({ command });
      assert.equal(effects(matching).length, 1);
      assert.equal(denied(matching), false);
      writeFileSync(policyFile, JSON.stringify({ schemaVersion: 1,
        trustedTargets: [{ context: "guard-fixture-lab", server: "https://different.invalid" }] }));
      const changed = await fixture.run({ command });
      assert.equal(effects(changed).length, 0);
      assert.ok(denied(changed));
    } finally { rmSync(policyFile, { force: true }); }
  });

  await t.test("a safe read pipeline runs while unsafe shell composition is guarded", async () => {
    const safe = await fixture.run({ command: "kubectl get pods --context=guard-fixture-remote | wc -l", allowedTools: "Bash" });
    assert.equal(effects(safe).length, 1);
    assert.equal(denied(safe), false);
    const unsafe = await fixture.run({ command: "kubectl get pods --context=guard-fixture-remote; printf synthetic", allowedTools: "Bash" });
    assert.equal(effects(unsafe).length, 0);
    assert.ok(denied(unsafe));
    const implicit = await fixture.run({ command: "kubectl delete pod fixture | wc -l", permission: "allow" });
    assert.equal(effects(implicit).length, 0);
    assert.equal(implicit.permissionRequests.length, 0, "Missing-context pipeline mutation must deny without offering approval");
    assert.ok(denied(implicit));
  });

  for (const [requested, effective] of [["manual", "default"], ["dontAsk", "dontAsk"], ["acceptEdits", "acceptEdits"], ["plan", "plan"], ["bypassPermissions", "bypassPermissions"]]) {
    await t.test(`noninteractive ${requested} keeps an unapproved explicit mutation from executing`, async () => {
      const run = await fixture.run({ mode: requested });
      assert.equal(effects(run).length, 0);
      assert.ok(denied(run));
      assert.equal(before(run)[0]?.mode, effective);
      assert.ok(run.hookEvents.some((event) => event.subtype === "hook_response" && event.output?.includes('"permissionDecision":"ask"')));
    });
  }

  await t.test("requested auto reports the effective mode without inventing auto coverage", async () => {
    const run = await fixture.run({ mode: "auto" });
    assert.equal(effects(run).length, 0);
    assert.ok(denied(run));
    const mode = before(run)[0]?.mode;
    assert.ok(mode === "default" || mode === "auto", `Unexpected effective mode: ${mode}`);
    t.diagnostic(mode === "auto" ? "Actual auto mode reached; mutation was denied."
      : "Requested auto became effective default. True auto enforcement remains unverified by this host fixture.");
  });

  for (const permission of ["deny", "allow"]) {
    await t.test(`actual SDK permission ${permission} controls dummy mutation execution`, async () => {
      const run = await fixture.run({ permission });
      assert.equal(run.permissionRequests.length, 1);
      assert.equal(run.permissionRequests[0].subtype, "can_use_tool");
      assert.equal(run.permissionRequests[0].tool_name, "Bash");
      assert.match(run.permissionRequests[0].decision_reason ?? "", /guard-fixture-remote/);
      assert.equal(effects(run).length, permission === "allow" ? 1 : 0);
      assert.equal(denied(run), permission === "deny");
      assert.equal(before(run)[0]?.mode, "default");
    });
  }

  await t.test("actual Agent subagent inherits the hook and cannot execute an unapproved mutation", async () => {
    const run = await fixture.run({ subagent: true });
    assert.equal(effects(run).length, 0);
    assert.ok(denied(run));
    const observation = before(run).find((event) => event.agent_type === "guard-fixture");
    assert.ok(observation?.agent_id);
    assert.equal(observation.session, run.sessionId);
    assert.ok(run.apiRequests.some((request) => request.tools.includes("Agent")));
    assert.ok(run.apiRequests.some((request) => !request.tools.includes("Agent")));
  });

  for (const runtime of ["missing", "crash"]) {
    await t.test(`${runtime} Node blocks after the real host starts the launcher`, async (subtest) => {
      const broken = new ClaudeHarness(subtest, plugin, { runtime });
      const run = await broken.run({ command: "kubectl get pods --context=guard-fixture-remote" });
      assert.equal(effects(run).length, 0);
      assert.ok(run.hookEvents.some((event) => event.exit_code === 2));
      assert.match(JSON.stringify(run.toolResults), /blocked|evaluation failed|Node.js/i);
    });
  }

  await t.test("a missing launcher demonstrates the host failure boundary", async (subtest) => {
    const broken = new ClaudeHarness(subtest, plugin, { hostFailure: "missing-launcher" });
    const run = await broken.run();
    assert.equal(effects(run).length, 1);
    assert.ok(run.hookEvents.some((event) => event.exit_code !== 0 && event.exit_code != null));
    subtest.diagnostic("The host allowed the stub because the guard launcher never started; installation alone does not establish enforcement.");
  });

  await t.test("real local marketplace install, disable, enable and uninstall change host behavior", async () => {
    await fixture.install();
    const active = await fixture.run({ installed: true });
    assert.equal(effects(active).length, 0);
    assert.ok(denied(active));
    await fixture.cli(["plugin", "disable", "kubectl-guard@ablankholm", "--scope", "user"]);
    assert.equal(effects(await fixture.run({ installed: true })).length, 1);
    await fixture.cli(["plugin", "enable", "kubectl-guard@ablankholm", "--scope", "user"]);
    assert.equal(effects(await fixture.run({ installed: true })).length, 0);
    await fixture.cli(["plugin", "uninstall", "kubectl-guard@ablankholm", "--scope", "user"]);
    assert.equal(effects(await fixture.run({ installed: true })).length, 1);
  });

  await t.test("slash-command substitution is real but injected shell does not prove PreToolUse", async (subtest) => {
    const injected = new ClaudeHarness(subtest, plugin);
    mkdirSync(join(injected.plugin, "commands"), { recursive: true });
    writeFileSync(join(injected.plugin, "commands/fixture-session.md"), [
      "---", "description: Synthetic session substitution fixture", "allowed-tools: Bash", "---", "",
      '!`node -e \'console.log("FIXTURE_SESSION=" + process.argv[1])\' "${CLAUDE_SESSION_ID}"`', "",
      "Report the fixture session identifier.",
    ].join("\n"));
    const sessionId = randomUUID();
    const run = await injected.run({ sessionId, prompt: "/kubectl-guard:fixture-session", textOnly: true,
      expectedText: `FIXTURE_SESSION=${sessionId}` });
    assert.equal(before(run).length, 0);
    assert.equal(run.apiRequests[0]?.includesExpectedText, true);
    subtest.diagnostic("Skill shell injection did not invoke PreToolUse. The regular doctor Bash call must establish its own observation.");
  });

  await t.test("doctor uses a regular Bash call and reports this actual session's observation", async (subtest) => {
    const doctor = new ClaudeHarness(subtest, plugin);
    await doctor.install();
    const installed = JSON.parse(await doctor.cli(["plugin", "list", "--json"]));
    const listed = installed.find((entry) => entry.id === "kubectl-guard@ablankholm");
    const installPath = listed?.installPath;
    assert.ok(installPath);
    assert.equal(listed.enabled, true);
    const sessionId = randomUUID();
    // A native local marketplace loads its source plugin even though plugin list
    // reports a cache installPath. Exercise the command the skill actually gives.
    const loadedRoot = join(doctor.base, "marketplace/plugins/kubectl-guard");
    const command = `node "${join(loadedRoot, "scripts/doctor.mjs")}" --session-id "${sessionId}" --json`;
    const run = await doctor.run({ sessionId, prompt: "/kubectl-guard:doctor", command, installed: true,
      allowedTools: "Bash(node *)", expectedText: command });
    assert.equal(effects(run).length, 0);
    assert.equal(before(run).length, 1);
    assert.equal(before(run)[0].session, sessionId);
    assert.equal(run.apiRequests[0]?.includesExpectedText, true, "First model request must contain the complete command expanded from the doctor skill");
    assert.equal(run.apiRequests[0]?.hasUnexpandedPluginVariables, false);
    const texts = run.toolResults.flatMap((result) => typeof result.content === "string"
      ? [result.content] : (result.content ?? []).filter((block) => block.type === "text").map((block) => block.text));
    const report = texts.map((text) => {
      // Claude may append a system-reminder after the tool's JSON output.
      try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); }
      catch { return null; }
    }).find((value) => value?.schemaVersion === 1 && value.sessionObservation);
    assert.ok(report, "Actual Bash tool result must contain the deterministic doctor JSON");
    assert.equal(report.sessionObservation.status, "observed");
    assert.equal(report.sessionObservation.permissionMode, "default");
    assert.equal(report.selfTests.passed, report.selfTests.total);
    const installation = report.checks.find((check) => check.name === "installation");
    assert.equal(installation?.status, "warn");
    assert.match(installation.detail, /installed copy differs/);
  });
});
