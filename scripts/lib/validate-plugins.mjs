import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// Catalogs describe supported hosts. A shipped host manifest must be registered,
// while a plugin shared by both hosts must use one source and release version.
export function validatePlugins({ root, files, readJSON, fail }) {
  const hosts = [
    { name: "Claude", directory: ".claude-plugin", catalog: ".claude-plugin/marketplace.json" },
    { name: "Codex", directory: ".codex-plugin", catalog: ".agents/plugins/marketplace.json" },
  ];
  const inside = (base, path) => {
    const rel = relative(base, path);
    return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  function localDirectory(base, value, label) {
    if (typeof value !== "string" || !value.startsWith("./") || value.includes("\\")) {
      fail(`${label}: expected a relative path beginning with ./`);
      return null;
    }
    const path = resolve(base, value);
    if (!inside(base, path) || !existsSync(path) || !inside(base, realpathSync(path)) || !lstatSync(path).isDirectory()) {
      fail(`${label}: directory is missing or resolves outside its package`);
      return null;
    }
    return path;
  }
  function catalog(host) {
    const entries = new Map();
    const manifest = readJSON(join(root, host.catalog));
    if (!Array.isArray(manifest?.plugins)) {
      fail(`${host.name}: marketplace must have a plugins array`);
      return entries;
    }
    for (const plugin of manifest.plugins) {
      if (!plugin || typeof plugin.name !== "string" || !plugin.name) {
        fail(`${host.name}: plugin is missing its name`);
        continue;
      }
      if (entries.has(plugin.name)) fail(`${host.name}: duplicate plugin ${plugin.name}`);
      if (host.name === "Codex" && plugin.source?.source !== "local") {
        fail(`${host.name}: ${plugin.name} must use a local marketplace source`);
      }
      entries.set(plugin.name, host.name === "Claude" ? plugin.source : plugin.source?.path);
    }
    return entries;
  }
  function checkHooks(path) {
    const hookFile = join(path, "hooks/hooks.json");
    if (!existsSync(hookFile)) return false;
    const config = readJSON(hookFile);
    if (!config?.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks) || !Object.keys(config.hooks).length) {
      fail(`${relative(root, hookFile)}: expected a nonempty hooks event map`);
      return false;
    }
    let handlers = 0;
    const handlerFields = new Map([["command", "command"], ["prompt", "prompt"], ["agent", "prompt"], ["http", "url"]]);
    for (const [event, entries] of Object.entries(config.hooks)) {
      if (!event || !Array.isArray(entries) || !entries.length) {
        fail(`${relative(root, hookFile)}: ${event || "unnamed event"} has no hook entries`);
        continue;
      }
      for (const entry of entries) {
        if (!Array.isArray(entry?.hooks) || !entry.hooks.length) {
          fail(`${relative(root, hookFile)}: ${event} has no hook handlers`);
          continue;
        }
        for (const hook of entry.hooks) {
          const field = handlerFields.get(hook?.type);
          if (!field) {
            fail(`${relative(root, hookFile)}: ${event} handler has an unsupported or missing type`);
          } else if (typeof hook[field] !== "string" || !hook[field].trim()) {
            fail(`${relative(root, hookFile)}: ${event} ${hook.type} handler has no ${field}`);
          } else {
            handlers++;
          }
        }
      }
    }
    return handlers > 0;
  }

  const catalogs = hosts.map((host) => catalog(host));
  const registered = new Set();
  const claudePaths = new Set();
  const components = new Map();
  for (const name of new Set(catalogs.flatMap((entries) => [...entries.keys()]))) {
    const manifests = [];
    if (catalogs.every((entries) => entries.has(name)) && catalogs[0].get(name) !== catalogs[1].get(name)) {
      fail(`${name}: marketplace source paths differ`);
    }
    for (let index = 0; index < hosts.length; index++) {
      const host = hosts[index];
      if (!catalogs[index].has(name)) continue;
      const path = localDirectory(root, catalogs[index].get(name), `${name}: ${host.name} marketplace source`);
      if (!path) continue;
      if (host.name === "Claude") claudePaths.add(path);
      const manifestPath = join(path, host.directory, "plugin.json");
      registered.add(manifestPath);
      const manifest = readJSON(manifestPath);
      manifests.push(manifest);
      if (manifest?.name !== name) fail(`${name}: ${host.name} manifest has a different name`);
      if (!/^\d+\.\d+\.\d+$/.test(manifest?.version ?? "")) fail(`${name}: ${host.name} version must use major.minor.patch`);
      if (!components.has(path)) {
        const skillsDirectory = join(path, "skills");
        const hasSkill = files.some((file) => basename(file) === "SKILL.md" && dirname(dirname(file)) === skillsDirectory);
        const hasHooks = checkHooks(path);
        if (!hasSkill && !hasHooks) fail(`${name}: plugin has no skills or configured hooks`);
        components.set(path, { hasSkill });
      }
      if (host.name === "Codex" && (components.get(path).hasSkill || manifest?.skills !== undefined)) {
        if (manifest?.skills !== "./skills/") fail(`${name}: expected shared ./skills/ directory`);
        localDirectory(path, manifest?.skills, `${name}: skills`);
      }
    }
    if (manifests.length === 2 && manifests[0]?.version !== manifests[1]?.version) {
      fail(`${name}: plugin versions differ between hosts`);
    }
  }
  for (const file of files) {
    const host = hosts.find((value) => basename(dirname(file)) === value.directory);
    if (host && basename(file) === "plugin.json" && !registered.has(file)) {
      fail(`${relative(root, file)}: manifest is not registered in the ${host.name} marketplace`);
    }
  }
  return [...claudePaths];
}
