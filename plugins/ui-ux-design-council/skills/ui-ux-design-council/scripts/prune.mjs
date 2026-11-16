// Reclaim screenshots from old iterations mid-session, without breaking the board.
//
//   node prune.mjs <workspace>/log.json [--keep N] [--min MB] [--yes]
//
// Keeps: the newest N iterations (default 2), every champion, every parked
// variant, and the whole ancestry of the current champion (the lineage view
// renders that chain across iterations). Drops: shots for challengers that
// lost in older iterations, orphan shot directories, and stray inline board
// files over 20MB that are not the current board.html.
//
// Dry run unless --yes. Never touches anything outside the workspace directory.
import { lstatSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const STRAY_BOARD_BYTES = 20 * 1024 * 1024;

function fail(message) {
    console.error(`prune: ${message}`);
    process.exit(2);
}
function confined(path, root) {
    let ancestor = resolve(path);
    const suffix = [];
    for (;;) {
        try {
            lstatSync(ancestor);
            break;
        }
        catch (error) {
            if (error.code !== "ENOENT") throw error;
            const parent = dirname(ancestor);
            if (parent === ancestor) throw error;
            suffix.unshift(relative(parent, ancestor));
            ancestor = parent;
        }
    }
    const canonical = resolve(realpathSync(ancestor), ...suffix);
    const rel = relative(root, canonical);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
        throw new Error("path escapes the workspace");
    return canonical;
}
function bytes(path) {
    let total = 0;
    const stack = [path];
    while (stack.length) {
        const current = stack.pop();
        let info;
        try { info = lstatSync(current); } catch { continue; }
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) {
            for (const entry of readdirSync(current)) stack.push(join(current, entry));
        }
        else total += info.size;
    }
    return total;
}
function human(value) {
    if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)}G`;
    if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)}M`;
    if (value >= 1024) return `${Math.round(value / 1024)}K`;
    return `${value}B`;
}
function options(argv) {
    const args = { keep: 2, min: 0, yes: false, log: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--yes" || arg === "-y") args.yes = true;
        else if (arg === "--keep" || arg === "--min") {
            const value = Number(argv[++i]);
            if (!Number.isFinite(value) || value < 0) fail(`${arg} needs a non-negative number`);
            if (arg === "--keep") args.keep = Math.floor(value);
            else args.min = Math.floor(value) * 1024 * 1024;
        }
        else if (arg.startsWith("-")) fail(`unknown argument: ${arg}`);
        else if (args.log === null) args.log = arg;
        else fail("pass exactly one log.json path");
    }
    if (!args.log) fail("usage: node prune.mjs <workspace>/log.json [--keep N] [--min MB] [--yes]");
    return args;
}

const args = options(process.argv.slice(2));
let logPath;
try { logPath = realpathSync(resolve(args.log)); }
catch { fail(`no such log: ${args.log}`); }
const root = dirname(logPath);
let log;
try { log = JSON.parse(readFileSync(logPath, "utf8")); }
catch (error) { fail(`cannot read ${args.log}: ${error.message}`); }
if (!Array.isArray(log?.iterations)) fail("log has no iterations array; refusing to guess what is disposable");

// Index every variant, then work out what the board still renders.
const variants = new Map();   // variant id -> {iteration, status, parent, mergedFrom}
const perIteration = new Map(); // iteration id -> Set(variant ids)
let newest = -1;
for (const iteration of log.iterations) {
    const id = Number(iteration?.id);
    if (!Number.isInteger(id) || id < 0) fail("an iteration has a non-integer id; refusing to prune");
    newest = Math.max(newest, id);
    const ids = new Set();
    for (const variant of Array.isArray(iteration.variants) ? iteration.variants : []) {
        if (typeof variant?.id !== "string" || !variant.id) continue;
        ids.add(variant.id);
        variants.set(variant.id, {
            iteration: id,
            status: typeof variant.status === "string" ? variant.status : "",
            parent: typeof variant.parent === "string" ? variant.parent : null,
            mergedFrom: Array.isArray(variant.merged_from) ? variant.merged_from.filter((v) => typeof v === "string") : [],
        });
    }
    perIteration.set(id, ids);
}
if (newest < 0) fail("log contains no iterations");

