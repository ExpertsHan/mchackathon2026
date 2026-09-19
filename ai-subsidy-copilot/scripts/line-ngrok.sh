#!/usr/bin/env bash
# 一鍵開 ngrok（LINE webhook / 前端 3000 / 後端 8000），並印出需要設定的網址與指令。
# 前置：ngrok config add-authtoken <token>；根目錄 .env 已填 LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET。
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/line-gateway.js >/tmp/line-gateway.log 2>&1 &
GW_PID=$!
ngrok http 8080 --log=stdout >/tmp/ngrok-line.log 2>&1 &
NGROK_PID=$!
trap 'kill $NGROK_PID $GW_PID 2>/dev/null' EXIT
for _ in $(seq 20); do
  URL=$(curl -s localhost:4040/api/tunnels | python3 -c "import sys,json;print(next(t['public_url'] for t in json.load(sys.stdin)['tunnels'] if t['public_url'].startswith('https')))" 2>/dev/null || true)
  [[ -n "$URL" ]] && break
  sleep 1
done
echo "$URL" > /tmp/line-public-url
cat <<M

✅ ngrok 已啟動（單一網址，由 gateway 依路徑分流）：$URL
1) LINE Webhook URL：$URL/webhook
2) 後端: cd backend && FRONTEND_ORIGIN=$URL CORS_ORIGINS=$URL,http://localhost:3000 uvicorn app.main:app --port 8000
3) 前端: cd frontend && NEXT_PUBLIC_API_URL=$URL npm run dev
4) LINE Bot: cd ocr && API_BASE_URL=http://localhost:8000 npm run line
5) Rich Menu（一次）: cd ocr && npm run rich-menu
M
wait $NGROK_PID
