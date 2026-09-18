#!/bin/bash
# 一鍵啟動三個系統，供 demo 使用。
# 用法：./demo-start.sh          啟動所有服務
#      ./demo-start.sh stop     停止所有服務

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COPILOT="$ROOT/ai-subsidy-copilot"
OCR="$ROOT/OCR"
NODE22="/opt/homebrew/opt/node@22/bin"

if [[ "${1:-}" == "stop" ]]; then
  echo "停止 backend / frontend / OCR..."
  pkill -f "uvicorn app.main:app" 2>/dev/null || true
  pkill -f "next dev" 2>/dev/null || true
  pkill -f "node server.js" 2>/dev/null || true
  (cd "$COPILOT" && docker compose stop postgres) || true
  echo "已停止（Docker 容器未刪除，下次啟動更快）。"
  exit 0
fi

echo "== 1/4 啟動 Docker Desktop（若未啟動） =="
open -a Docker
until docker info >/dev/null 2>&1; do sleep 1; done

echo "== 2/4 啟動 Postgres（ai-subsidy-copilot） =="
(cd "$COPILOT" && docker compose up -d postgres)
until docker exec ai-subsidy-copilot-postgres-1 pg_isready -U subsidy -d ai_subsidy >/dev/null 2>&1; do sleep 1; done

echo "== 3/4 啟動 ai-subsidy-copilot backend + frontend（原生執行，OCR bridge 才能用同機 node） =="
pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
(cd "$COPILOT/backend" && nohup .venv/bin/uvicorn app.main:app --port 8000 > /tmp/backend-native.log 2>&1 &)
(cd "$COPILOT/frontend" && nohup npm run dev > /tmp/frontend-native.log 2>&1 &)

echo "== 4/4 啟動 OCR / LINE Bot 後端（用 Node 22，port 3001） =="
pkill -f "node server.js" 2>/dev/null || true
(cd "$OCR" && export PATH="$NODE22:$PATH" && nohup node server.js > /tmp/ocr-server.log 2>&1 &)

echo "等待服務就緒..."
for i in $(seq 1 30); do
  BACKEND_OK=$(curl -s http://localhost:8000/health 2>/dev/null | grep -c '"status":"ok"' || true)
  FRONTEND_OK=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ 2>/dev/null || echo 0)
  OCR_OK=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/apply.html 2>/dev/null || echo 0)
  if [[ "$BACKEND_OK" == "1" && "$FRONTEND_OK" == "200" && "$OCR_OK" == "200" ]]; then
    break
  fi
  sleep 1
done

echo
echo "================================================"
echo "  AI 補助申請小幫手 — ai-subsidy-copilot"
echo "  民眾網站　http://localhost:3000"
echo "  API 文件　http://localhost:8000/docs"
echo
echo "  新竹市 AI 補助智慧審核 — OCR/LINE Bot 後端"
echo "  民眾申請頁　http://localhost:3001/apply.html?uid=demo-user-001"
echo "  承辦人後台　http://localhost:3001/admin.html  (Token: 見 OCR/.env 的 ADMIN_TOKEN)"
echo
echo "  資安防護瀏覽器擴充功能：Chrome 開 chrome://extensions"
echo "  開發人員模式 → 載入未封裝項目 → 選擇"
echo "  $ROOT/黑克嵩擴充功能_合併終版 資料夾"
echo "  （需先解壓縮 zip；目標網站 port 已對齊 3000）"
echo "================================================"
echo "結束 demo 後執行： ./demo-start.sh stop"
