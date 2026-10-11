#!/usr/bin/env bash
# Persian RTL for VS Code — Build Script (Linux / macOS)
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║ Noor Smart RTL v2.9.20 Build ║"
echo "╚══════════════════════════════════════════╝"
echo ""

command -v node &>/dev/null || { echo "❌ Node.js یافت نشد → https://nodejs.org"; exit 1; }
command -v npm  &>/dev/null || { echo "❌ npm یافت نشد"; exit 1; }
echo "✅ Node $(node -v) / npm $(npm -v)"
echo ""

echo "📦 نصب وابستگی‌ها..."
npm install --silent

echo "📦 ساخت VSIX..."
npm test
./node_modules/.bin/vsce package --no-dependencies --allow-missing-repository

VSIX=$(ls *.vsix 2>/dev/null | sort -V | tail -1)

if [ -z "$VSIX" ]; then
    echo "❌ ساخت VSIX ناموفق بود"
    exit 1
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  ✅ آماده: $VSIX"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "نصب:"
echo "  code --install-extension $VSIX"
echo "  یا: Ctrl+Shift+X → ··· → Install from VSIX"
echo ""
