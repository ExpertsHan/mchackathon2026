// 宣告全域放行 Flag
let bypassOnce = false;

// 【新增】記錄「目前這個網站是不是 AI 相關網站」，在 runAiSecurityCheck() 判斷一次後快取起來，
// 讓 performSecurityCheck() 可以直接使用，不用每次送出都重新掃一次全頁文字。
let siteIsAiRelated = false;

// ---------- 網域比對工具 ----------
// 【修正】原本用 currentHost.includes(domain) 做子字串比對，
// 例如 currentHost.includes('ai') 會誤判 mail.google.com（因為 "mail" 裡面就包含 "ai"）。
// 這裡改成「完全相符」或「是該網域的子網域」才算命中，避免子字串誤判。
function hostMatches(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

// 【新增】判斷 hostname 裡是否「以完整詞」的方式包含 ai / gpt 關鍵字，
// 而不是任意子字串。做法：把 hostname 依 "." 和 "-" 切開，逐段比對是否等於 ai / gpt，
// 這樣 mail.google.com 不會誤中，但 ai.example.com、chat-ai-tool.com 仍然抓得到。
function hostHasAiKeyword(host) {
  const labels = host.split(".");
  return labels.some((label) => {
    const words = label.split("-");
    return words.includes("ai") || words.includes("gpt");
  });
}

// ---------- 與「AI 補助小幫手」demo（ai-subsidy-copilot）串接 ----------
// 【新增】demo 網站的網址。本機開發預設是 http://localhost:3000；
// 之後如果部署到正式網域，只要改這一個常數，下面呼叫的地方都不用動。
const DEMO_APP_BASE_URL = "http://localhost:3000";

// 【新增】已核准 AI 工具的網域 → demo 補助申請系統裡對應的產品名稱。
// 這份對照表比照 demo 專案 backend/app/services/eligibility.py 的
// ELIGIBLE_PRODUCTS 清單維護；若 demo 那邊清單有異動，這裡也要跟著同步，
// 之後若想做成動態拉取（呼叫 demo 的 policy API），可以取代這份寫死的表。
const APPLY_PRODUCT_MAP = {
  "chatgpt.com": "ChatGPT Plus",
  "openai.com": "ChatGPT Plus",
  "claude.ai": "Claude Pro",
  "notion.so": "Notion AI",
  "notion.site": "Notion AI",
};

// 補上 SECURITY_PATTERNS 的正則表達式（Regex）清單
// 【修正】部分規則加上 validate() 二次驗證（Luhn 演算法、身分證檢查碼），
// 減少「隨便一串 10~16 位數字」就誤判成信用卡號/銀行帳號的情況；
// 原本過於寬鬆、幾乎逢數字必中的「銀行帳號 (10-16位數字)」規則已移除，
// 改成需要搭配「帳號」等關鍵字才觸發，降低誤判頻率。
const SECURITY_PATTERNS = [
  // 1. 密碼、OTP、API Key (金鑰與認證資安)
  { name: "API Key / Token 金鑰", regex: /(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|eyJhbGciOi|[a-zA-Z0-9_-]{32,}\.(?:AWS|AWS_SECRET|AZURE|GOOGLE))/i },
  { name: "帳號密碼/OTP驗證碼", regex: /(?:password|passwd|pwd|otp|one-time-password|驗證碼|一次性密碼)[\s:=]+[^\s]{4,}/i },
  { name: "私鑰憑證 (Private Key)", regex: /-----BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY-----/i },

  // 2. 證件、銀行、完整卡號
  {
    name: "台灣身分證字號",
    regex: /\b[A-Z][12]\d{8}\b/i,
    // 【新增】加上官方檢查碼演算法二次驗證，只有格式且檢查碼也對得上才視為真的身分證字號，
    // 避免任何「一個英文字母 + 1或2開頭 + 8位數字」的字串（例如亂數代碼）被誤判。
    validate: (match) => isValidTwId(match),
  },
  { name: "居留證號", regex: /\b[A-Z][89]\d{8}\b/i },
  {
    name: "信用卡號",
    regex: /\b(?:\d[ -]*?){13,16}\b/,
    // 【新增】加上 Luhn 演算法驗證，避免一般 13~16 位數字（如訂單編號、追蹤碼）被誤判成卡號。
    validate: (match) => luhnCheck(match),
  },
  // 【修正】原本「銀行帳號 (10-16位數字)」規則對任何 10~16 位數字都會觸發，
  // 幾乎是逢數字必中，實務上很容易誤判訂單編號、時間戳記等。
  // 改成要求前後文出現「帳號／帳戶」等關鍵字才觸發，降低誤判。
  { name: "銀行帳號", regex: /(?:銀行帳號|帳戶號碼|存款帳號|account\s*number)[\s:：]*\d{6,16}/i },
  { name: "手機號碼", regex: /\b09\d{8}\b/ },

  // 3. 病歷與生物辨識資料
  { name: "醫療/病歷相關資料", regex: /(?:病歷|診斷證明|主訴|處方箋|核酸檢測|基因序列|病歷號|病患姓名|ICD-10|ICD-9)/i },

  // 4. 未公開合約、原始碼
  { name: "未公開合約/保密協定", regex: /(?:保密協定|NDA|機密合約|商業機密|保密條款|Confidentiality Agreement|Proprietary)/i },
  { name: "程式碼/敏感設定檔", regex: /(?:import\s+[\w{}*]+\s+from|const\s+\w+\s*=|function\s+\w+\s*\(|class\s+\w+\s*\{|<\?php|def\s+\w+\s*\(|DB_PASSWORD|DATABASE_URL)/i },
];

// 【新增】Luhn 演算法（信用卡號檢查碼驗證）
function luhnCheck(rawText) {
  const digits = rawText.replace(/[^\d]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

// 【新增】台灣身分證字號檢查碼驗證（官方公開演算法）
function isValidTwId(rawText) {
  const id = rawText.trim().toUpperCase();
  if (!/^[A-Z][12]\d{8}$/.test(id)) return false;

  const letterMap = {
    A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18,
    K: 19, L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27,
    U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33,
  };

  const n = letterMap[id[0]];
  const a1 = Math.floor(n / 10);
  const a2 = n % 10;
  const d = id.slice(1).split("").map(Number); // d[0]..d[8]，d[8] 是檢查碼

  const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];
  const values = [a1, a2, ...d];

  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] * weights[i];
  }
  return sum % 10 === 0;
}

// 等待網頁元素載入完成後執行
window.addEventListener("DOMContentLoaded", runAiSecurityCheck);
if (document.readyState === "complete" || document.readyState === "interactive") {
  runAiSecurityCheck();
}

function runAiSecurityCheck() {
  const currentHost = window.location.hostname.toLowerCase();

  // 1. 【黑名單】禁止與不補助之 AI 工具（中國/港澳開發營運或高風險 AI）
  const forbiddenDomains = [
    "capcut.com", // CapCut (剪映海外版)
    "jianying.com", // 剪映
    "klingai.com", // 快手可靈 Kling
    "klingai.org",
    "meitu.com", // 美圖秀秀
    "xiuxiu.meitu.com",
    "wink.com", // Wink
    "whee.com", // WHEE (美圖旗下)
    "senseavatar.com", // 智譜/商湯相關 AI
    "manus.im", // Manus AI
    "manus.com",
    "deepseek.com", // DeepSeek
    "chatglm.cn", // 智譜清言
    "minimax.io", // 【修正】原本寫成 "minimax.i"，補上完整網域
  ];

  // 2. 【白名單】符合補助規範的核准 AI 工具
  const allowedAiDomains = [
    // (一) 通用型 AI
    "chatgpt.com", "openai.com", "gemini.google.com", "grok.com", "x.ai", "claude.ai", "perplexity.ai",
    // (二) 影像類 AI
    "canva.com", "firefly.adobe.com", "adobe.com", "midjourney.com", "figma.com",
    // (三) 辦公類 AI
    "copilot.microsoft.com", "microsoft.com", "copy.ai", "notion.so", "notion.site", "jasper.ai",
    // (四) 學習類 AI
    "grammarly.com", "speak.com", "elicit.com",
    // (五) 其他類 AI
    "cursor.com", "cursor.sh",
  ];

  // A. 先檢查是否命中【黑名單】（改用 hostMatches 完整網域比對，避免子字串誤判）
  const isForbidden = forbiddenDomains.some((domain) => hostMatches(currentHost, domain));

  if (isForbidden) {
    siteIsAiRelated = true;
    showSiteWarningModal(
      "🚨 禁用 AI 工具警示（不予補助）",
      "您目前存取的網站屬<b>中國大陸（含港澳）地區開發或營運之 AI 工具/軟體</b>。依規定此類服務不予補助且禁止使用，請勿在此輸入機密資料。"
    );
    return;
  }

  // B. 若不在黑名單，再檢查是否屬於「AI 相關網站」但「不在白名單內」
  const isAllowed = allowedAiDomains.some((domain) => hostMatches(currentHost, domain));
  const isUnapprovedAi = detectUnapprovedAiSite();

  // 【新增】快取這次判斷結果，讓輸入內容偵測（performSecurityCheck）知道目前是不是 AI 網站
  siteIsAiRelated = isAllowed || isUnapprovedAi;

  // 【新增】如果目前網站對應到 demo 補助系統裡「已核准」的產品，顯示「立即申請補助」提示。
  if (isAllowed) {
    maybeShowApplySuggestion(currentHost);
  }

  if (isUnapprovedAi && !isAllowed) {
    showSiteWarningModal(
      "⚠️ 未核准 AI 工具警示",
      "您目前存取的網站<b>不在官方核准補助的安全 AI 名單中</b>。請確認該工具是否符合資安規範，並避免輸入敏感公務與個人資料。"
    );
  }
}

// 動態偵測：網頁是否為「未核准的 AI 網站」（避免影響一般 Google、YouTube 瀏覽）
function detectUnapprovedAiSite() {
  const currentHost = window.location.hostname.toLowerCase();

  // 【修正】原本用 currentHost.includes('ai') / includes('gpt') 做子字串比對，
  // 會誤判 mail.google.com 這類「網域字串裡剛好出現 ai」的網站。
  // 改成以「網域片段」為單位比對，只有真的以 ai / gpt 作為獨立片段時才算命中。
  if (hostHasAiKeyword(currentHost)) {
    return true;
  }

  // 若網址沒有 AI 字眼，則檢查網頁內容是否充滿 Prompt 或 AI 生成特徵
  const pageText = document.body ? document.body.innerText.toLowerCase() : "";
  const aiKeywords = ["prompt", "text to image", "text to video", "ai generator", "ai writer"];

  const matchCount = aiKeywords.filter((kw) => pageText.includes(kw)).length;
  return matchCount >= 2;
}

// 【新增】在已核准的 AI 工具網站上，顯示一個小提示：這筆訂閱可能符合補助資格，
// 點擊後帶著對應的產品名稱直接開啟 demo 的申請頁面（/apply?product=...），
// 省去使用者自己再去選一次產品的步驟。只在真正命中白名單產品時顯示，
// 而不是任何「疑似 AI 網站」都顯示，避免誤導使用者去申請不存在的補助項目。
function maybeShowApplySuggestion(currentHost) {
  if (document.getElementById("ai-sec-apply-badge")) return;

  const matchedDomain = Object.keys(APPLY_PRODUCT_MAP).find((domain) => hostMatches(currentHost, domain));
  if (!matchedDomain) return;

  const product = APPLY_PRODUCT_MAP[matchedDomain];
  const applyUrl = `${DEMO_APP_BASE_URL}/apply?product=${encodeURIComponent(product)}`;

  const badge = document.createElement("div");
  badge.id = "ai-sec-apply-badge";
  badge.innerHTML = `
    <span class="ai-sec-apply-text">💰 偵測到您正在使用 <strong>${product}</strong>，這筆訂閱可能符合 AI 補助資格</span>
    <a class="ai-sec-apply-btn" id="ai-sec-apply-link" href="${applyUrl}" target="_blank" rel="noopener">立即申請</a>
    <button class="ai-sec-apply-close" id="ai-sec-apply-close" aria-label="關閉提示">✕</button>
  `;
  document.body.appendChild(badge);

  document.getElementById("ai-sec-apply-close").addEventListener("click", () => {
    badge.remove();
  });
}

// 警示彈窗渲染
function showSiteWarningModal(title, message) {
  if (document.getElementById("ai-sec-warning-modal")) return;

  const modal = document.createElement("div");
  modal.id = "ai-sec-warning-modal";
  modal.innerHTML = `
    <div class="ai-sec-modal-overlay" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.65); z-index: 999999; display: flex; align-items: center; justify-content: center;">
      <div style="background: white; padding: 28px; border-radius: 12px; max-width: 500px; width: 90%; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.25);">
        <h2 style="color: #dc2626; margin-top: 0; font-size: 20px;">${title}</h2>
        <p style="color: #374151; font-size: 15px; line-height: 1.6; text-align: left; background: #fef2f2; padding: 12px; border-radius: 8px; border-left: 4px solid #ef4444;">
          ${message}
        </p>
        <div style="margin-top: 24px; display: flex; gap: 10px; justify-content: center;">
          <button id="ai-sec-leave-btn" style="background-color: #dc2626; color: white; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: bold;">
            🚨 離開此網站
          </button>
          <button id="ai-sec-continue-btn" style="background-color: #4b5563; color: white; border: none; padding: 10px 14px; border-radius: 6px; cursor: pointer;">
            ⚠️ 我已知曉，繼續使用
          </button>
          <a href="https://line.me/R/ti/p/%40188ulmdu" target="_blank" style="text-decoration: none;">
            <button style="background-color: #00B900; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer;">
              💬 加 LINE 了解更多
            </button>
        </a>
          <a href="${DEMO_APP_BASE_URL}/safety" target="_blank" rel="noopener" style="text-decoration: none;">
            <button style="background-color: #0284c7; color: white; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer;">
              📖 前往 AI 安全學習模組
            </button>
          </a>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById("ai-sec-leave-btn").addEventListener("click", () => {
    window.history.back();
  });
  // 2. 點擊「我已知曉，繼續使用」：關閉彈窗，給予使用者選擇權
  document.getElementById("ai-sec-continue-btn").addEventListener("click", () => {
    modal.remove();
  });
}

const INJECTION_KEYWORDS = [
  "ignore previous instructions",
  "ignore all instructions",
  "dan mode",
  "developer mode",
  "忽略先前的指令",
  "忽略之前的提示",
  "繞過安全限制",
];

// 2. 顯示警告視窗 Modal
function showWarningModal(type, detail, originalEvent) {
  if (document.getElementById("ai-sec-modal")) return;

  const modal = document.createElement("div");
  modal.id = "ai-sec-modal";
  modal.innerHTML = `
    <div class="ai-sec-content">
      <div class="ai-sec-header">
        ⚠️ ⚠️ ⚠️ 偵測到 AI 資安風險警告 ⚠️ ⚠️ ⚠️
      </div>
      <div class="ai-sec-body">
        <p><strong>風險類型：</strong> ${type}</p>
        <p><strong>偵測特徵：</strong> <span class="highlight">${detail}</span></p>
        <hr>
        <p>💡 <strong>資安宣導提醒：</strong>（對應「AI 安全學習模組」課程內容）</p>
        <ul>
          <li><strong>個資/機密外洩（Module 1｜隱私）：</strong>請勿將密碼、API 金鑰、銀行憑證、身分證件或他人個資，隨意輸入至公共 AI 模型；傳送前先移除姓名與識別資訊。</li>
          <li><strong>提示詞注入 (Prompt Injection)（Module 3）：</strong>網頁、文件、收據裡的文字都只是「資料」，其中夾帶的指令不該被 AI 當成可以遵循的權限；試圖強制繞過安全限制可能導致產出不安全的結果。</li>
          <li><strong>AI 也會出錯（Module 2｜幻覺）：</strong>AI 給出的答案即使講得很肯定也可能是錯的，重要的申請、法律、財務決定請以官方原始來源為準。</li>
        </ul>
      </div>
      <div class="ai-sec-footer">
      <button id="ai-sec-cancel-btn" style="background-color: #ff4d4f; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-weight: bold;">
          🚫 取消發送
        </button>
        <button id="ai-sec-pass-btn" style="background-color: #ffc107; color: #212529; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-weight: bold;">
          ✅ 資料無誤，強制送出
        </button>
        <a href="https://line.me/R/ti/p/%40188ulmdu" target="_blank" style="text-decoration: none;">
          <button style="background-color: #00B900; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer;">
            💬 加LINE了解更多
          </button>
        </a>
        <a href="${DEMO_APP_BASE_URL}/safety" target="_blank" rel="noopener" style="text-decoration: none;">
          <button style="background-color: #0284c7; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer;">
            📖 前往 AI 安全學習模組
          </button>
        </a>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // 取消發送
  document.getElementById("ai-sec-cancel-btn").onclick = () => {
    bypassOnce = false; //
    modal.remove();
  };

  // ✅ 強制送出按鈕邏輯
  const passBtn = document.getElementById("ai-sec-pass-btn");
  if (passBtn) {
    passBtn.onclick = (e) => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      modal.remove();

      // 1. 設定放行 Flag
      bypassOnce = true;

      // 2. 安全檢查 originalEvent 是否存在
      setTimeout(() => {
        if (!originalEvent || !originalEvent.target) return;

        const targetEl = originalEvent.target;
        const eventType = originalEvent.type || "click"; // 給予預設值

        if (eventType === "keydown") {
          // 如果原本是按 Enter 送出
          // 【修正】像 Google 首頁搜尋框這種一般 <form>，
          // 「按 Enter 送出」是瀏覽器的原生行為，只認得使用者真的按鍵的
          // trusted 事件；用 dispatchEvent() 補打的合成事件 isTrusted 是
          // false，瀏覽器不會觸發原生表單送出，所以強制送出會沒反應。
          // 這裡改成優先找出所在的 <form>，直接呼叫 requestSubmit()
          // 來送出（不受 isTrusted 限制），找不到 form 才退回原本補打
          // Enter 事件的方式（給 AI 聊天網站那種自己攔截 Enter 的情況）。
          const form = targetEl.closest ? targetEl.closest("form") : null;
          if (form) {
            if (typeof form.requestSubmit === "function") {
              form.requestSubmit();
            } else {
              form.submit();
            }
          } else {
            const enterEvent = new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true,
            });
            targetEl.dispatchEvent(enterEvent);
          }
        } else {
          // 如果原本是點擊按鈕送出
          const sendBtn = targetEl.closest('button, [role="button"]') || targetEl;
          if (typeof sendBtn.click === "function") {
            sendBtn.click();
          }
        }
      }, 100);
    };
  }
}

