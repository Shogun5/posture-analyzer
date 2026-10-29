/**
 * 人體姿勢分析器 — 使用者白名單後端（Google Apps Script，綁定在 Google Sheet 上）
 *
 * 部署：擴充功能 → Apps Script → 貼上本檔 → 執行 setup() 一次 → 部署 → 新增部署作業 → 網頁應用程式
 *       執行身分：我；存取權：任何人。把 /exec 網址填到 js/config.js 的 scriptUrl。
 *
 * 工作表：
 *   Users    ：email | name | expires (YYYY-MM-DD，空白=不限) | active (TRUE/FALSE) | note
 *   Log      ：time | email | action | result | userAgent
 *   Requests ：time | email | name   （不在名單內的人嘗試登入時自動記錄，複製到 Users 即可核准）
 *
 * API（POST，Content-Type: text/plain，body 為 JSON）：
 *   { action: 'login', idToken }   → 驗證 Google ID token、比對白名單，回傳 { ok, email, name, session, exp }
 *   { action: 'check', session }   → 驗證 session 簽章並重新比對白名單（可即時停權）
 * 另外 doPost 也接受 Google Identity Services 的「頁面跳轉」登入（form 欄位 credential），
 * 驗證後導回 App：<appUrl>#session=...（iPhone 主畫面 App 彈出視窗不穩時使用）
 */

const CLIENT_ID = '822559901418-kei8as7i6qemq2797dtoqsqb557g2j22.apps.googleusercontent.com';   // 與 js/config.js 相同
const APP_URL = 'https://shogun5.github.io/posture-analyzer/';           // 跳轉登入完成後回到的網址
const SESSION_DAYS = 30;                                                 // 登入有效天數（每次開啟仍會線上複查）

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ensure = (name, header) => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) { sh.appendRow(header); sh.setFrozenRows(1); }
    return sh;
  };
  const users = ensure('Users', ['email', 'name', 'expires', 'active', 'note']);
  ensure('Log', ['time', 'email', 'action', 'result', 'userAgent']);
  ensure('Requests', ['time', 'email', 'name']);
  if (users.getLastRow() === 1) users.appendRow([Session.getActiveUser().getEmail(), 'admin', '', true, '管理者']);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() { return json({ ok: true, service: 'posture-analyzer-auth' }); }

function doPost(e) {
  try {
    // GIS 頁面跳轉登入：表單欄位 credential
    if (e.parameter && e.parameter.credential) {
      const r = login_(e.parameter.credential, 'redirect');
      const target = APP_URL + (r.ok ? '#session=' + encodeURIComponent(r.session) : '#denied=' + encodeURIComponent(r.reason || 'denied'));
      // 自動導回；若瀏覽器擋下自動跳轉，顯示按鈕讓使用者點一下回到 App
      const safe = target.replace(/"/g, '&quot;');
      return HtmlService.createHtmlOutput(
        '<div style="font:18px system-ui;padding:32px;text-align:center">' + (r.ok ? '登入成功 Signed in' : '無法使用 Access denied') +
        '<br><br><a href="' + safe + '" target="_top" style="font-size:20px">回到 App / Back to app</a></div>' +
        '<script>try{window.top.location.replace(' + JSON.stringify(target) + ')}catch(e){}</script>')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.action === 'login') return json(login_(body.idToken, 'login', body.ua));
    if (body.action === 'check') return json(check_(body.session, body.ua));
    return json({ ok: false, reason: 'bad_action' });
  } catch (err) {
    return json({ ok: false, reason: 'error', detail: String(err) });
  }
}

/** 驗證 Google ID token（tokeninfo 端點）→ 比對白名單 → 簽發 session */
function login_(idToken, action, ua) {
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return log_('', action, 'bad_token', ua, { ok: false, reason: 'bad_token' });
  const info = JSON.parse(res.getContentText());
  if (info.aud !== CLIENT_ID) return log_(info.email, action, 'bad_audience', ua, { ok: false, reason: 'bad_token' });
  if (String(info.email_verified) !== 'true') return log_(info.email, action, 'unverified', ua, { ok: false, reason: 'unverified' });
  const email = String(info.email).toLowerCase();
  const user = findUser_(email);
  if (!user) {
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Requests').appendRow([new Date(), email, info.name || '']);
    return log_(email, action, 'not_listed', ua, { ok: false, reason: 'not_listed', email: email });
  }
  if (!user.allowed) return log_(email, action, user.reason, ua, { ok: false, reason: user.reason, email: email });
  const exp = Date.now() + SESSION_DAYS * 864e5;
  return log_(email, action, 'ok', ua, { ok: true, email: email, name: user.name || info.name || '', exp: exp, session: sign_({ email: email, exp: exp }) });
}

/** 驗證 session 簽章與期限，並重新比對白名單（可即時停權） */
function check_(session, ua) {
  const p = verify_(session);
  if (!p) return log_('', 'check', 'bad_session', ua, { ok: false, reason: 'bad_session' });
  if (p.exp < Date.now()) return log_(p.email, 'check', 'session_expired', ua, { ok: false, reason: 'session_expired' });
  const user = findUser_(p.email);
  if (!user || !user.allowed) return log_(p.email, 'check', user ? user.reason : 'not_listed', ua, { ok: false, reason: user ? user.reason : 'not_listed' });
  return log_(p.email, 'check', 'ok', ua, { ok: true, email: p.email, name: user.name, exp: p.exp });
}

function findUser_(email) {
  const rows = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users').getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() !== email) continue;
    const name = rows[i][1], expires = rows[i][2], active = rows[i][3];
    if (active === false || String(active).toUpperCase() === 'FALSE') return { name: name, allowed: false, reason: 'disabled' };
    if (expires) {
      const d = expires instanceof Date ? expires : new Date(expires);
      if (!isNaN(d) && d.getTime() + 864e5 < Date.now()) return { name: name, allowed: false, reason: 'expired' };
    }
    return { name: name, allowed: true };
  }
  return null;
}

function log_(email, action, result, ua, out) {
  try { SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Log').appendRow([new Date(), email, action, result, String(ua || '').slice(0, 200)]); } catch (e) { /* ignore */ }
  return out;
}

// --- session：base64url(JSON) + '.' + base64url(HMAC-SHA256) ---
function b64url_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
function sign_(payload) {
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  const body = b64url_(Utilities.newBlob(JSON.stringify(payload)).getBytes());
  return body + '.' + b64url_(Utilities.computeHmacSha256Signature(body, secret));
}
function verify_(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const parts = token.split('.'), secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (b64url_(Utilities.computeHmacSha256Signature(parts[0], secret)) !== parts[1]) return null;
  const padded = parts[0] + '==='.slice((parts[0].length + 3) % 4);   // 補回 base64 的 = 填充
  try { return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString()); } catch (e) { return null; }
}
