import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, cpSync, rmSync, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateExtension, extensionDir } from "../scripts/validate-extension.js";
import { createStoreManifest, validateManifestIdentity } from "../scripts/store-manifest.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

test("upload manifest removes only the development key without mutating source", () => {
  const source = JSON.parse(readFileSync(join(extensionDir, "manifest.json"), "utf8"));
  const original = structuredClone(source);
  const upload = createStoreManifest(source);
  assert.deepEqual(source, original);
  assert.equal(Object.hasOwn(upload, "key"), false);
  assert.deepEqual({ ...upload, key: source.key }, source);
  assert.throws(() => validateManifestIdentity(source, { webStore: true }), /must not contain/);
  assert.throws(() => validateManifestIdentity(upload), /development public key/);
});

test("upload validation accepts a keyless manifest and rejects an included key", () => {
  const root = mkdtempSync(join(tmpdir(), "hello-lock-upload-test-"));
  try {
    cpSync(extensionDir, root, { recursive: true });
    assert.throws(() => validateExtension(root, { webStore: true }), /must not contain/);
    const source = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    writeFileSync(join(root, "manifest.json"), JSON.stringify(createStoreManifest(source)));
    assert.equal(validateExtension(root, { webStore: true }).manifest.version, source.version);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("actual Web Store ZIP is reproducible, keyless, and preserves development manifest", { skip: process.platform !== "win32" }, () => {
  const output = mkdtempSync(join(tmpdir(), "hello-lock-zip-test-"));
  const manifestPath = join(extensionDir, "manifest.json");
  const original = readFileSync(manifestPath);
  const source = JSON.parse(original.toString("utf8"));
  const script = fileURLToPath(new URL("../scripts/package.ps1", import.meta.url));
  function build() {
    const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-OutputDirectory", output], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return readFileSync(join(output, `chrome-hello-lock-${source.version}-webstore.zip`));
  }
  try {
    const zip = build();
    assert.deepEqual(build(), zip);
    assert.deepEqual(readFileSync(manifestPath), original);
    assert.equal(zip.includes(Buffer.from(source.key)), false);
    // Read the actual manifest entry from the ZIP local headers. .NET may use
    // deflate with level zero even when NoCompression is requested.
    let offset = 0, found = false;
    while (zip.readUInt32LE(offset) === 0x04034b50) {
      const method = zip.readUInt16LE(offset + 8);
      assert.ok([0, 8].includes(method), "Expected stored or deflated ZIP entry.");
      assert.equal(zip.readUInt16LE(offset + 6) & 8, 0, "Expected entry size in local header.");
      const size = zip.readUInt32LE(offset + 18);
      const nameLength = zip.readUInt16LE(offset + 26);
      const extraLength = zip.readUInt16LE(offset + 28);
      const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
      const start = offset + 30 + nameLength + extraLength;
      if (name === "manifest.json") {
        const data = zip.subarray(start, start + size);
        const bytes = method === 8 ? inflateRawSync(data) : data;
        assert.deepEqual(JSON.parse(bytes.toString("utf8")), createStoreManifest(source));
        found = true;
      }
      offset = start + size;
    }
    assert.equal(found, true, "manifest.json must be at ZIP root.");
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test("extension package includes every referenced bundled resource", () => {
  const { manifest, files } = validateExtension();
  assert.equal(manifest.version, "0.5.0");
  assert.ok(files.includes("manifest.json"));
  assert.ok(files.includes("lock.html"));
});

test("package validation rejects missing files and accidental secrets", () => {
  const root = mkdtempSync(join(tmpdir(), "hello-lock-package-test-"));
  try {
    cpSync(extensionDir, root, { recursive: true });
    writeFileSync(join(root, ".env"), "TEST_ONLY=not-a-secret");
    assert.throws(() => validateExtension(root), /Unexpected package file/);
    unlinkSync(join(root, ".env"));
    unlinkSync(join(root, "ui.css"));
    assert.throws(() => validateExtension(root), /Missing or incorrectly cased/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
