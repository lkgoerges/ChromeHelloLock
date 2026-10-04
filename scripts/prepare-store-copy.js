import { createHash, createPublicKey } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { extensionDir, validateExtension } from "./validate-extension.js";
import { createStoreManifest } from "./store-manifest.js";

// This is a public identity record, not a private credential.
export const storeIdentity = JSON.parse(readFileSync(new URL("../config/webstore-identity.json", import.meta.url), "utf8"));

export function extensionIdFromKey(publicKey) {
  if (typeof publicKey !== "string") throw new Error("Public key must be a base64 string.");
  const bytes = Buffer.from(publicKey, "base64");
  if (bytes.toString("base64") !== publicKey) throw new Error("Public key must be canonical base64 DER.");
  createPublicKey({ key: bytes, format: "der", type: "spki" });
  return createHash("sha256").update(bytes).digest("hex").slice(0, 32)
    .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
}

export function prepareStoreTest(destination, identity = storeIdentity) {
  const { manifest, files } = validateExtension();
  const itemId = extensionIdFromKey(identity.publicKey);
  if (itemId !== identity.itemId) throw new Error("Store public key does not match the expected item ID.");
  const target = resolve(destination || fileURLToPath(new URL(`../artifacts/store-test-${manifest.version}-${itemId}/`, import.meta.url)));
  const sourceRelationship = relative(target, extensionDir);
  const targetRelationship = relative(extensionDir, target);
  // Do not copy into the source, its parent, or any existing directory.
  const inside = path => path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
  if (inside(sourceRelationship) || inside(targetRelationship) || existsSync(target)) {
    throw new Error("Choose a new directory separate from the working extension; existing directories are never overwritten.");
  }
  const testManifest = { ...createStoreManifest(manifest), key: identity.publicKey };
  mkdirSync(dirname(target), { recursive: true });
  cpSync(extensionDir, target, { recursive: true, errorOnExist: true, force: false });
  writeFileSync(resolve(target, "manifest.json"), JSON.stringify(testManifest, null, 2) + "\n");
  validateExtension(target);
  for (const name of files.filter(name => name !== "manifest.json")) {
    if (!readFileSync(resolve(extensionDir, name)).equals(readFileSync(resolve(target, name)))) {
      throw new Error(`Test-copy resource differs from source: ${name}`);
    }
  }
  return { target, itemId, version: manifest.version };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = prepareStoreTest(process.argv[2]);
  console.log(`Prepared ${result.version} test copy: ${result.target}\nExpected Chrome ID: ${result.itemId}\nLoad only in a separate Chrome test profile; enroll a fresh Windows Hello credential.`);
}
