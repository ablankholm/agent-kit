import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const binaries = new Set(["kubectl", "kubecolor"]);
const reads = new Set([
  "get", "describe", "logs", "top", "explain", "api-resources", "api-versions", "version", "events",
]);
const localMutations = new Set([
  "delete", "apply", "create", "replace", "patch", "scale", "drain", "cordon", "uncordon",
  "taint", "rollout", "set", "autoscale", "annotate", "label", "run", "expose", "certificate",
]);
export const localDefaults = [
  "docker-desktop", "minikube", "kind-*", "k3d-*", "colima*", "orbstack*",
  "rancher-desktop", "k3s-default", "microk8s",
];
const valueFlags = new Set(["-n", "--namespace", "--context", "--request-timeout", "--cache-dir", "-v", "--v", "--vmodule"]);
const boolFlags = new Set(["--match-server-version", "--warnings-as-errors"]);
const targetFlags = /^--(?:kubeconfig|kuberc|server|cluster|user|as|as-group|as-uid|token|username|password|client-certificate|client-key|certificate-authority|tls-server-name|insecure-skip-tls-verify|raw)(?:=|$)/;
const guarded = (word) => binaries.has(basename(word));
const createBuiltins = new Set([
  "clusterrole", "clusterrolebinding", "configmap", "cronjob", "deployment", "ingress", "job",
  "namespace", "poddisruptionbudget", "priorityclass", "quota", "role", "rolebinding", "serviceaccount", "token",
]);

function normalizeFlag(arg) {
  if (!arg.startsWith("--")) return arg;
  const equals = arg.indexOf("=");
  const end = equals < 0 ? arg.length : equals;
  // kubectl's pflag normalizer accepts underscores in flag names, not their values.
  return arg.slice(0, end).replaceAll("_", "-") + arg.slice(end);
}

// A narrow literal shell grammar, not a shell interpreter. Unsupported syntax
// cannot qualify for the no-extra-prompt path. Quotes are removed without eval.
function literalWords(command) {
  if (/[\r\n\x00]/.test(command)) return null;
  const words = [];
  let word = "", quote = "", started = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === "'") quote = "";
      else word += ch;
    } else if (ch === "\\") {
      const next = command[++i];
      if (next === undefined) return null;
      if (quote === '"' && !['$', '`', '"', '\\'].includes(next)) word += "\\";
      word += next;
      started = true;
    } else if (ch === quote && quote) {
      quote = "";
    } else if (ch === "$" || ch === "`") {
      return null;
    } else if (quote) {
      word += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
    } else if ("|&;<>()[{}]*?!~".includes(ch) || (ch === "#" && !started)) {
      return null;
    } else if (ch === " " || ch === "\t") {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += ch;
      started = true;
    }
  }
  if (quote) return null;
  if (started) words.push(word);
  return words;
}

