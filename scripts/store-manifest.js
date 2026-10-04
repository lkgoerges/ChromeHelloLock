import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function validateManifestIdentity(manifest, { webStore = false } = {}) {
  if (webStore) {
    if (Object.hasOwn(manifest, "key")) throw new Error("Web Store upload manifests must not contain the development key.");
  } else if (!manifest.key || manifest.key.length < 100) {
    throw new Error("Stable development public key is missing.");
  }
}

export function createStoreManifest(manifest) {
  validateManifestIdentity(manifest);
  const { key, ...uploadManifest } = manifest;
  validateManifestIdentity(uploadManifest, { webStore: true });
  return uploadManifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  process.stdout.write(JSON.stringify(createStoreManifest(manifest), null, 2) + "\n");
}
