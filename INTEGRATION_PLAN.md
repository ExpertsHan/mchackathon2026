# 系統整合規格書

**整合對象**：`ai-backend`（OCR 規則引擎，Node.js）＋ `ai-subsidy-copilot`（FastAPI + Next.js）

**已確認的決策**
1. 政策參數以 ai-backend 為權威（年齡、受理期間、補助費率與上限、AI工具知識庫）
2. 規則引擎以 ai-backend 的 RULE-001~020 為核定依據
3. AI 不自動核准，一律進人工佇列（保留 ai-backend 的保守設計）

---

## 0. 整合原則（一句話）

> **ai-backend 的規則引擎決定「資格與金額」，Copilot 決定「流程與撥款」，AI 永遠不自動核准。**

Copilot 從「決策系統」降級為「流程與撥款的執行框架」。但它的三個安全邊界必須完整保留，不可因為整合而拆除：

| 必須保留的邊界 | 原因 |
|---|---|
| 撥款金額只能由後端從 `applications.approved_amount_twd` 讀取 | 瀏覽器不能指定金額，這是防竄改的關鍵 |
| `state_machine.py` 的狀態轉換驗證 | 防止跳過審核直接進撥款 |
| `audit_logs` 完整稽核（含 actor_type） | 政府實務必要，且比我們的 application_events 完整 |

---

## 1. 最重要的前提：Copilot 已預留接口，但接縫未接上

Copilot 內已存在一整層為 ai-backend 而寫的模組：

```
backend/app/services/ocr_bridge.py       subprocess 呼叫 Node
backend/app/services/source_review.py    OCR 文件審核流程
backend/app/models/source_review.py      source_reviews / source_documents
backend/app/api/source_review.py         5 支 API
frontend/components/source-intake.tsx    前端上傳畫面
frontend/components/source-review.tsx    前端結果畫面
```

**介面契約已完全吻合**，經逐欄位比對確認：

| Copilot 期待 | ai-backend 實際提供 | 狀態 |
|---|---|---|
| `evaluate` 回傳 `result`（5種值） | `evaluateApplication().result` | ✅ 一致 |
| `rules[].id` / `.disposition` | `rules[].id` / `.disposition` | ✅ 一致 |
| `supplement_center.items[]` | `supplement_center.items[]` | ✅ 一致 |
| OCR 欄位 `buyer_name`/`product_name`/`company_name`/`purchase_date`/`converted_twd_amount`/`is_hsinchu_city`/`account_holder_name`/`_confidence` | `ocr.js` 全部提供 | ✅ 一致 |
| `document_type` 六種值 | apply.html / server.js 六種一致 | ✅ 一致 |
| 規則編號 RULE-006/007/008/019 | rules.js 相同編號 | ✅ 一致 |

**唯一缺口**：Copilot 呼叫 `{ocr_module_dir}/copilot-bridge.js`，**此檔案在 ai-backend 中不存在**，必須新建。

---

## 2. 目標架構

```
        LINE Bot (Node.js, 移植自 ai-backend)
                    │ REST + 內部 API Key
                    ▼
  Next.js 前端 ──► FastAPI 後端（唯一權威、唯一碰資料庫的人）
  (Copilot)            │
                       ├── RAG 政策問答        （Copilot 保留）
                       ├── AI 安全教育模組      （Copilot 保留）
                       ├── 狀態機 + 稽核        （Copilot 保留）
                       ├── Mock 撥款            （Copilot 保留）
                       └── ocr_bridge ──► Node 子行程（無狀態函式庫）
                                            ├── copilot-bridge.js  ★新建
                                            ├── ocr.js          （ai-backend）
                                            ├── rules.js        （ai-backend）
                                            ├── tool-catalog.js （ai-backend）
                                            └── eligibility.js  （ai-backend）
                       │
                PostgreSQL + pgvector
```

**關鍵**：ai-backend 的 `server.js` / `db.js` / SQLite **不再使用**。Node 側降級成無狀態函式庫，不自己跑 Express、不自己碰資料庫。這避免了「兩套資料庫各存一份、互相不同步」這個最大的整合風險。

---

## 3. 資產歸屬表

### 保留 ai-backend 的（核心資產）
| 檔案 | 用途 | 改動 |
|---|---|---|
| `ocr.js` | Gemini 六類文件 OCR + 信心分數 | 無需改動 |
| `rules.js` | RULE-001~020、五種結果、交叉比對、補件中心 | 無需改動 |
| `tool-catalog.js` | 24筆知識庫（含中港澳禁止清單） | 無需改動 |
| `eligibility.js` | 台灣在地日期規則、補助費率上限 | 無需改動 |
| `line.js` | LINE Bot / 推播 / Rich Menu | 改為呼叫 FastAPI，不直接讀 DB |

