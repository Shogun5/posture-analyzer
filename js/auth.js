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
  const r = await fetch(AUTH.scriptUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, ua: navigator.userAgent }) });
  return r.json();
}

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
export function useRedirectMode(on) { try { on ? localStorage.setItem(MODE_KEY, '1') : localStorage.removeItem(MODE_KEY); } catch { /* ignore */ } location.reload(); }

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
    if (h.get('denied')) ui.show('denied', h.get('denied'));
  }

  const a = current();
  if (a?.session) {
    ui.show('checking');
    try {
      const r = await call({ action: 'check', session: a.session });
      if (r.ok) { save({ ...a, email: r.email, name: r.name, exp: r.exp, checked: Date.now() }); ui.hide(); return r; }
      clear(); ui.show('denied', r.reason);
    } catch (e) {
      // 離線或伺服器連不到：在 session 期限內放行（PWA 離線使用）
      if (a.exp > Date.now()) { ui.hide(); return { ...a, offline: true }; }
      ui.show('error', e.message);
    }
  }

  // 需要登入
  return new Promise(resolve => {
    if (ui.state !== 'denied' && ui.state !== 'error') ui.show('login');   // 被拒時保留原因，但仍顯示登入鈕（可換帳號）
    loadGis().then(() => {
      const redirect = (() => { try { return localStorage.getItem(MODE_KEY) === '1'; } catch { return false; } })();
      google.accounts.id.initialize({
        client_id: AUTH.clientId,
        ux_mode: redirect ? 'redirect' : 'popup',
        ...(redirect ? { login_uri: AUTH.scriptUrl } : {
          callback: async ({ credential }) => {
            ui.show('checking');
            try {
              const r = await call({ action: 'login', idToken: credential });
              if (r.ok) { save({ session: r.session, exp: r.exp, email: r.email, name: r.name, checked: Date.now() }); ui.hide(); resolve(r); }
              else ui.show('denied', r.reason, r.email);
            } catch (e) { ui.show('error', e.message); }
          },
        }),
        auto_select: false,
        itp_support: true,
      });
      google.accounts.id.renderButton(ui.buttonEl, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: ui.lang === 'en' ? 'en' : 'zh-TW' });
    }).catch(e => ui.show('error', e.message));
  });
}
