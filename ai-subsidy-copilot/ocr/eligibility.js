// eligibility.js：年齡／設籍／購買期間／申請期限的日期規則，以及補助金額試算模組
// 所有民國年日期都已經換算成西元年寫在這裡，之後政策調整（例如展延申請期限）改這個檔案就好。

const AGE_BIRTH_DATE_MIN = '1985-04-03'; // 民國74年4月3日（含）
const AGE_BIRTH_DATE_MAX = '2010-04-02'; // 民國99年4月2日（含）
const REGISTRATION_EFFECTIVE_DATE = '2026-08-14'; // 民國115年8月14日起，設籍新竹市才符合資格
const PURCHASE_DATE_MIN = '2026-04-02'; // 民國115年4月2日
const PURCHASE_DATE_MAX = '2026-10-31'; // 民國115年10月31日

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

// 回傳 true/false/null（null＝日期缺失或格式看不懂，無法判斷，交給人工）
function isWithinRange(dateStr, minStr, maxStr) {
  const d = parseDate(dateStr);
  if (!d) return null;
  return d >= parseDate(minStr) && d <= parseDate(maxStr);
}

function checkAge(birthDate) {
  return isWithinRange(birthDate, AGE_BIRTH_DATE_MIN, AGE_BIRTH_DATE_MAX);
}

function checkPurchaseDateRange(purchaseDate) {
  return isWithinRange(purchaseDate, PURCHASE_DATE_MIN, PURCHASE_DATE_MAX);
}

// 依繳費制度（月費制：買後1個月內；年費制：買後2個月內）算出申請期限，並跟實際送出申請的日期比較
function checkApplicationDeadline(purchaseDate, paymentType, applicationDate) {
  const purchase = parseDate(purchaseDate);
  const applied = parseDate(applicationDate);
  if (!purchase || !applied) return { withinDeadline: null, deadline: null };

  const deadline = new Date(purchase);
  deadline.setMonth(deadline.getMonth() + (paymentType === 'annual' ? 2 : 1));

  return { withinDeadline: applied.getTime() <= deadline.getTime(), deadline: deadline.toISOString().slice(0, 10) };
}

// NORMAL／SPECIAL／LANGUAGE 三種身分的補助費率與上限（SPECIAL 跟 LANGUAGE 費率相同，只是證明文件不同）
const SUBSIDY_RULES = {
  normal: { rate: 0.5, cap: 3000 },
  special: { rate: 0.9, cap: 6000 },
  language: { rate: 0.9, cap: 6000 },
};
const LEGACY_APPLICANT_TYPE_MAP = { general: 'normal', special_cultural: 'special' };

function normalizeApplicantCategory(applicantType) {
  return LEGACY_APPLICANT_TYPE_MAP[applicantType] || applicantType || 'normal';
}

// 計算補助金額。eligibleAmountTwd 是「已驗證/可採信的新臺幣購買金額」（月費制多個月要先加總）
function calculateSubsidy(eligibleAmountTwd, applicantType) {
  const category = normalizeApplicantCategory(applicantType);
  const rule = SUBSIDY_RULES[category] || SUBSIDY_RULES.normal;
  const amount = Number(eligibleAmountTwd) || 0;
  const rawAmount = Math.round(amount * rule.rate);
  const subsidyAmount = Math.min(rawAmount, rule.cap);
  return {
    applicant_category: category,
    eligible_amount: amount,
    subsidy_rate: rule.rate,
    subsidy_cap: rule.cap,
    subsidy_amount: subsidyAmount,
  };
}

module.exports = {
  AGE_BIRTH_DATE_MIN, AGE_BIRTH_DATE_MAX, REGISTRATION_EFFECTIVE_DATE, PURCHASE_DATE_MIN, PURCHASE_DATE_MAX,
  checkAge, checkPurchaseDateRange, checkApplicationDeadline, calculateSubsidy, normalizeApplicantCategory, SUBSIDY_RULES,
};
