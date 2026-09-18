// 修復：原本用 <a href="..." target="_blank"> 讓使用者點擊開啟 LINE 連結，
// 但擴充功能的 popup 視窗在 Chrome 上很容易在「新分頁還沒開完」之前
// 就因為失去焦點而被瀏覽器直接關掉，導致連結有時候點了沒反應。
//
// 改用 chrome.tabs.create() 由擴充功能主動開新分頁，這個 API 呼叫本身
// 是同步送出的，不會被 popup 視窗即將關閉這件事打斷，穩定性比單純依賴
// <a target="_blank"> 的預設瀏覽器行為好很多。
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("line-link-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const url = btn.dataset.url;
    if (!url) return;

    if (chrome && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url });
    } else {
      // 保底：萬一在非擴充功能情境下開啟這個頁面（例如純預覽 popup.html），
      // chrome.tabs 會是 undefined，改用一般開新分頁的方式。
      window.open(url, "_blank");
    }
    window.close();
  });
});
