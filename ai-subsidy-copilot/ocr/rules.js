// rules.js：AI 審核規則引擎（政府實務審核邏輯強化版）
//
// 核心設計原則：
// 1. 「OCR 無法辨識」≠「不符合資格」。無法辨識/缺資料 → NEED_SUPPLEMENT 或 REVIEW；
//    明確違反規則（有確定的比對結果）→ REJECT；AI 疑似異常（例如重複憑證）→ FRAUD_RISK。
// 2. 四種資料來源明確分開：申請人填寫（applicant_data）／OCR擷取（ocr_data）／知識庫（knowledge_base_data）／
//    規則引擎結果（rules）。同一份 evaluateApplication() 輸出裡各自獨立，不混在一起。
// 3. 每條規則都可以追溯到：Rule ID、名稱、判斷條件（condition）、資料來源（data_source）、
//    用到哪個 OCR 欄位（ocr_field）、該欄位的 AI 信心分數（confidence）、判斷結果（result）、
//    判斷原因（reason）、最終處理方式（disposition）。
// 4. AI 只負責「讀取→比對→找問題→提供建議」，不會自動核准或退件（見 server.js 的狀態轉換邏輯）。

const { checkAge, checkPurchaseDateRange, checkApplicationDeadline, calculateSubsidy, normalizeApplicantCategory, SUBSIDY_RULES } = require('./eligibility');
const { classifyTool, detectApiOrCreditPlan } = require('./tool-catalog');

// ---------- 共用小工具 ----------

function normalize(str) {
  return (str || '').toString().toLowerCase().replace(/[\s,.\-_/()（）、。．,]+/g, '');
}

// 兩段文字的字元重疊比例（0~1），中文姓名這種短字串用字元集合交集/聯集估算，
// 比純substring比對更能容忍 OCR 誤讀一兩個字的小誤差。
function charOverlapRatio(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let common = 0;
  for (const ch of setA) if (setB.has(ch)) common++;
  return common / Math.max(setA.size, setB.size);
}

// 'match'／'partial'／'mismatch'／null（缺資料無法判斷）
function similarityLevel(applied, ocrExtracted) {
  if (!applied || !ocrExtracted) return null;
  const a = normalize(applied);
  const b = normalize(ocrExtracted);
  if (!a || !b) return null;
  if (a === b || a.includes(b) || b.includes(a)) return 'match';
  const ratio = charOverlapRatio(a, b);
  return ratio === 0 ? 'mismatch' : 'partial';
}

// similarityLevel 的結果轉成需求文件第六節要的四種標籤
function toMatchLabel(level) {
  if (level === 'match') return 'MATCH';
  if (level === 'partial') return 'PARTIAL_MATCH';
  if (level === 'mismatch') return 'MISMATCH';
  return 'UNKNOWN';
}

function amountMatches(declared, ocrAmount) {
  if (!declared || !ocrAmount) return null;
  const diffRatio = Math.abs(declared - ocrAmount) / Math.max(declared, ocrAmount);
  if (diffRatio <= 0.05) return 'match';
  if (diffRatio <= 0.2) return 'minor_diff';
  return 'major_diff';
}
function amountMatchLabel(check) {
  if (check === 'match') return 'MATCH';
  if (check === 'minor_diff') return 'PARTIAL_MATCH';
  if (check === 'major_diff') return 'MISMATCH';
  return 'UNKNOWN';
}

// 把同一個 doc_type 底下多張圖片的 ocr_data 合併：每個欄位取「第一個非 null 的值」，
// has_payment_proof/is_hsinchu_city 這種布林欄位則是「只要有一張是 true 就算 true」。
// 底線開頭的欄位（_error、_confidence 等除錯用中繼資料）不參與合併，避免污染實際比對欄位。
function mergeOcrData(list, booleanOrFields = []) {
  const merged = {};
  for (const item of list || []) {
    const data = item?.ocr_data;
    if (!data) continue;
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('_')) continue;
      if (value === null || value === undefined) continue;
      if (booleanOrFields.includes(key)) merged[key] = merged[key] === true || value === true;
      else if (merged[key] === undefined) merged[key] = value;
    }
  }
  return merged;
}

// 跟 mergeOcrData 同樣邏輯，但合併的是每張圖片的 _confidence 分數（同一欄位取第一個有值的）
function mergeConfidence(list) {
  const merged = {};
  for (const item of list || []) {
    const conf = item?.ocr_data?._confidence;
    if (!conf) continue;
    for (const [key, value] of Object.entries(conf)) {
      if (typeof value !== 'number') continue;
      if (merged[key] === undefined) merged[key] = value;
    }
  }
  return merged;
}

function anyPending(list) {
  return !!(list && list.some((d) => d.ocr_status === 'pending'));
}
// 「這種文件可以拿來判斷了嗎」：不要求每一張圖都成功（同一種文件常常一次傳好幾張圖，一兩張模糊失敗很正常），
// 只要求沒有還在跑的（anyPending），而且至少有一張成功，就用已經成功讀到的資料去判斷。
function hasUsableOcrData(list) {
  return !!(list && list.length && !anyPending(list) && list.some((d) => d.ocr_status === 'done'));
}

