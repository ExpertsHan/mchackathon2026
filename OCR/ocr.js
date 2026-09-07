// ocr.js：用 Gemini 的圖片理解能力做 OCR + 結構化擷取（讀圖直接輸出 JSON，不用自己寫正規表示式去猜欄位）
//
// 欄位命名對齊需求文件第七節的 JSON schema（buyer_name/product_name/company_name...），
// 另外保留幾個需求文件裡有提到、但沒放進範例 JSON 的欄位（renewal_date、purchase_source、plan_type），
// 以及我們系統運作上還需要的欄位（converted_twd_amount、has_payment_proof、card_last4、card_holder_name）。
// 每個欄位都會附上 0~1 的信心分數（第十四節），信心不足的欄位由 server.js/rules.js 判斷是否要標記人工複核。
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const OCR_MODEL = 'gemini-2.5-flash';

// 所有欄位共用的防幻覺守則，避免模型為了「填好填滿」而亂猜、亂編造看不到的內容
const ANTI_HALLUCINATION_RULE =
  '非常重要：只填「圖片上真的看得到、看得清楚」的內容。如果模糊、被裁掉、看不懂，或圖片上根本沒有這個資訊，一律填 null，' +
  '絕對不要用常見值、範例值、或你認為「應該是」的內容去填空。日期若原文是民國年或其他格式，換算成西元 YYYY-MM-DD 再填，換算不確定就填 null。' +
  '每個欄位另外要給一個 0 到 1 的信心分數（confidence），代表你對這個欄位讀取結果的把握程度：完全看不到、填 null 的欄位信心分數固定填 0；' +
  '看得到但字跡模糊、可能有誤判風險的給 0.5~0.8；圖片清晰、有把握的給 0.9 以上。信心分數是誠實評估，不是隨便填高分。';

// 如果輸出被截斷（通常是缺右括號），嘗試簡單修復再解析一次，比直接放棄多救回一些案例
function tryRepairJson(text) {
  const opens = (text.match(/[{[]/g) || []).length;
  const closes = (text.match(/[}\]]/g) || []).length;
  const diff = opens - closes;
  if (diff <= 0) return null;
  try {
    return JSON.parse(text + '}'.repeat(diff));
  } catch {
    return null;
  }
}
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
          maxOutputTokens: 2500,
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
      const repaired = tryRepairJson(text);
      if (repaired) {
        console.warn('OCR JSON 輸出被截斷，已自動修復成功');
        return { status: 'done', data: repaired, reason: null };
      }
      console.error(`OCR JSON 解析失敗，原始內容前300字：${text.slice(0, 300)}`);
      return { status: 'failed', data: null, reason: 'AI 回傳的內容不是有效 JSON（可能是輸出被截斷，已提高輸出上限，若持續發生請回報）' };
    }
  } catch (err) {
    console.error('OCR 處理發生錯誤：', err.message || err);
    return { status: 'failed', data: null, reason: err.message || '未知錯誤' };
  }
}

// callGeminiVision 回傳的是 { fields: {...}, confidence: {...} }，這裡拆開來，
// 把 confidence 包成 _confidence（底線開頭＝除錯／統計用的中繼資料，不參與欄位比對），
// 失敗/跳過時統一包成 { _error } 塞進 ocr_data，讓後台除錯資訊可以直接顯示失敗原因。
function toResult(ocr) {
  if (ocr.status !== 'done') return { status: ocr.status, data: { _error: ocr.reason } };
  const fields = ocr.data?.fields || {};
  const confidence = ocr.data?.confidence || {};
  return { status: 'done', data: { ...fields, _confidence: confidence } };
}

