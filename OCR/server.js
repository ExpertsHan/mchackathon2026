require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { extractReceiptInfo, extractIdBackInfo, extractPassbookInfo } = require('./ocr');
const { evaluateApplication, mergeOcrData } = require('./rules');

// 固定時間比對字串，避免透過比對耗時差異，反推猜出正確的 token（timing attack）
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'demo-admin-token';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

const DOC_TYPES = {
  id_card: '身分證正反面照片',
  receipt: '購買憑證/發票',
  cultural_proof: '特定對象及文化語言保存者證明文件',
  passbook: '存摺封面影本',
  declaration: '切結書',
  payer_declaration: '父母、配偶或法定代理人代為支付切結書',
};
// 一定要附的文件（不分申請身分／付款方式）
const REQUIRED_DOCS = ['id_card', 'receipt', 'passbook', 'declaration'];
// 這幾種文件類型允許一次上傳、累積多張圖片（例如身分證正+反面分開拍、發票+帳單+信用卡背面分開拍）
const MULTI_FILE_DOC_TYPES = ['id_card', 'receipt'];
// applicant_type：normal（一般青年）/ special（特定對象）/ language（文化語言保存者）
// 舊資料可能還是 general/special_cultural，這裡一併相容
const NORMAL_APPLICANT_TYPES = ['normal', 'general'];
const STATUS_OPTIONS = ['draft', 'submitted', 'reviewing', 'need_supplement', 'approved', 'disbursed', 'rejected', 'cancelled'];

// 依申請人填寫的「申請身分」「是否本人信用卡」，算出這個申請案實際需要的文件清單
function requiredDocsFor(application) {
  const docs = [...REQUIRED_DOCS];
  if (!NORMAL_APPLICANT_TYPES.includes(application.applicant_type)) docs.push('cultural_proof');
  if (application.is_own_credit_card === 0 || application.is_own_credit_card === false) docs.push('payer_declaration');
  return docs;
}

const now = () => new Date().toISOString();

