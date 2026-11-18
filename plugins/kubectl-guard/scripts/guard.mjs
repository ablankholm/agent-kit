import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configurationDirectory, loadPolicy, normalizedServer } from "./policy.mjs";
import { mentionsKubectl, parsePipeline, safeFilter } from "./shell.mjs";
import { writeObservation } from "./observations.mjs";
export { configurationDirectory } from "./policy.mjs";

const binaries = new Set(["kubectl", "kubecolor"]);
const reads = new Set(["get", "describe", "logs", "top", "explain", "api-resources", "api-versions", "version", "events"]);
const mutations = new Set(["delete", "apply", "create", "replace", "patch", "edit", "scale", "drain", "cordon", "uncordon", "taint", "rollout", "set", "autoscale", "annotate", "label", "run", "expose", "certificate"]);
const valueFlags = new Set(["-n", "--namespace", "--context", "--request-timeout", "--cache-dir", "-v", "--v", "--vmodule", "-s", "--server", "--kubeconfig", "--kuberc", "--cluster", "--user", "--as", "--as-group", "--as-uid", "--token", "--username", "--password", "--client-certificate", "--client-key", "--certificate-authority", "--tls-server-name"]);
const boolFlags = new Set(["--match-server-version", "--warnings-as-errors", "--insecure-skip-tls-verify"]);
const targetFlags = /^--(?:kubeconfig|kuberc|server|cluster|user|as|as-group|as-uid|token|username|password|client-certificate|client-key|certificate-authority|tls-server-name|insecure-skip-tls-verify|raw)(?:=|$)/;
const createBuiltins = new Set(["clusterrole", "clusterrolebinding", "configmap", "cronjob", "deployment", "ingress", "job", "namespace", "poddisruptionbudget", "priorityclass", "quota", "role", "rolebinding", "serviceaccount", "token"]);
const guarded = (word) => binaries.has(basename(word));
const literalName = (name) => typeof name === "string" && name.length > 0 && name.length <= 512 && !name.startsWith("-") && !/[\x00-\x1f\x7f]/.test(name);
const safeName = (name) => literalName(name) ? JSON.stringify(name) : "unresolved";

function normalizeFlag(arg) {
  if (!arg.startsWith("--")) return arg;
  const equals = arg.indexOf("=");
  const end = equals < 0 ? arg.length : equals;
  return arg.slice(0, end).replaceAll("_", "-") + arg.slice(end);
}

function verbIndex(args) {
  let i = 0;
  while (args[i]?.startsWith("-")) {
    const flag = args[i], key = flag.split("=")[0];
    if (valueFlags.has(key)) {
      if (!flag.includes("=")) {
        if (!args[i + 1] || args[i + 1].startsWith("-")) return -1;
        i++;
      } else if (!flag.slice(flag.indexOf("=") + 1)) return -1;
    } else if (!boolFlags.has(key) && !/^-n[^-].*/.test(flag)) return -1;
    i++;
  }
  return i;
}

