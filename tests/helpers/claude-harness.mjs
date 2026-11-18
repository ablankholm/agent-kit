import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync, constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export function claudeExecutable() {
  const candidates = process.env.CLAUDE_BIN
    ? [process.env.CLAUDE_BIN]
    : (process.env.PATH ?? "").split(delimiter).map((directory) => join(directory, "claude"));
  for (const candidate of candidates) {
    try { accessSync(candidate, constants.X_OK); return realpathSync(candidate); }
    catch { /* Try the next executable location. */ }
  }
  throw new Error("Claude CLI is required for test:claude; install it or set CLAUDE_BIN.");
}

const parseLines = (file) => existsSync(file)
  ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
  : [];
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function modelResponse(response, body, run) {
  const tools = (body.tools ?? []).map((tool) => tool.name);
  const toolResults = (body.messages ?? []).flatMap((message) => Array.isArray(message.content)
    ? message.content.filter((block) => block.type === "tool_result") : []);
  run.toolResults.push(...toolResults);
  const messageText = (body.messages ?? []).flatMap((message) => typeof message.content === "string"
    ? [message.content] : (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text)).join("\n");
  run.apiRequests.push({ model: body.model, tools,
    includesExpectedText: run.expectedText ? messageText.includes(run.expectedText) : undefined,
    hasUnexpandedPluginVariables: /\$\{CLAUDE_(?:SESSION_ID|PLUGIN_ROOT)\}/.test(messageText) });
  const finished = toolResults.length > 0 || tools.length === 0 || run.textOnly;
  const parent = run.subagent && tools.includes("Agent");
  const content = finished
    ? { type: "text", text: "Synthetic fixture complete." }
    : parent
      ? { type: "tool_use", id: "toolu_fixture_agent", name: "Agent", input: {
        description: "Synthetic guard fixture", prompt: "Run the synthetic guard fixture.",
        subagent_type: "guard-fixture",
      } }
      : { type: "tool_use", id: "toolu_fixture_bash", name: "Bash", input: {
        command: run.command, description: "Synthetic guard fixture",
      } };
  const stopReason = finished ? "end_turn" : "tool_use";
  const message = {
    id: `msg_${randomUUID()}`, type: "message", role: "assistant", model: body.model,
    content: [content], stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
  if (!body.stream) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(message));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  emit("message_start", { type: "message_start", message: {
    ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 },
  } });
  emit("content_block_start", { type: "content_block_start", index: 0, content_block:
    content.type === "text" ? { type: "text", text: "" } : { ...content, input: {} } });
  emit("content_block_delta", { type: "content_block_delta", index: 0, delta:
    content.type === "text" ? { type: "text_delta", text: content.text }
      : { type: "input_json_delta", partial_json: JSON.stringify(content.input) } });
  emit("content_block_stop", { type: "content_block_stop", index: 0 });
  emit("message_delta", { type: "message_delta", delta: {
    stop_reason: stopReason, stop_sequence: null,
  }, usage: { output_tokens: 10 } });
  emit("message_stop", { type: "message_stop" });
  response.end();
}