// 每張圖片的 _confidence 分數彙整成「這個文件類別整體」的信心分數：只統計「這張圖確實有抓到值」的欄位，
// 避免被本來就不適用的欄位（信心分數固定0）拉低平均。
function computeConfidence(list) {
  const scores = [];
  const lowFields = [];
  for (const item of list || []) {
    const data = item?.ocr_data;
    if (!data || !data._confidence) continue;
    for (const [field, score] of Object.entries(data._confidence)) {
      if (data[field] === null || data[field] === undefined) continue;
      if (typeof score !== 'number') continue;
      scores.push(score);
      if (score < 0.85) lowFields.push(field);
    }
  }
  const overall = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null;
  return { overall, low_confidence_fields: [...new Set(lowFields)], sample_count: scores.length };
}

// 依 RULE_META 記錄的 data_source／ocr_field，去對應的信心分數表查出這條規則該用哪個信心分數
function confidenceFor(confMaps, dataSource, ocrFieldStr) {
  if (!ocrFieldStr) return null;
  const map = dataSource.includes('id_card') ? confMaps.id_card
    : dataSource.includes('passbook') ? confMaps.passbook
    : dataSource.includes('receipt') ? confMaps.receipt
    : null;
  if (!map) return null;
  const fields = ocrFieldStr.split(/[,/]/).map((s) => s.trim());
  const scores = fields.map((f) => map[f]).filter((v) => typeof v === 'number');
  if (!scores.length) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
}

// confidence 不能取代補助規則本身，只能在「這條規則原本判定沒問題」時，因為信心不足而降級成人工複核，
// 絕對不會因為信心低就直接判 REJECT/FRAUD_RISK，也不會因為信心高就跳過原本該做的比對。
const LOW_CONFIDENCE_THRESHOLD = 0.6;
function applyConfidenceGuard(ruleResult, confidence) {
  if (ruleResult.result === null && confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD) {
    return {
      ...ruleResult, result: 'REVIEW', risk: ruleResult.risk === 'info' ? 'low' : ruleResult.risk,
      reason: `${ruleResult.reason}（此欄位 OCR 信心分數偏低：${confidence}，建議人工複核）`,
    };
  }
  return ruleResult;
}

// 月費制分析：每個月是否有收據/臺幣換算/繳款憑證、月份是否連續、有沒有同一張憑證被重複拿去申請不同月份
function analyzeMonthlyReceipts(receiptList) {
  const byMonth = {};
  const signatureCount = {};
  let duplicateSignatureFound = false;

  for (const item of receiptList || []) {
    const d = item?.ocr_data;
    if (!d || !d.purchase_date) continue;
    const month = String(d.purchase_date).slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { hasAmount: false, hasPaymentProof: false, amount: null };
    if (d.converted_twd_amount) { byMonth[month].hasAmount = true; byMonth[month].amount = d.converted_twd_amount; }
    if (d.has_payment_proof) byMonth[month].hasPaymentProof = true;

    if (d.company_name && d.original_amount && d.purchase_date) {
      const sig = `${normalize(d.company_name)}|${d.original_amount}|${d.purchase_date}`;
      signatureCount[sig] = (signatureCount[sig] || 0) + 1;
      if (signatureCount[sig] > 1) duplicateSignatureFound = true;
    }
  }

  const months = Object.keys(byMonth).sort();
  const missing = [];
  for (let i = 1; i < months.length; i++) {
    const prev = new Date(`${months[i - 1]}-01`);
    const cur = new Date(`${months[i]}-01`);
    const diffMonths = (cur.getFullYear() - prev.getFullYear()) * 12 + (cur.getMonth() - prev.getMonth());
    for (let m = 1; m < diffMonths; m++) {
      const md = new Date(prev);
      md.setMonth(md.getMonth() + m);
      missing.push(md.toISOString().slice(0, 7));
    }
  }
  const incompleteMonths = months.filter((m) => !byMonth[m].hasAmount || !byMonth[m].hasPaymentProof);

  return { months, byMonth, missing, incompleteMonths, duplicateSignatureFound };
}

// 補助金額試算用的「可採信金額」：優先採用憑證 OCR 判讀到的換算金額（月費制多個月要加總），
// 完全讀不到才退回申請人自填金額；兩邊都沒有就明確回傳 unknown:true，不能偷偷算成 0 元。
function resolveEligibleAmount(receiptReady, receiptList, paymentType, mergedReceipt, declaredAmount) {
  if (receiptReady && mergedReceipt.converted_twd_amount) {
    if (paymentType === 'monthly') {
      const { byMonth } = analyzeMonthlyReceipts(receiptList);
      const sum = Object.values(byMonth).reduce((s, m) => s + (m.amount || 0), 0);
      return { amount: sum || mergedReceipt.converted_twd_amount, source: 'ocr_receipt', unknown: false };
    }
    return { amount: mergedReceipt.converted_twd_amount, source: 'ocr_receipt', unknown: false };
  }
  if (declaredAmount) return { amount: declaredAmount, source: 'applicant_declared', unknown: false };
  return { amount: null, source: null, unknown: true };
}