let lineRouter = null;
if (process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET) {
  lineRouter = require('./line');
  app.use('/', lineRouter);
  console.log('LINE Bot webhook 已啟用：/webhook');
} else {
  console.log('尚未設定 LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET，先略過 LINE webhook（不影響網站其他功能）');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, 'uploads', req.params.id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      // 同一種文件類型現在可能有多張圖片，檔名要加上不重複的隨機值避免互相覆蓋
      const unique = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
      cb(null, `${req.params.docType}_${unique}${path.extname(file.originalname) || ''}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype);
    cb(ok ? null : new Error('不支援的檔案格式，請上傳 jpg/png/webp/pdf'), ok);
  },
});

// 幫忙推播 LINE 通知，LINE 沒設定時直接跳過，不影響主要流程。
// quickReply 可選填，用來附上「取消申請」之類的快速按鈕。
async function notifyApplicant(lineUserId, text, quickReply) {
  if (!lineUserId || !lineRouter || typeof lineRouter.pushMessage !== 'function') return;
  try {
    await lineRouter.pushMessage(lineUserId, text, quickReply);
  } catch (err) {
    console.error('LINE 推播通知失敗：', err.message || err);
  }
}

// 審核時間軸（需求文件第九節）：記錄一筆事件。actor 是 null 代表系統/AI 自動事件，有值代表是承辦人員手動操作
function logEvent(applicationId, eventType, description, actor = null) {
  try {
    db.prepare(`INSERT INTO application_events (application_id, event_type, description, actor, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(applicationId, eventType, description, actor, now());
  } catch (err) {
    console.error('寫入審核時間軸失敗：', err.message || err);
  }
}

// 申請案還「在跑」（尚未走到最終結果）的狀態，同一個身分證字號同時間只能有一筆
const ACTIVE_STATUSES = ['draft', 'submitted', 'reviewing', 'need_supplement'];

// 依身分證字號正規化（去空白、轉大寫），受理編號跟查重都用這個值
function normalizeIdNumber(idNumber) {
  return (idNumber || '').toString().trim().toUpperCase();
}

// 受理編號＝身分證字號 + 這是這個人第幾次申請（例如 A123456789-01）。
// 用身分證字號查重，同一人若已有一筆「在跑」的申請案就不能再開新的一筆；
// 已核准/已撥款/不通過/已取消的舊案不算，seq 會往下一號累加，方便日後追溯同一人歷次申請紀錄。
function buildApplicationId(idNumber) {
  const countRow = db.prepare('SELECT COUNT(*) AS c FROM applications WHERE id_number = ?').get(idNumber);
  const seq = (countRow.c || 0) + 1;
  return `${idNumber}-${String(seq).padStart(2, '0')}`;
}

app.post('/api/applications', (req, res) => {
  const {
    line_user_id, name, phone, id_number,
    birth_date, email, household_address, mailing_address,
    payment_type, software_category, applied_tool_name, software_company,
    purchase_date, is_own_credit_card, original_currency, original_amount,
    declared_amount, applicant_type, applicant_subtype,
  } = req.body;

  if (!name || !phone) return res.status(400).json({ error: '請填寫姓名與電話' });
  const idNumber = normalizeIdNumber(id_number);
  if (!idNumber) return res.status(400).json({ error: '請填寫身分證字號' });

  const existing = db
    .prepare(`SELECT status FROM applications WHERE id_number = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 1`)
    .get(idNumber, ...ACTIVE_STATUSES);
  if (existing) {
    return res.status(409).json({
      error: '此身分證字號已有一筆申請案正在處理中，同一人同時間只能有一筆申請。若要查詢或補件，請透過 LINE 輸入「查詢進度」。',
    });
  }

  const applicantType = applicant_type || 'normal';
  const isDisadvantaged = !NORMAL_APPLICANT_TYPES.includes(applicantType);
  const id = buildApplicationId(idNumber);
  const accessToken = uuidv4(); // 存取金鑰，只在建立當下回傳一次，之後每次操作這個申請案都要附上
  try {
    db.prepare(`
      INSERT INTO applications
        (id, access_token, line_user_id, name, phone, id_number,
         birth_date, email, household_address, mailing_address,
         payment_type, software_category, applied_tool_name, software_company,
         purchase_date, is_own_credit_card, original_currency, original_amount,
         is_disadvantaged, applicant_type, applicant_subtype, declared_amount, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    `).run(
      id, accessToken, line_user_id || null, name, phone, idNumber,
      birth_date || null, email || null, household_address || null, mailing_address || null,
      payment_type || null, software_category || null, applied_tool_name || null, software_company || null,
      purchase_date || null,
      is_own_credit_card === false || is_own_credit_card === 'false' || is_own_credit_card === 0 ? 0 : 1,
      original_currency || null, original_amount ? Number(original_amount) : null,
      isDisadvantaged ? 1 : 0, applicantType, applicant_subtype || null, declared_amount ? Number(declared_amount) : null,
      now(), now()
    );
  } catch (err) {
    // 極少數情況下兩個請求同時搶同一個受理編號（例如同時點兩次送出），受理編號會撞號被 UNIQUE 擋下來
    console.error('建立申請案失敗：', err.message || err);
    return res.status(409).json({ error: '系統忙碌中，請稍後再試一次' });
  }

  res.json({ id, access_token: accessToken, status: 'draft' });
});

// 檢查「操作這個申請案的人，有沒有帶對存取金鑰」
function requireApplicantAccess(req, res, next) {
  const application = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!application) return res.status(404).json({ error: '找不到此申請案' });
  const token = req.headers['x-access-token'];
  if (!safeCompare(token, application.access_token)) {
    return res.status(403).json({ error: '未授權：存取金鑰不正確或未提供' });
  }
  req.application = application;
  next();
}