// Tests use an isolated configuration directory and an explicit environment list.
// Never copy real model, proxy, cloud, or cluster credentials into the child.
export class ClaudeHarness {
  constructor(test, sourcePlugin, options = {}) {
    this.claude = claudeExecutable();
    this.base = realpathSync(mkdtempSync(join(tmpdir(), "claude guard integration ")));
    test.after(() => rmSync(this.base, { recursive: true, force: true }));
    this.plugin = join(this.base, "plugin");
    this.config = join(this.base, "config");
    this.bin = join(this.base, "bin");
    this.shell = join(this.bin, "bash");
    this.kubeconfig = join(this.base, "empty-kubeconfig.json");
    this.settings = join(this.base, "settings.json");
    cpSync(sourcePlugin, this.plugin, { recursive: true });
    mkdirSync(this.config); mkdirSync(this.bin);
    writeFileSync(this.kubeconfig, JSON.stringify({ apiVersion: "v1", kind: "Config", contexts: [], clusters: [], users: [] }));
    // Claude's snapshot command explicitly sources the user's rc file. Reject it
    // before execution, then force the normal shell path to skip all profiles.
    writeFileSync(this.shell, `#!/bin/bash
unset BASH_ENV ENV
fixture_arguments=()
fixture_login_removed=false
for fixture_argument in "$@"; do
  case "$fixture_argument" in
    SNAPSHOT_FILE=*|*'.bashrc'*|*'.bash_profile'*|*'.bash_login'*|*'/.profile'*|*'.zshrc'*|*'.zprofile'*|*'.zshenv'*)
      if [ -n "\${FIXTURE_SHELL_OBSERVATIONS:-}" ]; then
        printf '%s\\n' '{"profileScriptBlocked":true}' >> "$FIXTURE_SHELL_OBSERVATIONS"
      fi
      exit 77 ;;
    -l|--login) fixture_login_removed=true ;;
    -lc|-cl) fixture_login_removed=true; fixture_arguments+=(-c) ;;
    *) fixture_arguments+=("$fixture_argument") ;;
  esac
done
if [ -n "\${FIXTURE_SHELL_OBSERVATIONS:-}" ]; then
  printf '{"profileFree":true,"loginFlagRemoved":%s}\\n' "$fixture_login_removed" >> "$FIXTURE_SHELL_OBSERVATIONS"
fi
exec /bin/bash --noprofile --norc "\${fixture_arguments[@]}"
`, { mode: 0o755 });
    symlinkSync(this.claude, join(this.bin, "claude"));
    if (options.runtime !== "missing") {
      if (options.runtime === "crash") {
        writeFileSync(join(this.bin, "node"), "#!/bin/bash\nexit 1\n", { mode: 0o755 });
      } else symlinkSync(process.execPath, join(this.bin, "node"));
    }
    const kubectlStub = join(this.base, "kubectl-stub.cjs");
    writeFileSync(kubectlStub, `
const fs = require("node:fs");
const args = process.argv.slice(2);
const lookup = args[0] === "config" && args[1] === "view";
const config = JSON.parse(fs.readFileSync(process.env.KUBECONFIG, "utf8"));
const emptyKubeconfig = config.contexts?.length === 0 && config.clusters?.length === 0 && config.users?.length === 0;
if (!emptyKubeconfig) throw new Error("Synthetic fixture requires an empty kubeconfig");
fs.appendFileSync(process.env.FIXTURE_EXECUTIONS, JSON.stringify({ lookup, args, emptyKubeconfig }) + "\\n");
if (lookup) {
  const context = args.find((arg) => arg.startsWith("--context="))?.slice(10) || "guard-fixture-remote";
  console.log(JSON.stringify({ "current-context": context,
    contexts: [{ name: context, context: { cluster: "fixture", namespace: "default" } }],
    clusters: [{ name: "fixture", cluster: { server: "https://127.0.0.1:6443" } }]
  }));
} else console.log("synthetic kubectl output");
`);
    // The stub remains executable when the guard's PATH Node is absent or broken.
    writeFileSync(join(this.bin, "kubectl"), `#!/bin/bash\nexec ${shellQuote(process.execPath)} ${shellQuote(kubectlStub)} "$@"\n`, { mode: 0o755 });
    const observer = join(this.base, "observer.mjs");
    writeFileSync(observer, `import fs from "node:fs";
const input = JSON.parse(fs.readFileSync(0, "utf8"));
fs.appendFileSync(process.env.FIXTURE_OBSERVATIONS, JSON.stringify({
  event: input.hook_event_name, session: input.session_id, mode: input.permission_mode,
  agent_id: input.agent_id, agent_type: input.agent_type, tool: input.tool_name,
  tool_use_id: input.tool_use_id,
}) + "\\n");
`);
    const hooks = Object.fromEntries(["PreToolUse", "PermissionRequest", "PostToolUse", "PostToolUseFailure"]
      .map((event) => [event, [{ matcher: "Bash", hooks: [{ type: "command",
        command: `"${process.execPath}" "${observer}"`,
      }] }]]));
    writeFileSync(this.settings, JSON.stringify({ hooks }));
    if (options.hostFailure === "missing-launcher") {
      rmSync(join(this.plugin, "scripts/kubectl-guard.sh"));
    } else if (options.hostFailure === "timeout") {
      const file = join(this.plugin, "hooks/hooks.json");
      const registration = JSON.parse(readFileSync(file, "utf8"));
      registration.hooks.PreToolUse[0].hooks[0] = {
        type: "command", command: "/bin/sleep 2", timeout: 1,
      };
      writeFileSync(file, JSON.stringify(registration));
    }
    this.env = {};
    for (const key of ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG"]) {
      if (process.env[key]) this.env[key] = process.env[key];
    }
    Object.assign(this.env, {
      PATH: `${this.bin}:/usr/bin:/bin`, SHELL: this.shell, CLAUDE_CODE_SHELL: this.shell,
      BASH_ENV: "/dev/null", ENV: "/dev/null", KUBECONFIG: this.kubeconfig,
      CLAUDE_CONFIG_DIR: this.config, KUBECTL_GUARD_CONFIG_DIR: this.config,
      ANTHROPIC_API_KEY: "sk-ant-synthetic-fixture", ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1", DISABLE_AUTOUPDATER: "1",
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: "1",
      CLAUDE_CODE_AUTO_CONNECT_IDE: "0", CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
    });
  }