// ---------- 各條規則（RULE-001 ~ RULE-020）----------
// 每條規則回傳 { status: 'pass'|'fail'|'unknown', result: null|'NEED_SUPPLEMENT'|'REVIEW'|'REJECT'|'FRAUD_RISK', reason, risk }
// result 是 null 代表這條規則本身不影響整體結果（通過，或這條規則不適用於這個案件）。
// 分類原則：資料缺失/看不清楚 → NEED_SUPPLEMENT（請補件）；資料有但兜不起來/不確定 → REVIEW（人工判斷）；
// 有明確、可信的比對結果違反規定 → REJECT；偵測到疑似異常模式（例如重複憑證）→ FRAUD_RISK。

function ruleAge(application) {
  const ok = checkAge(application.birth_date);
  if (ok === true) return { status: 'pass', result: null, reason: '出生日期符合16~40歲資格範圍', risk: 'info' };
  if (ok === false) return { status: 'fail', result: 'REJECT', reason: `出生日期（${application.birth_date}）不在補助資格範圍（民國74年4月3日～99年4月2日）內`, risk: 'high' };
  return { status: 'unknown', result: 'REVIEW', reason: '無法判讀出生日期，需人工確認年齡資格', risk: 'medium' };
}

function ruleRegistration(idCardReady, idCard) {
  if (!idCardReady) return { status: 'unknown', result: 'NEED_SUPPLEMENT', reason: '身分證正反面尚未辨識完成或辨識失敗，需補上更清楚的照片才能確認設籍地址', risk: 'medium' };
  if (idCard.is_hsinchu_city === true) return { status: 'pass', result: null, reason: 'OCR 判讀設籍地址為新竹市', risk: 'info' };
  if (idCard.is_hsinchu_city === false) return { status: 'fail', result: 'REJECT', reason: 'OCR 判讀身分證地址不是新竹市，不符合設籍資格', risk: 'high' };
  // 身分證有辨識出其他資訊，但地址欄位這個「特定欄位」讀不到（例如只拍到正面），這是缺資料需要補件，不是模糊的判斷問題
  return { status: 'unknown', result: 'NEED_SUPPLEMENT', reason: 'OCR 無法從身分證讀到地址欄位（可能只拍到正面），請補上身分證背面照片以確認設籍地址', risk: 'medium' };
}

function rulePurchaseDateRange(application) {
  const ok = checkPurchaseDateRange(application.purchase_date);
  if (ok === true) return { status: 'pass', result: null, reason: '購買日期在受理期間內', risk: 'info' };
  if (ok === false) return { status: 'fail', result: 'REJECT', reason: `購買日期（${application.purchase_date}）不在補助受理期間（民國115年4月2日～10月31日）內`, risk: 'high' };
  return { status: 'unknown', result: 'NEED_SUPPLEMENT', reason: '無法判讀購買日期，請確認填寫或提供更清楚的收據', risk: 'medium' };
}

function ruleApplicationDeadline(application, applicationDate) {
  const { withinDeadline, deadline } = checkApplicationDeadline(application.purchase_date, application.payment_type, applicationDate);
  const planLabel = application.payment_type === 'annual' ? '年費制（買後2個月內）' : '月費制（買後1個月內）';
  if (withinDeadline === true) return { status: 'pass', result: null, reason: `在申請期限（${deadline}）內送出（${planLabel}）`, risk: 'info' };
  if (withinDeadline === false) return { status: 'fail', result: 'REJECT', reason: `已超過申請期限（${deadline}），${planLabel}`, risk: 'high' };
  return { status: 'unknown', result: 'REVIEW', reason: '缺少購買日期或申請日期，無法計算申請期限', risk: 'medium' };
}

function ruleToolCategory(application, kb) {
  if (!kb.matched) return { status: 'unknown', result: 'REVIEW', reason: '知識庫沒有這個工具的分類資料，AI 無法自動判斷分類，需人工確認申請人選的分類是否正確', risk: 'low' };
  if (kb.matched.category && application.software_category && kb.matched.category !== application.software_category) {
    return {
      status: 'fail', result: 'REVIEW',
      reason: `申請人分類：${application.software_category}／AI 判斷分類：${kb.matched.category}／分類不一致／建議人工確認`,
      risk: 'low',
    };
  }
  return { status: 'pass', result: null, reason: '工具分類與知識庫一致', risk: 'info' };
}

function ruleOrigin(kb) {
  if (!kb.matched) return { status: 'unknown', result: 'REVIEW', reason: '知識庫沒有這個工具的資料，AI 無法確認開發/營運地區，需人工複核（不可逕自判定合格或不合格）', risk: 'medium' };
  if (kb.matched.eligible === false) {
    return { status: 'fail', result: 'REJECT', reason: `${kb.matched.product_name}（${kb.matched.company}）：${kb.matched.prohibited_reason}`, risk: 'high' };
  }
  return { status: 'pass', result: null, reason: `知識庫判斷此工具開發/營運地區為 ${kb.matched.country_or_region}，非中國大陸/港澳（最後確認日期：${kb.matched.last_verified_at}）`, risk: 'info' };
}

