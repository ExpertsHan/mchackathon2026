# Demo 操作指南

三個系統：**資安防護擴充功能**（第一入口/風險偵測）→ **AI 補助申請小幫手**（ai-subsidy-copilot，民眾申請）→ **新竹市 AI 補助智慧審核後台**（OCR，承辦人複核）。

---

## 0. Demo 前一天／當天開場前：啟動所有服務

打開「終端機」App，貼上：

```bash
cd ~/Documents/mchackathon2026
./demo-start.sh
```

- 這行指令會自動：開啟 Docker Desktop → 啟動 Postgres → 啟動補助網站的 backend/frontend → 啟動 OCR/LINE Bot 後端。
- 第一次啟動可能要等 Docker Desktop 開起來，約 30 秒～1 分鐘，腳本會自己等到就緒才繼續。
- 跑完會印出所有網址，出現下面這個框框代表成功：

```
================================================
  AI 補助申請小幫手 — ai-subsidy-copilot
  民眾網站　http://localhost:3000
  API 文件　http://localhost:8000/docs

  新竹市 AI 補助智慧審核 — OCR/LINE Bot 後端
  民眾申請頁　http://localhost:3001/apply.html?uid=demo-user-001
  承辦人後台　http://localhost:3001/admin.html
================================================
```

**Demo 結束後**記得關掉，省電也釋放 port：

```bash
cd ~/Documents/mchackathon2026
./demo-start.sh stop
```

### 重置 demo 資料（每次正式彩排/上台前建議做一次，讓資料是乾淨的）

```bash
# 重置補助網站的申請紀錄
curl -s -X POST http://localhost:8000/api/demo/reset

# 重灌 OCR 後台的三筆示範案件（正常／異常／需補件）
cd ~/Documents/mchackathon2026/OCR
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
node seed-demo.js
```

---

## 1. 載入 Chrome 擴充功能（只需做一次，除非換電腦）

1. Chrome 網址列輸入 `chrome://extensions` 並 Enter。
2. 右上角打開「開發人員模式」。
3. 點「載入未封裝項目」。
4. 選擇資料夾：`~/Documents/mchackathon2026/黑克嵩擴充功能_合併終版`
5. 出現在擴充功能列表就代表裝好了。裝好的瞬間會自動跳出一個隱私權說明分頁，可以直接關掉。

> 這個資料夾裡的網址是寫死指向 `localhost:3000`（也就是補助網站），所以**一定要先跑過 `./demo-start.sh`** 服務都在跑，擴充功能的按鈕才點得動。

---

## 2. 正式展示流程（約 5–6 分鐘）

### 開場（30 秒）— 擴充功能風險偵測

- 開新分頁，前往 `chatgpt.com`（已核准的 AI 工具）。
  - 畫面右下角會跳出提示：「💰 偵測到您正在使用 ChatGPT Plus，這筆訂閱可能符合 AI 補助資格」+「立即申請」按鈕。
- （可選加碼）再開一個分頁前往 `deepseek.com`（黑名單工具）。
  - 會跳出紅色警示彈窗：「🚨 禁用 AI 工具警示（不予補助）」，並提供「離開此網站」／「我已知曉，繼續使用」／「加 LINE 了解更多」／「前往 AI 安全學習模組」四個選項。

**台詞參考**：「這是我們的第一道防線。民眾平常上網用 AI 工具的時候，擴充功能會即時判斷這個工具能不能申請市府補助，也會擋掉高風險或禁用的工具。」

### 第二段（1.5 分鐘）— 點「立即申請」→ 補助申請網站

- 點擴充功能彈出的「立即申請」按鈕，會開新分頁到：
  `http://localhost:3000/apply?product=ChatGPT+Plus`
- 已驗證會**自動帶入產品名稱「ChatGPT Plus」**，不用使用者再手動選一次。
- 若尚未登入，先點「Demo login」→「Continue as Alex」（或 Jamie / Taylor）。
- 上傳收據示範：`~/Documents/mchackathon2026/ai-subsidy-copilot/demo/receipts/chatgpt_plus_valid.pdf`
  - 系統會自動解析金額、產品名，並顯示「These details look right」讓你確認。
  - 確認後會出現「啟用完整文件審核」區塊——這裡可以講一句：「使用者也可以在這裡加傳身分證、存摺，背後會呼叫我們另一套 OCR 系統的規則引擎做交叉比對。」

**台詞參考**：「申請流程結合了 AI 客服對話跟結構化表單，AI 只負責解釋政策、抓收據欄位，資格判定是純規則引擎跑的，不是 AI 說了算。」

### 第三段（1 分鐘）— AI Safety 測驗

- 確認收據後會被導到 `/safety`，隨手答一題（例如選「A public article you want summarized」）。

**台詞參考**：「送出申請前必須完成四個 AI 安全小教材，確保使用者理解 AI 幻覺、個資外洩等風險，這也是我們整合資安教育的地方。」