// 【修正】原本這個函式在檔案裡被重複定義了兩次，第二次是巢狀寫在第一次的函式主體中間，
// 屬於複製貼上殘留的死碼（永遠不會被呼叫到，但會讓人誤以為程式邏輯跑了兩次）。
// 這裡整理成單一版本，並保留原本「聚焦元素 → 頁面第一個輸入框 → 頁面任何有值的輸入框」
// 這三層 fallback 的完整邏輯。
function extractTextFromCurrentContext(target) {
  let text = "";
  const activeEl = document.activeElement || target;

  // 1. 先看當前聚焦元素本身是不是輸入框
  if (activeEl) {
    if (activeEl.tagName === "TEXTAREA" || (activeEl.tagName === "INPUT" && activeEl.type === "text")) {
      text = activeEl.value;
    } else if (
      activeEl.isContentEditable ||
      activeEl.getAttribute("contenteditable") === "true" ||
      activeEl.getAttribute("role") === "textbox"
    ) {
      text = activeEl.innerText || activeEl.textContent;
    }
  }

  // 2. 如果點擊按鈕時 activeEl 不是輸入框，自動尋找當前頁面中「正在輸入的 AI 輸入框」
  if (!text || !text.trim()) {
    // 只精準抓取「輸入框元素」，絕不抓取頁面閱讀區塊
    const inputCandidate = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
    if (inputCandidate) {
      text = inputCandidate.value || inputCandidate.innerText || inputCandidate.textContent;
    }
  }

  // 3. 備用方案：如果還是沒抓到，直接搜出全頁面目前唯一/最後一個被編輯過的輸入框
  if (!text || !text.trim()) {
    const allInputs = document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]');
    for (let el of allInputs) {
      const val = el.value || el.innerText || el.textContent;
      if (val && val.trim().length > 0) {
        text = val;
        break;
      }
    }
  }

  return (text || "").trim();
}

