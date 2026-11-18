import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { assess, configurationDirectory, localDefaults } from "../plugins/kubectl-guard/scripts/guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "plugins/kubectl-guard");
const forbidLookup = () => { throw new Error("Unexpected context lookup"); };
const local = { getCurrentContext: () => "kind-dev" };
const ask = (command, options = local) => assert.equal(typeof assess(command, options), "string", command);
const pass = (command, options = { getCurrentContext: forbidLookup }) => assert.equal(assess(command, options), null, command);

test("simple reads and ordinary unrelated commands preserve host permissions without lookup", () => {
  for (const command of [
    "git status", "npm test", "echo hello", "curl -k https://example.invalid", "",
    "kubectl get pods", "kubectl describe pod x", "kubectl logs pod/x", "kubectl top pods",
    "kubectl explain pod", "kubectl api-resources", "kubectl api-versions", "kubectl version",
    "kubectl events", "kubectl cluster-info", "kubectl --context=production get pods",
    "kubectl get pods --context production", "kubectl -n prod get pods", "kubectl -nx get pods",
    "kubectl --namespace=prod --request-timeout=5s get pods -o json",
    "kubectl get pods -o 'jsonpath={.items[*].metadata.name}'",
    "kubecolor get pods", "'/opt/tools with spaces/kubectl' get pods", '"kube"ctl get pods',
    "kube\\ctl get pods",
  ]) pass(command);
});

test("context selectors work before and after verbs with literal quoting and escapes", () => {
  for (const executable of ["kubectl", "kubecolor", "'kubectl'", '"kubectl"', '"kube"ctl', "kube\\ctl", "'/opt/my tools/kubectl'"]) {
    for (const selector of ["--context=production", "--context production", "--context 'production'"]) {
      ask(`${executable} ${selector} delete pod x`);
      ask(`${executable} delete pod x ${selector}`);
    }
    pass(`${executable} delete pod x --context=kind-dev`);
  }
  ask("kubectl --context production delete pod x", { getCurrentContext: forbidLookup });
  pass("kubectl delete pod x", local);
  ask("kubectl delete pod x", { getCurrentContext: () => "production" });
});

test("all built-in local defaults and known mutations use the no-decision path", () => {
  for (const context of localDefaults.map((pattern) => pattern.replaceAll("*", "demo"))) {
    pass(`kubectl delete pod x --context=${context}`);
  }
  for (const verb of ["delete", "apply", "replace", "patch", "scale", "drain", "cordon", "uncordon", "taint", "rollout", "set", "autoscale", "annotate", "label", "run", "expose", "certificate"]) {
    pass(`kubectl ${verb} x --context=kind-demo`);
    ask(`kubectl ${verb} x --context=production`);
  }
  pass(`kubectl patch deploy x -p '{"spec":{"replicas":0}}' --context=kind-demo`);
  for (const operation of ["configmap x", "namespace x", "secret generic x", "service clusterip x", "svc nodeport x"]) {
    pass(`kubectl create ${operation} --context=kind-demo`);
    ask(`kubectl create ${operation} --context=production`);
  }
});

test("unknown and non-cluster effects always ask, including on local contexts", () => {
  for (const operation of ["", "plugin-example", "config use-context prod", "config current-context", "exec pod/x -- sh", "attach pod/x", "cp pod/x:/tmp/a .", "proxy", "port-forward pod/x 8080", "debug pod/x", "diff -f deployment.yaml", "cluster-info dump", "edit deploy/x", "apply edit-last-applied deploy/x", "create custom-plugin x", "create secret custom-plugin x", "create configmap x --edit", "create configmap x -e", "create -f file.yaml"]) {
    ask(`kubectl --context=kind-demo ${operation}`);
  }
});

test("flag-looking values cannot fabricate a local target", () => {
  const production = { getCurrentContext: () => "production" };
  for (const operation of ["apply -f", "delete -f", "create configmap x --from-file", "apply --field-manager", "delete -l"]) {
    ask(`kubectl ${operation} --context=kind-demo`, production);
    ask(`kubectl ${operation} --context kind-demo`, production);
  }
  pass("kubectl apply -f file.yaml --context=kind-demo");
  ask("kubectl create custom-plugin x --context=kind-demo");
  ask("kubectl get\u00a0pods", local);
});

