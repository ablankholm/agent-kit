import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { assess, configurationDirectory, decisionForMode } from "../plugins/kubectl-guard/scripts/guard.mjs";
import { validatePolicy, normalizedServer } from "../plugins/kubectl-guard/scripts/policy.mjs";
import { parsePipeline } from "../plugins/kubectl-guard/scripts/shell.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "plugins/kubectl-guard");
const server = "https://127.0.0.1:6443";
const resolveTarget = (context = "production") => ({ context, server, namespace: "team" });
const target = { resolveTarget };
const policy = validatePolicy({ schemaVersion: 1, trustedTargets: [{ context: "kind-demo", server }] });
const trusted = { resolveTarget, getPolicy: () => policy };
const forbidLookup = () => { throw new Error("Unexpected context lookup"); };
const guarded = (command, options = target) => {
  const result = assess(command, options);
  assert.ok(result && ["ask", "deny"].includes(result.decision), command);
  return result;
};
const pass = (command, options = { resolveTarget: forbidLookup }) => assert.equal(assess(command, options), null, command);

test("simple reads and unrelated commands preserve host permissions without lookup", () => {
  for (const command of [
    "git status", "npm test", "echo hello", "curl -k https://example.invalid", "",
    "node /tmp/kubectl-guard/scripts/doctor.mjs --json", "bash /tmp/kubectl-guard/scripts/doctor.sh",
    "kubectl get pods", "kubectl describe pod x", "kubectl logs pod/x", "kubectl top pods",
    "kubectl explain pod", "kubectl api-resources", "kubectl api-versions", "kubectl version",
    "kubectl events", "kubectl cluster-info", "kubectl --context=production get pods",
    "kubectl get pods --context production", "kubectl -n prod get pods", "kubectl -nx get pods",
    "kubectl --namespace=prod --request-timeout=5s get pods -o json",
    "kubectl get pods -o 'jsonpath={.items[*].metadata.name}'", "kubecolor get pods",
    "'/opt/tools with spaces/kubectl' get pods", '"kube"ctl get pods', "kube\\ctl get pods",
  ]) pass(command);
});

test("strict default denies ambient mutations and asks even for local-looking explicit contexts", () => {
  for (const name of ["docker-desktop", "minikube", "kind-demo", "microk8s", "k3s-default", "production"]) {
    assert.equal(assess(`kubectl delete pod x --context=${name}`, target).decision, "ask");
    assert.equal(assess("kubectl delete pod x", { resolveTarget: () => ({ context: name, server }) }).decision, "deny");
  }
  const result = assess("kubectl delete pod x", target);
  assert.match(result.reason, /explicit --context/);
  assert.match(result.reason, /production.*current; not pinned/);
});

test("literal executable spellings and context positions retain identical policy", () => {
  for (const executable of ["kubectl", "kubecolor", "'kubectl'", '"kubectl"', '"kube"ctl', "kube\\ctl", "'/opt/my tools/kubectl'"]) {
    for (const selector of ["--context=production", "--context production", "--context 'production'"]) {
      assert.equal(guarded(`${executable} ${selector} delete pod x`).decision, "ask");
      assert.equal(guarded(`${executable} delete pod x ${selector}`).decision, "ask");
    }
    pass(`${executable} delete pod x --context=kind-demo`, trusted);
  }
});

test("trust requires an exact context and server and never excuses external effects", () => {
  for (const verb of ["delete", "apply", "replace", "patch", "scale", "drain", "cordon", "uncordon", "taint", "rollout", "set", "autoscale", "annotate", "label", "run", "expose", "certificate"]) {
    pass(`kubectl ${verb} x --context=kind-demo`, trusted);
    guarded(`kubectl ${verb} x --context=production`, trusted);
  }
  pass(`kubectl patch deploy x -p '{"spec":{"replicas":0}}' --context=kind-demo`, trusted);
  for (const operation of ["configmap x", "namespace x", "secret generic x", "service clusterip x", "svc nodeport x"]) pass(`kubectl create ${operation} --context=kind-demo`, trusted);
  guarded("kubectl delete pod x --context=kind-demo", { ...trusted, resolveTarget: (context) => ({ context, server: "https://different.invalid" }) });
  guarded("kubectl delete pod x --context=kind-demo", { ...trusted, resolveTarget: () => ({ context: "different", server }) });
  guarded("kubectl delete pod x --context=kind-demo", { ...trusted, resolveTarget: () => null });
  for (const operation of ["", "plugin-example", "config use-context prod", "config current-context", "exec pod/x -- sh", "attach pod/x", "cp pod/x:/tmp/a .", "proxy", "port-forward pod/x 8080", "debug pod/x", "diff -f deployment.yaml", "cluster-info dump", "edit deploy/x", "apply edit-last-applied deploy/x", "create custom-plugin x", "create secret custom-plugin x", "create configmap x --edit", "create configmap x -e", "create -f file.yaml"]) guarded(`kubectl --context=kind-demo ${operation}`, trusted);
});