function ruleOfficialSource(kb) {
  if (kb.isAggregator) return { status: 'fail', result: 'REJECT', reason: `購買來源比對到集合式AI平台/代購網站清單（${kb.aggregatorName}），不符合「須直接向官方網站購買」規定`, risk: 'high' };
  if (kb.isOfficialSource === true) return { status: 'pass', result: null, reason: '購買來源確認為官方網站', risk: 'info' };
  if (kb.isOfficialSource === false) return { status: 'fail', result: 'REVIEW', reason: '購買來源看起來不是已知的官方網站網域，需人工確認', risk: 'medium' };
  return { status: 'unknown', result: 'REVIEW', reason: '無法從憑證判讀購買來源網站，需人工確認是否為官方購買', risk: 'low' };
}

function ruleApiCreditToken(receipt) {
  const signal = detectApiOrCreditPlan({ productName: receipt.product_name, planType: receipt.plan_type, subscriptionPeriod: receipt.subscription_period });
  if (signal === 'strong') return { status: 'fail', result: 'REJECT', reason: `方案類型欄位（${receipt.plan_type}）明確顯示為 API額度/Credit/Token/點數/預付儲值等按用量計費項目，此類不得補助`, risk: 'high' };
  if (signal === 'weak') return { status: 'fail', result: 'REVIEW', reason: '商品名稱/訂閱期間文字中疑似出現 API/Credit/Token/點數等關鍵字，但不是在方案類型欄位，可能是誤判，需人工確認是否屬於禁止項目', risk: 'medium' };
  return { status: 'pass', result: null, reason: '未偵測到 API/Credit/Token/點數等禁止項目關鍵字', risk: 'info' };
}

function ruleReceiptName(application, receipt) {
  const level = similarityLevel(application.name, receipt.buyer_name);
  if (level === 'match') return { status: 'pass', result: null, reason: '憑證訂閱人姓名與申請人姓名一致', risk: 'info' };
  if (level === 'mismatch' || level === 'partial') {
    return { status: 'fail', result: 'REVIEW', reason: `憑證上的訂閱人姓名（${receipt.buyer_name}）與申請人姓名（${application.name}）不一致，需人工核對`, risk: 'low' };
  }
  return { status: 'unknown', result: 'REVIEW', reason: '憑證上沒有印出訂閱人姓名，或無法判讀', risk: 'low' };
}

function ruleReceiptRequiredFields(receipt) {
  const requiredKeys = ['product_name', 'company_name', 'purchase_date', 'original_amount', 'payment_method'];
  const labels = { product_name: '軟體名稱', company_name: '軟體公司名稱', purchase_date: '購買日期', original_amount: '原始費用', payment_method: '付款方式' };
  const missing = requiredKeys.filter((k) => receipt[k] === undefined || receipt[k] === null);
  if (!missing.length) return { status: 'pass', result: null, reason: '憑證必要欄位齊全', risk: 'info' };
  return { status: 'fail', result: 'NEED_SUPPLEMENT', reason: `憑證缺少必要欄位：${missing.map((k) => labels[k]).join('、')}，請提供更清楚的收據`, risk: 'medium' };
}

function ruleAmount(application, receipt) {
  const check = amountMatches(application.declared_amount, receipt.converted_twd_amount);
  if (check === 'match') return { status: 'pass', result: null, reason: '申請換算金額與憑證 OCR 金額一致', risk: 'info' };
  if (check === 'minor_diff') return { status: 'fail', result: 'REVIEW', reason: `申請換算金額（${application.declared_amount}元）與憑證 OCR 金額（${receipt.converted_twd_amount}元）有落差，需人工核對`, risk: 'low' };
  if (check === 'major_diff') return { status: 'fail', result: 'REVIEW', reason: `申請換算金額（${application.declared_amount}元）與憑證 OCR 金額（${receipt.converted_twd_amount}元）差異過大，需人工確認`, risk: 'medium' };
  // 完全讀不到憑證金額，這是缺資料，需要補一張看得到金額的收據，不是單純的判斷不確定
  return { status: 'unknown', result: 'NEED_SUPPLEMENT', reason: '無法從憑證判讀換算新臺幣金額，請提供能清楚看到金額的收據', risk: 'medium' };
}

function rulePaymentProof(receipt) {
  if (receipt.has_payment_proof) return { status: 'pass', result: null, reason: '已辨識出繳款憑證/出帳帳單', risk: 'info' };
  return { status: 'fail', result: 'NEED_SUPPLEMENT', reason: '未能辨識出「換算臺幣及繳款憑證（出帳帳單）」，請補附繳款/出帳截圖', risk: 'medium' };
}

function ruleBankAccountName(application, passbook) {
  const level = similarityLevel(application.name, passbook.account_holder_name);
  if (level === 'match') return { status: 'pass', result: null, reason: '存摺戶名與申請人姓名一致', risk: 'info' };
  if (level === 'mismatch') return { status: 'fail', result: 'REJECT', reason: `存摺戶名（${passbook.account_holder_name}）與申請人姓名（${application.name}）差異很大，撥款帳戶須為申請人本人`, risk: 'high' };
  if (level === 'partial') return { status: 'fail', result: 'REVIEW', reason: `存摺戶名 OCR 結果（${passbook.account_holder_name}）與申請人姓名（${application.name}）不完全一致，可能是 OCR 誤讀，需人工核對`, risk: 'medium' };
  return { status: 'unknown', result: 'NEED_SUPPLEMENT', reason: '無法判讀存摺戶名，需補件確認', risk: 'medium' };
}