test("target/auth overrides and ambiguous selectors never borrow local trust", () => {
  for (const flag of ["--kubeconfig", "--kuberc", "--server", "--cluster", "--user", "--as", "--as-group", "--as-uid", "--token", "--username", "--password", "--client-certificate", "--client-key", "--certificate-authority", "--tls-server-name", "--insecure-skip-tls-verify", "--raw", "-s"]) {
    for (const form of [`${flag} other`, `${flag}=other`]) {
      ask(`kubectl ${form} delete pod x`);
      ask(`kubectl delete pod x ${form}`);
      ask(`kubectl get pods ${form} --context=kind-demo`);
    }
    if (flag.startsWith("--")) ask(`kubectl get pods ${flag.slice(0, 2) + flag.slice(2).replaceAll("-", "_")}=other`);
  }
  for (const command of [
    "kubectl delete pod x -shttps://example.invalid", "kubectl delete pod x -wshttps://example.invalid",
    "kubectl get pods -Ashttps://example.invalid", "kubectl delete pod x --context=kind-dev --context=production",
    "kubectl --context kind-dev delete pod x --context kind-dev", "kubectl delete pod x --context",
    "kubectl delete pod x --context=", "kubectl delete pod x --context --server=x",
    "kubectl delete pod x --context ''", "kubectl delete pod x -- --context=kind-dev",
    "kubectl --unknown delete pod x", "kubectl --namespace --context=kind-dev delete pod x",
    "kubectl --namespace= delete pod x",
    "kubectl get pods --profile=cpu --profile-output=README.md",
    "kubectl get pods --profile_output=README.md",
  ]) ask(command);
});

test("complex shells cannot inherit a safe read or local mutation decision", () => {
  for (const command of [
    "kubectl get pods; rm -rf ./data", "kubectl get pods && kubectl delete ns prod",
    "kubectl get pods | cat", "kubectl get pods > output.txt", "kubectl get pods\nkubectl delete pod x",
    "kubectl delete pod $(kubectl get pod -o name) --context=kind-dev", "kubectl get `touch sentinel`",
    "kubectl get pods # comment", "kubectl get pods &", "(kubectl get pods)",
    "sudo kubectl get pods", "env KUBECONFIG=other kubectl get pods", "command kubectl get pods",
    "KUBECONFIG=other kubectl delete pod x", "bash -c 'kubectl delete pod x'",
    "kubectl get pods ${EXTRA_FLAGS}", "kubectl get pods $FLAGS", "kubectl get pods *",
    '"kubectl delete pod x', "kubectl get pods\\", "kube\\\nctl delete pod x",
    "kubectl --context=kind-dev get pods | kubectl --context=kind-dev delete -f -",
  ]) ask(command, { getCurrentContext: forbidLookup });
});

test("custom trust patterns are literal except documented wildcards", () => {
  const options = { getCurrentContext: forbidLookup, getLocalPatterns: () => ["lab-?*", "my.cluster", "plus+cluster"] };
  pass("kubectl delete pod x --context=lab-x", options);
  pass("kubectl delete pod x --context=my.cluster", options);
  pass("kubectl delete pod x --context=plus+cluster", options);
  ask("kubectl delete pod x --context=myXcluster", options);
  ask("kubectl delete pod x --context=lab-", options);
  for (const pattern of ["[ab]*", "foo\\*"]) ask("kubectl delete pod x --context=kind-dev", { getLocalPatterns: () => [pattern] });
  for (const context of ["", "kind-dev\nproduction", "kind-dev\0"]) ask("kubectl delete pod x", { getCurrentContext: () => context });
  ask(`kubectl delete pod x --context=${"a".repeat(513)}`);
  ask("kubectl delete pod x --context=kind-dev", { getLocalPatterns: () => ["a".repeat(257)] });
  ask("kubectl delete pod x --context=kind-dev", { getLocalPatterns: () => Array(129).fill("lab-*") });
});