### 保留 Copilot 的
| 模組 | 用途 |
|---|---|
| `rag/` + `knowledge/` | 政策問答與引用來源（ai-backend 沒有） |
| `services/safety.py` | AI 安全教育四模組（ai-backend 沒有） |
| `services/payments.py` | Mock 撥款、冪等、金額權威（ai-backend 沒有） |
| `services/state_machine.py` | 狀態轉換驗證 |
| `services/audit.py` + `audit_logs` | 稽核（取代 ai-backend 的 application_events） |
| `core/auth.py` | 簽章 token、擁有者檢查 |
| Next.js 全部頁面 | 取代 apply.html / admin.html |
| `tests/` 61 個 pytest | 需部分改寫（見 §6） |

### 廢棄不用
| 檔案 | 原因 |
|---|---|
| `server.js` | 改由 FastAPI 承擔 |
| `db.js` + SQLite | 改用 PostgreSQL |
| `public/apply.html` | 改用 Next.js `/apply` |
| `public/admin.html` | 功能遷移至 Next.js `/admin`（見 §5） |
| `seed-demo.js` | 改用 Copilot 的 `scripts/seed.py` |

---

## 4. 必須修改的項目（依風險排序）

### 4.1 【阻斷級】新建 `copilot-bridge.js`
Copilot 呼叫方式（已寫死在 `ocr_bridge.py`）：stdin 傳入 JSON、stdout 回傳 JSON。

需支援兩種 operation：
```
{ "operation": "extract", "document_type": "receipt|id_card|passbook", "file_path": "..." }
  → { "status": "done|failed|skipped", "data": { ...欄位, "_confidence": {...} } }

{ "operation": "evaluate", "application": {...}, "documents": {...}, "context": {...} }
  → evaluateApplication() 的完整輸出
```
注意：`ocr_bridge.py` 會把 `GEMINI_API_KEY` / `GEMINI_OCR_MODEL` 透過環境變數傳入，bridge 要能讀取。

### 4.2 【阻斷級】Docker 環境缺 Node.js
`backend/Dockerfile` 是 `python:3.12-slim`，**沒有安裝 Node.js**；`docker-compose.yml` 也**沒有掛載 OCR 目錄**。目前容器內橋接必定失敗。需要：
- Dockerfile 加裝 Node.js 20+
- docker-compose 掛載 ai-backend 目錄（唯讀）
- 設定 `OCR_MODULE_DIR` 環境變數（預設值 `../../OCR` 需修正為實際路徑）

### 4.3 【高】政策參數改為 ai-backend 權威
| 參數 | Copilot 現值 | 改為 |
|---|---|---|
| 年齡 | ≥18歲 | 16~40歲（民國74/4/3~99/4/2） |
| 受理期間 | 2026全年 | 115/4/2～115/10/31 |
| 補助上限 | 一律 NT$600 | 一般50%上限3000／特定・語言90%上限6000 |
| 工具清單 | 3筆 | ai-backend 24筆（含禁止清單） |

`config.py` 的 `maximum_subsidy_twd` 是單一數值，無法表達「依身分別不同費率」，**需改為由 bridge 回傳的 `subsidy` 物件決定**，不能只改常數。

### 4.4 【高】重寫 `apply_review_gate()` 讓我們的規則成為權威
現況（`source_review.py`）：
```python
POLICY_NOTICE = "OCR 的年齡、受理期間與補助試算供複核參考；核定資格及撥款金額依 Copilot 示範政策。"
```
`apply_review_gate()` 目前只要啟用文件審核就強制 `MANUAL_REVIEW` 且金額歸零——**從不讓我們的結果決定核准**。

需改為結果映射：
| ai-backend result | Copilot EligibilityOutcome | 應用狀態 |
|---|---|---|
| `PASS` | `ELIGIBLE` | → MANUAL_REVIEW（因為不自動核准） |
| `NEED_SUPPLEMENT` | `MANUAL_REVIEW` | → REQUESTED_INFORMATION（要求補件） |
| `REVIEW` | `MANUAL_REVIEW` | → MANUAL_REVIEW |
| `REJECT` | `INELIGIBLE` | → MANUAL_REVIEW（標記建議退件，仍需人工確認） |
| `FRAUD_RISK` | `MANUAL_REVIEW` + risk HIGH | → MANUAL_REVIEW（最高優先） |

`POLICY_NOTICE` 文字需改寫成反映新的權威關係。