test("flag-looking values and conflicting selectors cannot fabricate a target", () => {
  for (const operation of ["apply -f", "delete -f", "create configmap x --from-file", "apply --field-manager", "delete -l"]) {
    assert.equal(guarded(`kubectl ${operation} --context=kind-demo`, trusted).decision, "deny");
    assert.equal(guarded(`kubectl ${operation} --context kind-demo`, trusted).decision, "deny");
  }
  pass("kubectl apply -f file.yaml --context=kind-demo", trusted);
  for (const command of [
    "kubectl delete pod x --context=kind-demo --context=production",
    "kubectl --context kind-demo delete pod x --context kind-demo", "kubectl delete pod x --context",
    "kubectl delete pod x --context=", "kubectl delete pod x --context --server=x",
    "kubectl delete pod x --context ''", "kubectl delete pod x -- --context=kind-demo",
    "kubectl delete pod x --context=kind-demo -n one -n two", "kubectl delete pod x --context=kind-demo -n one -A",
  ]) assert.equal(guarded(command, trusted).decision, "deny");
  for (const command of ["kubectl --unknown delete pod x", "kubectl --namespace --context=kind-demo delete pod x", "kubectl --namespace= delete pod x", "kubectl get\u00a0pods"]) guarded(command);
});

test("target/auth overrides, normalized flags and local-write flags remain guarded", () => {
  for (const flag of ["--kubeconfig", "--kuberc", "--server", "--cluster", "--user", "--as", "--as-group", "--as-uid", "--token", "--username", "--password", "--client-certificate", "--client-key", "--certificate-authority", "--tls-server-name", "--insecure-skip-tls-verify", "--raw", "-s"]) {
    for (const form of [`${flag} other`, `${flag}=other`]) {
      guarded(`kubectl ${form} delete pod x`, trusted);
      guarded(`kubectl delete pod x ${form}`, trusted);
      guarded(`kubectl get pods ${form} --context=kind-demo`, trusted);
    }
    if (flag.startsWith("--")) guarded(`kubectl get pods ${flag.slice(0, 2) + flag.slice(2).replaceAll("-", "_")}=other`);
  }
  for (const command of ["kubectl delete pod x -shttps://example.invalid", "kubectl delete pod x -wshttps://example.invalid", "kubectl get pods -Ashttps://example.invalid", "kubectl get pods --profile=cpu --profile-output=README.md", "kubectl get pods --profile_output=README.md"]) guarded(command);
});

