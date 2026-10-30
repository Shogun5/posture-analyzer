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

---

## E. ECT 互動評估模組（只放在 Apps Script，不放 GitHub）

App 的「ECT 模組」分頁會在登入通過後，才向你的 Apps Script 下載講義模組。GitHub 上沒有這份內容。

1. Apps Script 編輯器左側「檔案」旁按「＋」→「HTML」，檔名輸入 `Module`（大小寫要一樣，不用打 .html）。
2. 刪掉預設內容，用記事本打開 `ECT互動評估模組.html`，全選、複製，貼進 Module，存檔。
3. 把 `Code.gs` 整份換成本專案 `apps-script/Code.gs` 的最新版（新增了 `module` 動作），存檔。
4. 「部署」→「管理部署作業」→ 鉛筆圖示 →「版本：新版本」→「部署」。網址不會變。

**以後要更新講義模組**：在 Module 檔貼上新內容，再做一次第 4 步。使用者下次開啟分頁時，會自動下載新版。

**模組在使用者裝置上的副本**
- 下載後會存在裝置上，離線時也能看。
- 使用者登出、被停權或到期時，會自動刪除這份副本。
- 每次下載都會在 Log 工作表記一筆 `module / sent`。

---

## F. 另建「名冊」給工作人員編輯（管理者做一次）

目的：讓工作人員只能編輯名單。Apps Script、講義模組、Log 都留在你的原始試算表，工作人員碰不到。

1. 開啟 https://sheets.new ，命名為「ECT 使用者名冊」。複製網址中 `/d/` 和 `/edit` 之間的那一段，這就是**名冊 ID**。
2. 回到原始試算表的 Apps Script，把 `Code.gs` 整份換成本專案最新版，並在 `const ROSTER_ID = '';` 的引號中貼上名冊 ID，存檔。
3. 上方函式選單選 `setupRoster`，按「執行」。
   - 這次會多要求「存取你所有的試算表」的權限，按允許即可。
   - 執行完成後，名冊會出現 Users 和 Requests 兩個工作表，原本的名單也會一起複製過去。
   - active 欄會變成核取方塊，expires 欄會限制只能輸入日期。
4. 「部署」→「管理部署作業」→ 鉛筆圖示 →「新版本」→「部署」。
5. 用名冊右上的「共用」，把工作人員加為**編輯者**。原始試算表**不要**共用。
6. 確認名冊上線無誤後，可以刪除原始試算表裡舊的 Users／Requests 工作表，避免兩邊混淆。Log 請保留。

完成後，App 會改用名冊的 Users 判斷誰能登入；新的登入申請也會記到名冊的 Requests。

## G. 使用者回饋與錯誤紀錄（v1.9.0 起）

App 右上角的 💬 按鈕可送出回饋；App 也會自動回報程式錯誤。兩者都寫進**名冊試算表**：

| 工作表 | 內容 |
|---|---|
| `Feedback` | 時間、帳號、類別、內容、版本、所在步驟、裝置、環境資訊、圖片連結、**處理狀態**（預設「未處理」）、回覆／備註 |
| `Errors` | 時間、帳號、版本、所在步驟、錯誤訊息、堆疊、裝置 |

工作表第一次收到資料時會自動建立。使用者勾選「附上目前的相機畫面」時，圖片存到管理者雲端硬碟的 `posture-analyzer feedback` 資料夾。

**啟用方式**：
1. Apps Script 編輯器左側「檔案」旁的 ＋ →「指令碼」，命名 `Feedback`，把 `apps-script/Feedback.gs` 全部內容貼上。
2. 在 `Code.gs` 的 `doPost` 裡，`if (body.action === 'module') ...` 那一行下面加兩行：
   ```js
   if (body.action === 'feedback') return json(feedback_(body));
   if (body.action === 'errlog') return json(errlog_(body));
   ```
3. 儲存後「部署 → 管理部署作業 → 編輯 → 版本：新版本 → 部署」。因為新增了雲端硬碟權限，第一次需要重新授權。