  async cli(args) {
    const child = spawn(this.claude, args, { cwd: this.base, env: this.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    clearTimeout(timer);
    if (code !== 0) throw new Error(`Claude ${args.join(" ")} failed (${code}): ${stderr || stdout}`);
    return stdout;
  }

  async install() {
    const marketplace = join(this.base, "marketplace");
    mkdirSync(join(marketplace, ".claude-plugin"), { recursive: true });
    cpSync(this.plugin, join(marketplace, "plugins/kubectl-guard"), { recursive: true });
    writeFileSync(join(marketplace, ".claude-plugin/marketplace.json"), JSON.stringify({
      name: "ablankholm", owner: { name: "Synthetic local fixture" },
      plugins: [{ name: "kubectl-guard", source: "./plugins/kubectl-guard" }],
    }));
    await this.cli(["plugin", "marketplace", "add", marketplace]);
    await this.cli(["plugin", "install", "kubectl-guard@ablankholm", "--scope", "user"]);
  }

  async run(options = {}) {
    const run = {
      command: "kubectl delete pod fixture --context=guard-fixture-remote", mode: "manual",
      apiRequests: [], toolResults: [], ...options,
    };
    // Absolute dummy executable paths prevent an unexpected PATH from reaching
    // a real kubectl. The dummy config resolver also has an empty KUBECONFIG.
    run.command = run.command.replace(/^kubectl(?=\s)/, shellQuote(join(this.bin, "kubectl")));
    const requests = [];
    const server = createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => {
        requests.push(request.url);
        if (request.url.startsWith("/v1/messages/count_tokens")) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end('{"input_tokens":10}');
        } else if (request.method === "POST" && request.url.startsWith("/v1/messages")) {
          try { modelResponse(response, JSON.parse(raw), run); }
          catch { response.writeHead(500); response.end("Invalid synthetic request"); }
        } else { response.writeHead(404); response.end("Unexpected synthetic endpoint"); }
      });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
    });
    const sessionId = options.sessionId ?? randomUUID();
    const executionFile = join(this.base, `${sessionId}.executions.jsonl`);
    const observationFile = join(this.base, `${sessionId}.observations.jsonl`);
    const shellFile = join(this.base, `${sessionId}.shell.jsonl`);
    const env = { ...this.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      FIXTURE_EXECUTIONS: executionFile, FIXTURE_OBSERVATIONS: observationFile,
      FIXTURE_SHELL_OBSERVATIONS: shellFile };
    const args = ["-p", "--model", "claude-sonnet-4-5", "--system-prompt", "You are a synthetic local integration test.",
      "--setting-sources", run.installed ? "user" : "", "--settings", this.settings,
      "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      "--tools", run.subagent ? "Bash,Agent" : "Bash",
      "--allowedTools", run.allowedTools ?? (run.subagent ? "Bash,Agent" : "Bash"),
      "--permission-mode", run.mode, "--output-format", "stream-json", "--include-hook-events",
      "--verbose", "--no-session-persistence", "--session-id", sessionId];
    if (!run.installed) args.push("--plugin-dir", this.plugin);
    if (run.mode === "bypassPermissions") args.push("--allow-dangerously-skip-permissions");
    if (run.subagent) args.push("--agents", JSON.stringify({ "guard-fixture": {
      description: "Synthetic test agent", prompt: "You run synthetic fixture commands.", tools: ["Bash"], model: "sonnet",
    } }));
    if (run.permission) args.push("--input-format", "stream-json", "--permission-prompt-tool", "stdio");
    else args.push(run.prompt ?? "Run the synthetic fixture.");
    const child = spawn(this.claude, args, { cwd: this.base, env, stdio: ["pipe", "pipe", "pipe"], detached: true });
    const messages = [], permissionRequests = [];
    let stderr = "", pending = "", timedOut = false;
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        messages.push(message);
        if (message.type === "control_request") {
          permissionRequests.push(message.request);
          child.stdin.write(`${JSON.stringify({ type: "control_response", response: {
            subtype: "success", request_id: message.request_id,
            response: { behavior: run.permission, updatedInput: message.request.input, message: "Synthetic permission response" },
          } })}\n`);
        }
        if (message.type === "result") child.stdin.end();
      }
    });
    if (run.permission) child.stdin.write(`${JSON.stringify({ type: "user", session_id: sessionId,
      message: { role: "user", content: run.prompt ?? "Run the synthetic fixture." }, parent_tool_use_id: null })}\n`);
    else child.stdin.end();
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }, 25000);
    let code;
    try {
      code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    } finally {
      clearTimeout(timer); await new Promise((resolve) => server.close(resolve));
    }
    if (timedOut || code !== 0) throw new Error(`Claude fixture failed (${code}, timeout=${timedOut}): ${stderr}`);
    return { sessionId, messages, permissionRequests, requests, stderr,
      hookEvents: messages.filter((message) => message.subtype?.startsWith("hook_")),
      results: messages.filter((message) => message.type === "result"),
      observations: parseLines(observationFile), executions: parseLines(executionFile),
      shellInvocations: parseLines(shellFile),
      apiRequests: run.apiRequests, toolResults: run.toolResults };
  }
}
