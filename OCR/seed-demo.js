// seed-demo.js：黑客松/展示用的示範資料腳本。
//
// 不會呼叫 Gemini OCR、不需要網路或 API 金鑰——直接餵「假裝已經 OCR 完成」的資料進真正的
// evaluateApplication() 規則引擎，所以這裡跑出來的 AI 建議、規則檢查結果、補助試算，
// 都是真實引擎算出來的，不是隨便寫死的展示文字。
//
// 使用方式：node seed-demo.js（會清掉舊的 DEMO-* 示範資料再重建，可以重複執行）
//
// 建立三筆示範案件：
//   DEMO-NORMAL-01：正常案件，資料齊全、工具合格、金額吻合 → 預期 AI 建議接近 PASS
//   DEMO-FRAUD-01 ：異常案件，用了中國禁止清單工具(CapCut) + 存摺戶名對不上 + 同一張憑證重複claim兩個月
//                   → 預期 AI 建議 FRAUD_RISK（多個嚴重問題疊加，FRAUD_RISK 優先權最高）
//   DEMO-SUPP-01  ：需要補件案件，繳款憑證缺失、換算金額讀不到、存摺辨識失敗 → 預期 AI 建議 NEED_SUPPLEMENT

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { evaluateApplication } = require('./rules');

const now = () => new Date().toISOString();

function makeApplication(overrides) {
  return {
    id_number: 'DEMO000000',
    name: '王小明', phone: '0912345678', birth_date: '2000-01-01',
    email: 'demo@example.com', household_address: '新竹市東區', mailing_address: '新竹市東區',
    payment_type: 'monthly', software_category: 'general', applied_tool_name: 'ChatGPT',
    software_company: 'OpenAI', purchase_date: '2026-05-10', is_own_credit_card: true,
    original_currency: 'USD', original_amount: 20, declared_amount: 630,
    applicant_type: 'normal', applicant_subtype: null,
    ...overrides,
  };
}

