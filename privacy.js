// 隱私聲明頁面的互動邏輯
// 【修正】這段程式碼原本是寫在 privacy.html 裡的 inline <script>，
// 但擴充功能頁面（chrome-extension://）預設的 CSP 是 script-src 'self'，
// 會直接擋掉所有 inline script，導致整段程式碼從沒被執行過、
// 按鈕點擊事件也從沒被註冊——這才是「按了沒反應」的真正原因。
// 改成獨立的 .js 檔案透過 <script src="privacy.js"> 載入就不受此限制。

document.getElementById('close-btn').addEventListener('click', () => {
  // window.close() 只對「由腳本自己開啟」的分頁有效，
  // 這個分頁是擴充功能背景的 chrome.tabs.create() 開出來的，不算「腳本自己開的」，
  // 所以改用 chrome.tabs.remove() 主動關閉「自己這個分頁」，不受此限制。
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.getCurrent) {
    chrome.tabs.getCurrent((tab) => {
      if (tab && typeof tab.id === 'number') {
        chrome.tabs.remove(tab.id);
      } else {
        window.close();
      }
    });
  } else {
    window.close();
  }

  // 保險機制：萬一上面兩種關閉方式都被瀏覽器擋掉，
  // 200ms 後把按鈕換成提示文字，讓畫面至少有明確反應，不會看起來卡住沒動靜
  setTimeout(() => {
    const footer = document.querySelector('.footer');
    if (footer) {
      footer.innerHTML =
        '<p style="color:#059669;font-size:14px;font-weight:bold;">✅ 設定完成，您可以手動關閉這個分頁繼續使用</p>';
    }
  }, 200);
});
