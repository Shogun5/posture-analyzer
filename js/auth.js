// auth.js — Google 登入 + Google Sheet 白名單（Apps Script 驗證）
// 流程：
//   1. 已有 session：線上 → 送 Apps Script 複查（名單移除/停用/到期即失效）；離線或連不到 → 在期限內放行
//   2. 沒有 session：顯示登入閘門，Google 登入取得 ID token → Apps Script 驗證並比對 Users 工作表 → 簽發 30 天 session
//   3. 頁面跳轉登入（iPhone 主畫面 App 彈出視窗失效時）：Apps Script 驗證後導回 #session=...
// 注意：這是「擋住轉傳連結」等級的保護；靜態網站的程式碼仍可被有心人下載。
import { AUTH } from './config.js';

const KEY = 'pa.auth', MODE_KEY = 'pa.authRedirect';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

export const configured = () => AUTH.enabled && !/^PASTE/.test(AUTH.clientId) && !/^PASTE/.test(AUTH.scriptUrl);
export function current() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
const save = a => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* ignore */ } };
// 清除登入時，一併刪除已下載的講義模組（ectmodule.js 的 Cache Storage），避免共用裝置留下內容
const clear = () => {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  try { caches.delete('ect-module'); } catch { /* ignore */ }
};

async function call(body) {
  // text/plain = 簡單請求，不觸發 CORS 預檢；Apps Script 回應帶 Access-Control-Allow-Origin: *
  // 20 秒逾時：手機網路卡住時不要永遠停在「確認中」
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(AUTH.scriptUrl, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, ua: navigator.userAgent }) });
    return await r.json();
  } catch (e) { throw e.name === 'AbortError' ? new Error('timeout (20 s)') : e; }
  finally { clearTimeout(timer); }
}

// 主畫面 App（standalone）或手機：Google 彈出視窗常開在另一個分頁、結果傳不回來 → 預設用頁面跳轉登入
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
export function redirectMode() {
  let v = null; try { v = localStorage.getItem(MODE_KEY); } catch { /* ignore */ }
  return v === '1' || (v !== '0' && (isStandalone() || isMobile()));
}

// 登入畫面下方的診斷列：版本、模式、步驟、錯誤（使用者截圖回報用）
const diag = { step: 'start', err: '' };
function note(ui, step, err = '') { diag.step = step; if (err) diag.err = err; ui.diag?.(`${redirectMode() ? 'redirect' : 'popup'} · ${isStandalone() ? 'app' : 'browser'} · ${diag.step}${diag.err ? ' · ' + diag.err : ''}`); }

function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true; s.onload = res; s.onerror = () => rej(new Error('Google sign-in script failed to load'));
    document.head.appendChild(s);
  });
}

export function signOut() {
  clear();
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* ignore */ }
  location.reload();
}
export function useRedirectMode(on) { try { localStorage.setItem(MODE_KEY, on ? '1' : '0'); } catch { /* ignore */ } location.reload(); }

/**
 * 通過驗證才 resolve；否則停在閘門畫面。
 * ui: { show(state, detail), hide(), buttonEl, lang }  state ∈ setup/checking/login/denied/error
 */
export async function requireAuth(ui) {
  if (!AUTH.enabled) return { email: null };
  if (!configured()) { ui.show('setup'); return new Promise(() => {}); }

  // 頁面跳轉登入回來：#session=... 或 #denied=...
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.has('session') || h.has('denied')) {
    if (h.get('session')) save({ session: h.get('session'), exp: 0 });
    history.replaceState(null, '', location.pathname + location.search);
    if (h.get('denied')) { note(ui, 'redirect-back', 'denied:' + h.get('denied')); ui.show('denied', h.get('denied')); }
    else note(ui, 'redirect-back');
  }

  const a = current();
  if (a?.session) {
    ui.show('checking'); note(ui, 'checking');
    try {
      const r = await call({ action: 'check', session: a.session });
      if (r.ok) { save({ ...a, email: r.email, name: r.name, exp: r.exp, checked: Date.now() }); ui.hide(); return r; }
      clear(); note(ui, 'check-denied', r.reason); ui.show('denied', r.reason);
    } catch (e) {
      // 離線或伺服器連不到：在 session 期限內放行（PWA 離線使用）
      if (a.exp > Date.now()) { ui.hide(); return { ...a, offline: true }; }
      note(ui, 'check-failed', e.message); ui.show('error', e.message);
    }
  }

  // 主畫面 App 的登入若在另一個 Chrome 分頁完成（同一份 localStorage），這裡收到通知就重新載入
  addEventListener('storage', ev => { if (ev.key === KEY && ev.newValue) location.reload(); });
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && current()?.session) location.reload(); });

  // 需要登入
  return new Promise(resolve => {
    if (ui.state !== 'denied' && ui.state !== 'error') ui.show('login');   // 被拒時保留原因，但仍顯示登入鈕（可換帳號）
    note(ui, 'loading-google');
    loadGis().then(() => {
      const redirect = redirectMode();
      note(ui, 'ready');
      google.accounts.id.initialize({
        client_id: AUTH.clientId,
        ux_mode: redirect ? 'redirect' : 'popup',
        ...(redirect ? { login_uri: AUTH.scriptUrl } : {
          callback: async ({ credential }) => {
            ui.show('checking'); note(ui, 'got-google-token');
            try {
              const r = await call({ action: 'login', idToken: credential });
              if (r.ok) { save({ session: r.session, exp: r.exp, email: r.email, name: r.name, checked: Date.now() }); ui.hide(); resolve(r); }
              else { note(ui, 'login-denied', r.reason); ui.show('denied', r.reason, r.email); }
            } catch (e) { note(ui, 'login-failed', e.message); ui.show('error', e.message); }
          },
        }),
        auto_select: false,
        itp_support: true,
      });
      google.accounts.id.renderButton(ui.buttonEl, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: ui.lang === 'en' ? 'en' : 'zh-TW',
        click_listener: () => note(ui, 'button-clicked') });
    }).catch(e => { note(ui, 'google-load-failed', e.message); ui.show('error', e.message); });
  });
}
