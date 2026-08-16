// LINE Bot webhook：申請連結／查詢進度／資安提醒／其他問題交給 AI 回答
const express = require('express');
const line = require('@line/bot-sdk');
const db = require('./db');
const KNOWLEDGE_BASE = require('./knowledge-base');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

const client = new line.Client(config);
const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const AI_MODEL = 'gemini-2.5-flash';

const AI_SYSTEM_PROMPT = `你是新竹市「AI領航青年數位工具補助」LINE官方帳號的客服小幫手。

規則：
1. 回答關於這個補助計畫的問題時，只能根據下面「官方資料」區塊提供的內容回答，不要使用你自己既有知識庫裡
   關於這個計畫的其他印象，因為那些資訊可能是舊的或不準確的。
2. 如果「官方資料」裡沒有寫到使用者問的細節，誠實說不確定，並請他撥打官方資料裡的聯絡電話洽詢，不要自己編造答案。
3. 你完全不知道任何人具體的申請案審核進度，遇到有人問自己的案件狀態，一律請他在 LINE 輸入「查詢進度」，不要臆測或編造狀態。
4. 也可以協助回答 AI 工具使用的資安安全建議（保護個資、避免詐騙、著作權等）與這個 LINE Bot 本身怎麼使用。
5. 回覆要精簡，適合在 LINE 對話框閱讀，控制在 4 句話以內，不要使用 Markdown 語法（不要出現 ** 或 # 這類符號），可以適度使用表情符號。
6. 如果問題跟這個補助方案或 AI 資安完全無關，禮貌說明你只能協助這方面的問題就好，不用長篇解釋。

===== 官方資料（回答補助相關問題時，只能依據這裡的內容）=====
${KNOWLEDGE_BASE}
===== 官方資料結束 =====`;

async function askAI(userText) {
  if (!GEMINI_API_KEY) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: AI_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: { maxOutputTokens: 400 },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`Gemini API 回應錯誤（狀態碼 ${res.status}）：${errText.slice(0, 300)}`);
      return null;
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim();
    return text || null;
  } catch (err) {
    console.error('呼叫 AI 回覆失敗：', err.message || err);
    return null;
  }
}

async function showLoadingAnimation(userId) {
  try {
    await fetch('https://api.line.me/v2/bot/chat/loading/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.channelAccessToken}` },
      body: JSON.stringify({ chatId: userId, loadingSeconds: 20 }),
    });
  } catch (err) {}
}

const APPLY_TRIGGERS = ['申請', '我要申請', '怎麼申請', '如何申請', '線上申請', '申請連結', '申請網址', '申請補助'];
const QUERY_TRIGGERS = ['查詢進度', '查詢', '進度查詢', '進度', '查詢核銷', '核銷進度', '查我的進度', '核銷'];
const SECURITY_TRIGGERS = ['AI資安', '資安', '資安提醒', '資安小提醒', 'AI 資安'];

const STATUS_LABEL = {
  draft: '尚未送出（草稿）',
  submitted: '已受理，等待審核',
  reviewing: '審核中',
  need_supplement: '需要補件，請留意通知',
  approved: '已核准，準備撥款 🎉',
  disbursed: '補助款已撥款完成 💰',
  rejected: '不通過',
};

const AI_SECURITY_CHECKLIST = `📋 AI 工具使用資安小提醒

☑️ 從官方網站或正版管道下載/訂閱，不要用來路不明的破解版
☑️ 上傳資料前先想一下：這份檔案有沒有身分證字號、財務資料等敏感個資
☑️ 產出內容如果用到別人的照片、聲音、作品，注意肖像權與著作權
☑️ 帳號開啟兩步驟驗證（2FA），密碼不要和其他網站共用
☑️ 收到「AI工具優惠/中獎」訊息保持警覺，先查證來源再點連結

想了解更多案例可以回覆「案例」，我們之後會補上真實資安事件分享。`;

router.post('/webhook', line.middleware(config), async (req, res) => {
  res.sendStatus(200); // 先回 200 給 LINE，事件各自處理，避免單一事件出錯影響其他訊息
  for (const event of req.body.events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error('處理 LINE 事件時發生錯誤：', err);
    }
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId;
  const text = event.message.text.trim();

  if (APPLY_TRIGGERS.includes(text)) {
    const applyUrl = `${PUBLIC_BASE_URL}/apply.html?uid=${userId}`;
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text:
        `請點選以下連結填寫申請資料並上傳文件：\n${applyUrl}\n\n` +
        `需準備：身分證正反面、購買憑證/發票、存摺封面影本（如為弱勢資格，另附相關證明）。`,
    });
  }

  if (QUERY_TRIGGERS.includes(text)) {
    const rows = db
      .prepare("SELECT * FROM applications WHERE line_user_id = ? AND status != 'draft' ORDER BY created_at DESC")
      .all(userId);
    if (!rows.length) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '目前查無您的申請紀錄，請先輸入「申請」開始申請流程。',
      });
    }
    const lines = rows.map((r, i) => {
      let line = `${i + 1}. 受理編號 ${r.id.slice(0, 8)}…\n   狀態：${STATUS_LABEL[r.status] || r.status}`;
      if (r.note) line += `\n   備註：${r.note}`;
      return line;
    });
    return client.replyMessage(event.replyToken, { type: 'text', text: lines.join('\n\n') });
  }

  if (SECURITY_TRIGGERS.includes(text)) {
    return client.replyMessage(event.replyToken, { type: 'text', text: AI_SECURITY_CHECKLIST });
  }

  await showLoadingAnimation(userId);
  const aiReply = await askAI(text);
  const quickReply = {
    items: [
      { type: 'action', action: { type: 'message', label: '申請', text: '申請' } },
      { type: 'action', action: { type: 'message', label: '查詢進度', text: '查詢進度' } },
      { type: 'action', action: { type: 'message', label: 'AI資安', text: 'AI資安' } },
    ],
  };
  if (aiReply) {
    return client.replyMessage(event.replyToken, { type: 'text', text: aiReply, quickReply });
  }
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '您好，輸入「申請」開始線上申請、「查詢進度」查看審核狀態，或輸入「AI資安」看使用 AI 工具前的安全提醒。',
    quickReply,
  });
}

async function pushMessage(userId, text) {
  if (!userId) return;
  await client.pushMessage(userId, { type: 'text', text });
}

module.exports = router;
module.exports.pushMessage = pushMessage;
