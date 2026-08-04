#!/usr/bin/env node
/**
 * 创建 release 包（obsidian-ai-whispers.zip）。
 * 包含 Obsidian 插件所需的三个文件：
 *   main.js, styles.css, manifest.json
 *
 * 由 CI 在 release 流程中调用，也可本地手动运行。
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import * as path from "path";

const ROOT = process.cwd();

// 确认构建产物存在
const REQUIRED = ["main.js", "styles.css", "manifest.json"];
for (const f of REQUIRED) {
  if (!existsSync(path.join(ROOT, f))) {
    console.error(`ERROR: ${f} not found. Run 'npm run build' first.`);
    process.exit(1);
  }
}

// 读取版本信息
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const version = manifest.version;
console.log(`  version: ${version}`);

// 创建 release 包
const zipName = "obsidian-ai-whispers.zip";
const zipArgs = ["zip", "-j", "-X", zipName, ...REQUIRED];

try {
  execSync(zipArgs.join(" "), { cwd: ROOT, stdio: "pipe" });
} catch (e) {
  console.error("ERROR: failed to create zip:", e.stderr?.toString() || e.message);
  process.exit(1);
}

// 统计大小
const stats = REQUIRED.map((f) => {
  const size = existsSync(f) ? readFileSync(f).length : 0;
  return `  ${f}: ${(size / 1024).toFixed(1)} KB`;
});
console.log(stats.join("\n"));

const zipSize = existsSync(zipName) ? readFileSync(zipName).length : 0;
console.log(`  ${zipName}: ${(zipSize / 1024).toFixed(1)} KB`);

// 生成 release notes
const changelog = existsSync("docs/CHANGELOG.md")
  ? readFileSync("docs/CHANGELOG.md", "utf8")
  : "";

// 从 CHANGELOG 中提取当前版本的条目
const versionHeader = `## v${version}`;
const vIndex = changelog.indexOf(versionHeader);
let releaseNotes = "";
if (vIndex >= 0) {
  const afterHeader = changelog.slice(vIndex);
  const nextVersion = afterHeader.search(/\n## v/);
  releaseNotes = nextVersion >= 0 ? afterHeader.slice(0, nextVersion) : afterHeader;
} else {
  releaseNotes = `## v${version}\n\nSee CHANGELOG.md for details.`;
}

writeFileSync("release-notes.md", releaseNotes.trim() + "\n");
console.log(`  release-notes.md: ${releaseNotes.length} chars`);

console.log(`\n✅ Release bundle created: ${zipName} (${(zipSize / 1024).toFixed(1)} KB)`);