function insertDemo({ id, application, docs, context, statusOverride, note }) {
  const accessToken = uuidv4();
  const evalResult = evaluateApplication(application, docs, context);
  const status = statusOverride || (evalResult.result === 'NEED_SUPPLEMENT' ? 'need_supplement' : 'reviewing');

  db.prepare(`DELETE FROM application_events WHERE application_id = ?`).run(id);
  db.prepare(`DELETE FROM documents WHERE application_id = ?`).run(id);
  db.prepare(`DELETE FROM applications WHERE id = ?`).run(id);

  db.prepare(`
    INSERT INTO applications
      (id, access_token, line_user_id, name, phone, id_number, birth_date, email, household_address, mailing_address,
       payment_type, software_category, applied_tool_name, software_company, purchase_date, is_own_credit_card,
       original_currency, original_amount, is_disadvantaged, applicant_type, applicant_subtype, declared_amount,
       status, ai_result, rule_results, subsidy_eligible_amount, subsidy_rate, subsidy_amount, subsidy_cap,
       ai_confidence_note, ai_evaluation, note, submitted_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, accessToken, null, application.name, application.phone, application.id_number,
    application.birth_date, application.email, application.household_address, application.mailing_address,
    application.payment_type, application.software_category, application.applied_tool_name, application.software_company,
    application.purchase_date, application.is_own_credit_card ? 1 : 0,
    application.original_currency, application.original_amount,
    application.applicant_type !== 'normal' ? 1 : 0, application.applicant_type, application.applicant_subtype,
    application.declared_amount,
    status, evalResult.result, JSON.stringify(evalResult.rules),
    evalResult.subsidy.eligible_amount, evalResult.subsidy.subsidy_rate, evalResult.subsidy.subsidy_amount, evalResult.subsidy.subsidy_cap,
    JSON.stringify(evalResult.confidence), JSON.stringify(evalResult),
    note || null, now(), now(), now()
  );

  const events = [['submitted', '申請人送件'], ['ocr_done', 'OCR 完成'], ['ai_reviewed', 'AI 初審完成']];
  const issueCount = evalResult.rules.filter((r) => r.result).length;
  if (issueCount) events.push(['issues_found', `發現 ${issueCount} 個項目需留意`]);
  if (status === 'need_supplement') events.push(['supplement_notified', '通知補件']);
  events.forEach(([type, desc]) => {
    db.prepare(`INSERT INTO application_events (application_id, event_type, description, actor, created_at) VALUES (?,?,?,?,?)`)
      .run(id, type, desc, null, now());
  });

  console.log(`✔ ${id}　AI建議=${evalResult.result}　狀態=${status}　補助試算=${evalResult.subsidy.unknown ? 'UNKNOWN' : evalResult.subsidy.subsidy_amount + '元'}`);
}

// ---------- F. 正常案件 ----------
insertDemo({
  id: 'DEMO-NORMAL-01',
  application: makeApplication({ id_number: 'A100000001' }),
  docs: {
    id_card: [
      { ocr_status: 'done', ocr_data: { side: 'front', name: '王小明', id_number: 'A100000001', birth_date: '2000-01-01', _confidence: { name: 0.98, id_number: 0.97 } } },
      { ocr_status: 'done', ocr_data: { side: 'back', address: '新竹市東區光復路一段100號', is_hsinchu_city: true, _confidence: { address: 0.95 } } },
    ],
    receipt: [
      { ocr_status: 'done', ocr_data: {
        document_type: 'official_receipt', buyer_name: '王小明', buyer_email: 'demo@example.com',
        product_name: 'ChatGPT Plus', company_name: 'OpenAI', purchase_date: '2026-05-10',
        subscription_period: '2026-05-10 至 2026-06-09', original_amount: 20, currency: 'USD',
        converted_twd_amount: 630, payment_method: '信用卡', purchase_source: 'chatgpt.com',
        plan_type: '月付方案', has_payment_proof: true, card_last4: '1234', card_holder_name: 'WANG XIAOMING',
        _confidence: { buyer_name: 0.95, product_name: 0.98, company_name: 0.97, purchase_date: 0.96, original_amount: 0.99, converted_twd_amount: 0.9 },
      } },
    ],
    passbook: [
      { ocr_status: 'done', ocr_data: { bank_name: '台灣銀行', bank_code: '004', account_number: '1234567890123', account_holder_name: '王小明', _confidence: { account_holder_name: 0.97, account_number: 0.95 } } },
    ],
    cultural_proof_uploaded: false, declaration_uploaded: true, payer_declaration_uploaded: false,
  },
  context: { applicationDate: '2026-05-20', duplicateApplicationId: null },
});

// ---------- G. 異常案件：CapCut（中國禁止清單）＋ 存摺戶名對不上 ＋ 同一張憑證重複 claim 兩個月（FRAUD_RISK） ----------
const capcutReceiptFields = {
  document_type: 'official_receipt', buyer_name: '陳大文', buyer_email: 'chen@example.com',
  product_name: 'CapCut Pro', company_name: '字節跳動 ByteDance', purchase_date: '2026-05-15',
  subscription_period: '2026-05-15 至 2026-06-14', original_amount: 10, currency: 'USD',
  converted_twd_amount: 300, payment_method: '信用卡', purchase_source: 'capcut.com',
  plan_type: '月付方案', has_payment_proof: true, card_last4: '5678', card_holder_name: 'CHEN DAWEN',
};
insertDemo({
  id: 'DEMO-FRAUD-01',
  application: makeApplication({ id_number: 'A200000002', applied_tool_name: 'CapCut', software_company: '字節跳動 ByteDance', declared_amount: 300, original_amount: 10 }),
  docs: {
    id_card: [
      { ocr_status: 'done', ocr_data: { side: 'front', name: '陳大文', id_number: 'A200000002', birth_date: '1998-03-01', _confidence: { name: 0.96 } } },
      { ocr_status: 'done', ocr_data: { side: 'back', address: '新竹市北區中正路50號', is_hsinchu_city: true, _confidence: { address: 0.93 } } },
    ],
    // 兩張發票圖片的公司/金額/日期完全相同 → 疑似同一張憑證被重複拿去申請兩個月份
    receipt: [
      { ocr_status: 'done', ocr_data: { ...capcutReceiptFields, _confidence: { buyer_name: 0.9, product_name: 0.97, company_name: 0.9, converted_twd_amount: 0.88 } } },
      { ocr_status: 'done', ocr_data: { ...capcutReceiptFields, _confidence: { buyer_name: 0.88, product_name: 0.95, company_name: 0.9, converted_twd_amount: 0.85 } } },
    ],
    passbook: [
      { ocr_status: 'done', ocr_data: { bank_name: '中華郵政', bank_code: '700', account_number: '9876543210', account_holder_name: '曾子嘉', _confidence: { account_holder_name: 0.95 } } },
    ],
    cultural_proof_uploaded: false, declaration_uploaded: true, payer_declaration_uploaded: false,
  },
  context: { applicationDate: '2026-05-25', duplicateApplicationId: null },
  statusOverride: 'reviewing',
});

// ---------- H. 需要補件案件：繳款憑證缺失、換算金額讀不到、存摺辨識失敗 ----------
insertDemo({
  id: 'DEMO-SUPP-01',
  application: makeApplication({ id_number: 'A300000003', applied_tool_name: 'Notion AI', software_company: 'Notion Labs', declared_amount: 300, original_amount: 10 }),
  docs: {
    id_card: [
      { ocr_status: 'done', ocr_data: { side: 'front', name: '林小華', id_number: 'A300000003', birth_date: '1995-06-15', _confidence: { name: 0.94 } } },
      { ocr_status: 'done', ocr_data: { side: 'back', address: '新竹市香山區中華路200號', is_hsinchu_city: true, _confidence: { address: 0.9 } } },
    ],
    receipt: [
      { ocr_status: 'done', ocr_data: {
        document_type: 'official_receipt', buyer_name: '林小華', buyer_email: 'lin@example.com',
        product_name: 'Notion AI', company_name: 'Notion Labs', purchase_date: '2026-05-12',
        original_amount: 10, currency: 'USD', converted_twd_amount: null,
        payment_method: '信用卡', purchase_source: 'notion.so', plan_type: '月付方案',
        has_payment_proof: false, card_last4: null, card_holder_name: null,
        _confidence: { buyer_name: 0.9, product_name: 0.95, original_amount: 0.9 },
      } },
    ],
    passbook: [
      { ocr_status: 'failed', ocr_data: { _error: '圖片模糊，OCR 無法判讀' } },
    ],
    cultural_proof_uploaded: false, declaration_uploaded: true, payer_declaration_uploaded: false,
  },
  context: { applicationDate: '2026-05-18', duplicateApplicationId: null },
});

console.log('\n三筆示範案件已建立完成（受理編號開頭是 DEMO-），重新整理後台頁面即可看到。');
