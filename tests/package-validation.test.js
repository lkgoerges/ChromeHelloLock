import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, cpSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateExtension, extensionDir } from "../scripts/validate-extension.js";

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