function ruleSpecialProof(hasCulturalProof) {
  if (hasCulturalProof) return { status: 'pass', result: null, reason: '已上傳特定對象證明文件', risk: 'info' };
  return { status: 'fail', result: 'NEED_SUPPLEMENT', reason: '申請身分為「特定對象」，但尚未上傳證明文件', risk: 'medium' };
}

function ruleLanguageProof(hasCulturalProof) {
  if (hasCulturalProof) return { status: 'pass', result: null, reason: '已上傳語言能力認證證明文件', risk: 'info' };
  return { status: 'fail', result: 'NEED_SUPPLEMENT', reason: '申請身分為「文化語言保存者」，但尚未上傳語言能力認證證明文件', risk: 'medium' };
}

function rulePayerRelationship(hasPayerDeclaration) {
  if (hasPayerDeclaration) return { status: 'pass', result: null, reason: '已上傳父母/配偶/法定代理人代付關係與共同簽署切結書', risk: 'info' };
  return { status: 'fail', result: 'NEED_SUPPLEMENT', reason: '付款人非本人，但尚未上傳父母/配偶/法定代理人關係證明與共同切結書', risk: 'medium' };
}

function ruleDeclaration(hasDeclaration) {
  if (hasDeclaration) return { status: 'pass', result: null, reason: '已上傳切結書', risk: 'info' };
  return { status: 'fail', result: 'NEED_SUPPLEMENT', reason: '尚未上傳切結書', risk: 'medium' };
}

function ruleMonthlyContinuity(receiptList) {
  const { months, missing, incompleteMonths, duplicateSignatureFound } = analyzeMonthlyReceipts(receiptList);
  if (duplicateSignatureFound) {
    return { status: 'fail', result: 'FRAUD_RISK', reason: '偵測到同一張憑證（相同公司/金額/購買日期）被重複用來申請不同月份，疑似重複請領', risk: 'high' };
  }
  if (months.length <= 1) return { status: 'pass', result: null, reason: '僅申請單一月份，不需檢查連續性', risk: 'info' };
  if (missing.length) return { status: 'fail', result: 'NEED_SUPPLEMENT', reason: `月費制申請月份不連續，缺少：${missing.join('、')}`, risk: 'medium' };
  if (incompleteMonths.length) return { status: 'fail', result: 'NEED_SUPPLEMENT', reason: `以下月份缺少臺幣換算金額或繳款憑證，需補件：${incompleteMonths.join('、')}`, risk: 'medium' };
  return { status: 'pass', result: null, reason: `月費制申請月份連續且每月資料齊全（${months.join('、')}）`, risk: 'info' };
}

function ruleDuplicateReceipt(duplicateApplicationId) {
  if (duplicateApplicationId) {
    return { status: 'fail', result: 'FRAUD_RISK', reason: `偵測到申請案 ${duplicateApplicationId} 使用了特徵幾乎相同的憑證（相同軟體公司/金額/購買日期），疑似重複使用同一張憑證申請`, risk: 'high' };
  }
  return { status: 'pass', result: null, reason: '未發現其他申請案使用相同憑證特徵', risk: 'info' };
}

