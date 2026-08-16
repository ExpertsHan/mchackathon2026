// ocr.js：用 Gemini 圖片理解做 OCR + 結構化擷取
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const OCR_MODEL = 'gemini-2.5-flash';

function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  return 'image/jpeg';
}

async function callGeminiVision(filePath, prompt) {
  if (!GEMINI_API_KEY) return { status: 'skipped', data: null, reason: '未設定 GEMINI_API_KEY' };

  try {
    const bytes = fs.readFileSync(filePath);
    const base64Data = bytes.toString('base64');
    const mimeType = guessMimeType(filePath);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${OCR_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Data } }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 500,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`OCR 呼叫 Gemini 失敗（狀態碼 ${res.status}）：${errText.slice(0, 300)}`);
      return { status: 'failed', data: null, reason: `API錯誤 ${res.status}` };
    }

    const responseData = await res.json();
    const text = responseData.candidates?.[0]?.content?.parts?.map((p) => p.text).join('');
    if (!text) return { status: 'failed', data: null, reason: 'AI 未回傳內容' };

    try {
      const parsed = JSON.parse(text);
      return { status: 'done', data: parsed, reason: null };
    } catch {
      return { status: 'failed', data: null, reason: 'AI 回傳的內容不是有效 JSON' };
    }
  } catch (err) {
    console.error('OCR 處理發生錯誤：', err.message || err);
    return { status: 'failed', data: null, reason: err.message || '未知錯誤' };
  }
}

// 擷取購買憑證/發票的結構化資訊
async function extractReceiptInfo(filePath) {
  const prompt = `請閱讀這張購買憑證/發票圖片，擷取以下欄位並「只回傳 JSON」，不要有其他文字說明：
{
  "tool_name": "購買的工具/軟體/服務名稱，看不出來就填 null",
  "payment_date": "付款日期，格式 YYYY-MM-DD，看不出來就填 null",
  "plan": "訂購方案（例如：月費方案、年費方案），看不出來就填 null",
  "amount": 純數字，付款金額（新臺幣，若為外幣請換算為概略新臺幣金額；看不出來就填 null),
  "currency_note": "若原始金額為外幣，註記原始幣別與金額；否則填 null",
  "card_last4": "信用卡卡號末四碼，若圖片有顯示就填，看不出來就填 null"
}`;
  return callGeminiVision(filePath, prompt);
}

// 擷取身分證背面的地址資訊（台灣國民身分證的住址欄位在背面）
async function extractIdBackInfo(filePath) {
  const prompt = `請閱讀這張台灣國民身分證背面圖片，擷取以下欄位並「只回傳 JSON」，不要有其他文字說明：
{
  "address": "住址欄位的完整文字，看不出來就填 null",
  "is_hsinchu_city": 布林值，如果地址開頭包含「新竹市」則為 true，否則為 false，完全看不出來則填 null
}`;
  return callGeminiVision(filePath, prompt);
}

module.exports = { extractReceiptInfo, extractIdBackInfo };
