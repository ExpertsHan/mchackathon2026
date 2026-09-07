/**
 * 一次性腳本：建立 Rich Menu、上傳底圖、設成預設選單。執行：node setup-rich-menu.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const line = require('@line/bot-sdk');

const client = new line.Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const IMAGE_PATH = path.join(__dirname, 'assets', 'richmenu.png');

async function main() {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('缺少 LINE_CHANNEL_ACCESS_TOKEN，請先在 .env 設定好再執行。');
    process.exit(1);
  }
  if (!fs.existsSync(IMAGE_PATH)) {
    console.error(`找不到底圖：${IMAGE_PATH}`);
    process.exit(1);
  }

  const richMenu = await client.createRichMenu({
    size: { width: 2500, height: 843 },
    selected: true,
    name: 'AI補助申請選單',
    chatBarText: '選單',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 834, height: 843 },
        action: { type: 'message', text: '申請' },
      },
      {
        bounds: { x: 834, y: 0, width: 833, height: 843 },
        action: { type: 'message', text: '查詢進度' },
      },
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: { type: 'message', text: 'AI資安' },
      },
    ],
  });
  console.log('已建立 Rich Menu，ID：', richMenu);

  await client.setRichMenuImage(richMenu, fs.createReadStream(IMAGE_PATH));
  console.log('底圖上傳完成');

  await client.setDefaultRichMenu(richMenu);
  console.log('已設為預設 Rich Menu，之後加好友或已加好友的人都會看到這個選單');

  console.log('\n完成！打開手機 LINE 對話視窗，下方應該會出現選單列。');
}

main().catch((err) => {
  console.error('設定 Rich Menu 失敗：', err.originalError?.response?.data || err);
  process.exit(1);
});
