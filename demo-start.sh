#!/bin/bash
# Demo 統一入口（LINE Bot + ngrok + 申請系統 + Admin）。實際邏輯在 ai-subsidy-copilot/demo-start.sh。
# 用法：./demo-start.sh          啟動所有服務（Ctrl+C 結束）
#      ./demo-start.sh stop     停止所有服務
# 選用：WITH_LEGACY_OCR=1 ./demo-start.sh   另外啟動舊版 OCR 系統（port 3001）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE22="/opt/homebrew/opt/node@22/bin"

if [[ "${1:-}" == "stop" ]]; then
  pkill -f "node server.js" 2>/dev/null || true   # 舊版 OCR（若有開）
  exec "$ROOT/ai-subsidy-copilot/demo-start.sh" stop
fi

if [[ "${WITH_LEGACY_OCR:-}" == "1" && -f "$ROOT/OCR/server.js" ]]; then
  (cd "$ROOT/OCR" && export PATH="$NODE22:$PATH" && nohup node server.js > /tmp/ocr-server.log 2>&1 &)
  echo "舊版 OCR 已啟動：http://localhost:3001/apply.html"
fi

exec "$ROOT/ai-subsidy-copilot/demo-start.sh" "$@"
