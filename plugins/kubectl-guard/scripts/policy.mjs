import { readFileSync } from "node:fs";
import { join } from "node:path";

export function configurationDirectory(env = process.env) {
  const directory = env.KUBECTL_GUARD_CONFIG_DIR || env.CLAUDE_CONFIG_DIR || (env.HOME && join(env.HOME, ".claude"));
  if (!directory) throw new Error("Cannot locate guard configuration.");
  return directory;
}

export function normalizedServer(value) {
  if (typeof value !== "string" || value.length > 2048 || /[\x00-\x20\x7f*?]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}

export function validatePolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)
      || Object.keys(policy).some((key) => !["schemaVersion", "trustedTargets"].includes(key))
      || policy.schemaVersion !== 1 || !Array.isArray(policy.trustedTargets) || policy.trustedTargets.length > 32) {
    throw new Error("kubectl-guard.json must contain schemaVersion: 1 and at most 32 trustedTargets.");
  }
  const seen = new Set();
  const trustedTargets = policy.trustedTargets.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
        || Object.keys(entry).length !== 2 || !Object.hasOwn(entry, "context") || !Object.hasOwn(entry, "server")
        || typeof entry.context !== "string" || !entry.context || entry.context.length > 512
        || entry.context.startsWith("-") || /[\x00-\x1f\x7f*?\[\]\\]/.test(entry.context)) {
      throw new Error("Each trusted target must contain an exact context and server, without wildcards.");
    }
    const server = normalizedServer(entry.server);
    if (!server) throw new Error("Trusted servers must be HTTP(S) URLs without credentials, queries, fragments, or wildcards.");
    const key = JSON.stringify([entry.context, server]);
    if (seen.has(key)) throw new Error("Duplicate trusted target in kubectl-guard.json.");
    seen.add(key);
    return { context: entry.context, server };
  });
  return { schemaVersion: 1, trustedTargets };
}

export function loadPolicy(directory) {
  let bytes;
  try { bytes = readFileSync(join(directory, "kubectl-guard.json")); }
  catch (error) {
    if (error.code === "ENOENT") return { schemaVersion: 1, trustedTargets: [] };
    throw new Error("Cannot read kubectl-guard.json. Repair its file permissions.");
  }
  if (bytes.length > 65536) throw new Error("kubectl-guard.json exceeds 64 KiB.");
  let policy;
  try { policy = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("kubectl-guard.json must be valid UTF-8 JSON."); }
  return validatePolicy(policy);
}
