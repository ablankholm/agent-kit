import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assess } from "./guard.mjs";
import { configurationDirectory, loadPolicy, normalizedServer } from "./policy.mjs";
import { pluginDirectory, pluginIdentity, readObservation, validSessionId } from "./observations.mjs";

const pluginId = "kubectl-guard@ablankholm";
const canonical = (path) => { try { return realpathSync(path); } catch { return resolve(path); } };

function projectDirectory(cwd) {
  let directory = resolve(cwd);
  while (true) {
    if (existsSync(join(directory, ".git"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return resolve(cwd);
    directory = parent;
  }
}

function readSettings(path) {
  try {
    const info = statSync(path);
    if (!info.isFile() || info.size > 1048576) throw new Error("Invalid settings file");
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Settings must be an object");
    const object = (entry) => entry && typeof entry === "object" && !Array.isArray(entry);
    if ((value.disableAllHooks !== undefined && typeof value.disableAllHooks !== "boolean")
      || (value.enabledPlugins !== undefined && (!object(value.enabledPlugins)
        || (value.enabledPlugins[pluginId] !== undefined && typeof value.enabledPlugins[pluginId] !== "boolean")))
      || (value.hooks !== undefined && !object(value.hooks))) throw new Error("Invalid hook settings");
    return { value };
  } catch (error) { return error.code === "ENOENT" ? { value: {} } : { error: true }; }
}

function settingsSummary({ env, cwd }) {
  const userDirectory = env.CLAUDE_CONFIG_DIR || (env.HOME && join(env.HOME, ".claude"));
  const project = projectDirectory(cwd);
  const sources = [
    ...(userDirectory ? [{ scope: "user", path: join(userDirectory, "settings.json") }] : []),
    { scope: "project", path: join(project, ".claude/settings.json") },
    { scope: "local", path: join(project, ".claude/settings.local.json") },
  ];
  const errors = [], registrationScopes = [];
  let disableAllHooks = false, pluginEnabled;
  for (const source of sources) {
    const settings = readSettings(source.path);
    if (settings.error) { errors.push(source.scope); continue; }
    if (typeof settings.value.disableAllHooks === "boolean") disableAllHooks = settings.value.disableAllHooks;
    if (typeof settings.value.enabledPlugins?.[pluginId] === "boolean") pluginEnabled = settings.value.enabledPlugins[pluginId];
    for (const entries of Object.values(settings.value.hooks || {})) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!Array.isArray(entry?.hooks)) continue;
        for (const hook of entry.hooks) {
          if (typeof hook?.command !== "string") continue;
          if (/kubectl-guard(?:\.sh|\/scripts\/)/.test(hook.command)) registrationScopes.push(source.scope);
        }
      }
    }
  }
  return { project, errors, registrationScopes, disableAllHooks, pluginEnabled };
}

export function selfCheck() {
  const server = normalizedServer("https://127.0.0.1:6443");
  const resolveTarget = (context) => ({ context: context || "production", server, namespace: "default" });
  const strict = { resolveTarget, getPolicy: () => ({ schemaVersion: 1, trustedTargets: [] }) };
  const trusted = { ...strict, getPolicy: () => ({ schemaVersion: 1, trustedTargets: [{ context: "lab", server }] }) };
  const cases = [
    ["unrelated command", "git status", strict, null],
    ["simple read", "kubectl get pods", strict, null],
    ["read pipeline", "kubectl get pods -o json | jq '.items | length'", strict, null],
    ["ambient mutation", "kubectl delete pod example", strict, "deny"],
    ["explicit mutation", "kubectl delete pod example --context=production", strict, "ask"],
    ["local-looking name", "kubectl delete pod example --context=kind-demo", strict, "ask"],
    ["exact trust pair", "kubectl delete pod example --context=lab", trusted, null],
    ["changed endpoint", "kubectl delete pod example --context=lab", { ...trusted, resolveTarget: () => ({ context: "lab", server: "https://different.invalid", namespace: "default" }) }, "ask"],
    ["unsafe composition", "kubectl get pods; rm -rf ./data", strict, "guarded"],
  ];
  const failures = [];
  for (const [name, command, options, expected] of cases) {
    try {
      const actual = assess(command, options)?.decision ?? null;
      if (expected === "guarded" ? !["ask", "deny"].includes(actual) : actual !== expected) failures.push(name);
    } catch { failures.push(name); }
  }
  return { total: cases.length, passed: cases.length - failures.length, failures };
}