// 文件上傳的實際處理邏輯，包成一個函式讓「一般文件上傳」跟「補件上傳」兩條路由共用
async function handleDocumentUpload(req, res) {
  if (!req.files || !req.files.length) return res.status(400).json({ error: '未收到檔案' });

  const docType = req.params.docType;
  const isMulti = MULTI_FILE_DOC_TYPES.includes(docType);

  // 單檔類型（存摺、切結書等）：新檔案上傳時，先把舊的檔案（實體檔+資料庫紀錄）清掉，只留最新一份
  if (!isMulti) {
    const olds = db.prepare('SELECT * FROM documents WHERE application_id = ? AND doc_type = ?').all(req.params.id, docType);
    olds.forEach((o) => {
      try { fs.unlinkSync(path.join(__dirname, o.file_path)); } catch (e) { /* 檔案可能已不存在，忽略即可 */ }
    });
    db.prepare('DELETE FROM documents WHERE application_id = ? AND doc_type = ?').run(req.params.id, docType);
  }

  const needsOcr = docType === 'receipt' || docType === 'id_card' || docType === 'passbook';
  const inserted = [];
  for (const file of req.files) {
    const relPath = path.relative(__dirname, file.path);
    const info = db.prepare(`
      INSERT INTO documents (application_id, doc_type, file_path, original_name, ocr_status, ocr_data, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, docType, relPath, file.originalname, needsOcr ? 'pending' : null, null, now());
    inserted.push({ id: info.lastInsertRowid, absolutePath: file.path });
  }
  db.prepare('UPDATE applications SET updated_at = ? WHERE id = ?').run(now(), req.params.id);

  res.json({ ok: true, doc_type: docType, count: req.files.length, ocr: needsOcr ? 'pending' : null });

  if (needsOcr) {
    for (const item of inserted) {
      const ocrPromise =
        docType === 'receipt' ? extractReceiptInfo(item.absolutePath)
        : docType === 'passbook' ? extractPassbookInfo(item.absolutePath)
        : extractIdBackInfo(item.absolutePath); // id_card：正面或背面都用同一支函式盡量擷取姓名/生日/字號/地址
      ocrPromise
        .then((result) => {
          db.prepare(`UPDATE documents SET ocr_status = ?, ocr_data = ? WHERE id = ?`).run(
            result.status,
            result.data ? JSON.stringify(result.data) : null,
            item.id
          );
        })
        .catch((err) => console.error('背景 OCR 處理失敗：', err.message || err));
    }
  }
}

// 對應需求文件第十七節 POST /applications/{id}/documents：一般文件上傳，doc_type 放在路徑上
app.post(
  '/api/applications/:id/documents/:docType',
  requireApplicantAccess,
  (req, res, next) => {
    if (!DOC_TYPES[req.params.docType]) return res.status(400).json({ error: '未知的文件類型' });
    next();
  },
  upload.array('files', 10),
  handleDocumentUpload
);

// 對應需求文件第十七節 POST /applications/{id}/supplements：補件上傳，doc_type 用 query string 帶（?docType=receipt），
// 行為跟一般文件上傳完全一樣，只是給「被要求補件」的流程一個語意比較清楚的路徑
app.post(
  '/api/applications/:id/supplements',
  requireApplicantAccess,
  (req, res, next) => {
    req.params.docType = req.query.docType;
    if (!DOC_TYPES[req.params.docType]) return res.status(400).json({ error: '請用 ?docType= 指定文件類型' });
    next();
  },
  upload.array('files', 10),
  handleDocumentUpload
);

// 產生第十六節要求的「自動補件」LINE 訊息格式
function buildSupplementMessage(applicationId, rules, resumeUrl) {
  const items = rules.filter((r) => r.result === 'NEED_SUPPLEMENT');
  const numerals = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
  const lines = items.map((r, i) => `${numerals[i] || `${i + 1}.`} ${r.reason}`);
  return (
    `您好，您的 AI 補助申請（受理編號：${applicationId}）目前需要補件：\n\n${lines.join('\n')}\n\n` +
    `請點選以下連結補齊或更新文件：\n${resumeUrl}\n\n` +
    `若您不想繼續申請，也可以直接在下方選擇「取消申請」。`
  );
}

app.post('/api/applications/:id/submit', requireApplicantAccess, async (req, res) => {
  const required = requiredDocsFor(req.application);

  const allDocs = db.prepare('SELECT * FROM documents WHERE application_id = ?').all(req.params.id);
  const uploadedTypes = [...new Set(allDocs.map((d) => d.doc_type))];
  const missing = required.filter((d) => !uploadedTypes.includes(d));
  if (missing.length) {
    return res.status(400).json({ error: '文件尚未齊全', missing: missing.map((d) => DOC_TYPES[d]) });
  }

  const isResubmit = !!req.application.submitted_at;
  logEvent(req.params.id, isResubmit ? 'supplemented' : 'submitted', isResubmit ? '申請人補件' : '申請人送件');

  // 等待這個 doc_type 底下「所有」圖片的 OCR 都跑完（因為現在一種文件可能有多張圖）
  const waitForOcr = async (docType) => {
    for (let i = 0; i < 15; i++) {
      const docs = db.prepare('SELECT * FROM documents WHERE application_id = ? AND doc_type = ?').all(req.params.id, docType);
      if (!docs.length || docs.every((d) => d.ocr_status !== 'pending')) return docs;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return db.prepare('SELECT * FROM documents WHERE application_id = ? AND doc_type = ?').all(req.params.id, docType);
  };
  const receiptDocs = await waitForOcr('receipt');
  const idCardDocs = await waitForOcr('id_card');
  const passbookDocs = await waitForOcr('passbook');
  logEvent(req.params.id, 'ocr_done', 'OCR 完成');

  const toOcrList = (docs) => docs.map((d) => ({ ocr_status: d.ocr_status, ocr_data: d.ocr_data ? JSON.parse(d.ocr_data) : null }));
  const receiptList = toOcrList(receiptDocs);

  // RULE-019 重複申請/重複憑證：拿這張憑證 OCR 出來的公司/金額/日期，去比對「別人」有沒有申請案用了幾乎一樣的特徵。
  // 因為系統目前只把「申請人自填」的軟體公司/金額/購買日期存成可查詢欄位，所以這裡比對的是
  // 「這次憑證 OCR 結果」vs「其他申請案的自填資料」，是一個保守的重複比對，不是嚴謹的原始憑證比對。
  const mergedReceiptForDup = mergeOcrData(receiptList, ['has_payment_proof']);
  let duplicateApplicationId = null;
  if (mergedReceiptForDup.company_name && mergedReceiptForDup.original_amount && mergedReceiptForDup.purchase_date) {
    const dup = db.prepare(`
      SELECT id FROM applications
      WHERE id_number != ? AND status NOT IN ('cancelled', 'rejected')
        AND software_company = ? AND original_amount = ? AND purchase_date = ?
      LIMIT 1
    `).get(req.application.id_number, mergedReceiptForDup.company_name, mergedReceiptForDup.original_amount, mergedReceiptForDup.purchase_date);
    duplicateApplicationId = dup ? dup.id : null;
  }

  const docsForRules = {
    receipt: receiptList,
    id_card: toOcrList(idCardDocs),
    passbook: toOcrList(passbookDocs),
    cultural_proof_uploaded: uploadedTypes.includes('cultural_proof'),
    declaration_uploaded: uploadedTypes.includes('declaration'),
    payer_declaration_uploaded: uploadedTypes.includes('payer_declaration'),
  };

  const evalResult = evaluateApplication(req.application, docsForRules, {
    applicationDate: now().slice(0, 10),
    duplicateApplicationId,
  });
  logEvent(req.params.id, 'ai_reviewed', isResubmit ? 'AI 重新審核' : 'AI 初審完成');

  const issueCount = evalResult.rules.filter((r) => r.result).length;
  if (issueCount > 0) logEvent(req.params.id, 'issues_found', `發現 ${issueCount} 個項目需留意（含補件/人工複核/退件建議）`);

  // AI 只給建議：NEED_SUPPLEMENT 屬於低風險、可回復的動作（跟申請人要文件），所以自動轉狀態並通知申請人。
  // PASS／REVIEW／REJECT／FRAUD_RISK 一律先進承辦人員審核佇列，AI 的建議只標記在案件上，不自動核准或退件。
  const newStatus = evalResult.result === 'NEED_SUPPLEMENT' ? 'need_supplement' : 'reviewing';
  const needSupplementReasons = evalResult.rules.filter((r) => r.result === 'NEED_SUPPLEMENT').map((r) => `📋 [${r.id}] ${r.reason}`);
  const note = needSupplementReasons.length ? `AI 建議補件：\n${needSupplementReasons.join('\n')}` : null;

  db.prepare(`
    UPDATE applications SET
      status = ?, submitted_at = COALESCE(submitted_at, ?),
      ai_result = ?, rule_results = ?,
      subsidy_eligible_amount = ?, subsidy_rate = ?, subsidy_amount = ?, subsidy_cap = ?,
      ai_confidence_note = ?, ai_evaluation = ?, note = COALESCE(?, note), updated_at = ?
    WHERE id = ?
  `).run(
    newStatus, now(),
    evalResult.result, JSON.stringify(evalResult.rules),
    evalResult.subsidy.eligible_amount, evalResult.subsidy.subsidy_rate, evalResult.subsidy.subsidy_amount, evalResult.subsidy.subsidy_cap,
    JSON.stringify(evalResult.confidence), JSON.stringify(evalResult),
    note, now(), req.params.id
  );

  if (newStatus === 'need_supplement') {
    logEvent(req.params.id, 'supplement_notified', '通知補件');
    const resumeUrl = `${PUBLIC_BASE_URL}/apply.html?resume=${req.params.id}&token=${req.application.access_token}`;
    notifyApplicant(
      req.application.line_user_id,
      buildSupplementMessage(req.params.id, evalResult.rules, resumeUrl),
      {
        items: [
          { type: 'action', action: { type: 'uri', label: '前往補件', uri: resumeUrl } },
          { type: 'action', action: { type: 'message', label: '取消申請', text: '取消申請' } },
          { type: 'action', action: { type: 'message', label: '查詢進度', text: '查詢進度' } },
        ],
      }
    );
  } else {
    // PASS/REVIEW/REJECT/FRAUD_RISK：不對申請人揭露 AI 的建議結果（尚未定案，由人工複核），只告知已受理
    notifyApplicant(
      req.application.line_user_id,
      `您的補助申請已成功送出（受理編號：${req.params.id}），將進入審核程序。\n後續審核、補件、撥款進度都會透過這裡通知您，也可以隨時輸入「查詢進度」查看。`
    );
  }

  res.json({ ok: true, status: newStatus, ai_result: evalResult.result, subsidy: evalResult.subsidy });
});

app.post('/api/applications/:id/cancel', requireApplicantAccess, async (req, res) => {
  if (['approved', 'disbursed'].includes(req.application.status)) {
    return res.status(400).json({ error: '此申請案已進入撥款流程，無法自行取消，如有需要請洽承辦人員' });
  }
  db.prepare(`UPDATE applications SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now(), req.params.id);
  logEvent(req.params.id, 'cancelled', '申請人取消申請');
  notifyApplicant(req.application.line_user_id, `您的補助申請（受理編號：${req.params.id}）已取消。若之後想重新申請，隨時輸入「申請」即可。`);
  res.json({ ok: true, status: 'cancelled' });
});

