// 背景 service worker（Manifest V3）
//
// 這裡只做一件事：監聽 chrome.runtime.onInstalled，
// 在使用者「剛裝好這個擴充功能的那一刻」自動開一個新分頁，
// 顯示隱私聲明頁面（privacy.html），讓使用者在開始被監控輸入內容之前，
// 先清楚知道這個工具會讀取什麼、不會讀取什麼、資料會不會被上傳。
//
// details.reason 可能是 "install"（第一次安裝）、"update"（版本更新）、
// "chrome_update" 或 "shared_module_update"。
// 這裡只在「第一次安裝」時跳出，避免每次自動更新版本都打擾使用者；
// 如果之後隱私權政策有重大變更，需要重新告知使用者，
// 可以把下面的判斷改成也包含 details.reason === "update"。
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("privacy.html")
    });
  }
});