// ---------- 每條規則的中繼資料：判斷條件／資料來源／對應的 OCR 欄位 ----------
// data_source 的值：applicant_input（申請人填寫）／ocr:xxx（OCR擷取，xxx是文件類型）／knowledge_base（知識庫）／rule_engine（規則引擎自身邏輯）
const RULE_META = {
  'RULE-001': { name: '年齡', condition: '出生日期需介於民國74年4月3日～99年4月2日（16~40歲）', data_source: 'applicant_input', ocr_field: null },
  'RULE-002': { name: '設籍新竹市', condition: '身分證地址須為新竹市', data_source: 'ocr:id_card', ocr_field: 'address' },
  'RULE-003': { name: '購買日期區間', condition: '購買日期需介於民國115年4月2日～10月31日', data_source: 'applicant_input', ocr_field: null },
  'RULE-004': { name: '申請期限', condition: '需於購買後1個月(月費制)/2個月(年費制)內送出申請', data_source: 'applicant_input', ocr_field: null },
  'RULE-005': { name: 'AI工具分類', condition: '申請人選擇分類需與知識庫分類一致（不一致時建議人工確認，不直接退件）', data_source: 'ocr:receipt + knowledge_base', ocr_field: 'product_name,company_name' },
  'RULE-006': { name: '中國/港澳地區', condition: '工具開發/營運地區不得為中國大陸/港澳', data_source: 'ocr:receipt + knowledge_base', ocr_field: 'product_name,company_name' },
  'RULE-007': { name: '官方網站購買', condition: '須直接向官方網站購買，不得透過集合式平台/代購網站', data_source: 'ocr:receipt + knowledge_base', ocr_field: 'purchase_source' },
  'RULE-008': { name: 'API/Credit/Token', condition: '不得為API額度/Credit/Token/點數/預付儲值等按用量計費項目', data_source: 'ocr:receipt', ocr_field: 'plan_type,product_name,subscription_period' },
  'RULE-009': { name: '收據姓名比對', condition: '憑證訂閱人姓名需與申請人姓名相符', data_source: 'ocr:receipt', ocr_field: 'buyer_name' },
  'RULE-010': { name: '收據必要欄位', condition: '憑證須包含軟體名稱/公司/日期/金額/付款方式', data_source: 'ocr:receipt', ocr_field: 'product_name,company_name,purchase_date,original_amount,payment_method' },
  'RULE-011': { name: '臺幣金額比對', condition: '申請填寫的換算金額需與憑證 OCR 金額相符', data_source: 'applicant_input + ocr:receipt', ocr_field: 'converted_twd_amount' },
  'RULE-012': { name: '繳款憑證', condition: '須附繳款憑證/出帳帳單', data_source: 'ocr:receipt', ocr_field: 'converted_twd_amount' },
  'RULE-013': { name: '存摺戶名', condition: '撥款帳戶戶名需與申請人姓名相符', data_source: 'ocr:passbook', ocr_field: 'account_holder_name' },
  'RULE-014': { name: '特定對象證明', condition: '選擇「特定對象」需檢附證明文件', data_source: 'applicant_input', ocr_field: null },
  'RULE-015': { name: '語言認證證明', condition: '選擇「文化語言保存者」需檢附語言能力認證文件', data_source: 'applicant_input', ocr_field: null },
  'RULE-016': { name: '代付款關係', condition: '付款人非本人時需檢附關係證明與共同切結書', data_source: 'applicant_input', ocr_field: null },
  'RULE-017': { name: '切結書', condition: '須上傳切結書', data_source: 'applicant_input', ocr_field: null },
  'RULE-018': { name: '月費連續月份', condition: '月費制申請的月份須連續、每月都要有收據/臺幣換算/繳款憑證，且不得重複使用同一張憑證申請不同月份', data_source: 'ocr:receipt', ocr_field: 'purchase_date,converted_twd_amount' },
  'RULE-019': { name: '重複申請/重複憑證', condition: '同一憑證特徵（公司/金額/日期）不得被不同身分證字號重複申請', data_source: 'ocr:receipt + rule_engine', ocr_field: 'company_name,original_amount,purchase_date' },
  'RULE-020': { name: '補助金額試算', condition: '依身分別費率與上限計算補助金額；金額無法確認時不得算成 0 元', data_source: 'ocr:receipt + rule_engine', ocr_field: 'converted_twd_amount' },
};

function pushRule(rules, id, resultObj, confMaps) {
  const meta = RULE_META[id];
  const confidence = confidenceFor(confMaps, meta.data_source, meta.ocr_field);
  const guarded = applyConfidenceGuard(resultObj, confidence);
  rules.push({
    id, name: meta.name, condition: meta.condition, data_source: meta.data_source, ocr_field: meta.ocr_field,
    confidence, status: guarded.status, result: guarded.result, reason: guarded.reason, risk: guarded.risk,
    disposition: guarded.result || 'PASS',
  });
}

// ---------- 彙整五種結果 ----------
const SEVERITY_ORDER = ['PASS', 'REVIEW', 'NEED_SUPPLEMENT', 'REJECT', 'FRAUD_RISK'];
function aggregateResult(rules) {
  let worst = 'PASS';
  for (const r of rules) {
    if (!r || !r.result) continue;
    if (SEVERITY_ORDER.indexOf(r.result) > SEVERITY_ORDER.indexOf(worst)) worst = r.result;
  }
  return worst;
}

// ---------- 資料交叉比對矩陣（需求文件第六節）----------
// Applicant vs Identity Document vs Receipt vs Payment Proof vs Bank Book，結果分 MATCH/PARTIAL_MATCH/MISMATCH/UNKNOWN
function analyzePaymentVsReceipt(receiptList) {
  const officialAmounts = [];
  const paymentAmounts = [];
  for (const item of receiptList || []) {
    const d = item?.ocr_data;
    if (!d) continue;
    if (d.document_type === 'official_receipt' && d.converted_twd_amount) officialAmounts.push(d.converted_twd_amount);
    if (d.document_type === 'payment_statement' && d.converted_twd_amount) paymentAmounts.push(d.converted_twd_amount);
  }
  if (!officialAmounts.length || !paymentAmounts.length) {
    return { receiptAmount: officialAmounts[0] ?? null, paymentAmount: paymentAmounts[0] ?? null, result: 'UNKNOWN' };
  }
  return { receiptAmount: officialAmounts[0], paymentAmount: paymentAmounts[0], result: amountMatchLabel(amountMatches(officialAmounts[0], paymentAmounts[0])) };
}