test("summaries identify safe target information and namespace provenance", () => {
  const command = "kubectl delete pod x --context=production";
  const reason = assess(`${command} -n payments`, target).reason;
  assert.match(reason, /Operation: delete/);
  assert.match(reason, /Context: "production" \(explicit\)/);
  assert.match(reason, /Namespace: "payments" \(explicit\)/);
  assert.match(reason, /Server: https:\/\/127.0.0.1:6443/);
  assert.match(assess(command, target).reason, /"team" \(kubeconfig default;/);
  assert.match(assess(command, { resolveTarget: (context) => ({ context, server }) }).reason, /"default" \(Kubernetes default\)/);
  assert.match(assess(`${command} -A`, target).reason, /all namespaces/);
  assert.match(assess(command).reason, /Namespace: unresolved.*Server: unresolved/);
  const overridden = assess(`${command} --token=credential-sentinel`, target).reason;
  assert.match(overridden, /Context: unresolved.*overridden or ambiguous/);
  assert.ok(!overridden.includes("credential-sentinel"));
  assert.ok(!assess(command, { resolveTarget: (context) => ({ context, server: `${server}/credential-sentinel` }) }).reason.includes("credential-sentinel"));
  for (const flag of ["-f resources.yaml", "--filename=resources.yaml", "-k overlay", "--kustomize=overlay"]) {
    for (const verb of ["apply", "delete", "replace"]) {
      const manifestCommand = `kubectl ${verb} ${flag} --context=production`;
      assert.match(assess(manifestCommand, target).reason, /Namespace: unresolved \(manifest/);
      assert.match(assess(`${manifestCommand} -n payments`, target).reason, /Namespace: "payments" \(explicit\)/);
    }
  }
});

test("literal pipeline AST tracks quoted pipe characters and source boundaries", () => {
  const source = "'kubectl' get pods | jq '.items | length'";
  const ast = parsePipeline(source);
  assert.equal(ast.type, "Pipeline");
  assert.deepEqual(ast.commands.map((node) => node.argv), [["kubectl", "get", "pods"], ["jq", ".items | length"]]);
  for (const node of ast.commands) for (const word of node.words) assert.ok(source.slice(word.start, word.end).length);
  assert.deepEqual(parsePipeline('kubectl get pods | grep "a\\qb"').commands[1].argv, ["grep", "a\\qb"]);
  for (const command of ["| kubectl get pods", "kubectl get pods |", "kubectl get pods || jq .", "kubectl get pods |& jq .", "kubectl get pods > file", "kubectl get pods\n", "kubectl get $PODS", "kubectl get pods $(echo x)", "kubectl get pods # comment", "kubectl get pods\\", "'kubectl get pods", "KUBECONFIG=x kubectl get pods", "kubectl get pods " + "x".repeat(65536), "kubectl get pods" + " | jq .".repeat(8)]) assert.equal(parsePipeline(command), null, command.slice(0, 100));
});

test("reviewed stdin-only read pipelines add no guard prompt", () => {
  for (const tail of ["jq .", "jq -r '.items[].metadata.name'", "jq -cs --sort-keys '.items | length'", "jq", "grep Running", "grep -ivE 'pending|error'", "head", "head -n 10", "tail --lines=20", "wc -l", "jq -r '.items[].metadata.name' | grep -v test | head -n 5 | wc -l"]) pass(`kubectl get pods | ${tail}`);
  pass("kubectl get pods | jq '.items[0].metadata[\"name\"]'");
});

test("every stage is checked and unsafe shell composition retains a gate", () => {
  for (const tail of ["xargs kubectl delete", "tee /tmp/file", "sort -o /tmp/file", "sh -c 'rm -rf data'", "jq -f filter.jq", "jq --run-tests", "jq . /tmp/file", "grep x /tmp/file", "grep -r x", "head -n 1 /tmp/file", "tail -f", "wc --files0-from=/tmp/file", "wc /tmp/file", "/tmp/jq .", "kubectl delete pod x", "cat"]) guarded(`kubectl get pods | ${tail}`);
  guarded("kubectl delete pod x --context=kind-demo | jq .", trusted);
  for (const command of ["kubectl delete pod x | jq .", "kubectl get pods | kubectl delete pod x", "echo x | kubectl delete pod x", "kubectl get pods | kubectl delete pod x --context=one --context=two"]) assert.equal(guarded(command, trusted).decision, "deny");
  for (const program of ['import "module" as data {search:"/tmp/review"}; data::probe', 'include "module";', 'env', '$ENV', '{x: "kubectl", y: "|"}', 'input_filename']) guarded(`kubectl get pods | jq '${program}'`);
  for (const command of ["kubectl get pods; rm -rf ./data", "kubectl get pods && kubectl delete ns prod", "kubectl get pods\nkubectl delete pod x", "kubectl delete pod $(kubectl get pod -o name) --context=kind-demo", "kubectl get `touch sentinel`", "kubectl get pods &", "(kubectl get pods)", "sudo kubectl get pods", "env KUBECONFIG=other kubectl get pods", "command kubectl get pods", "bash -c 'kubectl delete pod x'", "kubectl get pods ${EXTRA_FLAGS}", "kubectl get pods *", "kube\\\nctl delete pod x"]) guarded(command);
});

test("strict policy rejects typos, wildcards, unsafe endpoints and unbounded exceptions", () => {
  for (const invalid of [null, {}, {schemaVersion:2,trustedTargets:[]}, {schemaVersion:1,trustedTargets:[],typo:true}, {schemaVersion:1,trustedTargets:Array(33).fill({context:"x",server})}, ...["kind-*", "lab?", "[abc]", "x\\y"].map((context)=>({schemaVersion:1,trustedTargets:[{context,server}]})), ...["https://user:secret@example.invalid", "https://example.invalid/?token=x", "file:///tmp/x", "https://*.example.invalid", "https://example.invalid/#x"].map((endpoint)=>({schemaVersion:1,trustedTargets:[{context:"x",server:endpoint}]}))]) assert.throws(()=>validatePolicy(invalid));
  assert.throws(()=>validatePolicy({schemaVersion:1,trustedTargets:[{context:"x",server},{context:"x",server:server+"/"}]}));
  assert.equal(normalizedServer(server), server+"/");
});

test("unverified effective modes cannot silently accept a confirmation", () => {
  const result = assess("kubectl delete pod x --context=production", target);
  for (const mode of ["default", "acceptEdits", "plan", "bypassPermissions", "dontAsk"]) assert.equal(decisionForMode(result,mode).decision,"ask");
  for (const mode of ["auto", "future-mode", undefined]) assert.equal(decisionForMode(result,mode).decision,"deny");
  assert.equal(decisionForMode(null,"auto"),null);
});

class Fixture {
  constructor(t) {
    this.base = realpathSync(mkdtempSync(join(tmpdir(), "kubectl guard ")));
    t.after(() => rmSync(this.base, { recursive: true, force: true }));
    this.plugin = join(this.base, "plugin with spaces"); cpSync(plugin, this.plugin, { recursive: true });
    this.config = join(this.base, "config"); this.bin = join(this.base, "bin"); mkdirSync(this.config); mkdirSync(this.bin);
    symlinkSync(process.execPath, join(this.bin, "node")); this.log = join(this.base, "kubectl-args.json");
    this.stub(`const fs = require('node:fs'); const args=process.argv.slice(2); fs.writeFileSync(process.env.GUARD_TEST_LOG, JSON.stringify(args)); const context=args.find(x=>x.startsWith('--context='))?.slice(10)||'production'; console.log(JSON.stringify({'current-context':context,contexts:[{name:context,context:{cluster:'fixture',namespace:'team'}}],clusters:[{name:'fixture',cluster:{server:${JSON.stringify(server)}}}],users:[{name:'fixture',user:{token:'credential-sentinel'}}]}));`);
    this.env = { ...process.env, PATH: `${this.bin}:/usr/bin:/bin`, KUBECTL_GUARD_CONFIG_DIR: this.config, GUARD_TEST_LOG: this.log }; delete this.env.KUBECTL_GUARD;
    this.registration = JSON.parse(readFileSync(join(this.plugin, "hooks/hooks.json"), "utf8"));
  }
  stub(source) { writeFileSync(join(this.bin, "kubectl"), `#!/usr/bin/env node\n${source}\n`, { mode: 0o755 }); }
  run(command, options = {}) {
    const payload = options.payload ?? JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", permission_mode: options.mode ?? "default", cwd: this.base, session_id:"00000000-0000-4000-8000-000000000001", tool_input: { command } });
    const entry = this.registration.hooks.PreToolUse[0]; assert.equal(entry.matcher,"Bash");
    const result = spawnSync("/bin/bash", ["-c", entry.hooks[0].command], { cwd: this.base, env: { ...this.env, CLAUDE_PLUGIN_ROOT: this.plugin }, input: payload, encoding: "utf8", timeout: 6000 });
    assert.ifError(result.error); assert.equal(result.status, options.status ?? 0, result.stderr);
    assert.ok(!result.stdout.includes("credential-sentinel")); assert.ok(!result.stderr.includes("credential-sentinel"));
    if (result.status !== 0) { assert.equal(result.stdout, ""); assert.match(result.stderr,/blocked/i); return "blocked"; }
    if (!result.stdout) return null;
    const response = JSON.parse(result.stdout).hookSpecificOutput; assert.equal(response.hookEventName,"PreToolUse"); assert.ok(["ask","deny"].includes(response.permissionDecision)); assert.ok(response.permissionDecisionReason);
    return response.permissionDecision;
  }
}

test("registered hook inspects only local configuration and preserves strict defaults", (t) => {
  const f = new Fixture(t);
  assert.equal(f.run("git status"),null); assert.equal(f.run("kubectl get pods | jq ."),null); assert.equal(existsSync(f.log),false);
  assert.equal(f.run("kubectl delete pod x --context=kind-demo"),"ask");
  assert.deepEqual(JSON.parse(readFileSync(f.log)),["config","view","--minify","--output=json","--context=kind-demo"]);
  assert.equal(f.run("kubectl delete pod x"),"deny");
  writeFileSync(join(f.config,"kubectl-guard.json"),JSON.stringify(policy));
  assert.equal(f.run("kubectl delete pod x --context=kind-demo"),null);
  assert.equal(f.run("kubectl get pods; touch sentinel"),"ask"); assert.equal(existsSync(join(f.base,"sentinel")),false);
  assert.equal(f.run("kubectl delete pod x --token=credential-sentinel"),"deny");
  assert.equal(f.run("kubectl delete pod x --context=production",{mode:"auto"}),"deny");
});

test("unavailable, failed, malformed, oversized and timed-out resolution never creates trust", (t) => {
  const f = new Fixture(t); writeFileSync(join(f.config,"kubectl-guard.json"),JSON.stringify(policy));
  for (const source of ["process.exit(1)", "console.log('')", "console.log('{}')", "console.log('null')", "console.log('x'.repeat(140000))", "setTimeout(() => console.log('{}'),10000)"]) { f.stub(source); assert.equal(f.run("kubectl delete pod x --context=kind-demo"),"ask"); }
  rmSync(join(f.bin,"kubectl")); f.env.PATH=f.bin; symlinkSync("/bin/bash",join(f.bin,"bash")); assert.equal(f.run("kubectl delete pod x --context=kind-demo"),"ask");
});

test("disable switches, configuration precedence and user files are preserved", (t) => {
  const f = new Fixture(t); f.env.KUBECTL_GUARD="off";
  assert.equal(f.run("kubectl delete pod x"),null); assert.equal(f.run("ignored",{payload:"invalid JSON"}),null); delete f.env.KUBECTL_GUARD;
  const disabled=join(f.config,"kubectl-guard.disabled"); writeFileSync(disabled,"owned by user\n"); assert.equal(f.run("kubectl delete pod x"),null); assert.equal(readFileSync(disabled,"utf8"),"owned by user\n");
  assert.equal(configurationDirectory({HOME:"/example"}),"/example/.claude");
  assert.equal(configurationDirectory({HOME:"/example",CLAUDE_CONFIG_DIR:"/custom"}),"/custom");
  assert.equal(configurationDirectory({HOME:"/example",CLAUDE_CONFIG_DIR:"/custom",KUBECTL_GUARD_CONFIG_DIR:"/guard"}),"/guard");
  f.env.CLAUDE_CONFIG_DIR=f.config; delete f.env.KUBECTL_GUARD_CONFIG_DIR; assert.equal(f.run("kubectl delete pod x"),null);
});

test("malformed input and policy block; other events are ignored", (t) => {
  const f = new Fixture(t);
  for (const payload of ["invalid","null","[]","{}",'{"tool_name":"Bash","tool_input":{"command":17}}']) f.run("ignored",{payload,status:2});
  assert.equal(f.run("ignored",{payload:JSON.stringify({tool_name:"Read"})}),null);
  assert.equal(f.run("ignored",{payload:JSON.stringify({hook_event_name:"PostToolUse",tool_name:"Bash"})}),null);
  const path=join(f.config,"kubectl-guard.json");
  for (const content of ["bad-json",Buffer.from([0xff,0xfe]),"x".repeat(65537),'{"schemaVersion":1,"trustedTargets":[],"typo":true}']) { writeFileSync(path,content); f.run("kubectl delete pod x --context=kind-demo",{status:2}); }
  rmSync(path); mkdirSync(path); f.run("kubectl delete pod x --context=kind-demo",{status:2}); assert.equal(f.run("kubectl get pods"),null);
});

test("missing Node and failed evaluator use the blocking exit code", (t) => {
  const f=new Fixture(t), runtime=join(f.bin,"node"); rmSync(runtime); symlinkSync("/bin/bash",join(f.bin,"bash")); f.env.PATH=f.bin;
  f.run("kubectl get pods",{status:2}); writeFileSync(runtime,"#!/bin/bash\nexit 1\n",{mode:0o755}); f.run("kubectl get pods",{status:2});
  rmSync(runtime); symlinkSync(process.execPath,runtime); rmSync(join(f.plugin,"scripts/guard.mjs")); f.run("kubectl get pods",{status:2});
  f.env.KUBECTL_GUARD="off"; assert.equal(f.run("kubectl get pods"),null);
});