// Static installation checks and synthetic evaluation are separate from session
// evidence. None of these checks executes a proposed command or contacts Kubernetes.
export function runDoctor({ env = process.env, cwd = process.cwd(), pluginRoot = pluginDirectory, sessionId, execute = spawnSync, now = Date.now() } = {}) {
  const checks = [];
  const check = (name, status, detail) => checks.push({ name, status, detail });
  let identity, configDir;
  try { identity = pluginIdentity(pluginRoot); }
  catch { check("plugin files", "fail", "Plugin identity or files are invalid. Reinstall the published plugin."); }
  check("Node", Number(process.versions.node.split(".")[0]) >= 18 ? "pass" : "fail", `Node ${process.versions.node}; version 18+ is required.`);
  const invoke = (command, args, timeout = 3000) => {
    try { return execute(command, args, { cwd, env, encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: 1048576, shell: false, stdio: ["ignore", "pipe", "pipe"] }); }
    catch { return { error: true }; }
  };
  const bash = invoke("bash", ["--version"], 1000);
  check("Bash", !bash.error && bash.status === 0 ? "pass" : "fail", !bash.error && bash.status === 0 ? "Bash is available on PATH." : "Bash could not run. Repair PATH or install Bash.");

  try {
    configDir = configurationDirectory(env);
    const policy = loadPolicy(configDir);
    check("policy", "pass", policy.trustedTargets.length ? `Valid policy with ${policy.trustedTargets.length} explicit trusted target(s).` : "Strict defaults: no mutation exceptions configured.");
  } catch { check("policy", "fail", "Policy is unreadable or invalid. Check kubectl-guard.json against the README schema."); }
  let flagFile = false;
  try { flagFile = configDir && statSync(join(configDir, "kubectl-guard.disabled")).isFile(); } catch { /* A missing flag is the usual case. */ }
  const disabled = env.KUBECTL_GUARD === "off" || flagFile;
  const skipped = ["CLAUDE_CODE_SAFE_MODE", "CLAUDE_CODE_SIMPLE"].some((name) => ["1", "true", "yes", "on"].includes(String(env[name] ?? "").trim().toLowerCase()));
  check("controls", disabled || skipped ? "fail" : "pass", disabled ? "The guard is disabled by its environment or flag-file control." : skipped ? "Claude safe/bare mode can skip hooks. Start a normal session." : "No guard disable control or safe/bare-mode marker is set.");

  const settings = settingsSummary({ env, cwd });
  check("settings", settings.errors.length || settings.disableAllHooks || settings.pluginEnabled === false ? "fail" : "pass",
    settings.errors.length ? `Unreadable or malformed ${settings.errors.join(", ")} settings. Inspect those files before relying on hooks.`
      : settings.disableAllHooks ? "Inspected settings set disableAllHooks. Check /status and enable hooks deliberately."
        : settings.pluginEnabled === false ? "Inspected settings disable this plugin. Enable it and restart Claude."
          : "Inspected user/project/local files contain no effective hook or plugin disable setting.");
  const duplicateCount = settings.registrationScopes.length;
  check("direct registration", duplicateCount ? "fail" : "pass", duplicateCount
    ? `${duplicateCount} direct guard registration(s) found in ${[...new Set(settings.registrationScopes)].join(", ")} settings. Remove only the manual guard entries after backing up settings; keep the plugin.`
    : "No duplicate direct guard registration found in inspected settings.");

  const installed = invoke("claude", ["plugin", "list", "--json"]);
  let installationDisabled = false;
  try {
    if (installed.error || installed.status !== 0) throw new Error("Claude listing unavailable");
    const entries = JSON.parse(installed.stdout);
    if (!Array.isArray(entries)) throw new Error("Invalid plugin list");
    const matching = entries.filter((entry) => entry?.id === pluginId
      && (!entry.projectPath || canonical(entry.projectPath) === canonical(settings.project) || canonical(entry.projectPath) === canonical(cwd)));
    const enabled = matching.filter((entry) => entry.enabled === true);
    if (!matching.length) check("installation", "fail", "No installation is listed for this project. Install kubectl-guard@ablankholm, or confirm a deliberate session-only --plugin-dir load.");
    else if (!enabled.length) {
      installationDisabled = true;
      check("installation", "fail", "The listed guard installation is disabled. Enable it and restart Claude.");
    }
    else if (enabled.some((entry) => entry.errors?.length)) check("installation", "fail", "Claude reports plugin load errors. Inspect /plugin and repair the installation.");
    else if (enabled.length > 1) check("installation", "warn", "Multiple relevant enabled guard installations are listed. Inspect /plugin and /hooks for competing scopes.");
    else if (!identity || enabled[0].version !== identity.version || typeof enabled[0].installPath !== "string" || canonical(enabled[0].installPath) !== canonical(pluginRoot)) {
      check("installation", "warn", "The enabled installed copy differs from this checker. Self-check results apply only to this running copy; use the installed doctor after updating.");
    } else check("installation", "pass", `Claude lists this ${identity.version} copy as installed and enabled.`);
  } catch { check("installation", "fail", "Claude plugin listing is unavailable or invalid. Installation state is unknown; check Claude and its PATH."); }

  const selfTests = selfCheck();
  check("self-checks", selfTests.failures.length ? "fail" : "pass", `${selfTests.passed}/${selfTests.total} synthetic evaluator checks passed. No proposed command or cluster operation was executed.`);
  const sessionObservation = disabled || skipped || settings.disableAllHooks || settings.pluginEnabled === false || installationDisabled
    ? { status: "disabled", detail: "Hooks or this guard are currently disabled. An older receipt cannot verify current invocation." }
    : configDir ? readObservation({ sessionId, cwd, configDir, pluginRoot, now })
      : { status: "invalid", detail: "No valid configuration directory is available for observation checks." };
  const failures = checks.filter((entry) => entry.status === "fail").length;
  return {
    schemaVersion: 1, plugin: { id: pluginId, version: identity?.version || "unknown" },
    checks, selfTests, sessionObservation, failures,
    limitations: [
      "Installation and self-check results do not establish that a running Claude session loaded the hook.",
      "A receipt shows PreToolUse invocation only. It is user-local diagnostic data, not proof of host enforcement or tamper resistance.",
      "Static settings inspection covers user/project/local files. Session-only flags and remote/managed settings may differ; use /status and the documented host test matrix.",
    ],
  };
}

function main() {
  let json = false, sessionId;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") json = true;
    else if (args[i] === "--session-id" && args[i + 1] && validSessionId(args[i + 1])) sessionId = args[++i];
    else if (args[i] === "--help") {
      console.log("Usage: node doctor.mjs [--json] [--session-id UUID]\nRead-only installation checks and synthetic tests. Session evidence requires a matching recent hook receipt.");
      return;
    } else {
      console.error("Invalid doctor arguments. Use --json and optionally --session-id UUID.");
      process.exitCode = 2;
      return;
    }
  }
  const report = runDoctor({ sessionId });
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`kubectl-guard ${report.plugin.version} diagnostics`);
    for (const check of report.checks) console.log(`${check.status.toUpperCase()}: ${check.name}: ${check.detail}`);
    console.log(`SESSION ${report.sessionObservation.status}: ${report.sessionObservation.detail}`);
    if (report.sessionObservation.observedAt) console.log(`Observed ${report.sessionObservation.observedAt}; effective permission mode ${report.sessionObservation.permissionMode}.`);
    for (const limit of report.limitations) console.log(limit);
  }
  process.exitCode = report.failures ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
