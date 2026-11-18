#!/usr/bin/env node
// Validate the distributable package using Node and Bash only.
// TypeScript build freshness is checked separately by npm run build:check.
import { spawnSync } from "node:child_process";
import {
  accessSync, constants, existsSync, lstatSync, readdirSync, readFileSync, realpathSync,
} from "node:fs";
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePlugins } from "./lib/validate-plugins.mjs";

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const ignored = new Set([".git", "node_modules", "__pycache__", ".venv"]);
let failures = 0;
const display = (path) => relative(root, path) || ".";
const fail = (message) => { console.error(`FAIL: ${message}`); failures++; };

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      fail(`release includes a symlink: ${display(path)}`);
    } else if (entry.isDirectory()) {
      files.push(...walk(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${display(path)}: ${error.message}`);
    return {};
  }
}

function inside(base, path) {
  const rel = relative(base, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

const files = walk(root);
const json = new Map(files.filter((path) => extname(path) === ".json").map((path) => [path, readJSON(path)]));
const getJSON = (path) => json.has(path) ? json.get(path) : readJSON(path);
const pluginPaths = validatePlugins({ root, files, readJSON: getJSON, fail });

const unquote = (value) => {
  const first = value[0];
  return (first === '"' || first === "'") && value.at(-1) === first ? value.slice(1, -1) : value;
};
for (const path of files.filter((file) => basename(file) === "SKILL.md")) {
  const content = readFileSync(path, "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
  if (!frontmatter) {
    fail(`${display(path)}: missing frontmatter`);
    continue;
  }
  const fields = Object.fromEntries([...frontmatter[1].matchAll(/^(\w+):[ \t]*(.*)$/gm)]
    .map(([, key, value]) => [key, unquote(value.trim())]));
  if (fields.name !== basename(dirname(path))) fail(`${display(path)}: skill name differs from directory`);
  if (!fields.description) fail(`${display(path)}: missing description`);
  else if (fields.description.length > 1024) fail(`${display(path)}: description exceeds 1024 characters`);
  const references = new Set([
    ...[...content.matchAll(/`((?:references|scripts|assets)\/[^`\s]+)`/g)].map((match) => match[1]),
    ...[...content.matchAll(/\]\(((?:references|scripts|assets)\/[^)\s]+)\)/g)].map((match) => match[1]),
  ]);
  for (const reference of references) {
    const target = resolve(dirname(path), reference.split("#")[0]);
    if (!inside(dirname(path), target) || !existsSync(target) || !lstatSync(target).isFile()) {
      fail(`${display(path)}: missing or invalid reference ${reference}`);
    }
  }
}

const textExtensions = new Set([".md", ".json", ".yaml", ".yml", ".mts", ".ts", ".mjs", ".js", ".sh"]);
for (const path of files) {
  if (!textExtensions.has(extname(path))) continue;
  const content = readFileSync(path, "utf8");
  if (/[\u2013\u2014]/u.test(content)) fail(`unsupported dash punctuation: ${display(path)}`);
}
const board = join(root, "plugins/ui-ux-design-council/skills/ui-ux-design-council/scripts/build_board.mjs");
if (!existsSync(board)) fail("compiled build_board.mjs is missing; run npm run build before distributing");
console.log(`json/manifests/frontmatter/references: ${failures ? "FAIL" : "ok"}`);

function run(command, args, label, timeout = 60000) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", timeout });
  if (result.error || result.status !== 0) fail(`${label}${result.error ? `: ${result.error.message}` : ""}`);
}

function executable(name) {
  for (const directory of (process.env.PATH || "").split(delimiter)) {
    const path = join(directory, name);
    try {
      accessSync(path, constants.X_OK);
      if (lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) return path;
    } catch { /* Check the next PATH entry. */ }
  }
  return null;
}

for (const path of files) {
  if (extname(path) === ".sh") run("bash", ["-n", path], `Bash syntax: ${display(path)}`);
  if (extname(path) === ".mjs") run(process.execPath, ["--check", path], `JavaScript syntax: ${display(path)}`);
}
const claudeCLI = executable("claude");
if (claudeCLI) {
  run(claudeCLI, ["plugin", "validate", "--strict", root], "Claude marketplace validation");
  for (const path of pluginPaths) run(claudeCLI, ["plugin", "validate", "--strict", path], `Claude plugin validation: ${display(path)}`);
} else {
  console.log("skip: Claude CLI not found (native plugin validation)");
}
run(process.execPath, ["--test"], "regression tests");
if (failures) {
  console.error(`checks failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log("all checks passed");
}