// 擷取購買憑證/發票的結構化資訊。
// 申請人可能會分好幾張圖上傳（官方收據、電子帳單、扣款紀錄或信用卡背面照片其中一種），
// 所以這裡針對「單一張圖片」盡量擷取看得到的欄位，看不到的填 null，
// 之後由 server.js 把同一個申請案底下多張圖片的結果合併起來再送進規則引擎比對。
async function extractReceiptInfo(filePath) {
  const prompt = `這張圖片是申請人上傳的購買憑證相關圖片之一，可能是「官方收據/電子帳單」「繳款憑證/出帳帳單截圖」「信用卡背面照片」三種其中一種，同一次申請可能分好幾張圖上傳，這張圖不一定包含全部欄位。

${ANTI_HALLUCINATION_RULE}

請「只回傳 JSON」，不要有其他文字說明，格式是 { "fields": {...}, "confidence": {...} } 兩個物件：
{
  "fields": {
    "document_type": "這張圖看起來屬於哪一種：official_receipt（官方收據/電子帳單）／payment_statement（繳款憑證/出帳帳單截圖）／card_photo（信用卡照片）／unknown（看不出來或都不是）",
    "buyer_name": "訂閱人姓名，看不出來就填 null",
    "buyer_email": "訂閱人的電子信箱，看不出來就填 null",
    "product_name": "完整的AI工具/軟體/服務名稱（請寫完整名稱，不要只寫縮寫或代稱），看不出來就填 null",
    "company_name": "軟體公司名稱，看不出來就填 null",
    "purchase_date": "訂閱日期/購買日期，格式 YYYY-MM-DD，看不出來就填 null",
    "subscription_period": "訂閱期間（文字敘述即可，例如：2025-01-01 至 2025-12-31），看不出來就填 null",
    "renewal_date": "續訂日期，格式 YYYY-MM-DD 或文字敘述（例如「每月10日續訂」），看不出來就填 null",
    "original_amount": 純數字，原始費用金額（維持原幣別，不要換算，看不出來就填 null),
    "currency": "原始費用的幣別代碼，例如 TWD/USD/JPY/EUR/AUD/HKD，看不出來就填 null",
    "converted_twd_amount": 純數字，換算成新臺幣後的金額，若圖片本身已經是新臺幣就填同樣數字，看不出來就填 null,
    "payment_method": "付款方式，例如：信用卡、Apple Pay、銀行轉帳等，看不出來就填 null",
    "purchase_source": "購買來源／平台網址或名稱（例如官方網站網域、App Store、或代購/集合式平台名稱），看不出來就填 null",
    "plan_type": "方案類型（例如：月付方案、年付方案、API額度、點數包等），看不出來就填 null",
    "has_payment_proof": 布林值，這張圖是否屬於「繳款憑證/出帳帳單」（例如信用卡帳單明細、扣款通知，document_type=payment_statement 時通常是 true），是則 true，否則 false,
    "card_last4": "信用卡卡號末四碼，若圖片有顯示就填，看不出來就填 null",
    "card_holder_name": "信用卡卡片上的持卡人姓名（通常是英文或拼音），若圖片有顯示就填，看不出來就填 null"
  },
  "confidence": {
    "buyer_name": 0~1的數字, "buyer_email": 0~1, "product_name": 0~1, "company_name": 0~1, "purchase_date": 0~1,
    "subscription_period": 0~1, "renewal_date": 0~1, "original_amount": 0~1, "currency": 0~1, "converted_twd_amount": 0~1,
    "payment_method": 0~1, "purchase_source": 0~1, "plan_type": 0~1, "card_last4": 0~1, "card_holder_name": 0~1
  }
}`;
  return toResult(await callGeminiVision(filePath, prompt));
}

// 擷取身分證正面或背面的資訊（正面：姓名/生日/身分證字號，背面：住址）。
// 因為現在身分證正反面允許一次上傳多張圖片，這裡對單張圖片盡量擷取，
// 看不到的欄位填 null，由 server.js 合併多張圖片的結果。
async function extractIdBackInfo(filePath) {
  const prompt = `請閱讀這張台灣國民身分證照片（可能是正面或背面）。

${ANTI_HALLUCINATION_RULE}

請「只回傳 JSON」，不要有其他文字說明，格式是 { "fields": {...}, "confidence": {...} } 兩個物件：
{
  "fields": {
    "side": "這張是正面（有姓名、大頭照、出生年月日、身分證字號）還是背面（有住址、父母配偶欄）：front／back／unknown",
    "name": "姓名欄位，看不出來就填 null",
    "id_number": "身分證字號，看不出來就填 null",
    "birth_date": "出生年月日，格式 YYYY-MM-DD，看不出來就填 null",
    "address": "住址欄位的完整文字（通常在背面），看不出來就填 null",
    "is_hsinchu_city": 布林值，如果地址開頭包含「新竹市」則為 true，如果看得到地址但不是新竹市則為 false，這張是正面沒有地址欄位或完全看不出地址則填 null
  },
  "confidence": {
    "name": 0~1的數字, "id_number": 0~1, "birth_date": 0~1, "address": 0~1
  }
}`;
  return toResult(await callGeminiVision(filePath, prompt));
}

// 擷取存摺封面的銀行帳戶資訊，方便後續核准撥款時直接使用
async function extractPassbookInfo(filePath) {
  const prompt = `請閱讀這張銀行存摺封面（或內頁）照片。

${ANTI_HALLUCINATION_RULE}

請「只回傳 JSON」，不要有其他文字說明，格式是 { "fields": {...}, "confidence": {...} } 兩個物件：
{
  "fields": {
    "bank_name": "銀行名稱，看不出來就填 null",
    "bank_code": "銀行代碼（3碼數字），看不出來就填 null",
    "account_number": "帳號（去除空格的完整數字），看不出來就填 null",
    "account_holder_name": "戶名，看不出來就填 null"
  },
  "confidence": {
    "bank_name": 0~1的數字, "bank_code": 0~1, "account_number": 0~1, "account_holder_name": 0~1
  }
}`;
  return toResult(await callGeminiVision(filePath, prompt));
}

module.exports = { extractReceiptInfo, extractIdBackInfo, extractPassbookInfo };
