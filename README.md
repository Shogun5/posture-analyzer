# 人體姿勢分析器 Posture Analyzer（PWA）

MediaPipe Pose（heavy，33 點）本機推論的靜態姿勢分析 PWA：四方向（正、右、背、左）語音引導拍攝、自動倒數、語音指令或舉手手勢遙控、問題姿勢判讀（依 ECT 運動矯正講義 2026 修訂版 P22–63）、以身高換算比例尺、鉛垂線校正、多日紀錄與前後測比較。**影像只在本機處理，不上傳。**

## 檔案結構

```
posture-analyzer/
├─ index.html            介面（4 個分頁：拍攝/結果/歷史/設定）、CDN script 標籤、manifest 連結
├─ manifest.json         PWA 設定
├─ sw.js                 Service worker（離線快取：程式、Chart.js、WASM、heavy 模型）
├─ css/style.css         行動優先版面、淺/深色
├─ icons/icon-192.png    PWA 圖示
├─ icons/icon-512.png
├─ tools/make-icons.html 圖示產生器（瀏覽器開啟 → 下載 PNG）
└─ js/
   ├─ app.js       主控制：相機、30 fps 迴圈、引導拍攝狀態機、語音/手勢、校正、UI
   ├─ pose.js      MediaPipe PoseLandmarker 封裝（GPU→CPU 退回）
   ├─ biomech.js   座標轉換、關節/節段角度、COM、方向判斷、紀錄後處理
   ├─ filters.js   三次樣條內插/重取樣、移動平均、Savitzky–Golay 導數、摘要統計
   ├─ posture.js   問題姿勢規則與閾值（講義頁碼對照）
   ├─ overlay.js   骨架、角度弧、鉛垂/地板線、身高尺、軌跡、速度箭頭、數值面板
   ├─ voice.js     語音引導 TTS、提示音、語音指令
   ├─ recorder.js  疊加畫面錄影（MP4 優先，否則 WebM）
   ├─ storage.js   IndexedDB（每次紀錄、0° 基準）
   ├─ charts.js    Chart.js 時間序列、疊圖、趨勢、摘要表
   ├─ export.js    CSV 長格式、影片、PNG、HTML/PDF 報告
   └─ i18n.js      中英字串、語音腳本、指令關鍵字
```

---

## 安裝與環境建置

### 0. 版本（全部以 CDN 載入並固定版本）