const keepIterations = new Set();
for (const id of perIteration.keys()) if (id > newest - args.keep) keepIterations.add(id);

// The champion lineage stays whole: the board draws A1 -> A2 -> A3 side by side.
const keepVariants = new Set();
for (const [id, variant] of variants) {
    if (variant.status === "champion" || variant.status === "parked" || variant.status === "") keepVariants.add(id);
}
let champion = null;
for (const [id, variant] of variants) {
    if (variant.status !== "champion") continue;
    if (!champion || variant.iteration > variants.get(champion).iteration) champion = id;
}
const visited = new Set();
const pending = champion ? [champion] : [];
while (pending.length) {
    const id = pending.pop();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    keepVariants.add(id);
    const variant = variants.get(id);
    if (!variant) continue;
    for (const ancestor of [variant.parent, ...variant.mergedFrom]) if (ancestor) pending.push(ancestor);
}

const plan = [];
const shotsRoot = join(root, "shots");
let iterationDirs = [];
try { iterationDirs = readdirSync(shotsRoot, { withFileTypes: true }); } catch { /* no shots yet */ }
for (const entry of iterationDirs) {
    const match = /^iter-(\d+)$/.exec(entry.name);
    if (!entry.isDirectory() || !match) continue;
    const iteration = Number(match[1]);
    if (keepIterations.has(iteration)) continue;
    const iterationPath = confined(join(shotsRoot, entry.name), root);
    for (const variantEntry of readdirSync(iterationPath, { withFileTypes: true })) {
        if (!variantEntry.isDirectory()) continue;
        const known = perIteration.get(iteration)?.has(variantEntry.name);
        if (known && keepVariants.has(variantEntry.name)) continue;
        const path = confined(join(iterationPath, variantEntry.name), root);
        const why = !known
            ? `orphan shots, no variant ${variantEntry.name} in iteration ${iteration}`
            : `iteration ${iteration} ${variants.get(variantEntry.name)?.status || "variant"} ${variantEntry.name}, superseded`;
        plan.push({ path, size: bytes(path), why });
    }
}
// Inline boards are enormous; only the current board.html is worth keeping.
for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".html") || entry.name === "board.html") continue;
    const path = confined(join(root, entry.name), root);
    const size = statSync(path).size;
    if (size >= STRAY_BOARD_BYTES) plan.push({ path, size, why: "stray inline board, regenerate from log.json" });
}

const total = plan.reduce((sum, item) => sum + item.size, 0);
const feature = log.feature || relative(dirname(root), root);
if (!plan.length) {
    console.log(`${feature}: nothing to prune (keeping the newest ${args.keep} iteration(s) and the champion lineage)`);
    process.exit(0);
}
if (total < args.min) {
    console.log(`${feature}: ${human(total)} prunable, below the ${human(args.min)} threshold; staying quiet`);
    process.exit(0);
}
console.log(`${feature}: prune plan (keeping iterations ${[...keepIterations].sort((a, b) => a - b).join(", ") || "none"} and the champion lineage ${[...keepVariants].sort().join(", ") || "none"})`);
for (const item of plan.sort((a, b) => b.size - a.size)) {
    console.log(`  rm  ${human(item.size).padStart(5)}  ${relative(root, item.path)}  # ${item.why}`);
}
console.log(`  frees  ~${human(total)}`);
if (!args.yes) {
    console.log("dry run. re-run with --yes to delete.");
    process.exit(0);
}
let freed = 0;
for (const item of plan) {
    try { rmSync(item.path, { recursive: true, force: true }); freed += item.size; }
    catch (error) { console.error(`  could not remove ${relative(root, item.path)}: ${error.message}`); }
}
console.log(`pruned ${human(freed)}; the board shows "no shot" where pruned variants used to render`);
