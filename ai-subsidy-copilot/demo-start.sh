#!/usr/bin/env bash
# 一鍵啟動 demo：gateway + ngrok + 後端 + 前端 + LINE Bot，並自動更新 LINE Webhook URL。
# 用法：./demo-start.sh        （Ctrl+C 結束並關閉全部服務）
# 前置：ngrok 已設定 authtoken；根目錄 .env 已填 LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET / LINE_INTEGRATION_SECRET。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
LOG=/tmp/demo-logs; mkdir -p "$LOG"

[[ -f .env ]] || { echo "❌ 找不到 .env"; exit 1; }
set -a; . ./.env; set +a
for v in LINE_CHANNEL_ACCESS_TOKEN LINE_CHANNEL_SECRET LINE_INTEGRATION_SECRET; do
  [[ -n "${!v:-}" ]] || { echo "❌ .env 缺少 $v"; exit 1; }
done
command -v ngrok >/dev/null || { echo "❌ 找不到 ngrok"; exit 1; }
[[ -d ocr/node_modules ]] || (cd ocr && npm install --no-audit --no-fund)
[[ -d frontend/node_modules ]] || (cd frontend && npm install --no-audit --no-fund)

# 清掉上次殘留的服務
pkill -f "uvicorn app.main" 2>/dev/null; pkill -f "line-gateway.js" 2>/dev/null
pkill -f "line-server.js" 2>/dev/null; pkill -f "next dev" 2>/dev/null; pkill -x ngrok 2>/dev/null
for p in 3000 3100 8000 8080 4040; do lsof -ti tcp:$p 2>/dev/null | xargs kill 2>/dev/null; done
sleep 1

PIDS=()
cleanup() { echo; echo "關閉所有服務…"; kill "${PIDS[@]}" 2>/dev/null; pkill -f "next dev" 2>/dev/null; exit 0; }
trap cleanup INT TERM EXIT

# 1) 單一入口 + ngrok（免費方案只有一個網域，依路徑分流：/webhook→bot、/api→後端、其餘→前端）
node scripts/line-gateway.js > "$LOG/gateway.log" 2>&1 & PIDS+=($!)
ngrok http 8080 --log=stdout > "$LOG/ngrok.log" 2>&1 & PIDS+=($!)
URL=""
for _ in $(seq 30); do
  URL=$(curl -s localhost:4040/api/tunnels | python3 -c "import sys,json;print(next(t['public_url'] for t in json.load(sys.stdin)['tunnels'] if t['public_url'].startswith('https')))" 2>/dev/null || true)
  [[ -n "$URL" ]] && break; sleep 1
done
[[ -n "$URL" ]] || { echo "❌ ngrok 沒有啟動成功，請看 $LOG/ngrok.log"; exit 1; }

# 2) 後端（沒有 Postgres 時用 SQLite demo 資料庫）
export DATABASE_URL="${DEMO_DATABASE_URL:-sqlite:///./ai_subsidy_demo.db}"
export FRONTEND_ORIGIN="$URL" CORS_ORIGINS="$URL,http://localhost:3000,http://127.0.0.1:3000"
(cd backend && exec .venv/bin/uvicorn app.main:app --port 8000 > "$LOG/backend.log" 2>&1) & PIDS+=($!)

# 3) 前端
(cd frontend && NEXT_PUBLIC_API_URL="$URL" exec npm run dev > "$LOG/frontend.log" 2>&1) & PIDS+=($!)

# 4) LINE Bot
(cd ocr && API_BASE_URL=http://localhost:8000 exec node line-server.js > "$LOG/bot.log" 2>&1) & PIDS+=($!)

# 等服務就緒
wait_for() { for _ in $(seq 60); do curl -s -o /dev/null "$1" && return 0; sleep 1; done; echo "❌ $2 沒有啟動，請看 $LOG"; return 1; }
wait_for localhost:8000/health "後端" && wait_for localhost:3100/health "LINE Bot" && wait_for localhost:3000 "前端" || exit 1

# 5) 自動更新 LINE Webhook URL，並驗證
curl -s -XPUT https://api.line.me/v2/bot/channel/webhook/endpoint \
  -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"endpoint\":\"$URL/webhook\"}" > /dev/null
VERIFY=$(curl -s -XPOST https://api.line.me/v2/bot/channel/webhook/test \
  -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"endpoint\":\"$URL/webhook\"}")
[[ "$VERIFY" == *'"success":true'* ]] && WH="✅ 已自動設定並驗證通過" || WH="⚠️ 驗證失敗：$VERIFY"

# 6) Rich Menu：沒有預設選單才建立
if [[ "$(curl -s -o /dev/null -w '%{http_code}' https://api.line.me/v2/bot/user/all/richmenu -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN")" != "200" ]]; then
  (cd ocr && node setup-rich-menu.js > "$LOG/richmenu.log" 2>&1) && RM="✅ 已建立" || RM="⚠️ 建立失敗，見 $LOG/richmenu.log"
else RM="✅ 已存在"; fi

cat <<M

════════════ Demo 已啟動 ════════════
公開網址    $URL
申請頁      $URL/apply
Admin 後台  $URL/admin
LINE Webhook  $WH
Rich Menu     $RM
Log 位置    $LOG/
（首次用瀏覽器開 ngrok 網址若出現提示頁，按 Visit Site 即可）
Ctrl+C 結束
═════════════════════════════════════
M
wait
