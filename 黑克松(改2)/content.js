
// 宣告全域放行 Flag
let bypassOnce = false;
// 補上 SECURITY_PATTERNS 的正則表達式（Regex）清單
const SECURITY_PATTERNS = [
  // 1. 密碼、OTP、API Key (金鑰與認證資安)
  { name: "API Key / Token 金鑰", regex: /(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|eyJhbGciOi|[a-zA-Z0-9_-]{32,}\.(?:AWS|AWS_SECRET|AZURE|GOOGLE))/i },
  { name: "帳號密碼/OTP驗證碼", regex: /(?:password|passwd|pwd|otp|one-time-password|驗證碼|一次性密碼)[\s:=]+[^\s]{4,}/i },
  { name: "私鑰憑證 (Private Key)", regex: /-----BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY-----/i },

  // 2. 證件、銀行、完整卡號  
  { name: "台灣身分證字號", regex: /[A-Z][12]\d{8}/i },
  { name: "居留證號", regex: /[A-Z][89]\d{8}/i },
  { name: "信用卡號", regex: /\b(?:\d[ -]*?){13,16}\b/ },
  { name: "銀行帳號 (10-16位數字)", regex: /\b\d{10,16}\b/ },
  { name: "手機號碼", regex: /09\d{8}/ },

  // 3. 病歷與生物辨識資料
  { name: "醫療/病歷相關資料", regex: /(?:病歷|診斷證明|主訴|處方箋|核酸檢測|基因序列|病歷號|病患姓名|ICD-10|ICD-9)/i },

  // 4. 未公開合約、原始碼
  { name: "未公開合約/保密協定", regex: /(?:保密協定|NDA|機密合約|商業機密|保密條款|Confidentiality Agreement|Proprietary)/i },
  { name: "程式碼/敏感設定檔", regex: /(?:import\s+[\w{}*]+\s+from|const\s+\w+\s*=|function\s+\w+\s*\(|class\s+\w+\s*\{|<\?php|def\s+\w+\s*\(|DB_PASSWORD|DATABASE_URL)/i }
];
// 等待網頁元素載入完成後執行
window.addEventListener('DOMContentLoaded', runAiSecurityCheck);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  runAiSecurityCheck();
}

function runAiSecurityCheck() {
  const currentHost = window.location.hostname.toLowerCase();

  // 1. 【黑名單】禁止與不補助之 AI 工具（中國/港澳開發營運或高風險 AI）
  const forbiddenDomains = [
    'capcut.com',      // CapCut (剪映海外版)
    'jianying.com',    // 剪映
    'klingai.com',     // 快手可靈 Kling
    'klingai.org',
    'meitu.com',       // 美圖秀秀
    'xiuxiu.meitu.com',
    'wink.com',        // Wink
    'whee.com',        // WHEE (美圖旗下)
    'senseavatar.com', // 智譜/商湯相關 AI
    'manus.im',        // Manus AI
    'manus.com',
    'deepseek.com',    // DeepSeek
    'chatglm.cn',      // 智譜清言
    'minimax.i'       // MiniMax
  ];

  // 2. 【白名單】符合補助規範的核准 AI 工具
  const allowedAiDomains = [
    // (一) 通用型 AI
    'chatgpt.com', 'openai.com', 'gemini.google.com', 'grok.com', 'x.ai', 'claude.ai', 'perplexity.ai',
    // (二) 影像類 AI
    'canva.com', 'firefly.adobe.com', 'adobe.com', 'midjourney.com', 'figma.com',
    // (三) 辦公類 AI
    'copilot.microsoft.com', 'microsoft.com', 'copy.ai', 'notion.so', 'notion.site', 'jasper.ai',
    // (四) 學習類 AI
    'grammarly.com', 'speak.com', 'elicit.com',
    // (五) 其他類 AI
    'cursor.com', 'cursor.sh'
  ];

  // A. 先檢查是否命中【黑名單】
  const isForbidden = forbiddenDomains.some(domain => currentHost.includes(domain));
  
  if (isForbidden) {
    showSiteWarningModal('🚨 禁用 AI 工具警示（不予補助）', '您目前存取的網站屬<b>中國大陸（含港澳）地區開發或營運之 AI 工具/軟體</b>。依規定此類服務不予補助且禁止使用，請勿在此輸入機密資料。');
    return;
  }

  // B. 若不在黑名單，再檢查是否屬於「AI 相關網站」但「不在白名單內」
  const isAllowed = allowedAiDomains.some(domain => currentHost.includes(domain));
  const isUnapprovedAi = detectUnapprovedAiSite();

  if (isUnapprovedAi && !isAllowed) {
    showSiteWarningModal('⚠️ 未核准 AI 工具警示', '您目前存取的網站<b>不在官方核准補助的安全 AI 名單中</b>。請確認該工具是否符合資安規範，並避免輸入敏感公務與個人資料。');
  }
}

// 動態偵測：網頁是否為「未核准的 AI 網站」（避免影響一般 Google、YouTube 瀏覽）
function detectUnapprovedAiSite() {
  const currentHost = window.location.hostname.toLowerCase();
  
  // 若網址直接帶有 ai / gpt 關鍵字
  if (currentHost.includes('ai') || currentHost.includes('gpt')) {
    return true;
  }

  // 若網址沒有 AI 字眼，則檢查網頁內容是否充滿 Prompt 或 AI 生成特徵
  const pageText = document.body ? document.body.innerText.toLowerCase() : '';
  const aiKeywords = ['prompt', 'text to image', 'text to video', 'ai generator', 'ai writer'];
  
  const matchCount = aiKeywords.filter(kw => pageText.includes(kw)).length;
  return matchCount >= 2;
}

// 警示彈窗渲染
function showSiteWarningModal(title, message) {
  if (document.getElementById('ai-sec-warning-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'ai-sec-warning-modal';
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
          <a href="https://github.com/ExpertsHan/mchackathon2026/blob/main/AI_safety_for_dummies/README.md" target="_blank" style="text-decoration: none;">
            <button style="background-color: #0284c7; color: white; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer;">
              📖 AI 安全使用懶人包
            </button>
          </a>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('ai-sec-leave-btn').addEventListener('click', () => {
    window.history.back();
  });
    // 2. 點擊「我已知曉，繼續使用」：關閉彈窗，給予使用者選擇權
  document.getElementById('ai-sec-continue-btn').addEventListener('click', () => {
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
  "繞過安全限制"
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
        <p>💡 <strong>資安宣導提醒：</strong></p>
        <ul>
          <li><strong>個資/機密外洩：</strong>請勿將公司/學校未公開程式碼、身分證件或 API 金鑰輸入至公共 AI 模型。</li>
          <li><strong>提示詞注入 (Prompt Injection)：</strong>試圖強制繞過 AI 安全限制可能導致產出不安全的結果。</li>
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
        <a href="https://github.com/ExpertsHan/mchackathon2026/blob/main/AI_safety_for_dummies/README.md" target="_blank" style="text-decoration: none;">
          <button style="background-color: #0284c7; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer;">
            📖 AI安全使用懶人包
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
                cancelable: true
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
    const inputCandidate = document.querySelector(
      'textarea, [contenteditable="true"], [role="textbox"]'
    );
    if (inputCandidate) {
      text = inputCandidate.value || inputCandidate.innerText || inputCandidate.textContent;
    }
  }

  return (text || "").trim();
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
    const inputCandidate = document.querySelector(
      'textarea, [contenteditable="true"], [role="textbox"]'
    );
    if (inputCandidate) {
      text = inputCandidate.value || inputCandidate.innerText || inputCandidate.textContent;
    }
  }

  return (text || "").trim();
}
  // 備用方案：如果還是沒抓到，直接搜出全頁面目前唯一/最後一個被編輯過的輸入框
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

  const text = extractTextFromCurrentContext(event.target);
  if (!text) return false;

  // A. 檢查敏感情資 (Regex)
  for (let pattern of SECURITY_PATTERNS) {
    if (pattern.regex.test(text)) {
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