// This fallback intentionally errs toward a prompt, including text inside wrappers.
// It is not an attempt to discover aliases, encoded programs, or dynamic binaries.
function mentionsKubectl(command) {
  return /kubectl|kubecolor/.test(command.replace(/[\\'"\r\n]/g, ""));
}

export function parseLocalPatterns(content) {
  if (content.includes("\0")) throw new Error("Local-context configuration contains a NUL byte.");
  return content.split(/\r?\n/).map((line) => line.split("#")[0].trim()).filter(Boolean);
}

function matches(context, pattern) {
  // Bounded wildcard matching without regex backtracking. The caller also limits
  // pattern count/length and context length so the host hook timeout stays distant.
  const text = [...context], glob = [...pattern];
  let i = 0, j = 0, star = -1, retry = 0;
  while (i < text.length) {
    if (glob[j] === "?" || glob[j] === text[i]) { i++; j++; }
    else if (glob[j] === "*") { star = j++; retry = i; }
    else if (star >= 0) { j = star + 1; i = ++retry; }
    else return false;
  }
  while (glob[j] === "*") j++;
  return j === glob.length;
}

// Return a reason to ask, or null to leave the host's existing permissions alone.
// The guard never grants permission to the Bash call, including harmless calls.
export function assess(command, { getCurrentContext = () => "", getLocalPatterns = () => [] } = {}) {
  const words = literalWords(command);
  if (!words || !words.length || !guarded(words[0])) {
    return mentionsKubectl(command) ? "Complex or indirect kubectl command. Confirm its full shell behavior and target." : null;
  }
  const args = words.slice(1).map(normalizeFlag);
  let context, contextCount = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") return "Arguments after -- are outside the guard's literal command checks. Confirm this kubectl command.";
    if (/^--profile(?:-output)?(?:=|$)/.test(arg)) {
      return "kubectl profiling can create or overwrite local files. Confirm before running.";
    }
    if (/^--edit(?:=|$)/.test(arg) || /^-e/.test(arg)) {
      return "kubectl may launch an external editor. Confirm its local effects as well as the cluster target.";
    }
    if (targetFlags.test(arg) || /^-s/.test(arg)) {
      return "kubectl uses a connection, authentication, configuration, or raw-endpoint override. Confirm the effective target.";
    }
    // A boolean shorthand can be bundled with -s (for example -wsSERVER).
    // Only familiar value-taking shorthands can safely consume an attached value.
    if (/^-[^-].+/.test(arg) && !/^-[nofklvc]/.test(arg)) {
      return "kubectl uses bundled or unfamiliar shorthand flags. Confirm its effective target.";
    }
    if (arg === "--context" || arg.startsWith("--context=")) {
      // pflag accepts flag-looking values. In `apply -f --context=kind-demo`,
      // the second token is a filename, not a selector. Ambiguity must not create trust.
      if (i > 0 && args[i - 1].startsWith("-") && !args[i - 1].includes("=")) {
        return "A context-looking token may be the previous flag's value. Confirm the effective target.";
      }
      contextCount++;
      context = arg === "--context" ? args[++i] : arg.slice("--context=".length);
      if (!context || context.startsWith("-") || /[\x00-\x1f\x7f]/.test(context)) return "kubectl context is missing or ambiguous. Confirm the target.";
    }
  }
  if (contextCount > 1) return "kubectl repeats its context selector. Confirm which target is intended.";

  let index = 0;
  while (args[index]?.startsWith("-")) {
    const flag = args[index];
    const key = flag.split("=")[0];
    if (valueFlags.has(key)) {
      if (!flag.includes("=")) {
        if (!args[index + 1] || args[index + 1].startsWith("-")) return "kubectl has a missing flag value. Confirm this command.";
        index++;
      } else if (!flag.slice(flag.indexOf("=") + 1)) return "kubectl has an empty flag value. Confirm this command.";
    } else if (!boolFlags.has(key) && !/^-n[^-].*/.test(flag)) {
      return "kubectl has an unrecognized leading flag. Confirm its operation.";
    }
    index++;
  }
  const verb = args[index];
  if (reads.has(verb)) return null;
  // cluster-info dump can write files; only its argument-free form is a simple read.
  if (verb === "cluster-info" && index === args.length - 1) return null;
  if (!localMutations.has(verb)) return "kubectl operation is outside the recognized read and local-mutation lists. Confirm before running.";
  if (verb === "apply" && args.includes("edit-last-applied")) return "kubectl may launch an external editor. Confirm before running.";
  if (verb === "create") {
    const subcommand = args[index + 1], child = args[index + 2];
    const builtin = createBuiltins.has(subcommand)
      || (subcommand === "secret" && ["generic", "tls", "docker-registry"].includes(child))
      || (["service", "svc"].includes(subcommand) && ["clusterip", "externalname", "loadbalancer", "nodeport"].includes(child));
    if (!builtin) return "kubectl create may dispatch an external plugin or has an unrecognized form. Confirm before running.";
  }

  const patterns = getLocalPatterns();
  if (patterns.length > 128 || patterns.some((pattern) => pattern.length > 256)) {
    return "Local-context patterns exceed the guard's bounded matching limits. Simplify them or confirm this command.";
  }
  if (patterns.some((pattern) => /[\[\]\\]/.test(pattern))) {
    return "Local-context patterns support only * and ? wildcards. Update unsupported patterns or confirm this command.";
  }
  const effectiveContext = context ?? getCurrentContext();
  if (typeof effectiveContext !== "string" || !effectiveContext || effectiveContext.length > 512 || /[\x00-\x1f\x7f]/.test(effectiveContext)) {
    return "Could not resolve a single kubectl context. Confirm the target before mutating it.";
  }
  if ([...localDefaults, ...patterns].some((pattern) => matches(effectiveContext, pattern))) return null;
  return "kubectl may change a cluster that is not designated local. Confirm the target and operation.";
}

export function configurationDirectory(env) {
  const directory = env.KUBECTL_GUARD_CONFIG_DIR || env.CLAUDE_CONFIG_DIR || (env.HOME && join(env.HOME, ".claude"));
  if (!directory) throw new Error("Cannot locate user configuration.");
  return directory;
}

function customPatterns(directory) {
  let bytes;
  try {
    bytes = readFileSync(join(directory, "kubectl-guard-local-contexts"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error("Cannot read local-context configuration.");
  }
  if (bytes.length > 65536) throw new Error("Local-context configuration exceeds 64 KiB.");
  return parseLocalPatterns(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function currentContext(cwd) {
  // config current-context reads kubeconfig only; no API or credential execution.
  const result = spawnSync("kubectl", ["config", "current-context"], {
    cwd, encoding: "utf8", timeout: 1500, killSignal: "SIGKILL", maxBuffer: 65536,
    stdio: ["ignore", "pipe", "pipe"], shell: false,
  });
  return result.error || result.status !== 0 ? "" : result.stdout.trim();
}

function main() {
  if (Number(process.versions.node.split(".")[0]) < 18) throw new Error("Node.js 18+ is required.");
  const raw = readFileSync(0, "utf8");
  if (raw.length > 1048576) throw new Error("Hook input exceeds 1 MiB.");
  const input = JSON.parse(raw);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid hook payload.");
  if (input.tool_name && input.tool_name !== "Bash") return;
  if (input.hook_event_name && input.hook_event_name !== "PreToolUse") return;
  if (input.tool_name !== "Bash" || typeof input.tool_input?.command !== "string") throw new Error("Expected a Bash command payload.");
  const reason = assess(input.tool_input.command, {
    getCurrentContext: () => currentContext(typeof input.cwd === "string" ? input.cwd : process.cwd()),
    getLocalPatterns: () => customPatterns(configurationDirectory(process.env)),
  });
  if (reason) {
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason,
    } })}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch {
    // Do not echo command text, arguments, credentials, or malformed JSON to logs.
    console.error("kubectl-guard: invalid input, unreadable configuration, or runtime failure. Check the plugin README. Command blocked.");
    process.exitCode = 2;
  }
}
