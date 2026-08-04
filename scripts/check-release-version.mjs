#!/usr/bin/env node
/**
 * 检查发布版本是否与 git tag 一致。
 * 由 CI 在 release 流程中调用。
 * 防止误打 tag 或忘记更新 manifest.json/package.json。
 */

import { readFileSync } from "fs";

const GITHUB_REF = process.env.GITHUB_REF || "";
if (!GITHUB_REF) {
  console.log("  (not in CI, skipping version check)");
  process.exit(0);
}

// 从 refs/tags/v0.5.0 提取 0.5.0
const tagVersion = GITHUB_REF.replace(/^refs\/tags\/v?/, "");
if (!tagVersion) {
  console.error("ERROR: could not parse version from GITHUB_REF:", GITHUB_REF);
  process.exit(1);
}

console.log(`  tag: v${tagVersion}`);

// 检查 package.json
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (pkg.version !== tagVersion) {
  console.error(
    `ERROR: package.json version (${pkg.version}) does not match tag (${tagVersion}).\n` +
    `  Run: npm version ${tagVersion} --no-git-tag-version`
  );
  process.exit(1);
}
console.log(`  package.json: ✓ (${pkg.version})`);

// 检查 manifest.json
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
if (manifest.version !== tagVersion) {
  console.error(
    `ERROR: manifest.json version (${manifest.version}) does not match tag (${tagVersion}).\n` +
    `  Update manifest.json to match.`
  );
  process.exit(1);
}
console.log(`  manifest.json: ✓ (${manifest.version})`);

// 检查 versions.json
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
if (!(tagVersion in versions)) {
  console.error(
    `ERROR: versions.json missing entry for ${tagVersion}.\n` +
    `  Add: "${tagVersion}": "1.5.0"`
  );
  process.exit(1);
}
console.log(`  versions.json: ✓ (${tagVersion} → minAppVersion ${versions[tagVersion]})`);

console.log("\n✅ All version checks passed.");