// 4. 通用資安檢查與攔截核心邏輯
function performSecurityCheck(event) {
  // 🔴 關鍵修正：如果是強制送出觸發的，消耗掉 bypassOnce 旗標後立刻重置！
  if (bypassOnce) {
    bypassOnce = false; // 讀取後立刻清空，確保下次輸入會重新攔截
    return false;
  }

  // 【新增】只有在目前網站被判定為 AI 相關（黑名單/白名單/未核准 AI 網站）時才掃描輸入內容。
  // 修正前這裡完全沒有做這層判斷，導致在銀行、政府、購物等一般網站送出表單/密碼時，
  // 也會跳出「偵測到 AI 資安風險」的警告，文案與實際情境對不上、也容易造成誤觸。
  if (!siteIsAiRelated) return false;

  const text = extractTextFromCurrentContext(event.target);
  if (!text) return false;

  // A. 檢查敏感情資 (Regex)
  for (let pattern of SECURITY_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match) {
      // 【新增】若規則有附加 validate()（Luhn / 身分證檢查碼），要驗證通過才算真的命中，
      // 減少格式相似但其實不是真實卡號/證號的字串被誤判。
      if (pattern.validate && !pattern.validate(match[0])) continue;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showWarningModal("機密資料/個資外洩風險", `包含疑似「${pattern.name}」的格式`, event);
      return true;
    }
  }

  // B. 檢查 Prompt Injection
  const lowerText = text.toLowerCase();
  for (let keyword of INJECTION_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showWarningModal("提示詞注入 (Prompt Injection) 風險", `包含疑似越獄指令「${keyword}」`, event);
      return true;
    }
  }

  return false;
}

