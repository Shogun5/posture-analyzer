// feedback.js — 使用者回饋（💬 按鈕 → Apps Script → 名冊試算表 Feedback 工作表）與自動錯誤回報（Errors 工作表）
// 不傳受測者姓名與量測數值；只有使用者勾選時才附上目前相機畫面。
import { api } from './auth.js';

/**
 * o: { ver, t, toast, step(): 目前步驟, context(): 環境資訊字串, frame(): 目前相機畫面 dataURL 或 null }
 */
export function initFeedback(o) {
  const dlg = document.getElementById('fbDlg'), form = document.getElementById('fbForm');
  document.getElementById('fbBtn').onclick = () => {
    form.reset();
    const hasFrame = !!o.frame();
    form.elements.attach.disabled = !hasFrame;
    document.getElementById('fbAttachNote').textContent = o.t(hasFrame ? 'fbAttachWarn' : 'fbNoCamera');
    dlg.showModal(); form.elements.text.focus();
  };
  document.getElementById('fbCancel').onclick = () => dlg.close();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const text = form.elements.text.value.trim();
    if (!text) { form.elements.text.focus(); return; }
    const btn = document.getElementById('fbSend'); btn.disabled = true; btn.textContent = o.t('fbSending');
    try {
      await api('feedback', {
        category: form.elements.category.value, text, ver: o.ver, step: o.step(), ctx: o.context(),
        image: form.elements.attach.checked ? o.frame() : '',
      });
      dlg.close(); o.toast(o.t('fbThanks'));
    } catch (err) { o.toast(`${o.t('fbFailed')}${err.message}`); }
    finally { btn.disabled = false; btn.textContent = o.t('fbSend'); }
  });
}

// ---------------- 自動錯誤回報 ----------------
const QKEY = 'pa.errq';
const loadQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } };
const saveQ = q => { try { localStorage.setItem(QKEY, JSON.stringify(q.slice(-30))); } catch { /* ignore */ } };

/** 收集未處理的錯誤；同一訊息每次開啟只記一次；連線時每分鐘送出一批（離線先存在本機） */
export function initErrorReporting({ ver, step }) {
  const seen = new Set();
  const push = (msg, stack) => {
    msg = String(msg || '').slice(0, 500);
    if (!msg || seen.has(msg) || /ResizeObserver loop|Script error\.?$/.test(msg)) return;
    seen.add(msg);
    const q = loadQ(); q.push({ t: Date.now(), msg, stack: String(stack || '').slice(0, 1500), step: step() }); saveQ(q);
  };
  addEventListener('error', e => {
    if (e.filename && !e.filename.startsWith(location.origin) && !/cdn\.jsdelivr\.net/.test(e.filename)) return;   // 瀏覽器外掛的錯誤不收
    push(e.message, e.error?.stack || `${e.filename}:${e.lineno}:${e.colno}`);
  });
  addEventListener('unhandledrejection', e => push(e.reason?.message || e.reason, e.reason?.stack));
  const flush = async () => {
    const q = loadQ(); if (!q.length || !navigator.onLine) return;
    try { await api('errlog', { ver, errors: q }); saveQ(loadQ().slice(q.length)); } catch { /* 下次再送 */ }
  };
  setTimeout(flush, 5000); setInterval(flush, 60000);
  return { report: push };
}
