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
  applied_tool_name TEXT,           -- 軟體名稱，供比對發票 OCR 結果
  declared_amount INTEGER,          -- 換算新臺幣後的金額，供比對發票 OCR 結果
  status TEXT DEFAULT 'draft',      -- draft/submitted/reviewing/need_supplement/approved/disbursed/rejected/cancelled
  risk_level TEXT,                  -- green/yellow/red，送出申請時由規則引擎自動判定
  risk_reasons TEXT,                -- JSON 陣列字串，記錄判定成該燈號的具體原因，給承辦人員參考
  note TEXT,                        -- 承辦人備註（例如：退件原因、預計撥款日）
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,           -- id_card / receipt / cultural_proof / passbook / declaration / payer_declaration
  file_path TEXT NOT NULL,
  original_name TEXT,
  ocr_status TEXT,                  -- null（不需要OCR的文件類型）/ pending / done / failed
  ocr_data TEXT,                    -- JSON 字串，存放 OCR 擷取出的結構化欄位
  uploaded_at TEXT NOT NULL,
  FOREIGN KEY(application_id) REFERENCES applications(id)
);
`);

// 早期版本的 documents 表格對 (application_id, doc_type) 設了 UNIQUE，
// 導致一種文件類型只能存一筆。身分證、發票現在要能上傳多張圖片，
// 所以偵測到舊的 UNIQUE 索引時，就把資料搬到沒有該限制的新表格。
const hasOldUniqueIndex = db.prepare("PRAGMA index_list('documents')").all().some((idx) => idx.unique === 1);
if (hasOldUniqueIndex) {
  db.exec(`
    CREATE TABLE documents_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      original_name TEXT,
      ocr_status TEXT,
      ocr_data TEXT,
      uploaded_at TEXT NOT NULL,
      FOREIGN KEY(application_id) REFERENCES applications(id)
    );
    INSERT INTO documents_new (application_id, doc_type, file_path, original_name, ocr_status, ocr_data, uploaded_at)
      SELECT application_id, doc_type, file_path, original_name, ocr_status, ocr_data, uploaded_at FROM documents;
    DROP TABLE documents;
    ALTER TABLE documents_new RENAME TO documents;
  `);
}

// 以下為後續擴充欄位（申請人與購買明細相關的新表單欄位），
// 用 try/catch ALTER TABLE 做簡易 migration，
// 避免舊的 data.sqlite（只有最初那批欄位）在重新部署後直接報錯。
const NEW_APPLICATION_COLUMNS = [
  ['birth_date', 'TEXT'],              // 出生日期
  ['email', 'TEXT'],                   // 電子郵件
  ['household_address', 'TEXT'],       // 戶籍地址
  ['mailing_address', 'TEXT'],         // 通訊地址
  ['payment_type', 'TEXT'],            // 繳費制度：annual（年費制）/ monthly（月費制）
  ['software_category', 'TEXT'],       // 功能：general/image/office/learning/other
  ['software_company', 'TEXT'],        // 軟體公司名稱
  ['purchase_date', 'TEXT'],           // 購買日期
  ['is_own_credit_card', 'INTEGER'],   // 1=本人信用卡，0=父母、配偶或法定代理人付費
  ['original_currency', 'TEXT'],       // 原始費用幣別：TWD/USD/JPY/EUR/AUD/HKD/other
  ['original_amount', 'REAL'],         // 原始費用（未換算）
  ['applicant_type', 'TEXT'],          // normal（一般青年）/ special（特定對象）/ language（文化語言保存者）；舊資料可能是 general/special_cultural
  ['applicant_subtype', 'TEXT'],       // 特定對象細項（例如：低收入戶）或語言認證類別（例如：原住民族語言能力認證）
  ['submitted_at', 'TEXT'],            // 實際送出申請的時間（區別於 created_at 建立草稿的時間），用來算是否超過申請期限
  ['ai_result', 'TEXT'],               // AI 建議結果：PASS/NEED_SUPPLEMENT/REVIEW/REJECT/FRAUD_RISK（僅供參考，不等於最終審核結果）
  ['rule_results', 'TEXT'],            // JSON，RULE-001~020 每條規則的判定結果與原因
  ['subsidy_eligible_amount', 'REAL'], // 試算用的「可採信購買金額」（新臺幣）
  ['subsidy_rate', 'REAL'],            // 試算補助費率
  ['subsidy_amount', 'REAL'],          // 試算補助金額
  ['subsidy_cap', 'REAL'],             // 該身分別的補助金額上限
  ['ai_confidence_note', 'TEXT'],      // JSON，OCR 信心分數彙整（每種文件的平均信心分數與低信心欄位清單）
  ['ai_evaluation', 'TEXT'],           // JSON，evaluateApplication() 的完整輸出：申請人填寫/OCR擷取/知識庫/交叉比對/信心來源/補件中心，供後台完整回溯
];
for (const [col, type] of NEW_APPLICATION_COLUMNS) {
  try {
    db.exec(`ALTER TABLE applications ADD COLUMN ${col} ${type}`);
  } catch (e) {
    // 欄位已存在時 SQLite 會丟錯，直接忽略即可
  }
}

// 審核時間軸（需求文件第九節）：記錄這個申請案從送件到結案，每一個關鍵時間點發生了什麼事，
// 包含 AI 自動產生的事件（OCR完成、AI初審完成、發現異常、通知補件…）跟承辦人員手動操作的事件（複核決定）。
db.exec(`
CREATE TABLE IF NOT EXISTS application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL,
  event_type TEXT NOT NULL,   -- submitted / ocr_done / ai_reviewed / issues_found / supplement_notified / supplemented / admin_decision / cancelled 等
  description TEXT NOT NULL,  -- 顯示給承辦人員看的文字說明
  actor TEXT,                 -- 誰觸發的：'AI' 或承辦人員填寫的姓名，null 代表系統自動事件
  created_at TEXT NOT NULL,
  FOREIGN KEY(application_id) REFERENCES applications(id)
);
`);

module.exports = db;