app.get('/api/applications/:id', requireApplicantAccess, (req, res) => {
  const docs = db.prepare('SELECT id, doc_type, original_name, ocr_status, uploaded_at FROM documents WHERE application_id = ? ORDER BY uploaded_at').all(req.params.id);
  res.json({ ...req.application, documents: docs });
});

// 對應需求文件第十七節 GET /applications/{id}/status：只回傳狀態相關的精簡資訊，給 LINE/前端輪詢用
app.get('/api/applications/:id/status', requireApplicantAccess, (req, res) => {
  res.json({
    id: req.application.id,
    status: req.application.status,
    ai_result: req.application.ai_result,
    subsidy_amount: req.application.subsidy_amount,
    note: req.application.note,
    updated_at: req.application.updated_at,
  });
});

// 對應需求文件第十七節 GET /applications/{id}/missing-documents：目前這筆申請案還缺什麼
app.get('/api/applications/:id/missing-documents', requireApplicantAccess, (req, res) => {
  const allDocs = db.prepare('SELECT doc_type FROM documents WHERE application_id = ?').all(req.params.id);
  const uploadedTypes = [...new Set(allDocs.map((d) => d.doc_type))];
  const missingDocuments = requiredDocsFor(req.application)
    .filter((d) => !uploadedTypes.includes(d))
    .map((d) => ({ doc_type: d, label: DOC_TYPES[d], reason: '尚未上傳' }));

  let ruleIssues = [];
  if (req.application.rule_results) {
    try {
      ruleIssues = JSON.parse(req.application.rule_results)
        .filter((r) => r.result === 'NEED_SUPPLEMENT')
        .map((r) => ({ rule: r.id, label: r.name, reason: r.reason }));
    } catch (e) { /* 舊資料或格式異常就當作沒有 */ }
  }
  res.json({ missing_documents: missingDocuments, rule_issues: ruleIssues });
});

