import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { extensionIdFromKey, prepareStoreTest, storeIdentity } from "../scripts/prepare-store-copy.js";
import { extensionDir, validateExtension } from "../scripts/validate-extension.js";
import { createStoreManifest } from "../scripts/store-manifest.js";

test("store public key derives exactly the confirmed draft ID", () => {
  assert.equal(extensionIdFromKey(storeIdentity.publicKey), "jbejgimbnefhlkallnbldiholhojpogi");
  assert.throws(() => extensionIdFromKey("invalid"), /canonical base64/);
});

test("store test copy changes only identity and preserves the working installation", () => {
  const root = mkdtempSync(join(tmpdir(), "hello-store-identity-test-"));
  const sourcePath = join(extensionDir, "manifest.json");
  const original = readFileSync(sourcePath);
  const destination = join(root, "unpacked");
  try {
    const result = prepareStoreTest(destination);
    const { manifest, files } = validateExtension(result.target);
    const source = JSON.parse(original.toString("utf8"));
    assert.equal(extensionIdFromKey(manifest.key), storeIdentity.itemId);
    assert.equal(extensionIdFromKey(source.key), "bodeojcofhnjbhebeapdokhabmimcjmm");
    assert.deepEqual(createStoreManifest(manifest), createStoreManifest(source));
    for (const name of files.filter(name => name !== "manifest.json")) {
      assert.deepEqual(readFileSync(join(destination, name)), readFileSync(join(extensionDir, name)));
    }
    assert.deepEqual(readFileSync(sourcePath), original);
    assert.throws(() => prepareStoreTest(destination), /never overwritten/);
    assert.throws(() => prepareStoreTest(extensionDir), /never overwritten/);
    assert.throws(() => prepareStoreTest(dirname(extensionDir)), /never overwritten/);
    assert.throws(() => prepareStoreTest(join(extensionDir, "nested")), /never overwritten/);
    const mismatched = join(root, "mismatched");
    assert.throws(() => prepareStoreTest(mismatched, { ...storeIdentity, itemId: "wrong" }), /does not match/);
    assert.equal(existsSync(mismatched), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
