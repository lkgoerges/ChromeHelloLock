import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const extensionDir = fileURLToPath(new URL("../extension/", import.meta.url));

export function validateExtension(root = extensionDir) {
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Symlinks are not allowed.");
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
      else throw new Error(`Unsupported file: ${path}`);
    }
  }
  walk(root);
  files.sort();
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
  if (manifest.manifest_version !== 3) throw new Error("Manifest V3 is required.");
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version)) throw new Error("Invalid extension version.");
  if (!manifest.key || manifest.key.length < 100) throw new Error("Stable public key is missing.");
  if (!manifest.description || manifest.description.length > 132) throw new Error("Description must be 1–132 characters.");
  if (JSON.stringify([...manifest.permissions].sort()) !== JSON.stringify(["alarms", "storage", "tabs"])) throw new Error("Unexpected or missing permissions.");
  for (const name of ["host_permissions", "optional_host_permissions", "optional_permissions", "content_scripts", "externally_connectable", "web_accessible_resources"]) {
    if (name in manifest) throw new Error(`Unexpected capability: ${name}`);
  }
  if (manifest.version !== JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version) throw new Error("Manifest and package versions differ.");
  function requireFile(reference, parent = "manifest.json") {
    if (!reference || /^(?:[a-z]+:|\/\/|\/)/i.test(reference)) throw new Error(`Non-bundled resource: ${reference}`);
    const path = relative(root, resolve(root, dirname(parent), reference)).split(sep).join("/");
    if (path.startsWith("../") || !files.includes(path)) throw new Error(`Missing or incorrectly cased resource: ${reference} in ${parent}`);
  }
  requireFile(manifest.background.service_worker);
  if (manifest.background.type !== "module") throw new Error("Module service worker is required.");
  requireFile(manifest.options_page);
  requireFile(manifest.action.default_popup);
  for (const icon of [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) requireFile(icon);
  for (const path of files) {
    if (!/^(?:[a-z0-9-]+\.(?:js|css|html)|manifest\.json|icons\/icon-(?:16|32|48|128)\.png)$/.test(path)) throw new Error(`Unexpected package file: ${path}`);
    const bytes = readFileSync(resolve(root, path));
    if (!bytes.length) throw new Error(`Empty resource: ${path}`);
    const source = bytes.toString("utf8");
    if (path.endsWith(".js")) {
      const result = spawnSync(process.execPath, ["--check", resolve(root, path)], { encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr || `Invalid JavaScript: ${path}`);
      for (const match of source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)["']([^"']+)["']/g)) requireFile(match[1], path);
      for (const match of source.matchAll(/\bgetURL\(["']([^"']+)["']\)/g)) requireFile(match[1], path);
    }
    if (path.endsWith(".html")) {
      for (const match of source.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) requireFile(match[1], path);
      if (/<script\b[^>]*>\s*\S[\s\S]*?<\/script>/i.test(source) || /\son\w+\s*=/i.test(source)) throw new Error(`Inline executable code: ${path}`);
    }
    if (path.endsWith(".css")) {
      if (/@import\b/i.test(source)) throw new Error(`CSS imports are not allowed: ${path}`);
      for (const match of source.matchAll(/url\(["']?([^"')]+)["']?\)/g)) requireFile(match[1], path);
    }
  }
  return { manifest, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { manifest, files } = validateExtension(process.argv[2] ? resolve(process.argv[2]) : extensionDir);
  console.log(`Validated Chrome Hello Lock ${manifest.version}: ${files.length} bundled files.`);
}
