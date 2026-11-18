import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, opendirSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const pluginDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const validSessionId = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const day = 24 * 60 * 60 * 1000;
const freshFor = 5 * 60 * 1000;
const canonical = (path) => { try { return realpathSync(path); } catch { return resolve(path); } };
const stateDirectory = (configDir) => join(configDir, "kubectl-guard-state");
const receiptName = (sessionId) => `${createHash("sha256").update(sessionId.toLowerCase()).digest("hex")}.json`;

export function pluginIdentity(pluginRoot = pluginDirectory) {
  const files = [join(pluginRoot, ".claude-plugin/plugin.json"), join(pluginRoot, "hooks/hooks.json")];
  function scripts(directory, depth = 0) {
    if (depth > 4) throw new Error("Unexpected script depth");
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Unexpected script link");
      if (entry.isDirectory()) scripts(path, depth + 1);
      else if (entry.isFile() && /\.(?:mjs|sh)$/.test(entry.name)) files.push(path);
      if (files.length > 128) throw new Error("Unexpected script count");
    }
  }
  scripts(join(pluginRoot, "scripts"));
  const hash = createHash("sha256");
  let bytes = 0;
  for (const path of files.sort()) {
    const info = lstatSync(path);
    if (!info.isFile() || info.size > 1048576) throw new Error("Unexpected plugin file");
    const content = readFileSync(path);
    bytes += content.length;
    if (bytes > 2097152) throw new Error("Unexpected plugin size");
    hash.update(relative(pluginRoot, path)).update("\0").update(content).update("\0");
  }
  const manifest = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin/plugin.json"), "utf8"));
  if (manifest.name !== "kubectl-guard" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Unexpected plugin identity");
  return { version: manifest.version, fingerprint: hash.digest("hex") };
}

function privateDirectory(directory, create = false) {
  if (create) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) throw new Error("Nonprivate observation directory");
}

function prune(directory, now) {
  const receipts = [];
  const handle = opendirSync(directory);
  try {
    // Bound cleanup even if unrelated files have been placed in this directory.
    for (let count = 0; count < 512; count++) {
      const entry = handle.readSync();
      if (!entry) break;
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
      const path = join(directory, entry.name), info = lstatSync(path);
      if (now - info.mtimeMs > day) unlinkSync(path);
      else receipts.push({ path, mtime: info.mtimeMs });
    }
  } finally { handle.closeSync(); }
  for (const receipt of receipts.sort((a, b) => b.mtime - a.mtime).slice(128)) unlinkSync(receipt.path);
}

// These records are local invocation evidence, not permission-enforcement attestations.
// Failure is deliberately nonfatal: it must never alter the evaluator's decision.
export function writeObservation({ sessionId, cwd, permissionMode, outcome, configDir, pluginRoot = pluginDirectory, now = Date.now() }) {
  if (!validSessionId(sessionId) || typeof cwd !== "string" || !cwd || cwd.length > 4096 || !configDir || !Number.isFinite(now)) return false;
  let temporary;
  try {
    const decision = typeof outcome === "object" && outcome !== null ? outcome.decision : outcome;
    const classification = decision == null ? "pass" : decision;
    if (!["pass", "ask", "deny"].includes(classification)) return false;
    const identity = pluginIdentity(pluginRoot);
    const directory = stateDirectory(configDir);
    privateDirectory(directory, true);
    const path = join(directory, receiptName(sessionId));
    temporary = join(directory, `.${receiptName(sessionId)}.${randomUUID()}.tmp`);
    const record = {
      schemaVersion: 1, ...identity, cwd: canonical(cwd),
      permissionMode: typeof permissionMode === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(permissionMode) ? permissionMode : "unknown",
      observedAt: now, outcome: classification,
    };
    writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
    temporary = undefined;
    prune(directory, now);
    return true;
  } catch { return false; }
  finally { if (temporary) { try { unlinkSync(temporary); } catch { /* Best-effort diagnostic cleanup. */ } } }
}

export function readObservation({ sessionId, cwd, configDir, pluginRoot = pluginDirectory, now = Date.now() }) {
  if (!sessionId) return { status: "missing-session", detail: "No session ID supplied. Current-session hook invocation has not been checked." };
  if (!validSessionId(sessionId)) return { status: "invalid", detail: "Session ID must be a UUID." };
  let descriptor;
  try {
    const directory = stateDirectory(configDir);
    privateDirectory(directory);
    descriptor = openSync(join(directory, receiptName(sessionId)), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size > 8192 || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) throw new Error("Invalid observation file");
    const record = JSON.parse(readFileSync(descriptor, "utf8"));
    const fields = ["schemaVersion", "version", "fingerprint", "cwd", "permissionMode", "observedAt", "outcome"];
    if (!record || Array.isArray(record) || Object.keys(record).some((key) => !fields.includes(key))
      || record.schemaVersion !== 1 || typeof record.cwd !== "string" || record.cwd.length > 4096
      || !Number.isFinite(record.observedAt) || !["pass", "ask", "deny"].includes(record.outcome)
      || typeof record.permissionMode !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(record.permissionMode)) throw new Error("Invalid observation contents");
    const identity = pluginIdentity(pluginRoot);
    if (record.version !== identity.version || record.fingerprint !== identity.fingerprint) return { status: "different-release", detail: "The session receipt is from a different plugin version or fingerprint. Restart Claude and run doctor again." };
    if (record.cwd !== canonical(cwd)) return { status: "different-cwd", detail: "The session receipt is from another working directory. Run doctor through Bash in the current session." };
    if (now - record.observedAt > freshFor || record.observedAt - now > 30000) return { status: "stale", detail: "No matching hook invocation was observed within the last five minutes. Run doctor through Bash in this session." };
    return {
      status: "observed", detail: "PreToolUse invocation observed for this session and plugin. This does not prove the host enforced a decision.",
      observedAt: new Date(record.observedAt).toISOString(), permissionMode: record.permissionMode, outcome: record.outcome,
    };
  } catch (error) {
    return error.code === "ENOENT"
      ? { status: "missing", detail: "No matching current-session hook invocation has been observed. Restart Claude and run /kubectl-guard:doctor." }
      : { status: "invalid", detail: "Observation evidence is unreadable or invalid. No current-session claim can be made." };
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
