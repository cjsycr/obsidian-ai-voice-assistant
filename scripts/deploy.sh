#!/bin/bash
# 把当前 dev 目录构建产物同步到 Obsidian vault 里的插件目录
set -e
DEV_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# 从 obsidian.json 里自动找出活跃 vault
OBSIDIAN_JSON="$HOME/Library/Application Support/obsidian/obsidian.json"
if [ ! -f "$OBSIDIAN_JSON" ]; then
  echo "❌ 找不到 $OBSIDIAN_JSON"; exit 1
fi
VAULT=$(python3 -c "import json; d=json.load(open('$OBSIDIAN_JSON')); v=[x['path'] for x in d['vaults'].values() if x.get('open')]; print(v[0] if v else list(d['vaults'].values())[0]['path'])")
PLUGIN_DIR="$VAULT/.obsidian/plugins/ai-whispers"

if [ ! -d "$PLUGIN_DIR" ]; then
  echo "ℹ️  $PLUGIN_DIR 不存在，自动创建"
  mkdir -p "$PLUGIN_DIR"
fi

echo "📦 构建..."
cd "$DEV_DIR" && npm run build

echo "🚀 同步到 vault: $PLUGIN_DIR"
cp "$DEV_DIR/styles.css" "$PLUGIN_DIR/styles.css"
cp "$DEV_DIR/main.js"    "$PLUGIN_DIR/main.js"
cp "$DEV_DIR/manifest.json" "$PLUGIN_DIR/manifest.json"

echo "✅ 完成。请在 Obsidian 里禁用/重启用插件（Cmd+P → Reload app 也可）"
echo ""
echo "同步后的文件："
ls -la "$PLUGIN_DIR/styles.css" "$PLUGIN_DIR/main.js"