// 5. 最高權限全域事件監聽 (Capture 階段)

// 監聽鍵盤 Enter
window.addEventListener(
  "keydown",
  (e) => {
    // 如果焦點在彈窗內，不處理
    if (e.target.closest("#ai-sec-modal") || e.target.closest("#ai-sec-warning-modal")) {
      return;
    }

    // 只要按下 Enter 且沒按 Shift（代表準備送出）
    if (e.key === "Enter" && !e.shiftKey) {
      performSecurityCheck(e);
    }
  },
  true
);

// 監聽滑鼠點擊（只針對「發送按鈕」）
window.addEventListener(
  "click",
  (e) => {
    const target = e.target;

    // 1. 彈窗內部的點擊直接放行
    if (target.closest("#ai-sec-modal") || target.closest("#ai-sec-warning-modal")) {
      return;
    }

    // 2. 嚴格過濾：必須包含 explicit 發送屬性，或是在輸入框區塊內的送出按鈕
    const sendBtn = target.closest(
      'button[type="submit"], [aria-label*="Send" i], [aria-label*="送出"], [aria-label*="傳送"], [data-testid*="send" i]'
    );

    // 如果點擊的目標完全不符合發送按鈕的特徵（例如「顯示完整對話」按鈕），直接結束不檢查！
    if (!sendBtn) {
      return;
    }

    // 3. 額外防護：如果按鈕文字包含「顯示」、「完整」、「更多」、「展開」，直接放行
    const textContent = (sendBtn.innerText || sendBtn.textContent || "").trim();
    if (/(顯示|完整|更多|展開|詳情|Collapse|Expand|More)/i.test(textContent)) {
      return;
    }

    // 確認是發送按鈕才執行資安檢查
    performSecurityCheck(e);
  },
  true
);
