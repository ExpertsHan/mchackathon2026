# AI 安全新手村：來源與查核紀錄

本文件記錄教材中的外部事實、數字與框架來源。所有來源於 2026-08-15 查閱。案例摘要只轉述來源可以支持的內容，不把報導中的推測寫成確定事實。

## 專案依據

| 來源 | 用途 |
|---|---|
| [新竹市 AI 領航青年數位工具補助題目](../政府題目.pdf) | 確認教材須涵蓋資料隱私、智慧財產、惡意程式、AI 資安檢核與重大事件案例 |
| [青安補助通完整解題方案](../政府題目_完整解題方案.md) | 對齊第 8 節的四個行動、三類案例卡與持續推廣方式 |

## 風險框架

| 來源 | 日期 | 教材採用內容 |
|---|---:|---|
| [NIST, Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) | 2024-07-26 | 生成式 AI 風險須被辨識、量測與管理；教材將風險轉成可執行的來源、資料、查證與權利檢查 |
| [OWASP GenAI Security Project / LLM Top 10](https://owasp.org/www-project-top-10-for-large-language-model-applications/) | 2026 現行版入口 | 敏感資訊洩漏、供應鏈、過度依賴與過度授權等風險分類 |

## 案例一：2023 年 ChatGPT 資料暴露

### 事件日期

- 事件發生：2023-03-20
- OpenAI 公布說明：2023-03-24
- The Verge 報導時間（臺灣時區頁面顯示）：2023-03-25

### 來源

1. [OpenAI, March 20 ChatGPT outage: Here’s what happened](https://openai.com/index/march-20-chatgpt-outage/)
2. [The Verge, ChatGPT’s history bug may have also exposed payment info, says OpenAI](https://www.theverge.com/2023/3/24/23655622/chatgpt-outage-payment-info-exposed-monday)

### 可使用的事實

- 快取使用的開源函式庫錯誤，可能讓部分活躍使用者看到其他使用者的聊天標題。
- OpenAI 表示，約 1.2% 在特定九小時期間活躍的 ChatGPT Plus 訂閱者，付款相關資料可能被另一位活躍使用者看到。
- 可能顯示的欄位包括姓名、電子郵件、付款地址、信用卡末四碼與到期日；不是完整信用卡號。
- 少量訂閱確認信可能寄給錯誤的使用者。

### 不應誇大的說法

- 不寫成「所有 ChatGPT 使用者資料都外洩」。
- 不寫成「完整信用卡號被公開」。
- 不把系統錯誤描述成已證實的惡意駭侵。

## 案例二：2024 年香港多人深偽視訊詐騙

### 事件與報導日期

- CNN 報導：2024-02-04
- 報導引用香港警方在前一個星期五的簡報內容。

### 來源

1. [CNN, Finance worker pays out $25 million after video call with deepfake ‘chief financial officer’](https://edition.cnn.com/2024/02/04/asia/deepfake-cfo-scam-hong-kong-intl-hnk/index.html)

### 可使用的事實

- 香港警方表示，一名跨國公司財務人員參加多人視訊會議，以為看見多名認識的同事。
- 警方表示，會議中的人物是深偽重製。
- 該名員工依指示匯出合計約 2 億港元，約當時 2,560 萬美元。
- 事件後來因員工向公司總部查證而被發現。

### 不應誇大的說法

- 公司與員工身分未公開，不自行猜測。
- 不宣稱所有深偽都能靠肉眼辨認。
- 金額標示為「警方表示」或「CNN 引述警方」，避免寫成未附來源的官方統計。

## 案例三：2023 年假 AI 工具與惡意外掛

### 報告日期

- Meta 報告：2023-05-03

### 來源

1. [Meta, Meta’s Q1 2023 Security Reports: Protecting People and Businesses](https://about.fb.com/news/2023/05/metas-q1-2023-security-reports/)

### 可使用的事實

- Meta 表示，自 2023 年 3 月起，其安全分析人員發現約 10 個冒充 ChatGPT 及類似工具的惡意程式家族。
- Meta 表示已阻擋超過 1,000 個相關惡意網址在旗下 App 分享，並向其他服務商通報。
- 部分惡意瀏覽器外掛出現在官方網路商店，且真的包含 ChatGPT 功能，用來降低懷疑。
- 攻擊者會跟隨熱門主題更換誘餌名稱，不能只靠工具名稱判斷安全。

### 不應誇大的說法

- 「超過 1,000 個」指 Meta 阻擋的獨特惡意網址，不是 1,000 個惡意程式家族。
- 不寫成所有 AI 外掛或所有官方商店內容都有惡意。

## 編輯原則

- 「低風險」不寫成「安全」或「零風險」。
- 刪除聊天或檔案只列為降低暴露的動作，不保證所有備份同步刪除。
- 醫療、法律、財務與政府資格只提供查證方向，不由教材替讀者作成專業判斷。
- 工具資料政策與授權條款會變動，教材不替任何產品背書。
- 案例卡上的來源採短標示，完整標題、連結與限制均保留在本文件。

## 視覺素材紀錄

### 封面插畫

- 產生日期：2026-08-15
- 產生方式：OpenAI 內建 ImageGen
- 用途：AI 安全新手教材封面
- 提示詞摘要：一名臺灣青年在電腦前安全使用 AI；盾牌隔開證件、密碼、付款與機密資料；放大鏡代表查證；授權文件代表權利確認；親切扁平教育插畫；不得包含文字、品牌、真實個資或浮水印。
- 人工檢查：無可辨識真人、無品牌標誌、無可讀文字、無真實證件或付款資料。

### 資訊圖卡

- 一頁式懶人包、資料紅綠燈、決策流程及三張案例卡均為本教材原創 SVG 排版。
- PNG 由相同 SVG 輸出；繁中文字使用本機 `Noto Sans TC` 排版，避免生成式圖片文字錯誤。
- 圖卡不使用第三方照片、商標或未授權人物肖像。