// 對應需求文件第十七節 GET /applications/{id}/payment-status：撥款相關資訊，帳號只回傳末四碼避免過度曝露
app.get('/api/applications/:id/payment-status', requireApplicantAccess, (req, res) => {
  const passbookDocs = db.prepare("SELECT ocr_data FROM documents WHERE application_id = ? AND doc_type = 'passbook'").all(req.params.id);
  const merged = mergeOcrData(passbookDocs.map((d) => ({ ocr_data: d.ocr_data ? JSON.parse(d.ocr_data) : null })));
  res.json({
    status: req.application.status,
    subsidy_amount: req.application.subsidy_amount,
    bank_name: merged.bank_name || null,
    bank_code: merged.bank_code || null,
    account_number_last4: merged.account_number ? String(merged.account_number).slice(-4) : null,
    disbursed: req.application.status === 'disbursed',
  });
});

app.get('/api/applications/:id/documents/:docType/file/:fileId', (req, res) => {
  const application = db.prepare('SELECT id, access_token FROM applications WHERE id = ?').get(req.params.id);
  if (!application) return res.status(404).json({ error: '找不到此申請案' });

  const isAdmin = safeCompare(req.headers['x-admin-token'], ADMIN_TOKEN);
  const isApplicant = safeCompare(req.headers['x-access-token'], application.access_token);
  if (!isAdmin && !isApplicant) return res.status(403).json({ error: '未授權' });

  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND application_id = ? AND doc_type = ?').get(req.params.fileId, req.params.id, req.params.docType);
  if (!doc) return res.status(404).json({ error: '找不到此文件' });
  res.sendFile(path.join(__dirname, doc.file_path));
});