function analyze(argv) {
  const args = argv.slice(1).map(normalizeFlag), index = verbIndex(args), verb = args[index];
  const kind = reads.has(verb) || (verb === "cluster-info" && index === args.length - 1) ? "read" : mutations.has(verb) ? "mutation" : "other";
  const result = { kind, operation: reads.has(verb) || mutations.has(verb) || ["exec", "attach", "cp", "proxy", "port-forward", "debug", "diff", "config", "cluster-info"].includes(verb) ? verb : "unrecognized operation", context: undefined, namespace: undefined, allNamespaces: false, issue: null, targetIssue: false, exemptible: kind === "mutation" && verb !== "edit" };
  const issue = (message, target = false) => {
    if (!result.issue || target) result.issue = message;
    result.targetIssue ||= target;
  };
  let contexts = 0, namespaces = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (/^(?:--filename|--kustomize)(?:=|$)/.test(arg) || /^-[fk]/.test(arg)) result.manifestNamespace = true;
    if (arg === "--") { issue("Arguments after -- require manual inspection.", true); break; }
    if (targetFlags.test(arg) || /^-s/.test(arg)) issue("Connection/authentication/configuration overrides make the target unresolved.", true);
    if (/^--profile(?:-output)?(?:=|$)/.test(arg)) issue("Profiling can overwrite local files.");
    if (/^--edit(?:=|$)/.test(arg) || /^-e/.test(arg)) issue("An external editor can execute local code.");
    if (/^-[^-].+/.test(arg) && !/^-[nofklvc]/.test(arg)) issue("Bundled or unfamiliar shorthand flags make the target ambiguous.", true);
    const contextFlag = arg === "--context" || arg.startsWith("--context=");
    const namespaceFlag = arg === "-n" || arg === "--namespace" || arg.startsWith("--namespace=") || /^-n.+/.test(arg);
    if (contextFlag || namespaceFlag) {
      if (i > 0 && args[i - 1].startsWith("-") && !args[i - 1].includes("=")) issue("A target-looking token may be the previous flag's value.", true);
      let value;
      if (arg.includes("=")) value = arg.slice(arg.indexOf("=") + 1);
      else if (arg.startsWith("-n") && arg.length > 2) value = arg.slice(2);
      else value = args[++i];
      if (!literalName(value)) issue("A context or namespace value is missing or invalid.", true);
      if (contextFlag) { result.context = value; contexts++; }
      else { result.namespace = value; namespaces++; }
    }
    if (arg === "-A" || arg === "--all-namespaces" || arg === "--all-namespaces=true") result.allNamespaces = true;
    else if (arg.startsWith("--all-namespaces=") && arg !== "--all-namespaces=false") issue("An all-namespaces flag has an unrecognized value.", true);
  }
  if (contexts > 1 || namespaces > 1 || (result.allNamespaces && namespaces)) issue("Repeated or conflicting context/namespace selectors are ambiguous.", true);
  if (verb === "apply" && args.includes("edit-last-applied")) issue("An external editor can execute local code.");
  if (verb === "create") {
    const subcommand = args[index + 1], child = args[index + 2];
    const builtin = createBuiltins.has(subcommand) || (subcommand === "secret" && ["generic", "tls", "docker-registry"].includes(child)) || (["service", "svc"].includes(subcommand) && ["clusterip", "externalname", "loadbalancer", "nodeport"].includes(child));
    if (!builtin) issue("This create form may dispatch an external plugin or is unrecognized.");
  }
  if (result.issue) result.exemptible = false;
  return result;
}

function targetSummary(info, target) {
  const context = info.targetIssue ? undefined : info.context ?? target?.context;
  let namespace = "unresolved";
  if (!info.targetIssue) {
    if (info.allNamespaces) namespace = "all namespaces (explicit)";
    else if (info.namespace) namespace = `${safeName(info.namespace)} (explicit)`;
    else if (info.manifestNamespace) namespace = "unresolved (manifest may select multiple namespaces or cluster-scoped resources)";
    else if (target?.namespace) namespace = `${safeName(target.namespace)} (kubeconfig default; does not constrain cluster-scoped resources)`;
    else if (target) namespace = '"default" (Kubernetes default)';
  }
  const server = !info.targetIssue && normalizedServer(target?.server);
  // Only origin is displayed: a proxy server URL path can itself contain credentials.
  return `Operation: ${info.operation}. Context: ${safeName(context)} (${info.targetIssue ? "overridden or ambiguous" : info.context ? "explicit" : "current; not pinned"}). Namespace: ${namespace}. Server: ${server ? new URL(server).origin : "unresolved"}.`;
}

export function assess(command, { resolveTarget = () => null, getPolicy = () => ({ schemaVersion: 1, trustedTargets: [] }) } = {}) {
  const ast = parsePipeline(command);
  if (ast?.commands.length > 1) {
    for (const node of ast.commands) {
      if (!guarded(node.argv[0])) continue;
      const stage = analyze(node.argv);
      if (stage.kind === "mutation" && (!literalName(stage.context) || stage.targetIssue)) {
        return { decision: "deny", reason: `${targetSummary(stage, null)} ${stage.issue ?? "A cluster mutation requires an explicit --context."} Run this mutation separately with one unambiguous context.` };
      }
    }
  }
  if (!ast || !guarded(ast.commands[0].argv[0])) {
    return mentionsKubectl(command) ? { decision: "ask", reason: "Complex or indirect kubectl command. Target unresolved; inspect the whole shell command before approving." } : null;
  }
  const info = analyze(ast.commands[0].argv);
  if (ast.commands.length > 1) {
    if (info.kind === "read" && !info.issue && ast.commands.slice(1).every((node) => safeFilter(node.argv))) return null;
    return { decision: "ask", reason: "This pipeline is outside the reviewed read-only forms. Run mutations separately with an explicit --context. Target unresolved." };
  }
  if (info.kind === "read" && !info.issue) return null;
  const target = info.targetIssue ? null : resolveTarget(info.context);
  // A resolver returning a different context must not lend its server to an exemption.
  const resolved = target && literalName(target.context) && (!info.context || target.context === info.context) ? target : null;
  const summary = targetSummary(info, resolved);
  if (info.kind === "mutation" && (!literalName(info.context) || info.targetIssue)) {
    return { decision: "deny", reason: `${summary} ${info.issue ?? "A cluster mutation requires an explicit --context."} Select one unambiguous context and retry.` };
  }
  if (info.kind === "mutation") {
    const policy = getPolicy();
    const server = normalizedServer(resolved?.server);
    if (info.exemptible && server && policy.trustedTargets.some((entry) => entry.context === info.context && normalizedServer(entry.server) === server)) return null;
  }
  return { decision: "ask", reason: `${summary} ${info.issue ?? (info.kind === "mutation" ? "Confirm this cluster mutation; no exact trusted-target exception applies." : "This operation has unknown or external effects and requires confirmation.")}` };
}

