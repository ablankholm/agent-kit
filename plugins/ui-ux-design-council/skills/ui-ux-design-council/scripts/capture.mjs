#!/usr/bin/env node
// Capture parity screenshots for design variants.
// Usage: node capture.mjs <workspace>/log.json [--iteration N] [--variant ID] [--full-page]
// Reads log.json parity {breakpoints, states, themes} and each variant's ref.url template
// ({state} and {theme} placeholders). Writes shots/iter-NN/<variant>/<bp>-<state>[-<theme>].png
// next to log.json. Resolves Playwright from the current project (run from the repo root).

import { readFileSync, mkdirSync, lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { createRequire } from "node:module";

function fail(message) { throw new Error(message); }
function component(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    fail(`${label} must be a filename component using letters, digits, dots, underscores or hyphens`);
  }
  return value;
}
function list(value, label) {
  if (!Array.isArray(value) || !value.length) fail(`${label} must be a nonempty array`);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args[0]) fail("usage: capture.mjs <log.json> [--iteration N] [--variant ID] [--full-page]");
  const options = {};
  for (let i = 1; i < args.length; i++) {
    const key = args[i];
    if (key === "--full-page") options[key] = true;
    else if (["--iteration", "--variant"].includes(key) && args[i + 1] && !args[i + 1].startsWith("--")) options[key] = args[++i];
    else fail(`unknown or incomplete option: ${key}`);
  }
  const logPath = realpathSync(resolve(args[0]));
  const workspace = dirname(logPath);
  function confined(path) {
    let ancestor = resolve(path);
    const suffix = [];
    for (;;) {
      try { lstatSync(ancestor); break; }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        const parent = dirname(ancestor);
        if (parent === ancestor) throw error;
        suffix.unshift(relative(parent, ancestor));
        ancestor = parent;
      }
    }
    const canonical = resolve(realpathSync(ancestor), ...suffix);
    const rel = relative(workspace, canonical);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail("artifact path escapes the log workspace");
    return canonical;
  }
  const fullPage = Boolean(options["--full-page"]);
  const log = JSON.parse(readFileSync(logPath, "utf8"));
  const iters = list(log.iterations || [], "iterations");
  const ids = new Set(), variantIds = new Set();
  for (const iteration of iters) {
    if (!Number.isSafeInteger(iteration.id) || iteration.id < 0 || ids.has(iteration.id)) fail("iteration IDs must be unique nonnegative integers");
    ids.add(iteration.id);
    for (const variant of iteration.variants || []) {
      component(variant.id, "variant ID");
      if (variantIds.has(variant.id)) fail("variant IDs must be unique across iterations");
      variantIds.add(variant.id);
      if (variant.ref?.url !== undefined && typeof variant.ref.url !== "string") fail("variant ref.url must be a string");
    }
  }
  const iterId = options["--iteration"] === undefined ? iters.at(-1).id : Number(options["--iteration"]);
  const iter = iters.find((i) => i.id === iterId);
  if (!iter) fail(`iteration ${iterId} not found`);
  const onlyVariant = options["--variant"];
  if (onlyVariant && !(iter.variants || []).some((v) => v.id === onlyVariant)) fail(`variant ${onlyVariant} not found`);

  const parity = log.parity || {};
  const bps = list(parity.breakpoints || [375, 768, 1280], "breakpoints");
  const states = list(parity.states || ["default"], "states");
  const themes = list(parity.themes || ["light"], "themes");
  for (const bp of bps) if (!Number.isSafeInteger(bp) || bp <= 0) fail("breakpoints must be positive integers");
  for (const state of states) component(state, "state");
  for (const theme of themes) component(theme, "theme");
  const pad = (n) => String(n).padStart(2, "0");
  const outRoot = confined(join(workspace, "shots", `iter-${pad(iterId)}`));
  // Check every selected output before loading Playwright or visiting an application.
  for (const variant of iter.variants || []) {
    if (onlyVariant && variant.id !== onlyVariant) continue;
    for (const theme of themes) for (const bp of bps) for (const state of states) {
      confined(join(outRoot, variant.id, `${bp}-${state}${themes.length > 1 ? "-" + theme : ""}.png`));
    }
  }

  let pw;
  try {
    const req = createRequire(join(process.cwd(), "noop.js"));
    pw = req("playwright");
  } catch {
    try { pw = createRequire(join(process.cwd(), "noop.js"))("@playwright/test"); }
    catch {
      console.error("Playwright not found in this project. Install: npm i -D playwright && npx playwright install chromium\n" +
        "Or capture manually / with host browser tools to the same paths (see references/comparison.md).");
      process.exit(3);
    }
  }

  const browser = await pw.chromium.launch();
  let ok = 0, failed = 0;
  try {
    for (const v of iter.variants || []) {
      if (onlyVariant && v.id !== onlyVariant) continue;
      const tpl = v.ref?.url;
      if (!tpl) { console.warn(`skip ${v.id}: no ref.url`); continue; }
      const variantDir = confined(join(outRoot, v.id));
      mkdirSync(variantDir, { recursive: true });
      for (const theme of themes) {
        const ctx = await browser.newContext({ colorScheme: theme === "dark" ? "dark" : "light", deviceScaleFactor: 1 });
        try {
          const page = await ctx.newPage();
          for (const bp of bps) {
            await page.setViewportSize({ width: bp, height: bp < 600 ? 812 : 900 });
            for (const state of states) {
              const url = tpl.replaceAll("{state}", state).replaceAll("{theme}", theme);
              const file = confined(join(variantDir, `${bp}-${state}${themes.length > 1 ? "-" + theme : ""}.png`));
              try {
                await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
                await page.waitForTimeout(300); // settle animations
                await page.screenshot({ path: confined(file), fullPage, animations: "disabled" });
                ok++; console.log(`ok   ${v.id} ${bp} ${state} ${theme}`);
              } catch (e) { failed++; console.error(`FAIL ${v.id} ${bp} ${state} ${theme}: ${e.message.split("\n")[0]}`); }
            }
          }
        } finally { await ctx.close(); }
      }
    }
  } finally { await browser.close(); }
  console.log(`done: ${ok} ok, ${failed} failed -> ${outRoot}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => { console.error(`error: ${error.message}`); process.exitCode = 2; });
