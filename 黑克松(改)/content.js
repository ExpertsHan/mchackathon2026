// 【新增】信用卡號 Luhn 演算法驗證（標準 mod 10 檢查碼演算法）
// 原本只要有 13~16 位連續數字就會被判定為信用卡號，
// 導致訂單編號、時間戳記、電話+分機等一般數字都容易被誤判。
// 加上 Luhn 檢查後，只有「格式上真的可能是合法卡號」的數字才會觸發警示。
function isValidLuhn(rawText) {
  const digits = rawText.replace(/\D/g, "");
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

// 【新增】台灣身分證字號檢查碼驗證（內政部標準演算法，已用真實範例驗證過）
// 字母對應表：A~Z 轉成兩位數代碼（I、O、W、X、Y、Z 是不連續的特例）
const TW_ID_LETTER_VALUES = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18,
  K: 19, L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27,
  U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33
};
function isValidTaiwanId(rawText) {
  const upper = rawText.toUpperCase();
  if (!/^[A-Z][12]\d{8}$/.test(upper)) return false;

  const letterVal = TW_ID_LETTER_VALUES[upper[0]];
  const L1 = Math.floor(letterVal / 10);
  const L2 = letterVal % 10;
  const n = upper.slice(1).split("").map(Number); // N1~N9（性別碼＋流水碼＋檢查碼）
  const weights = [8, 7, 6, 5, 4, 3, 2, 1, 1];

  let sum = L1 * 1 + L2 * 9;
  for (let i = 0; i < 9; i++) sum += n[i] * weights[i];

  return sum % 10 === 0;
}

// SECURITY_PATTERNS 的正則表達式（Regex）清單
// 【修正】每個 pattern 除了 regex 之外，多了一個可選的 validate(matchedText)：
// regex 先做「格式」過濾，比對到之後再交給 validate 做「是否真的合理」的二次確認，
// 大幅降低誤判率。另外 regex 也都加上 (?<![A-Za-z0-9]) / (?![A-Za-z0-9]) 之類的
// 邊界判斷，避免在一長串英數字裡「碰巧」比對到一小段就誤判。
const SECURITY_PATTERNS = [
  {
    name: "身分證字號",
    regex: /(?<![A-Za-z0-9])[A-Za-z][12]\d{8}(?![A-Za-z0-9])/,
    validate: isValidTaiwanId
  },
  {
    name: "信用卡號",
    regex: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/,
    validate: isValidLuhn
  },
  {
    name: "手機號碼",
    regex: /(?<!\d)09\d{8}(?!\d)/
    // 手機號碼沒有公開的官方檢查碼演算法，維持格式比對即可
  }
  // 可以依需求自行增加其他的檢測 Pattern（記得視情況加上 validate 二次確認）
];

// 【修正】兩個彈窗都會用到的 id / class，統一放在這裡，
// 方便之後判斷「這次的點擊/按鍵是不是發生在我們自己的警示彈窗裡」
const AI_SEC_MODAL_SELECTOR =
  '#ai-sec-modal, #ai-sec-warning-modal, .ai-sec-modal-overlay';

// 【新增】「執意發送」功能用的全域狀態
// pendingAction：記錄被攔截下來的原始動作是「按 Enter」還是「點擊送出鈕」，
//                以及當初的目標元素是誰，這樣使用者選擇執意發送時才能重新觸發同一個動作。
// bypassSecurityCheck：下一次 performSecurityCheck 執行時先跳過檢查一次
//                （因為執意發送時我們是"重放"同一個使用者操作，不該再被攔一次）。
let pendingAction = null;
let bypassSecurityCheck = false;

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
    'minimaxi.com'     // 【修正】原本寫成 'minimax.i'，是不完整的網域，永遠不會命中，改成正確網域
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