### 第四段（1.5 分鐘）— 切到承辦人後台（OCR 系統）

- 開 `http://localhost:3001/admin.html`
- 輸入 Token：`demo-admin-token` → 登入
- 上方統計卡片會顯示「AI 幫市府處理了什麼」（自動讀取文件數、自動通過規則數、預估節省審核時間…）
- 點右上角「🚨 FRAUD_RISK」篩選按鈕，點進 `DEMO-FRAUD-01` 案件，展示三欄式複核工作台：
  - **左欄**：申請人資料、AI 建議燈號、補助試算、承辦人複核操作（姓名＋理由＋通過/補件/退件按鈕）
  - **中欄**：原始文件縮圖、補件中心、審核時間軸
  - **右欄**：RULE-001~020 規則檢查清單（可展開看判斷條件）、資料交叉比對矩陣

**台詞參考**：「AI 只給建議，紅燈黃燈都不會自動核准或退件——除了『需補件』這種低風險、可回復的動作會自動通知使用者之外，最終審核、核定、撥款一律由承辦人員決定，而且每次決定的人、時間、理由都會被記錄下來。」

### 收尾（30 秒）— LINE Bot 入口

- 如果已經設定 LINE（見下方「附錄：接通 LINE Bot」）：手機掃 LINE 官方帳號 QR code，輸入「申請」或「查詢進度」實際示範。
- 如果還沒設定，用講的即可：「民眾也可以直接從 LINE 官方帳號進來，輸入『申請』或『查詢進度』就會導到剛才那個網站或查詢畫面。LINE 只負責判斷使用者想做什麼，複雜表單交給網站處理，這是刻意的職責分離設計。」

---

## 3. 備用情境（如果評審想看更多案例）

| 情境 | 帳號 | 收據檔案 |
|---|---|---|
| 正常核准（走完整流程可看到撥款 `GOVPAY-DEMO-...`） | Alex Chen | `demo/receipts/chatgpt_plus_valid.pdf` |
| 重複憑證（觸發人工複核） | Jamie Lin | `demo/receipts/duplicate_receipt.pdf` |
| 未成年（觸發年齡資格 guardrail） | Taylor Wang | `demo/receipts/claude_pro_valid.pdf` |
| 疑似 Prompt Injection（收據內嵌惡意文字，示範 AI 資安防護） | Alex Chen | `demo/receipts/malicious_prompt_injection_receipt.pdf` |

全部在 `ai-subsidy-copilot/demo/receipts/` 資料夾下。

OCR 後台三筆示範案件（`node seed-demo.js` 灌的）：
- `DEMO-NORMAL-01`：AI 建議 PASS
- `DEMO-FRAUD-01`：AI 建議 FRAUD_RISK（禁用工具 + 重複憑證 + 存摺對不上）
- `DEMO-SUPP-01`：AI 建議 NEED_SUPPLEMENT（自動轉為需補件狀態）

---

## 4. 常見狀況排除

- **擴充功能的「立即申請」按鈕沒反應 / 打不開網頁**：先確認 `./demo-start.sh` 有跑起來，`http://localhost:3000` 能不能直接在瀏覽器打開。
- **補助網站聊天機器人回答「無法確認」**：代表知識庫沒 ingest 成功，重跑一次 `./demo-start.sh`（腳本已修好這個問題，正常不會發生）。
- **OCR 後台登入不了**：Token 打錯，看 `OCR/.env` 裡的 `ADMIN_TOKEN`（目前是 `demo-admin-token`）。
- **重開機後 port 被佔用**：先跑 `./demo-start.sh stop` 再重新 `./demo-start.sh`。

---

## 附錄：接通 LINE Bot（選用，需要你自己的 LINE 帳號）

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)，建立一個 Messaging API channel。
2. 取得 `Channel access token` 與 `Channel secret`，填入 `~/Documents/mchackathon2026/OCR/.env`：
   ```
   LINE_CHANNEL_ACCESS_TOKEN=你的token
   LINE_CHANNEL_SECRET=你的secret
   ```
3. 本機測試需要對外網址讓 LINE 平台打得進來，安裝並執行 ngrok：
   ```bash
   brew install ngrok
   ngrok http 3001
   ```
4. 把 ngrok 給的網址（`https://xxxx.ngrok-free.app`）填進 `OCR/.env` 的 `PUBLIC_BASE_URL`，並在 LINE Developers Console 的 Webhook URL 設成 `該網址/webhook`。
5. 重新執行 `./demo-start.sh`（或單獨重啟 OCR：見下）讓新的 `.env` 生效。

單獨重啟 OCR（不用整個腳本）：
```bash
pkill -f "node server.js"
cd ~/Documents/mchackathon2026/OCR
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
nohup node server.js > /tmp/ocr-server.log 2>&1 &
```

更多 LINE Bot 技術細節、Q&A 應答小抄在 `OCR/README.md` 和 `OCR/DEMO_QA_PREP.md`。
