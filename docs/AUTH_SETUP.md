# 登入白名單設定（Google 登入 + Google Sheet）

設定完成後的效果：
- 只有 Google Sheet「Users」工作表裡、而且狀態是啟用的 email，才能進入 App。
- 其他人打開網址只會停在登入畫面。他們的 email 會自動記到「Requests」工作表，你把那一列複製到 Users 就算核准。
- 每次登入或開啟 App 都會記錄到「Log」工作表。

整個設定約需 15 分鐘，分三段，**請依順序做**：
- A：建立 Sheet 和 Apps Script，取得 `/exec` 網址。
- B：在 Google Cloud 建立 OAuth 用戶端，取得 Client ID。
- C：把 Client ID 填回 Apps Script。

---

## A. 建立 Google Sheet 與 Apps Script

1. 開啟 https://sheets.new ，把試算表命名為「姿勢分析 使用者名單」。
2. 選單「擴充功能」→「Apps Script」。
3. 刪掉編輯器裡原本的內容，貼上 `apps-script/Code.gs` 的全部內容，按 💾 儲存。
4. 上方函式選單選 `setup`，按「執行」。
   - 第一次會要求授權：按「審查權限」→ 選你的帳號 →「進階」→「前往（不安全）」→「允許」。
   - 完成後試算表會多出 Users、Log、Requests 三個工作表，你自己的 email 已經在 Users 裡。
5. 右上「部署」→「新增部署作業」→ 齒輪圖示選「網頁應用程式」：
   - 執行身分：**我**
   - 誰可以存取：**任何人**
   - 按「部署」，複製結尾是 `/exec` 的網址（以下稱 **SCRIPT_URL**）。

## B. 建立 Google OAuth 用戶端 ID（免費）

1. 開啟 https://console.cloud.google.com/ ，在上方專案選單按「新增專案」，名稱填 `posture-analyzer`，建立後切換到這個專案。
2. 左側選單「API 和服務」→「OAuth 同意畫面」（新版介面叫「Google Auth Platform」）：
   - 應用程式名稱：人體姿勢分析器；使用者支援 email：你的 email。
   - 目標對象：**外部**。
   - 填完後到「目標對象」頁按「**發布應用程式**」，改成「正式版」。只用基本登入資訊（email、名稱）不需要 Google 審核；若停在「測試中」，只有你手動加入的測試使用者能登入。
3. 「憑證」→「建立憑證」→「OAuth 用戶端 ID」：
   - 應用程式類型：**網頁應用程式**
   - 已授權的 JavaScript 來源：
     - `https://shogun5.github.io`
     - `http://localhost:5173`（本機測試用）
   - 已授權的重新導向 URI：貼上 **SCRIPT_URL**（iPhone 主畫面 App 的「頁面跳轉登入」會用到）
   - 按「建立」，複製「用戶端 ID」，格式像 `1234-abc.apps.googleusercontent.com`（以下稱 **CLIENT_ID**）。

## C. 把 CLIENT_ID 填回 Apps Script

1. 回到 Apps Script，把第一段的 `const CLIENT_ID = 'PASTE_...'` 改成你的 **CLIENT_ID**，按儲存。
2. 「部署」→「管理部署作業」→ 鉛筆圖示 →「版本」選「新版本」→「部署」。這樣網址不會改變。

## D. 把兩個值交給 App

把 **CLIENT_ID** 和 **SCRIPT_URL** 填到 `js/config.js`，再推送到 GitHub；或直接告訴 Claude 代為填入。這兩個值不是機密，本來就會出現在網頁原始碼中。真正的名單與簽章密鑰存在你的 Sheet 和 Apps Script 裡，別人看不到。

---

## 日常管理（Users 工作表）

| email | name | expires | active | note |
|---|---|---|---|---|
| someone@gmail.com | 王小明 | 2027-06-30 | TRUE | 研究助理 |

- **新增使用者**：加一列，email 一定要是他們登入用的 Google 帳號。
- **停權**：把 active 改成 `FALSE`，或直接刪除那一列。對方下次開啟 App 時，只要有網路就會被擋下。
- **到期日**：expires 填 `YYYY-MM-DD`，過了那天就不能再登入；留空表示不限期。
- **核准申請**：Requests 工作表會列出想登入但不在名單內的人，把那一列複製到 Users 即可。

## 安全性說明

- **擋得住的**：連結被轉傳給別人時，對方打不開，只會停在登入畫面。
- **擋不住的**：懂技術的人可以從 GitHub 或瀏覽器下載程式碼，自己架一份。若需要更嚴格的保護，可以改用 Cloudflare Access，讓未授權的人連檔案都拿不到。
- **離線使用**：登入一次後 30 天內可以離線使用。一連上網路就會重新比對名單。
- **個資告知**：Log 工作表會記錄 email、時間與瀏覽器類型，請在研究同意書中告知受試者與研究人員。