export function decisionForMode(result, mode) {
  if (result?.decision === "ask" && !["default", "acceptEdits", "plan", "bypassPermissions", "dontAsk"].includes(mode)) {
    return { decision: "deny", reason: `${result.reason} Confirmation handling is unverified for this effective permission mode. Switch to default/manual mode and retry.` };
  }
  return result;
}

export function inspectTarget(context, cwd) {
  if (context !== undefined && !literalName(context)) return null;
  const args = ["config", "view", "--minify", "--output=json"];
  if (context) args.push(`--context=${context}`);
  const result = spawnSync("kubectl", args, { cwd, encoding: "utf8", timeout: 1500, killSignal: "SIGKILL", maxBuffer: 131072, stdio: ["ignore", "pipe", "pipe"], shell: false });
  if (result.error || result.status !== 0) return null;
  try {
    const data = JSON.parse(result.stdout), name = context ?? data["current-context"];
    if (!literalName(name) || !Array.isArray(data.contexts) || !Array.isArray(data.clusters)) return null;
    const selected = data.contexts.filter((entry) => entry.name === name);
    if (selected.length !== 1 || typeof selected[0].context?.cluster !== "string") return null;
    const clusters = data.clusters.filter((entry) => entry.name === selected[0].context.cluster);
    if (clusters.length !== 1) return null;
    const namespace = selected[0].context.namespace;
    if (namespace !== undefined && !literalName(namespace)) return null;
    return { context: name, server: normalizedServer(clusters[0].cluster?.server), namespace };
  } catch { return null; }
}

function main() {
  if (Number(process.versions.node.split(".")[0]) < 18) throw new Error("Node.js 18+ is required.");
  const raw = readFileSync(0, "utf8");
  if (raw.length > 1048576) throw new Error("Hook input exceeds 1 MiB.");
  let input;
  try { input = JSON.parse(raw); } catch { throw new Error("Hook input must be valid JSON."); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid hook payload.");
  if (input.tool_name && input.tool_name !== "Bash") return;
  if (input.hook_event_name && input.hook_event_name !== "PreToolUse") return;
  if (input.tool_name !== "Bash" || typeof input.tool_input?.command !== "string") throw new Error("Expected a Bash command payload.");
  const configDir = configurationDirectory(), cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const result = decisionForMode(assess(input.tool_input.command, { resolveTarget: (context) => inspectTarget(context, cwd), getPolicy: () => loadPolicy(configDir) }), input.permission_mode);
  // Observation is best-effort diagnostics and can never soften a decision.
  try { writeObservation({ sessionId: input.session_id, cwd, permissionMode: input.permission_mode, outcome: result?.decision ?? "pass", configDir }); } catch { /* Doctor will report absent evidence. */ }
  if (result) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: result.decision, permissionDecisionReason: result.reason } })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    // All expected error messages are fixed text. Never echo JSON or command args.
    const diagnostic = /^(?:kubectl-guard\.json|Cannot (?:locate|read)|Each trusted target|Trusted servers|Duplicate trusted target|Node\.js|Hook input|Invalid hook payload|Expected a Bash)/.test(error.message) ? error.message : "Input, policy, or runtime failure. Run kubectl-guard doctor.";
    console.error(`kubectl-guard: ${diagnostic} Command blocked.`);
    process.exitCode = 2;
  }
}
