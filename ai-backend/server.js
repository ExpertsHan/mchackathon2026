require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { extractReceiptInfo, extractIdBackInfo } = require('./ocr');
const { evaluateRisk } = require('./rules');

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

const DOC_TYPES = {
  id_front: '身分證正面',
  id_back: '身分證反面',
  receipt: '購買憑證/發票',
  disadvantaged_proof: '弱勢身分證明',
  passbook: '存摺封面影本',
};
const REQUIRED_DOCS = ['id_front', 'id_back', 'receipt', 'passbook'];
const STATUS_OPTIONS = ['draft', 'submitted', 'reviewing', 'need_supplement', 'approved', 'disbursed', 'rejected'];

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
      cb(null, `${req.params.docType}${path.extname(file.originalname) || ''}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype);
    cb(ok ? null : new Error('不支援的檔案格式，請上傳 jpg/png/webp/pdf'), ok);
  },
});

// 幫忙推播 LINE 通知，LINE 沒設定時直接跳過，不影響主要流程
async function notifyApplicant(lineUserId, text) {
  if (!lineUserId || !lineRouter || typeof lineRouter.pushMessage !== 'function') return;
  try {
    await lineRouter.pushMessage(lineUserId, text);
  } catch (err) {
    console.error('LINE 推播通知失敗：', err.message || err);
  }
}

app.post('/api/applications', (req, res) => {
  const { line_user_id, name, phone, id_number, is_disadvantaged, applied_tool_name, declared_amount } = req.body;
  if (!name || !phone) return res.status(400).json({ error: '請填寫姓名與電話' });

  const id = uuidv4();
  const accessToken = uuidv4(); // 存取金鑰，只在建立當下回傳一次，之後每次操作這個申請案都要附上
  db.prepare(`
    INSERT INTO applications
      (id, access_token, line_user_id, name, phone, id_number, is_disadvantaged,
       applied_tool_name, declared_amount, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(
    id, accessToken, line_user_id || null, name, phone, id_number || null,
    is_disadvantaged ? 1 : 0, applied_tool_name || null, declared_amount ? Number(declared_amount) : null,
    now(), now()
  );

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

app.post(
  '/api/applications/:id/documents/:docType',
  requireApplicantAccess,
  (req, res, next) => {
    if (!DOC_TYPES[req.params.docType]) return res.status(400).json({ error: '未知的文件類型' });
    next();
  },
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '未收到檔案' });

    const dir = path.dirname(req.file.path);
    const newFilename = path.basename(req.file.path);
    fs.readdirSync(dir).forEach((f) => {
      if (f.startsWith(`${req.params.docType}.`) && f !== newFilename) {
        fs.unlinkSync(path.join(dir, f));
      }
    });

    const relPath = path.relative(__dirname, req.file.path);
    const needsOcr = req.params.docType === 'receipt' || req.params.docType === 'id_back';

    db.prepare(`
      INSERT INTO documents (application_id, doc_type, file_path, original_name, ocr_status, ocr_data, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(application_id, doc_type) DO UPDATE SET
        file_path = excluded.file_path,
        original_name = excluded.original_name,
        ocr_status = excluded.ocr_status,
        ocr_data = NULL,
        uploaded_at = excluded.uploaded_at
    `).run(req.params.id, req.params.docType, relPath, req.file.originalname, needsOcr ? 'pending' : null, null, now());
    db.prepare('UPDATE applications SET updated_at = ? WHERE id = ?').run(now(), req.params.id);

    res.json({ ok: true, doc_type: req.params.docType, ocr: needsOcr ? 'pending' : null });

    if (needsOcr) {
      const absolutePath = req.file.path;
      const ocrPromise =
        req.params.docType === 'receipt' ? extractReceiptInfo(absolutePath) : extractIdBackInfo(absolutePath);
      ocrPromise
        .then((result) => {
          db.prepare(`UPDATE documents SET ocr_status = ?, ocr_data = ? WHERE application_id = ? AND doc_type = ?`).run(
            result.status,
            result.data ? JSON.stringify(result.data) : null,
            req.params.id,
            req.params.docType
          );
        })
        .catch((err) => console.error('背景 OCR 處理失敗：', err.message || err));
    }
  }
);