app.get('/api/status', (req, res) => {
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: '缺少 uid' });
  const rows = db.prepare(
    'SELECT id, status, risk_level, ai_result, note, created_at, updated_at FROM applications WHERE line_user_id = ? ORDER BY created_at DESC'
  ).all(uid);
  res.json(rows);
});

function requireAdmin(req, res, next) {
  if (!safeCompare(req.headers['x-admin-token'], ADMIN_TOKEN)) return res.status(401).json({ error: '未授權' });
  next();
}

app.get('/api/admin/applications', requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT id, line_user_id, name, phone, id_number, is_disadvantaged, applicant_type, applicant_subtype,
           applied_tool_name, declared_amount, status, risk_level, ai_result, subsidy_amount, note, created_at, updated_at
    FROM applications ORDER BY created_at DESC
  `).all());
});

app.get('/api/admin/applications/:id', requireAdmin, (req, res) => {
  const application = db.prepare(`
    SELECT id, line_user_id, name, phone, id_number, birth_date, email,
           household_address, mailing_address, is_disadvantaged, applicant_type, applicant_subtype,
           payment_type, software_category, applied_tool_name, software_company,
           purchase_date, is_own_credit_card, original_currency, original_amount,
           declared_amount, status, risk_level, risk_reasons, ai_result, rule_results,
           subsidy_eligible_amount, subsidy_rate, subsidy_amount, subsidy_cap, ai_confidence_note, ai_evaluation,
           note, submitted_at, created_at, updated_at
    FROM applications WHERE id = ?
  `).get(req.params.id);
  if (!application) return res.status(404).json({ error: '找不到此申請案' });
  const docs = db.prepare('SELECT id, doc_type, original_name, ocr_status, ocr_data, uploaded_at FROM documents WHERE application_id = ? ORDER BY uploaded_at').all(req.params.id);
  const events = db.prepare('SELECT event_type, description, actor, created_at FROM application_events WHERE application_id = ? ORDER BY created_at').all(req.params.id);
  res.json({
    ...application,
    risk_reasons: application.risk_reasons ? JSON.parse(application.risk_reasons) : [],
    rule_results: application.rule_results ? JSON.parse(application.rule_results) : [],
    ai_confidence_note: application.ai_confidence_note ? JSON.parse(application.ai_confidence_note) : null,
    ai_evaluation: application.ai_evaluation ? JSON.parse(application.ai_evaluation) : null,
    documents: docs.map((d) => ({ ...d, ocr_data: d.ocr_data ? JSON.parse(d.ocr_data) : null })),
    timeline: events,
  });
});

// Dashboard（第十五節）：給黑客松評審或市府長官快速看懂「AI 到底幫市府處理了什麼」的彙總統計。
// 注意：「預估節省人工審核時間」是用一個透明、寫死的假設（人工全部手動查核一件約20分鐘，
// 有 AI 輔助後承辦人員只需複核 AI 已標記的重點約5分鐘）粗估，不是真的量測出來的數字，僅供展示參考。
const MINUTES_MANUAL_PER_CASE = 20;
const MINUTES_AI_ASSISTED_PER_CASE = 5;

app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  const applications = db.prepare(`
    SELECT id, status, ai_result, rule_results, submitted_at FROM applications WHERE submitted_at IS NOT NULL
  `).all();
  const documents = db.prepare(`SELECT doc_type, ocr_status, ocr_data FROM documents`).all();

  let fieldsExtracted = 0;
  let docsOcrProcessed = 0;
  documents.forEach((d) => {
    if (!d.ocr_data) return;
    docsOcrProcessed++;
    try {
      const data = JSON.parse(d.ocr_data);
      fieldsExtracted += Object.entries(data).filter(([k, v]) => !k.startsWith('_') && v !== null && v !== undefined && v !== '').length;
    } catch (e) { /* 忽略解析失敗的資料 */ }
  });

  let rulesPassed = 0;
  let rulesTotal = 0;
  let issuesFound = 0;
  applications.forEach((a) => {
    if (!a.rule_results) return;
    try {
      const rules = JSON.parse(a.rule_results);
      rulesTotal += rules.length;
      rules.forEach((r) => { if (!r.result) rulesPassed++; else issuesFound++; });
    } catch (e) { /* 忽略 */ }
  });

  const supplementNotifiedCount = db.prepare(`SELECT COUNT(*) AS c FROM application_events WHERE event_type = 'supplement_notified'`).get().c;
  const needsHumanReview = applications.filter((a) => a.status === 'reviewing' || a.status === 'need_supplement').length;
  const submittedCount = applications.length;
  const estimatedMinutesSaved = submittedCount * (MINUTES_MANUAL_PER_CASE - MINUTES_AI_ASSISTED_PER_CASE);

  res.json({
    documents_uploaded: documents.length,
    documents_ocr_processed: docsOcrProcessed,
    ocr_fields_extracted: fieldsExtracted,
    applications_submitted: submittedCount,
    rules_total_checked: rulesTotal,
    rules_auto_passed: rulesPassed,
    issues_found: issuesFound,
    supplement_notifications_sent: supplementNotifiedCount,
    applications_needing_human_review: needsHumanReview,
    estimated_minutes_saved: estimatedMinutesSaved,
    assumption_note: `估算假設：人工全程手動審核一件約 ${MINUTES_MANUAL_PER_CASE} 分鐘，有 AI 輔助後承辦人員只需複核 AI 標記重點約 ${MINUTES_AI_ASSISTED_PER_CASE} 分鐘，僅供參考，非實測數字`,
  });
});

const STATUS_NOTIFY_TEXT = {
  reviewing: '您的補助申請目前正在審核中，請耐心等候，有任何需要會再透過這裡通知您。',
  need_supplement: '您的補助申請需要補件，請留意以下備註說明，並儘速補齊資料。',
  approved: '恭喜！您的補助申請已核准，將盡快安排撥款作業。🎉',
  disbursed: '您的補助款已完成撥款，請留意帳戶入帳狀況，感謝您的申請！💰',
  rejected: '很抱歉，您的補助申請經審核後未通過，如有疑問請洽新竹市青年發展中心。',
  cancelled: '您的補助申請已被取消。如有疑問請洽新竹市青年發展中心。',
};
// 給時間軸/紀錄用的中文標籤，對應人工複核工作台的「通過／補件／退件／需要進一步查核」四個動作
const DECISION_LABEL = {
  approved: '核准', need_supplement: '要求補件', rejected: '退件', reviewing: '標記需要進一步查核',
  disbursed: '完成撥款', cancelled: '取消申請', submitted: '恢復為已送出',
};

app.patch('/api/admin/applications/:id', requireAdmin, (req, res) => {
  const { status, note, reviewed_by, reason } = req.body;
  if (status && !STATUS_OPTIONS.includes(status)) return res.status(400).json({ error: '狀態不合法' });

  const before = db.prepare('SELECT line_user_id, status FROM applications WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: '找不到此申請案' });

  db.prepare(`
    UPDATE applications SET status = COALESCE(?, status), note = COALESCE(?, note), updated_at = ?
    WHERE id = ?
  `).run(status || null, note ?? null, now(), req.params.id);

  // 人工複核工作台（第十四節）：每一次承辦人員的決定都要記錄「承辦人、時間、決定、理由」，寫進審核時間軸
  if (status && status !== before.status) {
    const decisionLabel = DECISION_LABEL[status] || status;
    const actorLabel = reviewed_by ? reviewed_by : '（未填寫承辦人姓名）';
    logEvent(
      req.params.id, 'admin_decision',
      `承辦人複核：${decisionLabel}${reason ? `，理由：${reason}` : ''}`,
      actorLabel
    );
  }

  if (status && status !== before.status && STATUS_NOTIFY_TEXT[status]) {
    let text = STATUS_NOTIFY_TEXT[status];
    if (status === 'need_supplement' && note) text += `\n\n備註：${note}`;
    notifyApplicant(before.line_user_id, text);
  }

  res.json({ ok: true });
});

// 對應需求文件第十七節 POST /notifications/line：承辦人員手動推播一則自訂訊息給申請人
app.post('/api/admin/applications/:id/notify', requireAdmin, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: '請提供訊息內容' });
  const application = db.prepare('SELECT line_user_id FROM applications WHERE id = ?').get(req.params.id);
  if (!application) return res.status(404).json({ error: '找不到此申請案' });
  if (!application.line_user_id) return res.status(400).json({ error: '此申請案沒有對應的 LINE 使用者，無法推播' });
  await notifyApplicant(application.line_user_id, message);
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || '伺服器錯誤' });
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
