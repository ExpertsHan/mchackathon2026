# 新竹市 AI 補助申請 - 智慧審核系統

民眾在申請網頁填寫資料、上傳文件，AI 用 Gemini 做 OCR 擷取文件內容，
規則引擎（RULE-001~020）比對申請人填寫資料／OCR擷取資料／AI工具知識庫，
產生五種建議結果，交給承辦人員在後台複核決定，狀態變更透過 LINE 主動通知申請人。

## 核心原則

**AI 只負責「讀取 → 比對 → 找問題 → 提供建議」，不會自動核准或退件。**
除了「NEED_SUPPLEMENT（需補件）」屬於低風險、可回復的動作，會自動轉狀態並
用 LINE 通知申請人補件之外，其餘建議（PASS／REVIEW／REJECT／FRAUD_RISK）
都只是標記在案件上，最終審核／核定／核銷／撥款一律由承辦人員在後台決定，
且每一次決定都會記錄「承辦人、時間、決定、理由」到審核時間軸。

「OCR 無法辨識」不等於「不符合資格」：資料缺失或看不清楚只會觸發
NEED_SUPPLEMENT（補件）或 REVIEW（人工判斷），只有明確、可信的比對結果
違反規則才會 REJECT，偵測到疑似異常模式（例如重複憑證）才會 FRAUD_RISK。

## 快速開始

```bash
npm install
cp .env.example .env   # 填入 ADMIN_TOKEN、LINE 相關設定、GEMINI_API_KEY、PUBLIC_BASE_URL
npm start
```

- 民眾申請頁：`http://localhost:3000/apply.html?uid=demo-user-001`
- 承辦人員後台：`http://localhost:3000/admin.html`（用 `.env` 裡的 `ADMIN_TOKEN` 登入）

**不想現場即時上傳圖片跑 OCR？** 執行 `node seed-demo.js` 會直接呼叫真正的規則
引擎（不需要網路或 API 金鑰）灌入三筆示範案件（受理編號開頭 `DEMO-`），涵蓋
正常案件／異常案件（禁止工具+重複憑證+存摺對不上）／需要補件案件三種情境，
適合展示或демо用，可重複執行（會清掉舊的 DEMO- 資料重建）。

## A. 後台 Dashboard

登入後台首頁會看到一排統計卡片（來自 `GET /api/admin/dashboard`），一眼看懂
AI 幫市府處理了什麼：AI 自動讀取幾份文件、OCR 擷取多少欄位、自動通過多少規則、
發現多少異常/待確認項目、自動產生多少補件通知、有幾件需要人工處理、已送出
案件數，以及一個「預估節省審核時間」——這個數字是用寫死、透明公開的假設
（人工全程審核一件約20分鐘、有AI輔助後約5分鐘）粗估，不是實測數字，畫面上
也會註明這一點。

## B. 案件詳細頁（三欄式人工複核工作台）

點開任一案件會展開三欄：

- **左欄**：申請人填寫資料、AI 建議結果（五種狀態燈號）、補助金額試算（含
  UNKNOWN 情況的明確顯示）、資料可信度（OCR/知識庫/規則引擎三種信心來源）、
  承辦人複核操作（姓名＋理由輸入框 + 通過/補件/退件/需要進一步查核四個按鈕）
- **中欄**：原始文件縮圖、補件中心（列出缺什麼/為什麼/對應規則/補件期限）、
  審核時間軸（送件→OCR完成→AI初審→發現異常→通知補件→補件→AI重新審核→
  承辦人複核，每筆事件都有時間戳記）
- **右欄**：RULE-001~020 規則檢查清單（每條都可以往下展開看到判斷條件、
  資料來源、用到哪個OCR欄位、信心分數、最終處理方式）、資料交叉比對矩陣
  （Applicant vs 身分證 vs 收據 vs 繳款憑證 vs 存摺，結果分 MATCH/
  PARTIAL_MATCH/MISMATCH/UNKNOWN 四種）、OCR擷取結果對照表、知識庫比對結果

## C. 規則引擎資料結構（`rules.js`）

每條規則的中繼資料集中定義在 `RULE_META`：

```js
'RULE-006': {
  name: '中國/港澳地區',
  condition: '工具開發/營運地區不得為中國大陸/港澳',
  data_source: 'knowledge_base',   // applicant_input / ocr:xxx / knowledge_base / rule_engine
  ocr_field: 'product_name,company_name',
}
```

`evaluateApplication(application, docs, context)` 跑完之後，每條規則會被組成：