### 4.5 【高】移除自動核准路徑
`applications.py` 的 `submit_application()` 第 213~215 行目前會在 `result.eligible` 時直接 `APPROVED` 並寫入金額。依決策 3，此分支需移除——**所有案件送出後一律進 MANUAL_REVIEW**，等承辦人員按按鈕才能 APPROVED。

金額處理：`approved_amount_twd` 在送出時只做「試算」寫入（來自我們的 `subsidy.subsidy_amount`），但狀態不進 APPROVED；承辦人員核准時才生效。`process_payment` 讀取此欄位的安全設計不變。

### 4.6 【中】兩套文件儲存與重複偵測合併
**已定案：整併**，以 `source_documents` 為單一真實來源。詳細做法見 §9.2。

### 4.7 【中】LINE 模組改接 FastAPI
`line.js` 目前直接 `require('./db')` 讀 SQLite。需改為：
- 透過 HTTP 呼叫 FastAPI（需新增內部 API 或 service token 機制）
- Copilot 完全沒有 LINE 相關欄位，`users` 表需新增 `line_user_id`
- 撥款/補件通知的觸發點要從 FastAPI 發出

### 4.8 【中】申請案編號擇一
- ai-backend：`A123456789-01`（身分證字號+序號，可追溯同一人歷次申請）
- Copilot：`AI-2026-000001`（不含個資，較適合公開顯示）

建議：**採用 Copilot 格式當 public_id**（避免個資外露於網址與後台列表），另存 `id_number` 欄位供查重。ai-backend 的「同一人同時只能有一筆在跑」規則改用 `id_number` 查詢實作。

---

## 5. 後台功能遷移對照（admin.html → Next.js）

ai-backend 的後台有幾項 Copilot 沒有的，需移植到 `frontend/app/admin/`：

| 功能 | Copilot 現況 | 動作 |
|---|---|---|
| RULE-001~020 檢查清單（含資料血緣） | 無 | 移植（`source-review.tsx` 已有雛形，需擴充） |
| 資料交叉比對矩陣 MATCH/PARTIAL/MISMATCH/UNKNOWN | 無 | 移植 |
| 補件中心（缺什麼/為什麼/期限） | 無 | 移植 |
| AI 信心分數三來源 | 無 | 移植 |
| Dashboard 八張統計卡 | 有 `admin-stat-card.tsx` 但指標不同 | 合併指標 |
| 三欄式工作台 | 部分 | 調整版面 |
| 承辦人姓名+理由記錄 | 有（`ReviewerActionRequest.reason`） | ✅ 已具備，但承辦人身分是寫死的 `demo-reviewer` |
| 審核時間軸 | 有 `audit-timeline.tsx` | ✅ 已具備，較完整 |

---

## 6. 會失效的測試與 Demo

**pytest（約 15~20 個需改寫）**
- `test_eligibility.py`：年齡、金額上限、產品清單全部改變
- `test_api_flows.py`：happy path 不再自動核准，斷言需改
- `test_state_payment.py`：狀態流程改變
- `test_receipts.py`：`subscriptions` 收據流程停用後，這支測試連同 `set_subscription`/`attach_receipt` 一起需要改寫或移除

**Demo 帳號劇本**
- Taylor Wang（17歲）原本測 `AGE_REQUIREMENT` 失敗 → 新規則 16~40 歲，17歲**變成合格**，需改年齡或改劇本
- Alex Chen happy path「自動核准 NT$600」→ 改為「進人工佇列、試算金額依新費率」
- Jamie Lin 重複收據 → 不受影響，仍為 FRAUD_RISK

---

## 7. 建議執行階段

| 階段 | 內容 | 可驗證成果 |
|---|---|---|
| **P1 接通** | 新建 `copilot-bridge.js`；Dockerfile 裝 Node；compose 掛載目錄 | 上傳文件能跑出 RULE-001~020 結果 |
| **P2 政策** | 政策參數改為 ai-backend 權威；知識庫換成 24 筆；`config.py` 改為支援分身分別費率 | 補助金額算出 50%/90% 正確值 |
| **P3 權威** | 重寫 `apply_review_gate()`；移除自動核准分支（保留安全模組閘門）；修正 `POLICY_NOTICE` | 送出後一律 MANUAL_REVIEW，AI 建議正確映射 |
| **P4 整併** | 停用 `subscriptions` 收據流程，`source_documents` 成為唯一來源；砍/改前端舊收據元件；後台加承辦人姓名欄位 | 只有一條收據上傳路徑；audit_logs 記錄真實承辦人姓名 |
| **P5 前端** | 後台四項功能移植到 Next.js；Dashboard 指標合併 | 承辦人員能看到完整規則血緣 |
| **P6 LINE** | `users` 加 `line_user_id`；`line.js` 改接 FastAPI；通知觸發點 | LINE 補件通知可運作 |
| **P7 收尾** | 改寫失效測試；更新 Demo 劇本；文件同步 | `make test` 全綠 |

