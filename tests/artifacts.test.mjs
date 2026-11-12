import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKILL = join(ROOT, "plugins/ui-ux-design-council/skills/ui-ux-design-council");
const BOARD = join(SKILL, "scripts/build_board.mjs");
const CAPTURE = join(SKILL, "scripts/capture.mjs");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2tIAAAAASUVORK5CYII=", "base64");

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "council-artifact-test-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const workspace = join(base, "workspace with spaces");
  mkdirSync(workspace);
  const logPath = join(workspace, "log.json");
  const f = {
    base, workspace, logPath,
    log: {
      feature: "Example settings",
      parity: { breakpoints: [375], states: ["default"], themes: ["light"] },
      iterations: [{ id: 1, variants: [{ id: "A1", status: "champion", ref: { url: "http://localhost:3000/?state={state}&theme={theme}" } }] }],
    },
    run(script, ...args) {
      writeFileSync(logPath, JSON.stringify(this.log));
      const result = spawnSync(process.execPath, [script, logPath, ...args], { cwd: base, encoding: "utf8", timeout: 10_000 });
      assert.ifError(result.error);
      return result;
    },
    board(...args) { return this.run(BOARD, ...args); },
    capture(...args) { return this.run(CAPTURE, ...args); },
    source(file = "board.html") { return readFileSync(join(workspace, file), "utf8"); },
    shot(name = "375-default.png", variant = "A1", iteration = 1) {
      const folder = join(workspace, "shots", `iter-${String(iteration).padStart(2, "0")}`, variant);
      mkdirSync(folder, { recursive: true });
      const path = join(folder, name);
      writeFileSync(path, PNG);
      return path;
    },
    reject(result, message) {
      assert.notEqual(result.status, 0, result.stdout);
      assert.ok(result.stderr.includes(message), result.stderr);
      assert.equal(existsSync(join(workspace, "board.html")), false);
    },
    fakePlaywright() {
      const module = join(base, "node_modules/playwright");
      mkdirSync(module, { recursive: true });
      writeFileSync(join(module, "index.js"), `const fs = require('node:fs');
module.exports = {chromium: {launch: async () => ({
  newContext: async () => ({newPage: async () => ({
    setViewportSize: async () => {}, goto: async () => {}, waitForTimeout: async () => {},
    screenshot: async ({path}) => fs.writeFileSync(path, 'test screenshot')
  }), close: async () => {}}), close: async () => {}
})}};`);
    },
  };
  return f;
}

function success(result) { assert.equal(result.status, 0, result.stderr); }

test("example generates the inline board with trends, lineage and screenshot data", (t) => {
  const f = fixture(t);
  f.log = JSON.parse(readFileSync(join(SKILL, "assets/log.example.json"), "utf8"));
  f.shot();
  success(f.board("--inline"));
  const source = f.source();
  assert.match(source, /Champion lineage: A1 → A2/);
  assert.ok(source.includes(`data:image/png;base64,${PNG.toString("base64")}`));
  assert.match(source, /consistency 5→4/);
  assert.match(source, /\+2 Nielsen sev3/);
  assert.ok(source.indexOf('id="iter-2"') < source.indexOf('id="iter-1"'));
});

test("nested output keeps image URLs relative to the HTML location", (t) => {
  const f = fixture(t);
  f.shot();
  mkdirSync(join(f.workspace, "exports"));
  success(f.board("--out", "exports/comparison.html"));
  assert.ok(f.source("exports/comparison.html").includes('src="../shots/iter-01/A1/375-default.png"'));
});