```js
{
  id: 'RULE-006', name: '中國/港澳地區',
  condition: '工具開發/營運地區不得為中國大陸/港澳',
  data_source: 'knowledge_base', ocr_field: 'product_name,company_name',
  confidence: 0.9,                 // 從對應的 OCR 信心分數表查出來的，查不到是 null
  status: 'fail',                  // pass / fail / unknown
  result: 'REJECT',                // null / NEED_SUPPLEMENT / REVIEW / REJECT / FRAUD_RISK
  reason: 'CapCut（字節跳動 ByteDance）：中國大陸開發/營運，屬禁止清單',
  disposition: 'REJECT',           // 最終處理方式，等於 result（null 時顯示 PASS）
}
```

`evaluateApplication()` 的完整回傳（也是 `applications.ai_evaluation` 欄位存的內容），
四種資料來源明確分開，不混在一起：

```js
{
  result: 'REJECT',                       // 彙整後的五種建議之一
  applicant_data: { name, birth_date, purchase_date, declared_amount, ... },  // 申請人填寫
  ocr_data: { id_card: {...}, receipt: {...}, passbook: {...} },             // OCR擷取（已合併多張圖）
  knowledge_base_data: { tool: {...}, is_aggregator, is_official_source },   // 知識庫
  cross_validation: [ { check, label, a_source, a_value, b_source, b_value, result } ],
  confidence_sources: { ocr: {...}, knowledge_base: 1.0, rule_engine: 1.0, note },
  rules: [ /* 上面那種結構，RULE-001~020 */ ],
  subsidy: { applicant_category, eligible_amount, subsidy_rate, subsidy_amount, subsidy_cap, source, unknown },
  supplement_center: { items: [{rule_id, missing_item, reason}], deadline },
}
```

五種結果的彙整規則：所有規則裡最嚴重的那個等級（優先順序
`FRAUD_RISK > REJECT > NEED_SUPPLEMENT > REVIEW > PASS`）。

## D. AI 工具資格知識庫（`tool-catalog.js`）

`TOOL_KNOWLEDGE_BASE` 是一份陣列，每筆工具資料包含：

```js
{
  product_name: 'ChatGPT', company: 'OpenAI', category: 'general',
  country_or_region: 'US', official_domain: 'chatgpt.com',
  eligible: true, prohibited_reason: null,
  subscription_type: 'subscription', last_verified_at: '2026-08-01',
  aliases: ['chatgpt', 'openai'],   // OCR文字比對用
}
```

禁止清單的工具（CapCut/Kling/Meitu/Wink/WHEE/SenseAvatar/Manus）用同一份
資料結構，只是 `eligible: false` 並填 `prohibited_reason`。**知識庫查不到的
工具，`classifyTool()` 回傳 `matched: null`，呼叫端一律導向 REVIEW，絕對不會
因為清單沒收錄就自動判定合格或不合格**——這份清單需要承辦人員/工程持續
維護更新，`last_verified_at` 記錄最後人工確認日期。

另外還有：
- `AGGREGATOR_PLATFORMS`：集合式AI平台/代購網站清單（Poe.com、GoingBus），
  用來判斷「有沒有直接跟官方網站購買」
- `detectApiOrCreditPlan()`：偵測 API/Credit/Token/點數等禁止項目，區分
  「強訊號」（出現在方案類型這種結構化欄位，較可信，判 REJECT）跟
  「弱訊號」（只在自由文字欄位出現，可能誤判，判 REVIEW）

## E. OCR → Rule → Decision 完整資料流

```
1. 民眾在 apply.html 上傳文件（身分證/發票可一次多張，存摺/切結書單張）
      ↓
2. server.js handleDocumentUpload()：存檔 → documents 表新增一筆（ocr_status='pending'）
      ↓
3. ocr.js extractReceiptInfo/extractIdBackInfo/extractPassbookInfo()
   呼叫 Gemini 圖片理解，回傳 { fields: {...}, confidence: {...} }
      ↓
4. 寫回 documents.ocr_data（fields + _confidence 一起存成一個 JSON），ocr_status='done'/'failed'
      ↓
5. 民眾按下「送出申請」→ server.js /submit：
   - 等待同一種文件底下所有圖片的 OCR 都跑完
   - mergeOcrData()／mergeConfidence()：把同一種文件的多張圖片合併成一份彙總資料
   - 查詢是否有其他申請案使用相同憑證特徵（RULE-019 用）
      ↓
6. rules.js evaluateApplication(application, docs, context)：
   - 用 eligibility.js 算年齡/日期區間/申請期限/補助金額
   - 用 tool-catalog.js 查知識庫，判斷工具地區/分類/購買來源
   - 跑完 RULE-001~020，每條都標註 data_source/ocr_field/confidence
   - 組出 cross_validation 矩陣、confidence_sources、supplement_center
   - 彙整成五種建議結果之一
      ↓
7. 存回 applications 表：ai_result（快速篩選用）+ ai_evaluation（完整JSON，供後台完整回溯）
   同時寫入 application_events（審核時間軸）
      ↓
8. NEED_SUPPLEMENT → 自動轉狀態 + LINE通知補件；其餘 → 進「審核中」佇列，等承辦人員複核
      ↓
9. 承辦人員在 admin.html 複核，按下 通過/補件/退件/需要進一步查核
   → PATCH /api/admin/applications/:id（記錄 reviewed_by + reason 到時間軸）
   → 觸發 LINE 通知申請人最新狀態
```