function buildCrossValidation(application, idCard, receipt, passbook, receiptList) {
  const paymentCheck = analyzePaymentVsReceipt(receiptList);
  return [
    { check: 'identity_vs_id_document', label: '申請人 vs 身分證姓名', a_source: 'applicant_input', a_value: application.name, b_source: 'ocr:id_card.name', b_value: idCard.name ?? null, result: toMatchLabel(similarityLevel(application.name, idCard.name)) },
    { check: 'identity_vs_receipt', label: '申請人 vs 收據訂閱人姓名', a_source: 'applicant_input', a_value: application.name, b_source: 'ocr:receipt.buyer_name', b_value: receipt.buyer_name ?? null, result: toMatchLabel(similarityLevel(application.name, receipt.buyer_name)) },
    { check: 'identity_vs_bank', label: '申請人 vs 存摺戶名', a_source: 'applicant_input', a_value: application.name, b_source: 'ocr:passbook.account_holder_name', b_value: passbook.account_holder_name ?? null, result: toMatchLabel(similarityLevel(application.name, passbook.account_holder_name)) },
    { check: 'email', label: '申請人 Email vs 收據 Email', a_source: 'applicant_input', a_value: application.email ?? null, b_source: 'ocr:receipt.buyer_email', b_value: receipt.buyer_email ?? null, result: (application.email && receipt.buyer_email) ? (normalize(application.email) === normalize(receipt.buyer_email) ? 'MATCH' : 'MISMATCH') : 'UNKNOWN' },
    { check: 'purchase_amount', label: '申請填寫換算金額 vs 收據 OCR 金額', a_source: 'applicant_input', a_value: application.declared_amount ?? null, b_source: 'ocr:receipt.converted_twd_amount', b_value: receipt.converted_twd_amount ?? null, result: amountMatchLabel(amountMatches(application.declared_amount, receipt.converted_twd_amount)) },
    { check: 'payment_vs_receipt', label: '繳款憑證金額 vs 官方收據金額', a_source: 'ocr:receipt(payment_statement)', a_value: paymentCheck.paymentAmount, b_source: 'ocr:receipt(official_receipt)', b_value: paymentCheck.receiptAmount, result: paymentCheck.result },
  ];
}

// ---------- 資料可信度（需求文件第七節）----------
// 三種獨立的信心來源：OCR（各文件的信心分數平均）、知識庫（有沒有比對到已知工具）、規則引擎（決定性邏輯，非AI推論，固定1.00）。
// 這裡只是「報告」信心分數，不會拿來覆蓋規則判斷結果——低信心只會讓 applyConfidenceGuard 把 PASS 降級成 REVIEW，不會有其他作用。
function buildConfidenceSources(confidence, kb) {
  return {
    ocr: { receipt: confidence.receipt.overall, id_card: confidence.id_card.overall, passbook: confidence.passbook.overall },
    knowledge_base: kb.matched ? 1.0 : 0,
    rule_engine: 1.0,
    note: 'confidence 僅供承辦人員參考排序、決定是否要優先人工複核，不能取代補助規則本身的判斷。',
  };
}

// ---------- 補件中心（需求文件第八節）----------
function buildSupplementCenter(rules) {
  const items = rules.filter((r) => r.result === 'NEED_SUPPLEMENT').map((r) => ({ rule_id: r.id, missing_item: r.name, reason: r.reason }));
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 7);
  return { items, deadline: deadline.toISOString().slice(0, 10) };
}

