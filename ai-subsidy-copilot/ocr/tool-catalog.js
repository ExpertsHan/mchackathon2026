// tool-catalog.js：AI 工具資格知識庫
//
// 這是「靜態維護清單＋保守判斷」的做法，不是即時查證公司登記地或官網——系統沒有對外查證能力。
// 清單裡沒有的工具一律回傳 matched:null（無法確認），呼叫端必須把這種情況導向 REVIEW，
// 絕對不能因為清單沒收錄就自動判定合格或不合格。清單需要承辦人員/工程定期維護更新，
// 尤其是禁止清單，新的中國/港澳應用程式上市要記得補進來（last_verified_at 記錄最後確認日期）。
//
// 每筆資料的欄位：
//   product_name        產品名稱
//   company             公司名稱
//   category            分類代碼：general/image/office/learning/other，不合格工具通常填 null
//   country_or_region   國家/地區代碼，例如 US/AU/CN
//   official_domain     官方網域（用來比對購買來源是否為官方網站）
//   eligible            true=合格／false=不合格（禁止清單）
//   prohibited_reason   不合格原因，eligible=true 時是 null
//   subscription_type   訂閱型態，例如 subscription（訂閱制）
//   last_verified_at    最後人工確認這筆資料正確性的日期
//   aliases             OCR 擷取到的文字比對用的別名清單（小寫）

const TOOL_KNOWLEDGE_BASE = [
  { product_name: 'ChatGPT', company: 'OpenAI', category: 'general', country_or_region: 'US', official_domain: 'chatgpt.com', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['chatgpt', 'openai'] },
  { product_name: 'Google AI 訂閱方案', company: 'Google', category: 'general', country_or_region: 'US', official_domain: 'one.google.com', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['google ai', 'gemini', 'google one ai premium'] },
  { product_name: 'Grok', company: 'xAI', category: 'general', country_or_region: 'US', official_domain: 'x.ai', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['grok', 'xai'] },
  { product_name: 'Claude', company: 'Anthropic', category: 'general', country_or_region: 'US', official_domain: 'claude.ai', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['claude', 'anthropic'] },
  { product_name: 'Perplexity', company: 'Perplexity AI', category: 'general', country_or_region: 'US', official_domain: 'perplexity.ai', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['perplexity'] },
  { product_name: 'Canva AI', company: 'Canva', category: 'image', country_or_region: 'AU', official_domain: 'canva.com', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['canva'] },
  { product_name: 'Adobe Firefly', company: 'Adobe', category: 'image', country_or_region: 'US', official_domain: 'adobe.com', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['adobe firefly', 'firefly', 'adobe creative cloud'] },
  { product_name: 'Midjourney', company: 'Midjourney', category: 'image', country_or_region: 'US', official_domain: 'midjourney.com', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['midjourney'] },
  { product_name: 'Figma AI', company: 'Figma', category: 'image', country_or_region: 'US', official_domain: 'figma.com', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['figma'] },
  { product_name: 'Microsoft Copilot', company: 'Microsoft', category: 'office', country_or_region: 'US', official_domain: 'copilot.microsoft.com', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['microsoft copilot', 'copilot', 'microsoft 365 copilot'] },
  { product_name: 'Copy.ai', company: 'Copy.ai', category: 'office', country_or_region: 'US', official_domain: 'copy.ai', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['copy.ai'] },
  { product_name: 'Notion AI', company: 'Notion Labs', category: 'office', country_or_region: 'US', official_domain: 'notion.so', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['notion ai', 'notion'] },
  { product_name: 'Jasper', company: 'Jasper', category: 'office', country_or_region: 'US', official_domain: 'jasper.ai', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['jasper'] },
  { product_name: 'Grammarly', company: 'Grammarly', category: 'learning', country_or_region: 'US', official_domain: 'grammarly.com', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['grammarly'] },
  { product_name: 'Speak', company: 'Speak', category: 'learning', country_or_region: 'US', official_domain: 'speak.com', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['speak'] },
  { product_name: 'Elicit', company: 'Elicit', category: 'learning', country_or_region: 'US', official_domain: 'elicit.com', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['elicit'] },
  { product_name: 'Cursor', company: 'Anysphere', category: 'other', country_or_region: 'US', official_domain: 'cursor.com', eligible: true, prohibited_reason: null, subscription_type: 'subscription', last_verified_at: '2026-08-01', aliases: ['cursor'] },

  // 禁止清單（需求文件第六節）：中國大陸/港澳開發或營運
  { product_name: 'CapCut', company: '字節跳動 ByteDance', category: null, country_or_region: 'CN', official_domain: null, eligible: false, prohibited_reason: '中國大陸（字節跳動）開發/營運，屬禁止清單', subscription_type: null, last_verified_at: '2026-08-01', aliases: ['capcut', '剪映'] },
  { product_name: 'Kling 可靈', company: '快手 Kuaishou', category: null, country_or_region: 'CN', official_domain: null, eligible: false, prohibited_reason: '中國大陸（快手）開發/營運，屬禁止清單', subscription_type: null, last_verified_at: '2026-08-01', aliases: ['kling', '可靈'] },
  { product_name: 'Meitu 美圖秀秀', company: 'Meitu 美圖公司', category: null, country_or_region: 'CN', official_domain: null, eligible: false, prohibited_reason: '中國大陸（美圖公司）開發/營運，屬禁止清單', subscription_type: null, last_verified_at: '2026-08-01', aliases: ['meitu', '美圖秀秀'] },
  { product_name: 'Wink', company: 'Meitu 美圖公司', category: null, country_or_region: 'CN', official_domain: null, eligible: false, prohibited_reason: '中國大陸（美圖公司）開發/營運，屬禁止清單', subscription_type: null, last_verified_at: '2026-08-01', aliases: ['wink'] },
  { product_name: 'WHEE', company: 'Meitu 美圖公司', category: null, country_or_region: 'CN', official_domain: null, eligible: false, prohibited_reason: '中國大陸（美圖公司）開發/營運，屬禁止清單', subscription_type: null, last_verified_at: '2026-08-01', aliases: ['whee'] },
  { product_name: 'SenseAvatar', company: 'SenseTime 商湯', category: null, country_or_region: 'CN', official_domain: null, eligible: false, prohibited_reason: '中國大陸（商湯）開發/營運，屬禁止清單', subscription_type: null, last_verified_at: '2026-08-01', aliases: ['senseavatar', 'sense avatar'] },
  { product_name: 'Manus', company: '蝴蝶效應 Butterfly Effect', category: null, country_or_region: 'CN', official_domain: null, eligible: false, prohibited_reason: '中國大陸（蝴蝶效應）開發/營運，屬禁止清單', subscription_type: null, last_verified_at: '2026-08-01', aliases: ['manus'] },
];

