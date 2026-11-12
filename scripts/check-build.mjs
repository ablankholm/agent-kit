#!/usr/bin/env node
// Compile into a temporary directory and compare every generated file to the release.
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const compiler = join(root, "node_modules/typescript/bin/tsc");
const output = join(root, "plugins/ui-ux-design-council/skills/ui-ux-design-council/scripts");
if (!existsSync(compiler)) {
  console.error("Run npm ci to install development dependencies before checking the build.");
  process.exit(1);
}
const temporary = mkdtempSync(join(tmpdir(), "agent-kit-build-"));
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
try {
  const compiled = spawnSync(process.execPath, [compiler, "--project", join(root, "tsconfig.json"), "--outDir", temporary], { cwd: root, stdio: "inherit" });
  if (compiled.error) throw compiled.error;
  if (compiled.status !== 0) throw new Error("TypeScript compilation failed.");
  const generated = files(temporary);
  if (!generated.length) throw new Error("The TypeScript build produced no files.");
  for (const file of generated) {
    const destination = join(output, relative(temporary, file));
    if (!existsSync(destination) || !readFileSync(file).equals(readFileSync(destination))) {
      throw new Error(`Generated file is missing or stale: ${relative(root, destination)}. Run npm run build and commit the output.`);
    }
  }
  console.log(`Generated output matches TypeScript source (${generated.length} file${generated.length === 1 ? "" : "s"}).`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