| 套件 | 版本 | 網址 |
|---|---|---|
| @mediapipe/tasks-vision | 0.10.14 | `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs` |
| WASM 路徑 | 0.10.14 | `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm` |
| Pose heavy 模型 | float16 v1 | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task` |
| （備用）full / lite | float16 v1 | 將上列網址中的 `heavy` 換成 `full` 或 `lite` |
| Chart.js | 4.4.1 | `https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js` |

```html
<!-- index.html <head> -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script type="module" src="js/app.js"></script>
```
```js
// js/pose.js（ES module 匯入）
import { PoseLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
```

不需要安裝 Python。

### 1. 為什麼不能雙擊 index.html（file://）

- `<script type="module">` 在 `file://` 下被 CORS 擋住，模組載不進來。
- MediaPipe 要用 `fetch` 下載 WASM 與 `.task` 模型，`file://` 不允許。
- `getUserMedia`（相機）、Service Worker 只能在「安全來源」執行：`https://` 或 `http://localhost`。

### 2. 本機測試（擇一）

**A. VS Code Live Server**
1. VS Code → 擴充套件 → 搜尋安裝「Live Server」（Ritwick Dey）。
2. 檔案 → 開啟資料夾 → 選 `posture-analyzer`。
3. 在 `index.html` 按右鍵 →「Open with Live Server」。
4. 瀏覽器自動開啟 `http://127.0.0.1:5500/index.html`。

**B. `npx serve`（需 Node.js 18+）**

Windows（PowerShell）：
```bash
cd posture-analyzer
npx --yes serve@14.2.4 -l 5173 .
```
macOS / Linux：同上指令。開啟 `http://localhost:5173/index.html`。

> 已有 Python 的人也可以改用 `python -m http.server 5173`，結果一樣。

### 3. 用手機測試（必須 HTTPS）

用同一個 Wi‑Fi、以 `http://192.168.x.x:5173` 開啟時，因為不是 HTTPS 也不是 localhost，**瀏覽器會擋相機**（`navigator.mediaDevices` 為 undefined 或權限被拒）。解法：

**A. GitHub Pages（建議，免費、固定網址）**
1. 在 GitHub 建立新 repository（例如 `posture-analyzer`）。
2. 上傳 `posture-analyzer/` 內所有檔案到 repo 根目錄：
   ```bash
   git init
   git add .
   git commit -m "posture analyzer"
   git branch -M main
   git remote add origin https://github.com/<帳號>/posture-analyzer.git
   git push -u origin main
   ```
3. Repo → Settings → Pages → Source 選「Deploy from a branch」→ Branch `main`、資料夾 `/ (root)` → Save。
4. 1–2 分鐘後用手機開啟 `https://<帳號>.github.io/posture-analyzer/`。

**B. Netlify Drop**
1. 開 `https://app.netlify.com/drop`（需登入）。
2. 把整個 `posture-analyzer` 資料夾拖進去。
3. 取得 `https://xxxx.netlify.app` 網址，用手機開啟。

**C. ngrok 通道（開發中快速測試）**
1. 電腦先跑 `npx --yes serve@14.2.4 -l 5173 .`
2. 安裝 ngrok 並登入（到 ngrok.com 取得 authtoken）：
   ```bash
   ngrok config add-authtoken <你的token>
   ngrok http 5173
   ```
3. 用手機開啟畫面上的 `https://xxxx.ngrok-free.app/index.html`。

### 4. PWA 設定

`manifest.json`（已附）：
```json
{
  "name": "人體姿勢分析器 Posture Analyzer",
  "short_name": "姿勢分析",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "background_color": "#0b1120",
  "theme_color": "#0f766e",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```
在 HTML 中連結：
```html
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#0f766e">
<link rel="apple-touch-icon" href="icons/icon-192.png">   <!-- iOS 用這個當主畫面圖示 -->
<meta name="apple-mobile-web-app-capable" content="yes">
```
**產生圖示**：已附 `icons/icon-192.png`、`icons/icon-512.png`。要自訂：用本機伺服器開 `tools/make-icons.html` → 按兩個下載鈕 → 覆蓋 `icons/`。或把任一張正方形 PNG 用 realfavicongenerator.net 或 maskable.app 轉出 192 與 512。

### 5. Service worker

- **快取內容**：全部本機檔（html/css/js/icons/manifest）、Chart.js、`vision_bundle.mjs`、4 個 WASM 檔（`vision_wasm_internal.js/.wasm`、`vision_wasm_nosimd_internal.js/.wasm`）、heavy `.task` 模型（約 30 MB）。lite/full 模型在第一次使用時才快取。第一次上線開啟後即可離線使用。
- **註冊**（`js/app.js`）：
  ```js
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
  ```
- **更新版本**：改程式後，把 `sw.js` 的 `const CACHE = 'posture-v1.0.0'` 改成新版號（同時改 `js/app.js` 的 `APP_VERSION`）。新 SW 安裝時呼叫 `skipWaiting()`、啟用時刪除舊快取並 `clients.claim()`；頁面收到 `controllerchange` 後會自動重新整理，使用者拿到新版。本機檔採 network-first，連線時一定先抓新檔。

### 6. 安裝到裝置

| 平台 | 步驟 |
|---|---|
| **Windows**（Chrome / Edge） | 開啟 HTTPS 網址（或 localhost）→ 網址列右側「安裝」圖示 → 安裝。 |
| **Android**（Chrome） | 開啟 HTTPS 網址 → 右上「⋮」選單 →「安裝應用程式」或「加到主畫面」。 |
| **iPhone / iPad** | **必須用 Safari**開啟 HTTPS 網址 → 分享鈕 →「加入主畫面」→ 新增。 |

**iOS PWA 限制**
- 相機只在 HTTPS 下可用；第一次會跳權限視窗。主畫面 App 的權限與 Safari 分開，可能每次啟動都再問一次。若被拒：設定 → Safari → 相機 → 允許。
- `<video>` 必須有 `playsinline` 與 `muted`，否則會全螢幕或黑畫面（本程式已加）。
- 語音（TTS）與音效要在使用者點按後才能發聲，所以要先按「開啟相機 / 開始引導拍攝」。
- 鉛垂感測器需按「感測器鉛垂」後授權動作感測（`DeviceMotionEvent.requestPermission`）。
- 不能在背景執行：切到別的 App 或鎖螢幕，相機與錄影就會停止。
- 儲存空間可能被系統清除（長時間沒有使用時）。請定期匯出 CSV/報告。

### 7. 常見問題與解法

| 症狀 | 原因 | 解法 |
|---|---|---|
| 模型一直載入／`Failed to fetch`、`import` 錯誤 | 用 `file://` 開啟 | 用 Live Server 或 `npx serve` 以 http://localhost 開啟 |
| 相機無法開啟／`NotAllowedError` / `mediaDevices undefined` | 權限被拒，或不是 HTTPS | 用 HTTPS（GitHub Pages / Netlify / ngrok）；在瀏覽器網站設定中允許相機 |
| `404` 找不到 wasm 或 `.task` | CDN 網址或版本號打錯 | 對照上方版本表；WASM 路徑結尾是 `/wasm`，不要加檔名 |
| 手機很慢（< 10 fps）、發燙 | heavy 模型太重 | 設定 → 模型改 `full` 或 `lite`、解析度改 480p；靜態姿勢平均數影響不大 |
| iPhone 畫面黑色 | 缺 `playsinline`／未經使用者點擊 | 已內建 `playsinline muted`；請由按鈕啟動相機，並用 Safari |
| 更新程式後手機還是舊版 | Service worker 快取 | 提高 `sw.js` 的 `CACHE` 版號再部署；必要時關閉 App 再開，或清除網站資料 |
| 背面拍攝左右標反了 | MediaPipe 背面常標錯左右 | 程式在正/背面自動修正（狀態列「左右修正幀」）；前鏡頭左右顛倒時勾選「鏡像修正」 |
| 語音指令沒反應 | iOS/Firefox 不支援，或沒有網路 | 改用「舉手過頭 1.2 秒」手勢，或按鈕操作 |
| 下載的影片是 .webm | 瀏覽器不支援 MP4 MediaRecorder | 用 Safari 或 Chrome 126+；或用 ffmpeg 轉檔：`ffmpeg -i in.webm out.mp4` |

---

## 操作流程

1. **設定**：受測者 ID、身高、體重（預設 65 kg）、模型、鏡頭。
2. **擺放手機**：放在約 1 m 高的腳架上，距受測者約 3 m，直式拍攝。按「感測器鉛垂」讀加速度計。或者在畫面中放一條真的鉛垂線（或門框），按「手動鉛垂」後點線上兩點。
3. 按 **開啟相機**，再按 **開始引導拍攝**。語音會依序引導：**正面 → 右側 → 背面 → 左側**（每次都是「向左轉 90°」）。
4. 每個方向都會自動檢查：全身是否入鏡、與鏡頭距離、是否在中央、朝向是否正確、雙手是否下垂、是否靜止。條件都符合 1 秒後，自動倒數並記錄（預設 5 秒）。
   - 遠距遙控：說「拍照／下一個／重拍／停止／再說一次」，或舉一隻手過頭 1.2 秒來開始倒數。
5. 四個方向完成後自動存檔。**結果**分頁可看：問題姿勢判讀、摘要表、時間序列、左右疊圖、前後測疊圖、多日趨勢，也可以匯出。
6. 第一次（或介入前）的紀錄按「設為 0° 基準」。之後各天的角度都會輸出 Δ（相對基準）。

---

## 生物力學量的計算方法

### 座標與校正
- **影像座標**：x 向右、y 向下（px）。前鏡頭若送出的是鏡像畫面，先左右翻轉回真實方向（鏡像修正）。
- **鉛垂校正**：取得影像中「真正向上」的單位向量 **u**。來源有兩種：加速度計重力向量依螢幕方向旋轉，或手動在鉛垂線上點兩點。偏角 α = atan2(uₓ, −u_y)，所有點繞畫面中心旋轉 −α：x′ = cosα·dx + sinα·dy，y′ = −sinα·dx + cosα·dy。
- **比例尺（身高基準）**：s [m/px] = 0.936 × H / d。H 是身高（m），d 是旋轉後「雙眼中點 → 雙腳跟中點」的鉛垂像素距離，取記錄期間的中位數。眼高 ≈ 0.936 H 引用 Drillis & Contini (1966)。每個方向各自計算，所以受測者前後移動不影響。腳跟看不到時改用「眼睛→腳踝」（0.936 − 0.039 = 0.897 H）；雙腳都不在畫面時，改用 world landmarks 的軀幹長（m）除以像素長（誤差約 10%，CSV 摘要與結果頁會標示 `scale_source`）。原點同理依序退回：右腳跟 → 雙踝中點 → 髖中點。
- **身體座標**：X = σ·(x′ − x₀′)·s，Y = −(y′ − y₀′)·s。原點 (x₀′, y₀′) 是**第一幀（濾波後）右腳跟**。y 軸鉛垂向上。σ 依方向決定：
  - 右側面 σ = +1、左側面 σ = −1，使 **x = 受測者前方**。
  - 正面 σ = −1、背面 σ = +1，使額狀面 **x = 受測者右側**。額狀面上沒有前後方向，所以 x 改用左右。
- **world landmarks**：MediaPipe 輸出以髖中點為原點的公尺座標（x 右、y 下、z 越小越近鏡頭）。CSV 會保留這些原始值，目前只用來估算 3D 足尖外開角（實驗性）。
- **可信度**：visibility < 0.5（可調）的點視為缺值。

### 節段角（相對鉛垂線，°）
θ_seg = atan2(Δx, Δy)，向量方向是「下端（遠端）→ 上端（近端）」，上端偏 +x 為正。
- 矢狀面：上端在前為正。額狀面：上端偏向受測者右側為正。
- 軀幹：髖中點→肩中點。大腿：膝→髖。小腿：踝→膝。上臂：肘→肩。前臂：腕→肘。頭：肩→耳。
- 足部改用**相對水平**：φ_foot = atan2(Δy, Δx)，向量為跟→趾，腳尖上抬為正。等同「相對鉛垂 − 90°」。

### 關節角（解剖學定義：中立站姿 = 0°）
| 變數 | 矢狀面（面向鏡頭那側） | 正值 |
|---|---|---|
| 頸 neck_flex | θ_head − θ_trunk | 頭前傾（屈曲） |
| 肩 shoulder_flex | θ_trunk − θ_upperarm | 屈曲（手臂向前） |
| 肘 elbow_flex | θ_upperarm − θ_forearm | 屈曲 |
| 腕 wrist_flex | θ_forearm − θ_hand（腕→食指） | 手向前偏（投影） |
| 軀幹前傾 trunk_seg | θ_trunk | 前傾 |
| 髖 hip_flex | θ_trunk − θ_thigh | 屈曲；負值 = 伸展 |
| 膝 knee_flex | θ_shank − θ_thigh | 屈曲；負值 = 膝反屈 |
| 踝 ankle_DF | θ_shank + φ_foot | 背屈；負值 = 蹠屈 |

| 變數 | 額狀面（左右兩側；左側乘 −1，使兩側同義） | 正值 |
|---|---|---|
| 肩 shoulder_abd | ±(θ_trunk − θ_upperarm) | 外展 |
| 肘 elbow_valgus | ±(θ_upperarm − θ_forearm) | 外翻（攜帶角，需掌心朝前） |
| 髖 hip_abd | ±(θ_trunk − θ_thigh) | 外展 |
| 膝 knee_valgus（FPPA） | ±(θ_thigh − θ_shank) | 膝外翻（X 型腿）；負 = 膝內翻 |
| 後足 rearfoot_valgus | ±(θ_shank − θ_heel)，θ_heel：跟→踝 | 跟骨外翻（背面才有效） |
| 骨盆傾斜 pelvic_obliquity | atan2(y_Rhip − y_Lhip, x_Rhip − x_Lhip) | 右側高 |
| 肩傾斜、眼線傾斜 | 同上，改用左右肩、左右眼 | 右側高 |

其他：CVA_proxy = 耳—肩連線與水平的夾角（以肩峰代替 C7）；head_pitch = 耳→鼻連線相對水平的角度（抬下巴為正）。所有角度都收斂到 (−180°, 180°]。

### 鉛垂線偏移（cm）
- 矢狀面（Kendall）：以外踝（ankle 點）為基準，計算耳、肩、髖、膝、COM 的 x 差值。正值 = 在外踝前方。另有 ear − shoulder、shoulder − hip。
- 額狀面：以雙踝中點為基準，計算頭、肩中點、髖中點、COM 的側向偏移。正值 = 偏向受測者右側。另有膝間距、踝間距。

### 全身重心 COM（m）
r_COM = Σ mᵢ·rᵢ / Σ mᵢ，節段參數採 Winter (2009) Table 4.1：

| 節段 | 質量比例 | 質心位置（從近端算起的比例） |
|---|---|---|
| 頭頸 | 0.081 | 位於耳 |
| 軀幹 | 0.497 | 0.50（肩中點 → 髖中點） |
| 上臂 | 0.028 | 0.436 |
| 前臂 | 0.016 | 0.430 |
| 手 | 0.006 | 0.506 |
| 大腿 | 0.100 | 0.433 |
| 小腿 | 0.0465 | 0.433 |
| 足 | 0.0145 | 0.50（跟 → 趾） |

### 軌跡、位移、角位移、ROM
- 軌跡：COM、髖中點、右腳跟、頭（耳中點）的 x、y（m），以第一幀右腳跟為原點。
- 線位移：dᵢ = |rᵢ − r₀|（m）。
- 角位移：Δθᵢ = θᵢ − θ_ref（°）。θ_ref 是已設定的 0° 基準平均值；沒有設定時用第一幀。
- ROM = max − min。摘要表另列最大值、最小值、平均，以及最大值與最小值的發生時間。

### 資料處理流程
1. visibility < 閾值 → 設為 NaN。
2. **自然三次樣條**：內插缺值，並重取樣到等間隔 30 Hz（實際幀率可能較低）。超出資料範圍的部分保持最近值，不外插。
3. **置中移動平均**（視窗 5 幀）。
4. **Savitzky–Golay 導數**（視窗 11、二次多項式）：
   - 速度 v = dr/dt（m/s）
   - 加速度 a = d²r/dt²（m/s²）
5. 以體重正規化的淨外力估計（由 COM 加速度換算，屬靜態站姿下的雜訊等級估計，**不是測力板數據**）：
   - N/kg：F/m = a + g（垂直方向）、a（水平方向）
   - BW：F/(m·g)
   - 牛頓：F = m(a + g)，m = 65 kg
6. 原始（未濾波，原始幀時間）與濾波後資料都寫入 CSV。

### 輸出
- **CSV（長格式）**：`subject,date,view,stage,frame,time_s,variable,value`
  - stage = raw / filtered / summary。
  - 變數名稱都帶單位後綴：`_deg _cm _m _mps _mps2 _Nkg _BW _N _px`。
  - 可選擇加入原始 33 點像素座標、visibility 與 world 座標。
- **影片**：疊加骨架的畫面，Safari 與 Chrome 126+ 輸出 MP4，其他瀏覽器輸出 WebM。
- **圖片**：圖表 PNG、快照 JPG。
- **報告**：HTML 報告，可用瀏覽器「列印 → 另存 PDF」。

---

## 限制
- **2D 投影誤差**：單機只能量到投影角度。
  - 額狀面拍攝時，膝與髖的屈伸角會被投影縮短（例如膝屈曲 20° 看起來接近 0°）。額狀面適合分析膝外翻（FPPA）、骨盆與肩的傾斜、側移。
  - 矢狀面拍攝時，旋轉與內收外展會被投影縮短。
  - 受測者沒有正對（或正側對）鏡頭 10° 時，角度誤差可達數度。
- **遮擋**：側面拍攝時，遠側肢體被身體擋住，所以只分析面向鏡頭那一側。背面拍攝時看不到臉，MediaPipe 常把左右標反，程式會自動修正，但仍要確認。
- **鏡頭畸變與透視**：手機廣角鏡頭邊緣有桶狀畸變。人離鏡頭太近時，頭和腳的透視比例不同，會影響身高比例尺與鉛垂偏移。建議距離 ≥ 3 m、鏡頭高度約在髖部、人站在畫面中央。
- **關鍵點偏差**：
  - MediaPipe 的「髖」是推估的髖關節中心，不是 ASIS/PSIS，所以**無法量測骨盆前後傾**。
  - 沒有脊椎標記點，所以**無法量測胸椎後凸與腰椎前凸**。
  - 肩點不是肩峰，耳點不是耳屏，腳跟/腳踝點也只能粗略代表跟骨與外踝。
  - 寬鬆衣物、長髮、背景雜亂都會讓偏差變大。
- **比例尺**：用眼高比例 0.936 只是人群平均值，個體差異約 ±1–2%。腳跟點也略高於地面。
- **力的估計**：由二次微分求得，對雜訊非常敏感，只能當參考，不能取代測力板。
- **判讀閾值**：是研究預設值，請依你的族群與信效度研究調整（設定 → JSON）。結果屬篩檢，不是診斷。
- **語音指令**：Chrome 與 Safari 會把**聲音**送到瀏覽器廠商的雲端辨識（影像不上傳）。若要完全離線，請用手勢或按鈕。

## 驗證準確度的方法
1. **已知長度**：在受測者站立的平面放一支 1 m 尺（或貼兩個相距 1 m 的標記），比較程式換算出的長度與真實長度，求比例尺誤差（%）。同時用身高驗證：程式推得的身高 vs 身高計量測值。
2. **鉛垂/角度模型**：用量角器把一支桿子固定在已知角度（0°、10°、20°、30°），或請受測者在量角器設定的膝角下靜止，比較程式輸出。求 bias 與 95% LoA（Bland–Altman）。
3. **與 Kinovea 比較**：用同一支匯出的 MP4，在 Kinovea 手動標記相同點並量角度，計算 ICC(2,1)、RMSE、Bland–Altman。
4. **與臨床量測比較**：用量角器量 FPPA 與跟骨角、用 Spinal Mouse 或傾斜儀量胸腰曲度、觸診 ASIS/PSIS 高度差，評估問題姿勢判讀的敏感度與特異度。
5. **與 3D 動作擷取或測力板比較**：COM 位置與晃動對照測力板的 COP 平均位置與搖晃軌跡；角度對照 Vicon/Qualisys 等光學系統。
6. **再測信度**：同一受測者同一天重複拍攝 3 次，並在不同日期再拍。計算 ICC(3,k)、SEM、MDC₉₅。MDC 可作為「多日變化是否大於測量誤差」的判斷門檻。
7. **系統設定敏感度**：改變拍攝距離（2/3/4 m）、鏡頭高度、受測者旋轉 ±10°，量化每種設定造成的誤差。
