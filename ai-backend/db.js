// db.js
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,              -- 申請案編號 (uuid)
  access_token TEXT NOT NULL,       -- 存取金鑰：操作/查看這個申請案都需要這把金鑰，不能只靠 id
  line_user_id TEXT,                -- 從 LINE 導連過來時帶入，之後查詢進度、推播通知都用這個
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  id_number TEXT,                   -- 完整身分證字號，屬敏感個資，正式環境應加密儲存並限制存取
  is_disadvantaged INTEGER DEFAULT 0,
  applied_tool_name TEXT,           -- 申請人自己填寫「購買的AI工具名稱」，供比對發票 OCR 結果
  declared_amount INTEGER,          -- 申請人自己填寫「實際付款金額」，供比對發票 OCR 結果
  status TEXT DEFAULT 'draft',      -- draft/submitted/reviewing/need_supplement/approved/disbursed/rejected
  risk_level TEXT,                  -- green/yellow/red，送出申請時由規則引擎自動判定
  risk_reasons TEXT,                -- JSON 陣列字串，記錄判定成該燈號的具體原因，給承辦人員參考
  note TEXT,                        -- 承辦人備註（例如：退件原因、預計撥款日）
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,           -- id_front / id_back / receipt / disadvantaged_proof / passbook
  file_path TEXT NOT NULL,
  original_name TEXT,
  ocr_status TEXT,                  -- null（不需要OCR的文件類型）/ pending / done / failed
  ocr_data TEXT,                    -- JSON 字串，存放 OCR 擷取出的結構化欄位
  uploaded_at TEXT NOT NULL,
  UNIQUE(application_id, doc_type),
  FOREIGN KEY(application_id) REFERENCES applications(id)
);
`);

module.exports = db;