test("adversarial wildcard input cannot consume the hook's execution budget", () => {
  const script = `import { assess } from ${JSON.stringify(new URL("../plugins/kubectl-guard/scripts/guard.mjs", import.meta.url).href)};
    if (!assess('kubectl delete pod x --context=' + 'a'.repeat(80), {getLocalPatterns: () => ['a*a*a*a*a*a*a*a*a*a*b']})) process.exit(1);`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { timeout: 1500, encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

class Fixture {
  constructor(t) {
    this.base = realpathSync(mkdtempSync(join(tmpdir(), "kubectl guard ")));
    t.after(() => rmSync(this.base, { recursive: true, force: true }));
    this.plugin = join(this.base, "plugin with spaces");
    cpSync(plugin, this.plugin, { recursive: true });
    this.config = join(this.base, "config");
    this.bin = join(this.base, "bin");
    mkdirSync(this.config);
    mkdirSync(this.bin);
    symlinkSync(process.execPath, join(this.bin, "node"));
    this.log = join(this.base, "kubectl-args.json");
    this.stub(`const fs = require('node:fs'); fs.writeFileSync(process.env.GUARD_TEST_LOG, JSON.stringify(process.argv.slice(2))); console.log('kind-test');`);
    this.env = { ...process.env, PATH: `${this.bin}:/usr/bin:/bin`, KUBECTL_GUARD_CONFIG_DIR: this.config, GUARD_TEST_LOG: this.log };
    delete this.env.KUBECTL_GUARD;
    this.registration = JSON.parse(readFileSync(join(this.plugin, "hooks/hooks.json"), "utf8"));
  }
  stub(source) {
    writeFileSync(join(this.bin, "kubectl"), `#!/usr/bin/env node\n${source}\n`, { mode: 0o755 });
  }
  run(command, options = {}) {
    const payload = options.payload ?? JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", cwd: this.base, tool_input: { command } });
    const entries = this.registration.hooks.PreToolUse;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].matcher, "Bash");
    const hook = entries[0].hooks[0];
    assert.equal(hook.type, "command");
    assert.equal(hook.timeout, 5);
    const result = spawnSync("/bin/bash", ["-c", hook.command], {
      cwd: this.base, env: { ...this.env, CLAUDE_PLUGIN_ROOT: this.plugin }, input: payload,
      encoding: "utf8", timeout: 6000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, options.status ?? 0, result.stderr);
    if (result.status !== 0) {
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /blocked/i);
      return "blocked";
    }
    if (!result.stdout) return null;
    const response = JSON.parse(result.stdout);
    assert.equal(response.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(response.hookSpecificOutput.permissionDecision, "ask");
    assert.ok(response.hookSpecificOutput.permissionDecisionReason);
    return "ask";
  }
}

test("registered hook works in a path with spaces and never executes proposed commands", (t) => {
  const f = new Fixture(t);
  assert.equal(f.run("git status"), null);
  assert.equal(f.run("kubectl get pods"), null);
  assert.equal(existsSync(f.log), false);
  assert.equal(f.run("kubectl delete pod x"), null);
  assert.deepEqual(JSON.parse(readFileSync(f.log)), ["config", "current-context"]);
  assert.equal(f.run("kubectl get pods; touch sentinel"), "ask");
  assert.equal(existsSync(join(f.base, "sentinel")), false);
  const response = f.run("kubectl delete pod x --token=credential-sentinel");
  assert.equal(response, "ask");
});

test("lookup failure, absence, excessive output, and timeout ask without fallback to real kubectl", (t) => {
  const f = new Fixture(t);
  for (const source of ["process.exit(1)", "console.log('')", "console.log('production')", "console.log('kind-test\\nproduction')", "console.log('x'.repeat(70000))", "setTimeout(() => console.log('kind-test'), 10000)"]) {
    f.stub(source);
    assert.equal(f.run("kubectl delete pod x"), "ask");
  }
  rmSync(join(f.bin, "kubectl"));
  f.env.PATH = f.bin;
  // The outer registered shell command still needs bash, so make only that available.
  symlinkSync("/bin/bash", join(f.bin, "bash"));
  assert.equal(f.run("kubectl delete pod x"), "ask");
});

test("legacy switches and user configuration survive hook execution", (t) => {
  const f = new Fixture(t);
  f.env.KUBECTL_GUARD = "off";
  assert.equal(f.run("kubectl delete pod x --context=production"), null);
  assert.equal(f.run("ignored", { payload: "invalid JSON" }), null);
  delete f.env.KUBECTL_GUARD;
  const disabled = join(f.config, "kubectl-guard.disabled");
  writeFileSync(disabled, "owned by user\n");
  assert.equal(f.run("kubectl delete pod x --context=production"), null);
  assert.equal(readFileSync(disabled, "utf8"), "owned by user\n");
  rmSync(disabled);
  const path = join(f.config, "kubectl-guard-local-contexts");
  const content = "# personal trust\n  lab-?*  # disposable\n\n";
  writeFileSync(path, content);
  assert.equal(f.run("kubectl delete pod x --context=lab-test"), null);
  assert.equal(readFileSync(path, "utf8"), content);
  writeFileSync(path, "[ab]*\n");
  assert.equal(f.run("kubectl delete pod x --context=kind-test"), "ask");
});

test("configuration directory precedence preserves the default legacy path", (t) => {
  assert.equal(configurationDirectory({ HOME: "/example" }), "/example/.claude");
  assert.equal(configurationDirectory({ HOME: "/example", CLAUDE_CONFIG_DIR: "/custom" }), "/custom");
  assert.equal(configurationDirectory({ HOME: "/example", CLAUDE_CONFIG_DIR: "/custom", KUBECTL_GUARD_CONFIG_DIR: "/guard" }), "/guard");
  const f = new Fixture(t);
  f.env.CLAUDE_CONFIG_DIR = f.config;
  delete f.env.KUBECTL_GUARD_CONFIG_DIR;
  writeFileSync(join(f.config, "kubectl-guard.disabled"), "");
  assert.equal(f.run("kubectl delete pod x --context=production"), null);
});

test("malformed input and required configuration block, other tool events are ignored", (t) => {
  const f = new Fixture(t);
  for (const payload of ["invalid", "null", "[]", "{}", '{"tool_name":"Bash","tool_input":{"command":17}}']) {
    f.run("ignored", { payload, status: 2 });
  }
  assert.equal(f.run("ignored", { payload: JSON.stringify({ tool_name: "Read" }) }), null);
  assert.equal(f.run("ignored", { payload: JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash" }) }), null);
  const path = join(f.config, "kubectl-guard-local-contexts");
  for (const content of ["kind-*\0", Buffer.from([0xff, 0xfe]), "x".repeat(65537)]) {
    writeFileSync(path, content);
    f.run("kubectl delete pod x", { status: 2 });
  }
  rmSync(path);
  mkdirSync(path);
  f.run("kubectl delete pod x", { status: 2 });
  assert.equal(f.run("kubectl get pods"), null);
});

test("missing Node and evaluator failure use the host's blocking exit code", (t) => {
  const f = new Fixture(t);
  const runtime = join(f.bin, "node");
  rmSync(runtime);
  symlinkSync("/bin/bash", join(f.bin, "bash"));
  f.env.PATH = f.bin;
  f.run("kubectl get pods", { status: 2 });
  writeFileSync(runtime, "#!/bin/bash\nexit 1\n", { mode: 0o755 });
  f.run("kubectl get pods", { status: 2 });
  rmSync(runtime);
  symlinkSync(process.execPath, runtime);
  rmSync(join(f.plugin, "scripts/guard.mjs"));
  f.run("kubectl get pods", { status: 2 });
  f.env.KUBECTL_GUARD = "off";
  assert.equal(f.run("kubectl get pods"), null);
});
