// ectmodule.js — ECT 互動評估模組：只向 Apps Script 下載（需有效登入），不放在公開的 GitHub
// 下載後存在本機 Cache Storage（ect-module），離線時使用；登出或被停權時清除（見 auth.js）。
import { AUTH } from './config.js';
import { current } from './auth.js';

export const MODULE_CACHE = 'ect-module';
const KEY = './__ect_module__';

async function readCache() {
  try {
    const r = await (await caches.open(MODULE_CACHE)).match(KEY);
    return r ? { html: await r.text(), ver: r.headers.get('x-ver') } : null;
  } catch { return null; }
}
async function writeCache(html, ver) {
  try { await (await caches.open(MODULE_CACHE)).put(KEY, new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'x-ver': ver } })); }
  catch { /* 儲存空間不足等：下次再下載 */ }
}

/** 回傳 { html, source: 'net' | 'cache' | 'offline' }；被拒時丟出帶 reason 的錯誤 */
export async function loadModule() {
  const cached = await readCache();
  let r;
  try {
    const res = await fetch(AUTH.scriptUrl, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'module', session: current()?.session, ver: cached?.ver, ua: navigator.userAgent }),
    });
    r = await res.json();
  } catch (e) {
    if (cached) return { html: cached.html, source: 'offline' };   // 離線：用本機副本
    throw e;
  }
  if (!r.ok) {
    if (r.reason !== 'no_module') { try { await caches.delete(MODULE_CACHE); } catch { /* ignore */ } }
    throw Object.assign(new Error(r.reason), { reason: r.reason });
  }
  if (r.same && cached) return { html: cached.html, source: 'cache' };
  await writeCache(r.html, r.ver);
  return { html: r.html, source: 'net' };
}

/** 原檔沒有 <!doctype>／charset／viewport，放進 iframe 前補上 */
export const wrapModule = html => `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${html}`;