test("untrusted text and filenames cannot add HTML elements or attributes", (t) => {
  const f = fixture(t);
  const payload = '<img src=x onerror="throw 123">';
  f.log.feature = payload;
  f.log.iterations[0].variants[0].notes = payload;
  f.shot('375-default" onerror="throw 123.png');
  success(f.board());
  const source = f.source();
  assert.ok(source.includes("&lt;img src=x onerror=&quot;throw 123&quot;&gt;"));
  const images = [...source.matchAll(/<img\b([^>]*?)>/g)].map((match) =>
    Object.fromEntries([...match[1].matchAll(/([^\s=/'">]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)]
      .map((attribute) => [attribute[1], attribute[2] ?? attribute[3] ?? attribute[4]])));
  assert.ok(images.every((attrs) => !Object.hasOwn(attrs, "onerror")));
  assert.ok(images.every((attrs) => attrs.src !== "x"));
  assert.ok(source.includes("%22%20onerror%3D%22"));
});

test("malicious numeric values fail before writing an artifact", (t) => {
  const f = fixture(t);
  const variant = f.log.iterations[0].variants[0];
  for (const [key, value, message] of [
    ["nielsen", { "3": '<img src=x onerror="throw 123">' }, "Nielsen counts"],
    ["scores", { usability: "5' onclick='throw 123" }, "scores must"],
  ]) {
    variant[key] = value;
    f.reject(f.board(), message);
    delete variant[key];
  }
});

test("variant path traversal and absolute paths are rejected", (t) => {
  const f = fixture(t);
  for (const value of ["..", "../../outside", "/tmp/outside", "C:\\outside"]) {
    f.log.iterations[0].variants[0].id = value;
    f.reject(f.board("--inline"), "variant ID");
  }
});

test("symlinked screenshot cannot inline an external file", (t) => {
  const f = fixture(t), outside = join(f.base, "private.png");
  writeFileSync(outside, "outside secret marker");
  const shot = f.shot();
  unlinkSync(shot); symlinkSync(outside, shot);
  f.reject(f.board("--inline"), "escapes the log workspace");
});

test("symlinked screenshots directory cannot escape the workspace", (t) => {
  const f = fixture(t), outside = join(f.base, "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(f.workspace, "shots"), "dir");
  f.reject(f.board(), "escapes the log workspace");
});

test("output traversal and symlinks cannot overwrite an external file", (t) => {
  const f = fixture(t), outside = join(f.base, "private.html");
  writeFileSync(outside, "preserve me");
  f.reject(f.board("--out", "../private.html"), "escapes the log workspace");
  symlinkSync(outside, join(f.workspace, "linked.html"));
  f.reject(f.board("--out", "linked.html"), "escapes the log workspace");
  assert.equal(readFileSync(outside, "utf8"), "preserve me");
});

test("a lineage cycle fails without hanging", (t) => {
  const f = fixture(t);
  f.log.iterations[0].variants[0].parent = "A1";
  f.reject(f.board(), "lineage contains a cycle");
});

test("A/B comparison assigns untrusted image values through DOM properties", (t) => {
  const f = fixture(t);
  f.shot();
  success(f.board());
  const script = f.source().match(/<script>([\s\S]*?)<\/script>/)[1];
  function element(tag) {
    return {
      tag, children: [], style: {}, options: [], value: "",
      set innerHTML(value) { throw new Error("HTML injection sink used"); },
      append(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
      addEventListener() {}, querySelector() { return element("img"); },
    };
  }
  const nodes = Object.fromEntries(["a", "b", "op", "abv", "zoom"].map((id) => [id, element(id)]));
  nodes.a.value = '" onerror="throw 123'; nodes.b.value = nodes.a.value; nodes.op.value = "50";
  let mode = "side";
  const document = {
    getElementById: (id) => nodes[id], createElement: element,
    querySelector: () => ({ value: mode }), querySelectorAll: () => [],
  };
  const context = vm.createContext({ document });
  vm.runInContext(script, context, { timeout: 1000 });
  assert.equal(nodes.abv.children[0].children[0].children[0].src, nodes.a.value);
  mode = "over";
  vm.runInContext("r()", context, { timeout: 1000 });
  assert.equal(nodes.abv.children[0].children[1].src, nodes.b.value);
  assert.equal(nodes.abv.children[0].children[1].style.opacity, 0.5);
});

test("capture writes the expected screenshot for a valid log", (t) => {
  const f = fixture(t);
  f.fakePlaywright();
  success(f.capture());
  assert.equal(readFileSync(join(f.workspace, "shots/iter-01/A1/375-default.png"), "utf8"), "test screenshot");
});

test("capture rejects path components before loading the browser", (t) => {
  const f = fixture(t);
  for (const [section, key, value] of [
    ["variant", "id", "../../outside"], ["parity", "states", ["../outside"]],
    ["parity", "themes", ["../../outside"]], ["parity", "breakpoints", ["../../outside"]],
  ]) {
    const target = section === "variant" ? f.log.iterations[0].variants[0] : f.log.parity;
    const previous = target[key]; target[key] = value;
    const result = f.capture();
    assert.notEqual(result.status, 0);
    assert.ok(!result.stderr.includes("Playwright not found"), result.stderr);
    assert.equal(existsSync(join(f.workspace, "shots")), false);
    target[key] = previous;
  }
});

test("capture does not overwrite a symlinked external screenshot", (t) => {
  const f = fixture(t), outside = join(f.base, "private.png");
  f.fakePlaywright();
  writeFileSync(outside, "preserve me");
  const shot = f.shot();
  unlinkSync(shot); symlinkSync(outside, shot);
  const result = f.capture();
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes("escapes the log workspace"), result.stderr);
  assert.equal(readFileSync(outside, "utf8"), "preserve me");
});

test("capture rejects a symlinked external output directory", (t) => {
  const f = fixture(t), outside = join(f.base, "outside");
  f.fakePlaywright();
  mkdirSync(outside);
  symlinkSync(outside, join(f.workspace, "shots"), "dir");
  const result = f.capture();
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes("escapes the log workspace"), result.stderr);
  assert.deepEqual(readdirSync(outside), []);
});

test("weighted percentages preserve ties-to-even rounding", (t) => {
  const f = fixture(t);
  f.log.rubric = { usability: 1 };
  f.log.iterations[0].variants = [
    { id: "A1", scores: { usability: 0.125 } },
    { id: "B1", scores: { usability: 0.175 } },
    { id: "C1", scores: { usability: 4.225 } },
    { id: "D1" },
  ];
  success(f.board());
  assert.ok(f.source().includes("<tr class='total'><th>Weighted</th><td class='num'>2</td><td class='num'>4</td><td class='num'>84</td><td class='num'>n/a</td></tr>"));
});

test("screenshot grid follows parity states then numeric breakpoint order", (t) => {
  const f = fixture(t);
  f.log.parity.states = ["empty", "default"];
  for (const name of ["1280-default.png", "375-default.png", "1280-empty.png", "375-empty.png"]) f.shot(name);
  success(f.board());
  const section = f.source().match(/<section class="iter"[\s\S]*?<\/section>/)[0];
  const rows = [...section.matchAll(/<div class="rk">([^<]*)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(rows, ["375-empty", "1280-empty", "375-default", "1280-default"]);
});

test("merged variants compare their score and regressions with the best source", (t) => {
  const f = fixture(t);
  f.log.rubric = { usability: 1 };
  f.log.iterations = [
    { id: 2, variants: [{ id: "M2", merged_from: ["A1", "B1"], scores: { usability: 3 }, nielsen: { "3": 2 }, status: "champion" }] },
    { id: 1, variants: [{ id: "A1", scores: { usability: 2 } }, { id: "B1", scores: { usability: 5 }, nielsen: { "3": 1 } }] },
  ];
  success(f.board());
  const source = f.source();
  assert.match(source, /<span class="down">▼40<\/span>/);
  assert.match(source, /usability 5→3; \+1 Nielsen sev3/);
  assert.ok(source.indexOf("<th>Iter 1</th>") < source.indexOf("<th>Iter 2</th>"));
});

test("prototype-like variant identifiers cannot alter lookups", (t) => {
  const f = fixture(t);
  f.log.iterations[0].variants[0].id = "constructor";
  f.shot("375-default.png", "constructor");
  success(f.board());
  assert.match(f.source(), /Champion lineage: constructor/);
});

test("empty logs and missing screenshots still produce a usable board", (t) => {
  const f = fixture(t);
  f.log.iterations = [];
  success(f.board());
  assert.match(f.source(), /No champion yet/);
  assert.match(f.source(), /id="ab"/);
});