P1~P4 是核心，完成後系統即具備完整、一致的整合功能；P5~P7 是體驗與品質補強。

---

## 8. 決策定案

1. **AI 安全教育模組：保留為送出前置條件**（§9.1）
2. **兩套文件儲存：整併**（§9.2）
3. **承辦人身分：輕量具名登記，不做完整帳號制**（§9.3）
4. **申請案編號格式：用 Copilot 的 `AI-2026-000001`**（§9.4）

---

## 9. 四項定案的落地方式

### 9.1 AI 安全教育模組——保留
`applications.py` 的 `submit_application()` 現有的 `SafetyTrainingIncomplete` 檢查**不動**。整合後這道閘門與 ai-backend 的規則引擎並列、互不取代：

- 安全模組沒完成 → 擋在 Copilot 這層，連 `evaluate_application` 都不會跑（現況邏輯，維持）
- 安全模組完成後 → 才進我們的 RULE-001~020 判定資格與金額

兩者是「先後」關係，不是「二選一」，不需要額外改動判斷邏輯，只需確保 §4.5（移除自動核准分支）時不要誤刪這段檢查。

### 9.2 兩套文件儲存——整併
以 `source_documents`（OCR 層，ai-backend 對接的那份）為**唯一真實來源**，`subscriptions.receipt_*` 系列欄位停止寫入，理由：
- `source_documents` 支援一種文件多張圖片（身分證正反面、發票多張），`subscriptions` 只能存一張，資訊量較少
- 重複偵測目前兩邊都在查（`_duplicate_reference()` 已經同時查 `Subscription.receipt_hash` 和 `SourceDocument.sha256`），整併後只留 `SourceDocument` 那段查詢，`Subscription` 相關查詢連同 `receipt_hash`/`receipt_reference` 等欄位可以停用（保留欄位但不再寫入，避免破壞既有 migration）
- `set_subscription()` / `attach_receipt()`（Copilot 原生的收據流程）**整段停用**，前端一律走 `source-intake.tsx` 的完整文件上傳流程，不再有「先選方案→上傳單張收據」這條舊路徑
- 影響：`frontend/components/receipt-uploader.tsx`、`payment-panel.tsx` 等依賴舊流程的元件需要跟著砍或改接新流程；`test_receipts.py` 需要改寫或移除

### 9.3 承辦人身分——輕量具名登記
- 後台加一個「承辦人姓名」文字輸入框（瀏覽器本機記住，不用每次重打），比照 ai-backend 現有做法
- `ReviewerActionRequest` 這個 schema 加一個 `reviewer_name` 欄位，取代目前寫死的 `"demo-reviewer"` 字串
- `audit_logs.actor_identifier` 從此記錄真實姓名，稽核時間軸才有意義
- 不做登入驗證、不做角色權限——任何人都能在後台輸入任意姓名操作，這一點跟現在的 `x-admin-token` 單一密鑰模型風險相當，不算新增風險，只是把「誰做的」這件事從無到有補上
- 真正的帳號制／SSO／角色權限留給正式上線前處理，不卡這次整合

### 9.4 申請案編號格式——用 Copilot 的 `AI-2026-000001`
`applications.py` 的 `generate_public_id()` 不用改，直接沿用。但這個決定牽動一個必須一起處理的細節：

**「同一人同時只能有一筆在跑」這條規則的查詢依據要換掉。** ai-backend 原本靠受理編號本身（`身分證字號-序號`）就能查重；換成不含身分證字號的 `AI-2026-000001` 之後，查重邏輯必須改成直接查身分證字號欄位。但 Copilot 的 `users.government_id_masked` 只存遮罩後的顯示字串（例如 `A12****789`），**不是完整、可查詢的身分證字號**，沒有這個欄位就做不了查重。

建議做法：
- `users` 表新增 `government_id_hash`（身分證字號正規化後取 SHA-256），只用來查重，不可逆
- `government_id_masked` 保留給畫面顯示用途不變
- 完整身分證字號**只在建立/OCR比對當下經手，不落地存明碼**——這其實比 ai-backend 原本「明碼存在 applications.id_number」更符合個資保護原則，也是這次改用 Copilot 編號格式的附帶好處
- 查重邏輯：`SELECT ... WHERE government_id_hash = ? AND status IN (進行中狀態)`，取代原本解析受理編號字串的做法