app.post('/api/applications/:id/submit', requireApplicantAccess, async (req, res) => {
  const required = [...REQUIRED_DOCS];
  if (req.application.is_disadvantaged) required.push('disadvantaged_proof');

  const allDocs = db.prepare('SELECT * FROM documents WHERE application_id = ?').all(req.params.id);
  const uploadedTypes = allDocs.map((d) => d.doc_type);
  const missing = required.filter((d) => !uploadedTypes.includes(d));
  if (missing.length) {
    return res.status(400).json({ error: '文件尚未齊全', missing: missing.map((d) => DOC_TYPES[d]) });
  }

  const waitForOcr = async (docType) => {
    for (let i = 0; i < 15; i++) {
      const doc = db.prepare('SELECT * FROM documents WHERE application_id = ? AND doc_type = ?').get(req.params.id, docType);
      if (!doc || doc.ocr_status !== 'pending') return doc;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return db.prepare('SELECT * FROM documents WHERE application_id = ? AND doc_type = ?').get(req.params.id, docType);
  };
  const receiptDoc = await waitForOcr('receipt');
  const idBackDoc = await waitForOcr('id_back');

  const docsForRules = {
    receipt: receiptDoc && { ocr_status: receiptDoc.ocr_status, ocr_data: receiptDoc.ocr_data ? JSON.parse(receiptDoc.ocr_data) : null },
    id_back: idBackDoc && { ocr_status: idBackDoc.ocr_status, ocr_data: idBackDoc.ocr_data ? JSON.parse(idBackDoc.ocr_data) : null },
  };

  const { level, reasons } = evaluateRisk(req.application, docsForRules);

  db.prepare(`
    UPDATE applications SET status = 'submitted', risk_level = ?, risk_reasons = ?, updated_at = ? WHERE id = ?
  `).run(level, JSON.stringify(reasons), now(), req.params.id);

  notifyApplicant(
    req.application.line_user_id,
    `您的補助申請已成功送出（受理編號：${req.params.id.slice(0, 8)}…），將進入審核程序。\n後續審核、補件、撥款進度都會透過這裡通知您，也可以隨時輸入「查詢進度」查看。`
  );

  res.json({ ok: true, status: 'submitted', risk_level: level });
});

app.get('/api/applications/:id', requireApplicantAccess, (req, res) => {
  const docs = db.prepare('SELECT doc_type, original_name, ocr_status, uploaded_at FROM documents WHERE application_id = ?').all(req.params.id);
  res.json({ ...req.application, documents: docs });
});

app.get('/api/applications/:id/documents/:docType/file', (req, res) => {
  const application = db.prepare('SELECT id, access_token FROM applications WHERE id = ?').get(req.params.id);
  if (!application) return res.status(404).json({ error: '找不到此申請案' });

  const isAdmin = safeCompare(req.headers['x-admin-token'], ADMIN_TOKEN);
  const isApplicant = safeCompare(req.headers['x-access-token'], application.access_token);
  if (!isAdmin && !isApplicant) return res.status(403).json({ error: '未授權' });

  const doc = db.prepare('SELECT * FROM documents WHERE application_id = ? AND doc_type = ?').get(req.params.id, req.params.docType);
  if (!doc) return res.status(404).json({ error: '找不到此文件' });
  res.sendFile(path.join(__dirname, doc.file_path));
});

app.get('/api/status', (req, res) => {
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: '缺少 uid' });
  const rows = db.prepare(
    'SELECT id, status, risk_level, note, created_at, updated_at FROM applications WHERE line_user_id = ? ORDER BY created_at DESC'
  ).all(uid);
  res.json(rows);
});

function requireAdmin(req, res, next) {
  if (!safeCompare(req.headers['x-admin-token'], ADMIN_TOKEN)) return res.status(401).json({ error: '未授權' });
  next();
}

app.get('/api/admin/applications', requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT id, line_user_id, name, phone, id_number, is_disadvantaged, applied_tool_name, declared_amount,
           status, risk_level, note, created_at, updated_at
    FROM applications ORDER BY created_at DESC
  `).all());
});

app.get('/api/admin/applications/:id', requireAdmin, (req, res) => {
  const application = db.prepare(`
    SELECT id, line_user_id, name, phone, id_number, is_disadvantaged, applied_tool_name, declared_amount,
           status, risk_level, risk_reasons, note, created_at, updated_at
    FROM applications WHERE id = ?
  `).get(req.params.id);
  if (!application) return res.status(404).json({ error: '找不到此申請案' });
  const docs = db.prepare('SELECT doc_type, original_name, ocr_status, ocr_data, uploaded_at FROM documents WHERE application_id = ?').all(req.params.id);
  res.json({
    ...application,
    risk_reasons: application.risk_reasons ? JSON.parse(application.risk_reasons) : [],
    documents: docs.map((d) => ({ ...d, ocr_data: d.ocr_data ? JSON.parse(d.ocr_data) : null })),
  });
});

const STATUS_NOTIFY_TEXT = {
  reviewing: '您的補助申請目前正在審核中，請耐心等候，有任何需要會再透過這裡通知您。',
  need_supplement: '您的補助申請需要補件，請留意以下備註說明，並儘速補齊資料。',
  approved: '恭喜！您的補助申請已核准，將盡快安排撥款作業。🎉',
  disbursed: '您的補助款已完成撥款，請留意帳戶入帳狀況，感謝您的申請！💰',
  rejected: '很抱歉，您的補助申請經審核後未通過，如有疑問請洽新竹市青年發展中心。',
};

app.patch('/api/admin/applications/:id', requireAdmin, (req, res) => {
  const { status, note } = req.body;
  if (status && !STATUS_OPTIONS.includes(status)) return res.status(400).json({ error: '狀態不合法' });

  const before = db.prepare('SELECT line_user_id, status FROM applications WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: '找不到此申請案' });

  db.prepare(`
    UPDATE applications SET status = COALESCE(?, status), note = COALESCE(?, note), updated_at = ?
    WHERE id = ?
  `).run(status || null, note ?? null, now(), req.params.id);

  if (status && status !== before.status && STATUS_NOTIFY_TEXT[status]) {
    let text = STATUS_NOTIFY_TEXT[status];
    if (status === 'need_supplement' && note) text += `\n\n備註：${note}`;
    notifyApplicant(before.line_user_id, text);
  }

  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || '伺服器錯誤' });
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
