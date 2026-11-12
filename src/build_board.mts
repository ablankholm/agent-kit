#!/usr/bin/env node
/** Generated runtime: edit src/build_board.mts and run npm run build.
 * Build the comparison board with Node.js builtins only.
 */
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

type JsonObject = Record<string, unknown>;
type NumericMap = Record<string, number>;
interface Variant {
  id: string;
  parent?: string;
  mergedFrom: string[];
  thesis?: string;
  status?: string;
  notes?: string;
  axes: Record<string, string>;
  scores: NumericMap;
  nielsen: NumericMap;
  slopFlags?: number;
}
interface Iteration {
  id: number;
  date?: string;
  goal?: string;
  countRationale?: string;
  feedback?: string;
  decision?: string;
  decidedBy?: string;
  variants: Variant[];
}
interface DesignLog {
  feature?: string;
  briefRef?: string;
  rubric: NumericMap;
  parity: Record<string, string[] | number[]>;
  iterations: Iteration[];
}
interface Options { log: string; out: string; inline: boolean }
interface VariantEntry { iteration: number; variant: Variant }
interface BoardFields {
  title: string;
  brief: string;
  champ: string;
  nav: string;
  trend: string;
  sections: string;
  lineage: string;
  opts: string;
  parity: string;
}
const DEFAULT_RUBRIC: NumericMap = { brief_fit: 3, usability: 3, a11y: 2, consistency: 2, distinctiveness: 1, feasibility: 1 };
const USAGE = "Usage: node build_board.mjs <workspace>/log.json [--out board.html] [--inline]\nRelative output paths start in the log workspace. Output must stay inside it.";

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonObject;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}
function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined || value === null ? undefined : string(value, label);
}
function component(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${label} must be a filename component using letters, digits, dots, underscores or hyphens`);
  }
  return value;
}
function numericMap(value: unknown, label: string, valid: (n: number) => boolean, message: string): NumericMap {
  return Object.fromEntries(Object.entries(object(value ?? {}, label)).map(([key, number]) => {
    if (typeof number !== "number" || !Number.isFinite(number) || !valid(number)) throw new Error(message);
    return [key, number];
  }));
}
function parseLog(value: unknown): DesignLog {
  const input = object(value, "log");
  const iterationIds = new Set<number>();
  const variantIds = new Set<string>();
  const iterations = array(input.iterations ?? [], "iterations").map((value): Iteration => {
    const iteration = object(value, "iteration");
    const id = iteration.id;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0 || iterationIds.has(id)) {
      throw new Error("iteration IDs must be unique nonnegative integers");
    }
    iterationIds.add(id);
    const variants = array(iteration.variants ?? [], "variants").map((value): Variant => {
      const variant = object(value, "variant");
      const id = component(variant.id, "variant ID");
      if (variantIds.has(id)) throw new Error("variant IDs must be unique across iterations");
      variantIds.add(id);
      const slopFlags = variant.slop_flags;
      if (slopFlags !== undefined && (typeof slopFlags !== "number" || !Number.isSafeInteger(slopFlags) || slopFlags < 0)) {
        throw new Error("slop_flags must be a nonnegative integer");
      }
      return {
        id,
        parent: optionalString(variant.parent, "parent"),
        mergedFrom: array(variant.merged_from ?? [], "merged_from").map((v) => string(v, "merge source")),
        thesis: optionalString(variant.thesis, "thesis"),
        status: optionalString(variant.status, "status"),
        notes: optionalString(variant.notes, "notes"),
        axes: Object.fromEntries(Object.entries(object(variant.axes ?? {}, "axes")).map(([k, v]) => [k, string(v, "axis value")])),
        scores: numericMap(variant.scores, "scores", (n) => n >= 0 && n <= 5, "scores must be finite numbers between 0 and 5"),
        nielsen: numericMap(variant.nielsen, "nielsen", (n) => Number.isSafeInteger(n) && n >= 0, "Nielsen counts must be nonnegative integers"),
        slopFlags,
      };
    });
    return {
      id, variants,
      date: optionalString(iteration.date, "date"),
      goal: optionalString(iteration.goal, "goal"),
      countRationale: optionalString(iteration.count_rationale, "count_rationale"),
      feedback: optionalString(iteration.feedback, "feedback"),
      decision: optionalString(iteration.decision, "decision"),
      decidedBy: optionalString(iteration.decided_by, "decided_by"),
    };
  }).sort((a, b) => a.id - b.id);
  const rubric = numericMap(input.rubric, "rubric", (n) => n > 0, "rubric weights must be positive finite numbers");
  const parity = Object.fromEntries(Object.entries(object(input.parity ?? {}, "parity")).map(([key, value]) => {
    const values = array(value, `parity.${key}`);
    if (key === "breakpoints") {
      if (!values.every((v): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0)) {
        throw new Error("breakpoints must be positive integers");
      }
      return [key, values];
    }
    return [key, values.map((v) => string(v, `parity.${key} value`))];
  }));
  return {
    feature: optionalString(input.feature, "feature"),
    briefRef: optionalString(input.brief_ref, "brief_ref"),
    rubric: Object.keys(rubric).length ? rubric : DEFAULT_RUBRIC,
    parity, iterations,
  };
}
function escapeHtml(value: string | number | undefined | null): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]!);
}
function confined(path: string, root: string): string {
  let ancestor = resolve(path);
  const suffix: string[] = [];
  for (;;) {
    try { lstatSync(ancestor); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      suffix.unshift(relative(parent, ancestor));
      ancestor = parent;
    }
  }
  const canonical = resolve(realpathSync(ancestor), ...suffix);
  const rel = relative(root, canonical);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("artifact path escapes the log workspace");
  return canonical;
}
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function compareTextLists(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const result = compareText(a[i]!, b[i]!);
    if (result) return result;
  }
  return a.length - b.length;
}
function imageStem(path: string): string { return basename(path, ".png"); }
function breakpoint(stem: string): number {
  const first = stem.split("-")[0]!;
  return /^\d+$/.test(first) ? Number(first) : 0;
}
function roundEven(value: number): number {
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + floor % 2 : Math.round(value);
}
function urlPath(path: string): string {
  return path.split(sep).map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}
function badge(status?: string): string {
  return status ? `<span class="badge b-${escapeHtml(status)}">${escapeHtml(status)}</span>` : "";
}
function render(log: DesignLog, root: string, out: string, inline: boolean): { html: string; shotCount: number } {
  const { rubric, parity, iterations } = log;
  const stateOrder = new Map((parity.states ?? []).map((state, index) => [String(state), index]));
  const variants = new Map<string, VariantEntry>();
  for (const iteration of iterations) for (const variant of iteration.variants) variants.set(variant.id, { iteration: iteration.id, variant });
  function weighted(variant: Variant): number | undefined {
    let numerator = 0, denominator = 0;
    for (const [key, weight] of Object.entries(rubric)) if (Object.hasOwn(variant.scores, key)) {
      numerator += variant.scores[key]! * weight;
      denominator += 5 * weight;
    }
    if (!denominator) return undefined;
    const value = 100 * numerator / denominator;
    if (!Number.isFinite(value)) throw new Error("weighted score exceeds the supported numeric range");
    return roundEven(value);
  }
  function predecessor(variant: Variant): Variant | undefined {
    const parent = variant.parent ? variants.get(variant.parent)?.variant : undefined;
    if (parent) return parent;
    let best: Variant | undefined, bestScore = -Infinity;
    for (const id of variant.mergedFrom) {
      const source = variants.get(id)?.variant;
      const score = source ? weighted(source) : undefined;
      if (score !== undefined && score > bestScore) { best = source; bestScore = score; }
    }
    return best;
  }
  function regressions(variant: Variant): string[] {
    const parent = predecessor(variant), flags: string[] = [];
    if (!parent) return flags;
    for (const key of Object.keys(rubric)) {
      const current = variant.scores[key], previous = parent.scores[key];
      if (Object.hasOwn(variant.scores, key) && Object.hasOwn(parent.scores, key) && current! <= previous! - 1) {
        flags.push(`${key} ${previous}→${current}`);
      }
    }
    for (const severity of ["4", "3"]) {
      const current = variant.nielsen[severity] ?? 0, previous = parent.nielsen[severity] ?? 0;
      if (current > previous) flags.push(`+${current - previous} Nielsen sev${severity}`);
    }
    return flags;
  }
  function rootOf(id: string): string {
    const seen = new Set<string>();
    for (;;) {
      const parent = variants.get(id)?.variant.parent;
      if (!parent || !variants.has(parent)) return id;
      if (seen.has(id)) throw new Error("variant lineage contains a cycle");
      seen.add(id); id = parent;
    }
  }
  function shotsFor(iteration: number, id: string): string[] {
    const directory = confined(join(root, "shots", `iter-${String(iteration).padStart(2, "0")}`, id), root);
    try { if (!statSync(directory).isDirectory()) return []; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const files = readdirSync(directory).filter((name) => name.endsWith(".png")).map((name) => join(directory, name));
    for (const path of files) confined(path, root);
    return files.sort((a, b) => {
      const as = imageStem(a), bs = imageStem(b), ast = as.split("-")[1] ?? "", bst = bs.split("-")[1] ?? "";
      return (stateOrder.get(ast) ?? 99) - (stateOrder.get(bst) ?? 99) || compareText(ast, bst) || breakpoint(as) - breakpoint(bs) || compareText(as, bs);
    });
  }
  function source(path: string): string {
    const safe = confined(path, root);
    return inline ? `data:image/png;base64,${readFileSync(safe).toString("base64")}` : escapeHtml(urlPath(relative(dirname(out), safe)));
  }

  const lineages = new Map<string, Map<number, Variant>>();
  for (const [id, { iteration, variant }] of variants) {
    const lineage = rootOf(id);
    if (!lineages.has(lineage)) lineages.set(lineage, new Map());
    lineages.get(lineage)!.set(iteration, variant);
  }
  const trend = ['<table class="trend"><thead><tr><th>Lineage</th>' + iterations.map((it) => `<th>Iter ${it.id}</th>`).join("") + "</tr></thead><tbody>"];
  for (const id of [...lineages.keys()].sort(compareText)) {
    const row = [`<tr><th>${escapeHtml(id)}</th>`];
    for (const iteration of iterations) {
      const variant = lineages.get(id)!.get(iteration.id);
      if (!variant) { row.push('<td class="empty">·</td>'); continue; }
      const score = weighted(variant), parent = predecessor(variant), previous = parent ? weighted(parent) : undefined;
      let delta = "";
      if (score !== undefined && previous !== undefined) {
        delta = score > previous ? `<span class="up">▲${score - previous}</span>` : score < previous ? `<span class="down">▼${previous - score}</span>` : '<span class="flat">=</span>';
      }
      const flags = regressions(variant);
      const flag = flags.length ? `<div class="flag" title="${escapeHtml(flags.join("; "))}">⚠ ${escapeHtml(flags[0])}${flags.length > 1 ? ` +${flags.length - 1}` : ""}</div>` : "";
      const merged = variant.mergedFrom.length ? `<div class="muted">← ${escapeHtml(variant.mergedFrom.join(", "))}</div>` : "";
      row.push(`<td><b>${escapeHtml(variant.id)}</b> ${score ?? "n/a"} ${delta} ${badge(variant.status)}${merged}${flag}</td>`);
    }
    trend.push(row.join("") + "</tr>");
  }
  trend.push("</tbody></table>");

  const allShots: { label: string; source: string }[] = [];
  const sections: string[] = [];
  for (const iteration of iterations) {
    const vs = iteration.variants;
    const head = `<section class="iter" id="iter-${iteration.id}">
<h2>Iteration ${iteration.id} <span class="muted">${escapeHtml(iteration.date)}</span></h2>
<dl class="meta">
${iteration.goal ? `<dt>Goal</dt><dd>${escapeHtml(iteration.goal)}</dd>` : ""}
${iteration.countRationale ? `<dt>Count</dt><dd>${escapeHtml(iteration.countRationale)}</dd>` : ""}
${iteration.feedback ? `<dt>Feedback</dt><dd>${escapeHtml(iteration.feedback)}</dd>` : ""}
${iteration.decision ? `<dt>Decision</dt><dd>${escapeHtml(iteration.decision)} <span class='muted'>(${escapeHtml(iteration.decidedBy)})</span></dd>` : ""}
</dl>`;
    const scores = ['<table class="scores"><thead><tr><th></th>' + vs.map((v) => `<th>${escapeHtml(v.id)} ${badge(v.status)}</th>`).join("") + "</tr></thead><tbody>"];
    scores.push("<tr><th>Thesis</th>" + vs.map((v) => `<td class='thesis'>${escapeHtml(v.thesis)}</td>`).join("") + "</tr>");
    if (vs.some((v) => Object.keys(v.axes).length)) scores.push("<tr><th>Axes</th>" + vs.map((v) => `<td>${escapeHtml(Object.entries(v.axes).map(([k, x]) => `${k}: ${x}`).join(", "))}</td>`).join("") + "</tr>");
    if (vs.some((v) => v.parent || v.mergedFrom.length)) scores.push("<tr><th>From</th>" + vs.map((v) => `<td>${escapeHtml(v.parent || v.mergedFrom.join(", ") || "none")}</td>`).join("") + "</tr>");
    for (const [key, weight] of Object.entries(rubric)) {
      scores.push(`<tr><th>${escapeHtml(key)} <span class='muted'>×${escapeHtml(weight)}</span></th>` + vs.map((v) => {
        const score = Object.hasOwn(v.scores, key) ? v.scores[key] : undefined;
        return `<td class='num s${escapeHtml(score)}'>${escapeHtml(score ?? "n/a")}</td>`;
      }).join("") + "</tr>");
    }
    scores.push("<tr class='total'><th>Weighted</th>" + vs.map((v) => `<td class='num'>${weighted(v) ?? "n/a"}</td>`).join("") + "</tr>");
    scores.push("<tr><th>Nielsen 4/3/2/1</th>" + vs.map((v) => `<td class='num'>${["4", "3", "2", "1"].map((s) => escapeHtml(v.nielsen[s] ?? 0)).join("/")}</td>`).join("") + "</tr>");
    scores.push("<tr><th>Slop flags</th>" + vs.map((v) => `<td class='num'>${escapeHtml(v.slopFlags ?? "n/a")}</td>`).join("") + "</tr>");
    if (vs.some((v) => v.notes)) scores.push("<tr><th>Notes</th>" + vs.map((v) => `<td class='thesis'>${escapeHtml(v.notes)}</td>`).join("") + "</tr>");
    scores.push("</tbody></table>");
    const byKey = new Map<string, Map<string, string>>();
    for (const variant of vs) for (const path of shotsFor(iteration.id, variant.id)) {
      const stem = imageStem(path);
      if (!byKey.has(stem)) byKey.set(stem, new Map());
      byKey.get(stem)!.set(variant.id, path);
      allShots.push({ label: `Iter ${iteration.id} · ${variant.id} · ${stem}`, source: source(path) });
    }
    const grid: string[] = [];
    if (byKey.size) {
      grid.push(`<div class="grid" style="--cols:${vs.length}"><div class="gh"></div>` + vs.map((v) => `<div class="gh">${escapeHtml(v.id)}</div>`).join(""));
      const keys = [...byKey.keys()].sort((a, b) => {
        const ap = a.split("-"), bp = b.split("-");
        return (stateOrder.get(ap[1] ?? "") ?? 99) - (stateOrder.get(bp[1] ?? "") ?? 99) || compareTextLists(ap.slice(1), bp.slice(1)) || breakpoint(a) - breakpoint(b);
      });
      for (const key of keys) {
        grid.push(`<div class="rk">${escapeHtml(key)}</div>`);
        for (const variant of vs) {
          const path = byKey.get(key)!.get(variant.id);
          grid.push(path ? `<figure><img loading="lazy" src="${source(path)}" alt="${escapeHtml(variant.id)} ${escapeHtml(key)}" onclick="zoom(this)"></figure>` : '<figure class="missing">no shot</figure>');
        }
      }
      grid.push("</div>");
    } else grid.push(`<p class="muted">No screenshots yet for this iteration (expected under shots/iter-${String(iteration.id).padStart(2, "0")}/&lt;variant&gt;/).</p>`);
    sections.push(head + scores.join("") + grid.join("") + "</section>");
  }

  const champion = [...iterations].reverse().map((it) => it.variants.find((v) => v.status === "champion")).find((v) => v !== undefined);
  let lineageHtml = "";
  if (champion) {
    const chain: Variant[] = [], seen = new Set<string>();
    let current: Variant | undefined = champion;
    while (current) {
      if (seen.has(current.id)) throw new Error("champion lineage contains a cycle");
      seen.add(current.id); chain.push(current);
      current = current.parent ? variants.get(current.parent)?.variant : undefined;
    }
    chain.reverse();
    const keys = new Map<string, Map<string, string>>();
    for (const variant of chain) for (const path of shotsFor(variants.get(variant.id)!.iteration, variant.id)) {
      const stem = imageStem(path);
      if (!keys.has(stem)) keys.set(stem, new Map());
      keys.get(stem)!.set(variant.id, path);
    }
    const rows = [`<div class="grid" style="--cols:${chain.length}"><div class="gh"></div>` + chain.map((v) => `<div class="gh">${escapeHtml(v.id)} <span class="muted">it${variants.get(v.id)!.iteration}</span></div>`).join("")];
    for (const key of [...keys.keys()].sort(compareText)) rows.push(`<div class="rk">${escapeHtml(key)}</div>` + chain.map((v) => {
      const path = keys.get(key)!.get(v.id);
      return path ? `<figure><img loading="lazy" src="${source(path)}" onclick="zoom(this)"></figure>` : '<figure class="missing">no shot</figure>';
    }).join(""));
    rows.push("</div>");
    lineageHtml = `<section id="lineage"><h2>Champion lineage: ${chain.map((v) => escapeHtml(v.id)).join(" → ")}</h2>${keys.size ? rows.join("") : "<p class=muted>No screenshots.</p>"}</section>`;
  }
  const fields: BoardFields = {
    title: escapeHtml(log.feature ?? "Design board"),
    brief: log.briefRef ? `<span class="muted">brief: ${escapeHtml(log.briefRef)}</span>` : "",
    champ: champion ? `Champion: <b>${escapeHtml(champion.id)}</b>: ${escapeHtml(champion.thesis)}` : "No champion yet",
    nav: iterations.map((it) => `<a href="#iter-${it.id}">Iter ${it.id}</a>`).join(" ") + (lineageHtml ? ' <a href="#lineage">Lineage</a>' : "") + ' <a href="#ab">A/B</a>',
    trend: trend.join(""), sections: sections.reverse().join(""), lineage: lineageHtml,
    opts: allShots.map((shot) => `<option value="${shot.source}">${escapeHtml(shot.label)}</option>`).join(""),
    parity: escapeHtml(Object.entries(parity).map(([key, values]) => `${key}: ${values.join(", ")}`).join(" · ")),
  };
  return { html: TEMPLATE.replace(/\{(title|brief|champ|nav|trend|sections|lineage|opts|parity)\}/g, (_, key: keyof BoardFields) => fields[key]), shotCount: allShots.length };
}
function options(args: string[]): Options {
  if (!args[0] || args[0].startsWith("--")) throw new Error(USAGE);
  const result: Options = { log: args[0], out: "board.html", inline: false };
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--inline") result.inline = true;
    else if (arg === "--out" && args[i + 1] && !args[i + 1]!.startsWith("--")) result.out = args[++i]!;
    else throw new Error(`unknown or incomplete option: ${arg}\n${USAGE}`);
  }
  return result;
}
function main(): void {
  if (process.argv.slice(2).includes("--help")) { console.log(USAGE); return; }
  const args = options(process.argv.slice(2));
  const logPath = realpathSync(resolve(args.log)), root = dirname(logPath);
  const out = confined(isAbsolute(args.out) ? args.out : join(root, args.out), root);
  const log = parseLog(JSON.parse(readFileSync(logPath, "utf8")) as unknown);
  const board = render(log, root, out, args.inline);
  writeFileSync(confined(out, root), board.html);
  console.log(`wrote ${out} (${board.shotCount} shots, ${log.iterations.length} iterations${args.inline ? ", inline" : ""})`);
}

const TEMPLATE = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · design board</title>
<style>
:root{--bg:#f6f5f2;--fg:#1d1c1a;--muted:#6f6b63;--line:#dedad2;--card:#fff;--accent:#0b6e4f;--up:#0b6e4f;--down:#b42318;--warn:#9a6700}
@media (prefers-color-scheme:dark){:root{--bg:#151513;--fg:#ecebe7;--muted:#9b978e;--line:#2f2e2a;--card:#1d1d1a;--accent:#4cc38a;--up:#4cc38a;--down:#ff7b72;--warn:#d29922}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 20px;display:flex;flex-wrap:wrap;gap:6px 24px;align-items:baseline}
header h1{font-size:16px;margin:0;letter-spacing:-.01em}nav a{color:var(--fg);margin-right:12px;text-decoration:none;border-bottom:1px solid var(--line)}nav a:hover{border-color:var(--accent)}
main{padding:16px 20px 80px;max-width:1600px}h2{font-size:15px;margin:32px 0 8px}.muted{color:var(--muted);font-weight:400}
table{border-collapse:collapse;background:var(--card);border:1px solid var(--line);margin:8px 0 16px;font-variant-numeric:tabular-nums}th,td{border-bottom:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}thead th{font-weight:600}tbody th{font-weight:500;white-space:nowrap}
.num{text-align:right}.thesis{max-width:260px;color:var(--muted)}.total td{font-weight:700}.s1,.s2{color:var(--down)}.s5{color:var(--up);font-weight:600}
.up{color:var(--up)}.down{color:var(--down)}.flat{color:var(--muted)}.flag{color:var(--warn);font-size:12px}.empty{color:var(--line)}
.badge{font-size:11px;padding:1px 6px;border-radius:3px;border:1px solid var(--line);color:var(--muted)}.b-champion{border-color:var(--accent);color:var(--accent);font-weight:600}.b-dropped{text-decoration:line-through}
dl.meta{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:0 0 8px}dt{color:var(--muted)}dd{margin:0}
.grid{display:grid;grid-template-columns:120px repeat(var(--cols),minmax(160px,1fr));gap:8px;align-items:start}.gh{font-weight:600;position:sticky;top:52px;background:var(--bg);padding:4px 0}.rk{font:12px ui-monospace,monospace;color:var(--muted);padding-top:4px}
figure{margin:0;background:var(--card);border:1px solid var(--line)}figure img{display:block;width:100%;height:auto;max-height:520px;object-fit:cover;object-position:top;cursor:zoom-in}.missing{padding:24px;text-align:center;color:var(--muted);font-size:12px}
#ab .ctl{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}select{max-width:420px;font:inherit;background:var(--card);color:var(--fg);border:1px solid var(--line);padding:4px}
.ab-side{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ab-over{position:relative;display:inline-block;max-width:100%}.ab-over img{display:block;max-width:100%}.ab-over img+img{position:absolute;inset:0}
#zoom{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:flex-start;justify-content:center;overflow:auto;z-index:10;padding:20px;cursor:zoom-out}#zoom img{max-width:100%}
@media (max-width:700px){.grid{grid-template-columns:80px repeat(var(--cols),minmax(140px,1fr));overflow-x:auto}.ab-side{grid-template-columns:1fr}}
</style></head><body>
<header><h1>{title}</h1><span>{champ}</span>{brief}<nav>{nav}</nav></header>
<main>
<h2>Score trend <span class="muted">weighted /100 · ▲▼ vs parent (or best merge source) · ⚠ regression</span></h2>{trend}
<p class="muted">Parity: {parity}</p>
{sections}
{lineage}
<section id="ab"><h2>A/B compare <span class="muted">any two shots, same or different iterations</span></h2>
<div class="ctl"><select id="a">{opts}</select><select id="b">{opts}</select>
<label><input type="radio" name="m" value="side" checked> side by side</label><label><input type="radio" name="m" value="over"> overlay</label>
<input id="op" type="range" min="0" max="100" value="50" aria-label="overlay opacity"></div>
<div id="abv"></div></section>
</main><div id="zoom" onclick="this.style.display='none'"><img alt=""></div>
<script>
function zoom(i){var z=document.getElementById('zoom');z.querySelector('img').src=i.src;z.style.display='flex'}
var A=document.getElementById('a'),B=document.getElementById('b'),O=document.getElementById('op'),V=document.getElementById('abv');
if(B.options.length>1)B.selectedIndex=1;
function r(){var m=document.querySelector('input[name=m]:checked').value;
V.replaceChildren();
if(!A.value){var p=document.createElement('p');p.className='muted';p.textContent='No screenshots yet.';V.append(p);return}
var wrap=document.createElement('div');wrap.className=m=='side'?'ab-side':'ab-over';
[A.value,B.value].forEach(function(src,index){
var img=document.createElement('img');img.src=src;
if(m=='side'){var figure=document.createElement('figure');figure.append(img);wrap.append(figure)}
else{if(index==1){img.id='ovb';img.style.opacity=O.value/100}wrap.append(img)}
});V.append(wrap);}
[A,B,O].forEach(function(e){e.addEventListener('input',r)});document.querySelectorAll('input[name=m]').forEach(function(e){e.addEventListener('change',r)});r();
</script></body></html>`;

try { main(); }
catch (error) { console.error(`error: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
