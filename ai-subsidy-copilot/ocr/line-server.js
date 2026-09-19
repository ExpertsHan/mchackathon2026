// 獨立的 LINE Bot 行程（docker compose 的 line-bot 服務）。
// 只掛載 /webhook，不含資料庫、不含申請流程；所有資料都經由 FastAPI 內部 API。
// 同時讀取專案根目錄 .env（與 FastAPI 共用）與 ocr/.env；先載入者優先
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('dotenv').config();
const express = require('express');

if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !process.env.LINE_CHANNEL_SECRET) {
  console.error('缺少 LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET，LINE Bot 無法啟動。');
  process.exit(1);
}
if (!process.env.LINE_INTEGRATION_SECRET) {
  console.error('缺少 LINE_INTEGRATION_SECRET（需與 FastAPI 後端相同），LINE Bot 無法啟動。');
  process.exit(1);
}

const app = express();
app.use('/', require('./line'));
app.get('/health', (req, res) => res.json({ ok: true }));
// 簽章驗證失敗回 401（而非 500 堆疊），其餘錯誤回 500
app.use((err, req, res, next) => {
  if (err instanceof require('@line/bot-sdk').SignatureValidationFailed) return res.sendStatus(401);
  console.error(err);
  res.sendStatus(500);
});
const port = process.env.PORT || 3100;
app.listen(port, () => console.log(`LINE Bot webhook listening on :${port}/webhook`));