// 集合式 AI 平台／代購網站：就算上面賣的工具本身合格，購買來源不是官網也要標記（不是「工具」，所以獨立一份清單）
const AGGREGATOR_PLATFORMS = [
  { name: 'Poe.com', domains: ['poe.com', 'poe'] },
  { name: 'GoingBus', domains: ['goingbus'] },
];

// API／Credit／Token／點數／預付儲值／按用量計費：分成「強訊號」（出現在方案類型這種結構化欄位，比較可信）
// 跟「弱訊號」（只出現在商品名稱/訂閱期間這種自由文字欄位，可能是誤判，例如工具名稱剛好包含這些字）
const STRONG_KEYWORD_FIELD = 'planType';
const API_CREDIT_KEYWORDS = /\bapi\b|\bcredit\b|\btoken\b|點數|儲值|加值|topup|top-up|按量|按用量|usage[- ]?based|prepaid|儲值金/i;

function normalize(str) {
  return (str || '').toString().toLowerCase().trim();
}

function matchByAlias(entry, text) {
  const t = normalize(text);
  if (!t) return false;
  return entry.aliases.some((a) => t.includes(normalize(a)));
}

// 從 OCR 擷取到的 product_name／company_name／purchase_source 查知識庫。
// 回傳：
//   matched: 知識庫裡的完整記錄物件，查不到就是 null（呼叫端必須把 null 導向 REVIEW，不能自動判定）
//   isAggregator: 購買來源是否比對到集合式平台/代購網站清單
//   isOfficialSource: true/false/null（購買來源是否為官方網站，null=無法判斷，通常是因為收據沒印網址）
function classifyTool({ productName, companyName, purchaseSource }) {
  const haystack = `${productName || ''} ${companyName || ''}`;
  const matched = TOOL_KNOWLEDGE_BASE.find((t) => matchByAlias(t, haystack)) || null;

  const aggregator = AGGREGATOR_PLATFORMS.find((p) => p.domains.some((d) => normalize(purchaseSource).includes(d)));
  const isAggregator = !!aggregator;

  let isOfficialSource = null;
  if (isAggregator) {
    isOfficialSource = false;
  } else if (matched && matched.official_domain && purchaseSource) {
    isOfficialSource = normalize(purchaseSource).includes(normalize(matched.official_domain));
  }

  return { matched, isAggregator, aggregatorName: aggregator?.name || null, isOfficialSource };
}

// 回傳 'strong'（在方案類型等結構化欄位發現關鍵字，較可信）／'weak'（只在自由文字欄位發現，可能誤判）／null（沒發現）
function detectApiOrCreditPlan({ productName, planType, subscriptionPeriod }) {
  if (API_CREDIT_KEYWORDS.test(planType || '')) return 'strong';
  if (API_CREDIT_KEYWORDS.test(`${productName || ''} ${subscriptionPeriod || ''}`)) return 'weak';
  return null;
}

module.exports = { classifyTool, detectApiOrCreditPlan, TOOL_KNOWLEDGE_BASE, AGGREGATOR_PLATFORMS };