// ---------- 主要進入點 ----------
//
// application：申請資料（含 applicant_type: normal/special/language, payment_type, birth_date...）
// docs：{
//   id_card: [{ocr_status, ocr_data}], receipt: [...], passbook: [...],
//   declaration_uploaded: bool, cultural_proof_uploaded: bool, payer_declaration_uploaded: bool,
// }
// context：{ applicationDate（送出申請的日期，用來算是否超過申請期限）, duplicateApplicationId（重複憑證比對到的其他案件編號，沒有就是 null） }
function evaluateApplication(application, docs, context = {}) {
  const applicantCategory = normalizeApplicantCategory(application.applicant_type);
  const idCardList = docs.id_card || [];
  const receiptList = docs.receipt || [];
  const passbookList = docs.passbook || [];

  const idCardReady = hasUsableOcrData(idCardList);
  const receiptReady = hasUsableOcrData(receiptList);
  const passbookReady = hasUsableOcrData(passbookList);

  const idCard = idCardReady ? mergeOcrData(idCardList, ['is_hsinchu_city']) : {};
  const receipt = receiptReady ? mergeOcrData(receiptList, ['has_payment_proof']) : {};
  const passbook = passbookReady ? mergeOcrData(passbookList) : {};

  const confMaps = {
    receipt: mergeConfidence(receiptList),
    id_card: mergeConfidence(idCardList),
    passbook: mergeConfidence(passbookList),
  };

  const kb = receiptReady
    ? classifyTool({ productName: receipt.product_name, companyName: receipt.company_name, purchaseSource: receipt.purchase_source })
    : { matched: null, isAggregator: false, aggregatorName: null, isOfficialSource: null };

  const notReady = (reason) => ({ status: 'unknown', result: 'NEED_SUPPLEMENT', reason, risk: 'medium' });

  const rules = [];
  pushRule(rules, 'RULE-001', ruleAge(application), confMaps);
  pushRule(rules, 'RULE-002', ruleRegistration(idCardReady, idCard), confMaps);
  pushRule(rules, 'RULE-003', rulePurchaseDateRange(application), confMaps);
  pushRule(rules, 'RULE-004', ruleApplicationDeadline(application, context.applicationDate), confMaps);
  pushRule(rules, 'RULE-005', receiptReady ? ruleToolCategory(application, kb) : notReady('憑證尚未辨識完成，無法確認工具分類'), confMaps);
  pushRule(rules, 'RULE-006', receiptReady ? ruleOrigin(kb) : notReady('憑證尚未辨識完成，無法確認工具來源地區'), confMaps);
  pushRule(rules, 'RULE-007', receiptReady ? ruleOfficialSource(kb) : notReady('憑證尚未辨識完成，無法確認購買來源'), confMaps);
  pushRule(rules, 'RULE-008', receiptReady ? ruleApiCreditToken(receipt) : notReady('憑證尚未辨識完成，無法確認方案類型'), confMaps);
  pushRule(rules, 'RULE-009', receiptReady ? ruleReceiptName(application, receipt) : notReady('憑證尚未辨識完成'), confMaps);
  pushRule(rules, 'RULE-010', receiptReady ? ruleReceiptRequiredFields(receipt) : notReady('憑證 OCR 辨識失敗或尚未完成'), confMaps);
  pushRule(rules, 'RULE-011', receiptReady ? ruleAmount(application, receipt) : notReady('憑證尚未辨識完成，無法核對金額'), confMaps);
  pushRule(rules, 'RULE-012', receiptReady ? rulePaymentProof(receipt) : notReady('憑證尚未辨識完成，無法確認是否附繳款憑證'), confMaps);
  pushRule(rules, 'RULE-013', passbookReady ? ruleBankAccountName(application, passbook) : notReady('存摺 OCR 辨識失敗或尚未完成'), confMaps);

  if (applicantCategory === 'special') pushRule(rules, 'RULE-014', ruleSpecialProof(!!docs.cultural_proof_uploaded), confMaps);
  if (applicantCategory === 'language') pushRule(rules, 'RULE-015', ruleLanguageProof(!!docs.cultural_proof_uploaded), confMaps);
  if (!application.is_own_credit_card) pushRule(rules, 'RULE-016', rulePayerRelationship(!!docs.payer_declaration_uploaded), confMaps);

  pushRule(rules, 'RULE-017', ruleDeclaration(!!docs.declaration_uploaded), confMaps);
  if (application.payment_type === 'monthly') pushRule(rules, 'RULE-018', ruleMonthlyContinuity(receiptList), confMaps);
  pushRule(rules, 'RULE-019', ruleDuplicateReceipt(context.duplicateApplicationId), confMaps);

  const eligible = resolveEligibleAmount(receiptReady, receiptList, application.payment_type, receipt, application.declared_amount);
  let subsidy;
  if (eligible.unknown) {
    const rate = SUBSIDY_RULES[applicantCategory]?.rate ?? null;
    const cap = SUBSIDY_RULES[applicantCategory]?.cap ?? null;
    subsidy = { applicant_category: applicantCategory, eligible_amount: null, subsidy_rate: rate, subsidy_cap: cap, subsidy_amount: null, source: null, unknown: true };
    pushRule(rules, 'RULE-020', { status: 'unknown', result: 'NEED_SUPPLEMENT', reason: '無法從憑證或申請資料確認可採信的購買金額，補助金額暫時無法試算（不會算成0元），需補件或人工確認金額', risk: 'medium' }, confMaps);
  } else {
    subsidy = { ...calculateSubsidy(eligible.amount, application.applicant_type), source: eligible.source, unknown: false };
    pushRule(rules, 'RULE-020', {
      status: 'pass', result: null,
      reason: `試算補助金額 ${subsidy.subsidy_amount} 元（費率 ${Math.round(subsidy.subsidy_rate * 100)}%，上限 ${subsidy.subsidy_cap} 元，可採信購買金額 ${subsidy.eligible_amount} 元，金額來源：${eligible.source === 'ocr_receipt' ? '憑證OCR' : '申請人自填（憑證無法判讀，僅供參考，建議人工核對）'}）`,
      risk: eligible.source === 'ocr_receipt' ? 'info' : 'low',
    }, confMaps);
  }

  const result = aggregateResult(rules);
  const confidence = { receipt: computeConfidence(receiptList), id_card: computeConfidence(idCardList), passbook: computeConfidence(passbookList) };

  return {
    result,
    // 四種資料來源明確分開回傳：
    applicant_data: {
      name: application.name, phone: application.phone, id_number: application.id_number,
      birth_date: application.birth_date, email: application.email,
      household_address: application.household_address, mailing_address: application.mailing_address,
      applicant_type: application.applicant_type, applicant_subtype: application.applicant_subtype,
      payment_type: application.payment_type, software_category: application.software_category,
      applied_tool_name: application.applied_tool_name, software_company: application.software_company,
      purchase_date: application.purchase_date, is_own_credit_card: !!application.is_own_credit_card,
      original_currency: application.original_currency, original_amount: application.original_amount,
      declared_amount: application.declared_amount,
    },
    ocr_data: { id_card: idCard, receipt, passbook },
    knowledge_base_data: { tool: kb.matched, is_aggregator: kb.isAggregator, aggregator_name: kb.aggregatorName, is_official_source: kb.isOfficialSource },
    cross_validation: buildCrossValidation(application, idCard, receipt, passbook, receiptList),
    confidence_sources: buildConfidenceSources(confidence, kb),
    rules,
    subsidy,
    supplement_center: buildSupplementCenter(rules),
    confidence,
    applicant_category: applicantCategory,
  };
}

module.exports = { evaluateApplication, mergeOcrData };