## API 一覽

| Method | Path | 用途 | 需要驗證 |
|---|---|---|---|
| POST | `/api/applications` | 建立申請案（受理編號＝身分證字號+序號），回傳 `id` 與 `access_token` | 無 |
| POST | `/api/applications/:id/documents/:docType` | 上傳文件（身分證/發票可傳多檔） | `x-access-token` |
| POST | `/api/applications/:id/supplements?docType=` | 補件上傳，行為同上，語意給「被要求補件」流程用 | `x-access-token` |
| POST | `/api/applications/:id/submit` | 送出申請：跑規則引擎、判定五種結果、LINE通知 | `x-access-token` |
| POST | `/api/applications/:id/cancel` | 申請人自行取消（已核准/已撥款不可取消） | `x-access-token` |
| GET | `/api/applications/:id` | 查詢單一申請案（含文件清單） | `x-access-token` |
| GET | `/api/applications/:id/status` | 精簡狀態，給輪詢用 | `x-access-token` |
| GET | `/api/applications/:id/missing-documents` | 目前還缺什麼文件/規則問題 | `x-access-token` |
| GET | `/api/applications/:id/payment-status` | 撥款相關資訊（帳號只回末四碼） | `x-access-token` |
| GET | `/api/applications/:id/documents/:docType/file/:fileId` | 讀取單一文件檔案 | `x-access-token` 或 `x-admin-token` |
| GET | `/api/status?uid=` | LINE Bot 用：依 LINE 使用者查所有申請案狀態 | 無（伺服器對伺服器） |
| GET | `/api/admin/dashboard` | 後台總覽統計（見上方 A 節） | `x-admin-token` |
| GET | `/api/admin/applications` | 後台：案件列表 | `x-admin-token` |
| GET | `/api/admin/applications/:id` | 後台：單一案件完整資料（含 ai_evaluation、時間軸） | `x-admin-token` |
| PATCH | `/api/admin/applications/:id` | 後台：承辦人複核決定（記錄 reviewed_by/reason），觸發 LINE 通知 | `x-admin-token` |
| POST | `/api/admin/applications/:id/notify` | 承辦人手動推播自訂 LINE 訊息 | `x-admin-token` |

## 設定 Gemini（OCR + LINE AI 自動回覆）

1. 到 [Google AI Studio](https://aistudio.google.com/apikey) 申請免費的 Gemini API Key
2. 填進 `.env` 的 `GEMINI_API_KEY`（OCR 和 LINE 自動回覆共用同一把）
3. `npm install`，`npm start` 重開

沒有設定 `GEMINI_API_KEY`：OCR 會回傳 `skipped` 狀態，對應的規則會標記
NEED_SUPPLEMENT/REVIEW（不會讓系統壞掉，只是少了自動化判斷）。

## 授權設計

- 每個申請案有獨立的 `access_token`，操作/查看都要帶這把金鑰，光知道受理編號不夠用（避免 IDOR）
- 受理編號＝身分證字號+序號，同一身分證字號同時間只能有一筆「在跑」的申請案
- `/uploads` 資料夾不公開，檔案要透過需驗證的路由讀取
- Token 比對用固定時間比對（`crypto.timingSafeEqual`），避免時序攻擊

## 正式上線前要補強的地方（Demo 先跳過）

- **OCR 準確度**：Gemini 的圖片理解不是專門訓練的 OCR 模型，遇到模糊、傾斜的照片準確度會下降
- **AI工具知識庫**：目前是人工維護的靜態清單，正式上線需要建立更新流程與更完整的資料來源
- **重複憑證比對**：目前只比對「申請人自填欄位」，正式環境建議對 OCR 結果建立可查詢的索引
- **身分驗證**：後台目前只用一組固定 Token，正式環境要換成正式登入 + 權限控管（含承辦人帳號制，取代目前手動輸入姓名）
- **檔案儲存/個資保護**：目前存在本機磁碟，身分證字號等敏感個資應加密，正式環境建議雲端物件儲存
- **HTTPS 與速率限制**：正式站台需要 HTTPS，並對上傳/OCR 相關 API 加上速率限制