// 警示彈窗渲染（網站黑/白名單用）
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
        <div style="margin-top: 24px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
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
  // 點擊「我已知曉，繼續使用」：關閉彈窗，給予使用者選擇權
  document.getElementById('ai-sec-continue-btn').addEventListener('click', () => {
    modal.remove();
  });

  // 【新增】點擊半透明背景（遮罩）也可以關閉彈窗，避免使用者卡住
  modal.querySelector('.ai-sec-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      modal.remove();
    }
  });

  // 【新增】按下 Esc 鍵可以關閉彈窗
  document.addEventListener('keydown', function escCloseHandler(e) {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', escCloseHandler);
    }
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

// 顯示警告視窗 Modal（輸入內容偵測用）
function showWarningModal(type, detail) {
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
        <button id="ai-sec-cancel-btn">🚫 取消發送</button>
        <button id="ai-sec-force-btn" style="background-color: #f59e0b; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-weight: bold;">
          ⚠️ 執意發送
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

  document.getElementById("ai-sec-cancel-btn").addEventListener('click', () => {
    // 取消發送：單純關閉彈窗，原本被攔下的動作不會被重放，等於放棄這次送出
    pendingAction = null;
    modal.remove();
  });

  // 【新增】「執意發送」：使用者已看過警示，仍要堅持送出原本的內容
  document.getElementById("ai-sec-force-btn").addEventListener('click', () => {
    modal.remove();
    forceSendPendingAction();
  });

  // 按下 Esc 鍵也可以關閉彈窗（視同取消發送），避免唯一的關閉方式失效時使用者卡住
  document.addEventListener('keydown', function escCloseHandler(e) {
    if (e.key === 'Escape') {
      pendingAction = null;
      modal.remove();
      document.removeEventListener('keydown', escCloseHandler);
    }
  });
}

// 【新增】重放被攔截下來的原始動作（按 Enter 或點擊送出鈕），讓內容真正送出
function forceSendPendingAction() {
  if (!pendingAction || !pendingAction.target) {
    pendingAction = null;
    return;
  }

  const { type, target } = pendingAction;
  pendingAction = null;

  // 下一次 performSecurityCheck 執行時直接放行一次，
  // 避免我們自己重放的這個動作又被自己攔下來，造成無法送出的迴圈
  bypassSecurityCheck = true;
  // 保險機制：如果目標元素消失或事件沒有被正確重新觸發，
  // 2 秒後自動把旗標重設回 false，避免之後所有操作都被永久跳過檢查
  setTimeout(() => { bypassSecurityCheck = false; }, 2000);

  if (type === "keydown") {
    // 【修正】原本的做法是對輸入框 dispatchEvent 一個模擬的 keydown Enter 事件，
    // 但瀏覽器基於安全考量，「Enter 觸發表單送出」這個原生預設行為只認
    // 使用者真正按鍵產生的『受信任事件』(event.isTrusted === true)，
    // 用程式 dispatchEvent 出來的事件 isTrusted 一律是 false，
    // 所以像 Google 搜尋這種用原生 <form> 送出的網站，模擬 Enter 完全不會有反應。
    //
    // 修正方式：先找有沒有原生 <form> 包住這個輸入框，
    // 有的話直接呼叫 form.requestSubmit()——這是瀏覽器明確提供給「程式呼叫」
    // 用的送出 API，效果等同使用者按下送出鈕，不受 isTrusted 限制，
    // 也會正常觸發網站自己監聽的 submit 事件。
    // 只有在真的找不到原生 form（例如 ChatGPT 這類完全用 JS 自己處理
    // Enter 事件、沒有原生表單的聊天介面）時，才退回原本模擬 keydown 的做法，
    // 讓網站自己的 JS 監聽器接手處理。
    const form = target.form || (typeof target.closest === "function" ? target.closest("form") : null);

    if (form) {
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.submit();
      }
    } else {
      const kbEvent = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      target.dispatchEvent(kbEvent);
    }
  } else {
    // click 類型：直接對當初的送出鈕觸發一次點擊
    if (typeof target.click === "function") {
      target.click();
    } else {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
  }
}

// 【萬用文字擷取器】自動從當前聚焦元素或父節點抓取全量文字
function extractTextFromCurrentContext(target) {
  let text = "";

  // 優先抓取當前 Focus 的元素
  const activeEl = document.activeElement || target;

  if (activeEl) {
    // A. 如果是傳統輸入框
    if (activeEl.tagName === "TEXTAREA" || activeEl.tagName === "INPUT") {
      text = activeEl.value;
    }
    // B. 如果是富文本 / contenteditable / Shadow DOM
    else if (activeEl.isContentEditable || activeEl.getAttribute("contenteditable") === "true" || activeEl.getAttribute("role") === "textbox") {
      text = activeEl.innerText || activeEl.textContent;
    }
    // C. 如果 focus 在父節點上，往上/往下找尋最近的輸入區域
    else {
      const closetInput = activeEl.closest('[contenteditable="true"], textarea, [role="textbox"]');
      if (closetInput) {
        text = closetInput.value || closetInput.innerText || closetInput.textContent;
      }
    }
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

// 通用資安檢查與攔截核心邏輯
// replayTarget：真正要被重放的目標元素（Enter 情境是輸入框本身，click 情境是送出鈕），
//               供使用者選擇「執意發送」時使用；不傳的話就退回用 event.target。
function performSecurityCheck(event, replayTarget) {
  // 【新增】如果這是「執意發送」重放出來的動作，直接放行一次，不重複攔截
  if (bypassSecurityCheck) {
    bypassSecurityCheck = false;
    return false;
  }

  const text = extractTextFromCurrentContext(event.target);
  if (!text) return false;

  const actionTarget = replayTarget || event.target;

  // A. 檢查敏感情資 (Regex + 二次驗證)
  for (let pattern of SECURITY_PATTERNS) {
    const match = pattern.regex.exec(text);
    if (match && (!pattern.validate || pattern.validate(match[0]))) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      pendingAction = { type: event.type, target: actionTarget };
      showWarningModal("機密資料/個資外洩風險", `包含疑似「${pattern.name}」的格式`);
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
      pendingAction = { type: event.type, target: actionTarget };
      showWarningModal("提示詞注入 (Prompt Injection) 風險", `包含疑似越獄指令「${keyword}」`);
      return true;
    }
  }

  return false;
}

// 最高權限全域事件監聽 (Capture 階段)

// 監聽鍵盤 Enter
window.addEventListener(
  "keydown",
  (e) => {
    // 【修正核心 bug】如果這次按鍵是發生在我們自己的警示彈窗裡（例如在彈窗裡按 Enter），
    // 就直接放行，不要再跑一次 performSecurityCheck，
    // 否則彈窗會攔截自己的事件，導致彈窗內的互動失效。
    if (e.target.closest && e.target.closest(AI_SEC_MODAL_SELECTOR)) {
      return;
    }
    // 只要按下 Enter 且沒按 Shift（代表準備送出）
    if (e.key === "Enter" && !e.shiftKey) {
      // 【新增】把 e.target（真正按下 Enter 的那個輸入框）當作重放目標傳進去，
      // 這樣「執意發送」時才知道要對哪個元素重新送出 Enter
      performSecurityCheck(e, e.target);
    }
  },
  true // useCapture = true，確保在任何網站腳本之前觸發
);

// 監聽滑鼠點擊（針對各種送出/傳送按鈕）
window.addEventListener(
  "click",
  (e) => {
    const target = e.target;

    // 【修正核心 bug】原本的問題：
    // 這個監聽器用 capture 階段（true）綁在 window 上，比彈窗按鈕自己的 click
    // 事件更早觸發。當使用者點擊「取消發送 / 我已知曉繼續使用 / 離開此網站」等
    // 按鈕時，這裡的 isButtonLike 判斷式（含 'button' 選擇器）也會命中彈窗按鈕本身，
    // 於是又跑了一次 performSecurityCheck；只要原本輸入框裡的敏感內容還沒被清掉，
    // 偵測就會再次命中，並呼叫 event.stopPropagation() / stopImmediatePropagation()。
    // 因為這是在「capture 階段、且發生在到達按鈕本身之前」呼叫 stopPropagation，
    // 會導致事件永遠傳不到按鈕自己的 click handler，
    // 使用者也就永遠點不掉彈窗（無限迴圈式攔截自己）。
    //
    // 修正方式：只要點擊發生在我們自己的彈窗（#ai-sec-modal 或
    // #ai-sec-warning-modal）範圍內，就直接放行，完全不呼叫 performSecurityCheck，
    // 讓彈窗自己的按鈕事件可以正常執行。
    if (target.closest && target.closest(AI_SEC_MODAL_SELECTOR)) {
      return;
    }

    // 判斷點擊目標是否為按鈕，或是包含送出圖示/文字的元素
    // 【修正】原本這裡還包含裸的 'svg', 'path'，代表網頁上任何一個 SVG 圖示
    // （收藏愛心、漢堡選單、關閉 X…）被點擊都會觸發檢查，容易誤攔跟「送出」
    // 完全無關的操作。real-world 的送出圖示幾乎都會包在 <button> 或
    // role="button" 的容器裡，所以拿掉裸 svg/path 也不太會漏掉真正的送出鈕。
    const isButtonLike = target.closest(
      'button, [role="button"], [aria-label*="Send"], [aria-label*="送出"], [aria-label*="傳送"], [data-testid*="send"]'
    );

    if (isButtonLike) {
      // 【新增】把實際判定出的送出鈕（isButtonLike）當作重放目標傳進去，
      // 這樣「執意發送」時才知道要對哪個按鈕重新觸發點擊
      performSecurityCheck(e, isButtonLike);
    }
  },
  true // useCapture = true
);
