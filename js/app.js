// app.js — 主控制：相機、即時分析迴圈、四方向引導拍攝狀態機、語音/手勢控制、校正、結果/歷史/設定 UI
import { t, v, setLang, getLang } from './i18n.js';
import { createPose, detect, MP_VERSION } from './pose.js';
import { VIEWS, isSag, makeTransform, computeVars, computeCOM, detectView, enforceLR, upFromGravity, processRecording, EYE_HEIGHT_RATIO } from './biomech.js';
import { assessPosture, DEFAULT_THR } from './posture.js';
import { drawOverlay } from './overlay.js';
import { speak, beep, unlockAudio, startListening, stopListening, speechSupported, isSpeaking } from './voice.js';
import { CanvasRecorder } from './recorder.js';
import * as store from './storage.js';
import { timeSeries, trend, chartPNG, summaryTable } from './charts.js';
import { downloadCSV, downloadVideos, download, dataURLtoBlob, reportHTML, KEY_VARS } from './export.js';
import { sgDerivative } from './filters.js';

export const APP_VERSION = '1.0.1'; // 與 sw.js 的 CACHE 版本一起更新

const $ = s => document.querySelector(s);
const fin = Number.isFinite;

// ---------------- 設定 ----------------
const DEF = {
  lang: 'zh', subject: 'S01', height_cm: 170, mass_kg: 65, model: 'heavy', facing: 'environment', res: '720',
  captureSec: 5, countdownSec: 5, visThr: 0.5, mirrorFix: false, autoCapture: true, gesture: true, rawLm: false, thr: DEFAULT_THR,
};
let cfg = loadCfg();
function loadCfg() {
  try { const c = JSON.parse(localStorage.getItem('pa.cfg') || '{}'); return { ...DEF, ...c, thr: { ...DEFAULT_THR, ...(c.thr || {}) } }; }
  catch { return { ...DEF }; }
}
const saveCfg = () => { try { localStorage.setItem('pa.cfg', JSON.stringify(cfg)); } catch { /* private mode */ } };

// ---------------- 狀態 ----------------
const S = {
  pose: null, poseVariant: null, stream: null, looping: false, lastTs: 0, fpsEMA: 0,
  phase: 'idle', guided: false, viewIdx: 0,
  up: [0, -1], plumbMode: 'none', manualPts: null, tilt: NaN,
  liveScale: NaN, hist: [], trails: { COM: [], hipMid: [], R_heel: [], head: [] },
  okSince: 0, lastCue: 0, readyAnnounced: false, gestureSince: 0,
  countdownEnd: 0, lastCount: -1, recFrames: [], recStart: 0, snapTaken: false, recorder: null,
  session: null, viewSession: null, compare: null, baseline: null, voiceOn: false,
};
const canvas = $('#stage'), ctx = canvas.getContext('2d', { willReadFrequently: false }), video = $('#video');
const curView = () => VIEWS[S.viewIdx];

function newSession() {
  return { id: `${Date.now()}`, subject: cfg.subject, date: new Date().toISOString(), height_m: cfg.height_cm / 100, mass_kg: cfg.mass_kg,
    model: cfg.model, plumbMode: S.plumbMode, up: S.up, views: {} };
}

function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2200); }
const say = (key, opts) => speak(v(key), opts);

// ---------------- 相機 ----------------
async function startCamera() {
  unlockAudio();
  if (!window.isSecureContext) { toast(t('needHttps')); return; }
  try {
    S.stream?.getTracks().forEach(tr => tr.stop());
    const h = +cfg.res;
    const constraints = mode => ({
      audio: false,
      video: { facingMode: { [mode]: cfg.facing }, height: { ideal: h }, width: { ideal: Math.round(h * 16 / 9) }, frameRate: { ideal: 30, max: 30 } },
    });
    // 先要求指定鏡頭（exact）；只有一顆鏡頭的裝置（筆電）退回 ideal
    try { S.stream = await navigator.mediaDevices.getUserMedia(constraints('exact')); }
    catch (e) { if (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError') throw e; S.stream = await navigator.mediaDevices.getUserMedia(constraints('ideal')); }
    video.srcObject = S.stream;
    video.setAttribute('playsinline', ''); video.muted = true;    // iOS 必要
    await video.play();
    await ensureModel();
    $('#guideBtn').disabled = false; $('#capBtn').disabled = false;
    if (!S.looping) { S.looping = true; requestAnimationFrame(loop); }
  } catch (e) { toast(t('camErr') + e.message); console.error(e); }
}
async function ensureModel() {
  if (S.pose && S.poseVariant === cfg.model) return;
  $('#msg').textContent = t('loadingModel');
  S.pose?.close?.();
  S.pose = await createPose(cfg.model);
  S.poseVariant = cfg.model;
  $('#msg').textContent = '';
  toast(t('modelReady'));
}

// ---------------- 主迴圈（~30 fps） ----------------
function loop(now) {
  if (!S.looping) return;
  requestAnimationFrame(loop);
  if (now - S.lastTs < 1000 / 31 || video.readyState < 2) return;
  const dt = now - S.lastTs; S.lastTs = now;
  S.fpsEMA = S.fpsEMA ? S.fpsEMA * 0.9 + 100 / dt : 1000 / dt;

  const W = video.videoWidth, H = video.videoHeight;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  // 前鏡頭鏡像修正：把鏡像來源翻回真實左右，再送進模型
  ctx.save();
  if (cfg.mirrorFix) { ctx.translate(W, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, W, H);
  ctx.restore();
  if (!S.pose) return;

  let det = null;
  try { det = detect(S.pose, canvas, now); } catch (e) { console.warn(e); }
  const view = curView();
  const detView = det ? detectView(det.norm) : null;
  let lm = det?.lm ?? null, swapped = false;
  if (lm) ({ lm, swapped } = enforceLR(lm, view));

  // 即時變數（比例尺以本幀身高估計，EMA 平滑）
  let vars = null, comPx = null;
  if (lm) {
    const tf0 = makeTransform({ W, H, up: S.up, view });
    const eyeY = (tf0.rot(...lm[2])[1] + tf0.rot(...lm[5])[1]) / 2, heelY = (tf0.rot(...lm[29])[1] + tf0.rot(...lm[30])[1]) / 2;
    const sc = EYE_HEIGHT_RATIO * cfg.height_cm / 100 / (heelY - eyeY);
    if (sc > 0) S.liveScale = fin(S.liveScale) ? S.liveScale * 0.9 + sc * 0.1 : sc;
    const tf = makeTransform({ W, H, up: S.up, scale: S.liveScale, origin: tf0.rot(lm[30][0], lm[30][1]), view });
    const P = lm.map(p => tf.toBody(p[0], p[1]));
    vars = computeVars(P, view, det.wlm);
    comPx = computeCOM(lm.map(p => [p[0], p[1]]));
    const push = (k, p) => { const a = S.trails[k]; a.push(p); if (a.length > 45) a.shift(); };
    push('COM', comPx); push('hipMid', [(lm[23][0] + lm[24][0]) / 2, (lm[23][1] + lm[24][1]) / 2]); push('R_heel', [lm[30][0], lm[30][1]]);
    push('head', [(lm[7][0] + lm[8][0]) / 2, (lm[7][1] + lm[8][1]) / 2]);
    S.hist.push({ t: now, n: det.norm }); if (S.hist.length > 30) S.hist.shift();
  } else { S.hist = []; }

  // COM 速度（SG 一階導數，最近 11 幀）
  let vel = null;
  const tr = S.trails.COM;
  if (tr.length >= 11) {
    const xs = tr.slice(-11), dtS = 1 / Math.max(5, S.fpsEMA);
    const vx = sgDerivative(xs.map(p => p[0]), dtS, 11, 2, 1), vy = sgDerivative(xs.map(p => p[1]), dtS, 11, 2, 1);
    vel = { p: tr[tr.length - 1], v: [vx[10], vy[10]] };
  }

  stepStateMachine(now, det, detView, lm);

  // 記錄
  if (S.phase === 'record' && det) S.recFrames.push({ t: now / 1000, lm, wlm: det.wlm, swapped });

  const panel = [];
  if (vars) for (const k of KEY_VARS[view].slice(0, 9)) if (fin(vars[k])) panel.push([k.replace(/_(deg|cm|m)$/, ''), `${vars[k].toFixed(1)}${k.endsWith('_deg') ? '°' : k.endsWith('_cm') ? 'cm' : 'm'}`]);
  let banner = '';
  if (S.phase === 'countdown') banner = String(Math.max(0, Math.ceil((S.countdownEnd - now) / 1000)));
  if (S.phase === 'record') banner = `● ${((now - S.recStart) / 1000).toFixed(1)} s`;
  drawOverlay(ctx, { lm, view, up: S.up, scale: S.liveScale, vars, trails: S.trails, vel, height_m: cfg.height_cm / 100, visThr: cfg.visThr, panel, banner });

  // 快照：記錄中段
  if (S.phase === 'record' && !S.snapTaken && now - S.recStart > cfg.captureSec * 500) {
    S.snapTaken = true; S.snapshot = canvas.toDataURL('image/jpeg', 0.85);
  }
  if (S.phase === 'record' && now - S.recStart >= cfg.captureSec * 1000) finishRecording();
  renderStatus(detView);
}

// ---------------- 對位檢查 ----------------
function alignmentCue(det, detView) {
  if (!det) return 'noPerson';
  const n = det.norm, view = curView(), thr = cfg.visThr;
  const visKey = [11, 12, 23, 24, 25, 26, 27, 28].reduce((s, i) => s + n[i][3], 0) / 8;
  const shY = (n[11][1] + n[12][1]) / 2, top = n[0][1] - (shY - n[0][1]) * 0.9;
  const bottom = Math.max(n[29][1], n[30][1], n[27][1], n[28][1]);
  if (top < 0.01 || bottom > 0.99 || visKey < thr) return 'backUp';
  if (bottom - top < 0.45) return 'comeCloser';
  const cx = (n[23][0] + n[24][0]) / 2;
  if (cx < 0.25 || cx > 0.75) return 'center';
  if (detView !== view) return `turn_${view}`;
  // 雙手自然下垂（手腕低於髖部上方）
  const wrists = isSag(view) ? [view === 'right' ? 16 : 15] : [15, 16];
  if (wrists.some(i => n[i][1] < Math.min(n[23][1], n[24][1]) - 0.03)) return 'arms';
  // 靜止：最近 0.5 s 髖中點位移
  const h = S.hist.slice(-15);
  if (h.length < 10) return 'still';
  const xs = h.map(e => (e.n[23][0] + e.n[24][0]) / 2), ys = h.map(e => (e.n[23][1] + e.n[24][1]) / 2);
  if (Math.max(...xs) - Math.min(...xs) > 0.012 || Math.max(...ys) - Math.min(...ys) > 0.012) return 'still';
  return null;
}
// 舉手手勢：任一手腕高於鼻子持續 1.2 s
function gestureFired(det, now) {
  if (!cfg.gesture || !det) { S.gestureSince = 0; return false; }
  const n = det.norm, up = [15, 16].some(i => n[i][3] > 0.5 && n[i][1] < n[0][1]);
  if (!up) { S.gestureSince = 0; return false; }
  if (!S.gestureSince) S.gestureSince = now;
  if (now - S.gestureSince > 1200) { S.gestureSince = 0; return true; }
  return false;
}

// ---------------- 狀態機 ----------------
function setPhase(p) { S.phase = p; renderChips(); }

function enterAlign() {
  setPhase('align'); S.okSince = 0; S.readyAnnounced = false; S.lastCue = performance.now() + 3000;
  say(`view_${curView()}`, { interrupt: true });
}

function stepStateMachine(now, det, detView) {
  if (S.phase === 'align' || S.phase === 'idle') {
    if (gestureFired(det, now) && S.phase === 'align') { say('lowerArm', { interrupt: true }); startCountdown(Math.max(cfg.countdownSec, 4)); return; }
  }
  if (S.phase === 'align') {
    const cue = S.gestureSince ? null : alignmentCue(det, detView);
    $('#msg').textContent = cue ? v(cue) : '✓';
    if (cue) {
      S.okSince = 0;
      if (now - S.lastCue > 3500 && !isSpeaking()) { say(cue); S.lastCue = now; }
    } else {
      S.okSince ||= now;
      if (now - S.okSince > 1000) {
        if (cfg.autoCapture) { say('readyAuto', { interrupt: true }); startCountdown(cfg.countdownSec); }
        else if (!S.readyAnnounced) { S.readyAnnounced = true; say('readyManual'); }
      }
    }
  } else if (S.phase === 'countdown') {
    const left = Math.ceil((S.countdownEnd - now) / 1000);
    if (left !== S.lastCount && left > 0) { S.lastCount = left; beep(660, 120); speak(v('nums')[left] ?? String(left)); }
    if (now >= S.countdownEnd) startRecording(now);
  }
}

function startCountdown(sec = cfg.countdownSec) {
  if (!S.pose || S.phase === 'record') return;
  S.session ??= newSession();
  S.countdownEnd = performance.now() + sec * 1000; S.lastCount = -1;
  setPhase('countdown');
}

function startRecording(now) {
  beep(1046, 300);
  say('recording', { interrupt: true });
  S.recFrames = []; S.recStart = now; S.snapTaken = false; S.snapshot = null;
  S.recorder = new CanvasRecorder(canvas, 30);
  S.recorder.start();
  setPhase('record');
  $('#msg').textContent = '';
}

async function finishRecording() {
  setPhase('done');
  const view = curView();
  const clip = await S.recorder?.stop();
  const frames = S.recFrames;
  if (frames.length < 5) { toast('Too few frames'); enterAlign(); return; }
  const baseline = S.baseline?.views?.[view] ?? null;
  const result = processRecording(frames, {
    view, W: canvas.width, H: canvas.height, up: S.up, height_m: cfg.height_cm / 100, mass_kg: cfg.mass_kg, visThr: cfg.visThr, baseline,
  });
  const flags = assessPosture(result.summary, view, cfg.thr);
  S.session.views[view] = { result, flags, snapshot: S.snapshot, video: clip };
  S.session.plumbMode = S.plumbMode; S.session.up = S.up;
  S.viewSession = S.session;
  beep(880, 120); say('viewDone', { interrupt: true });
  const nFlags = flags.filter(f => f.sev !== 'info').length;
  toast(`${t('view_' + view)} ✓  ${t('flags')}: ${nFlags}`);
  renderResults(view);

  if (S.guided) {
    const next = VIEWS.findIndex((vw, i) => i > S.viewIdx && !S.session.views[vw]);
    if (next >= 0) { S.viewIdx = next; setTimeout(enterAlign, 1500); }
    else { S.guided = false; setPhase('idle'); say('allDone'); await saveCurrent(true); }
  } else setPhase('idle');
}

// 指令（語音/按鈕共用）
function command(cmd) {
  if (cmd === 'capture') { if (S.phase === 'align' || S.phase === 'idle') startCountdown(); }
  else if (cmd === 'next') { S.viewIdx = (S.viewIdx + 1) % 4; if (S.guided) enterAlign(); else renderChips(); }
  else if (cmd === 'retake') { if (S.phase !== 'record') { S.guided = true; enterAlign(); } }
  else if (cmd === 'stop') { S.guided = false; S.recorder?.stop(); setPhase('idle'); speechSynthesis.cancel(); $('#msg').textContent = ''; }
  else if (cmd === 'repeat') say(`view_${curView()}`, { interrupt: true });
}

// ---------------- 鉛垂校正 ----------------
async function plumbSensor() {
  try {
    if (typeof DeviceMotionEvent?.requestPermission === 'function') { // iOS 13+ 需使用者授權
      if (await DeviceMotionEvent.requestPermission() !== 'granted') { toast('motion permission denied'); return; }
    }
  } catch (e) { console.warn(e); }
  const acc = [];
  const h = e => { const g = e.accelerationIncludingGravity; if (g && fin(g.x)) acc.push([g.x, g.y]); };
  window.addEventListener('devicemotion', h);
  setTimeout(() => {
    window.removeEventListener('devicemotion', h);
    if (acc.length < 5) { toast('No motion sensor (desktop?)'); return; }
    const ax = acc.reduce((s, a) => s + a[0], 0) / acc.length, ay = acc.reduce((s, a) => s + a[1], 0) / acc.length;
    const ang = screen.orientation?.angle ?? window.orientation ?? 0;
    S.up = upFromGravity(ax, ay, ang, cfg.facing === 'user' ? -1 : 1);
    S.plumbMode = 'sensor';
    toast(`${t('plumbStatus')}: ${(Math.atan2(S.up[0], -S.up[1]) * 180 / Math.PI).toFixed(2)}°`);
  }, 1000);
}
// 持續顯示手機傾斜（協助把手機擺正）
window.addEventListener('devicemotion', e => {
  const g = e.accelerationIncludingGravity;
  if (g && fin(g.x) && fin(g.y)) S.tilt = Math.atan2(g.x, Math.abs(g.y)) * 180 / Math.PI;
});
function plumbManual() { S.manualPts = []; toast(t('tapPlumb1')); }
canvas.addEventListener('click', e => {
  if (!S.manualPts) return;
  const r = canvas.getBoundingClientRect();
  S.manualPts.push([(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height]);
  if (S.manualPts.length === 1) { toast(t('tapPlumb2')); return; }
  let [a, b] = S.manualPts; if (a[1] > b[1]) [a, b] = [b, a];  // a = 上方點
  const dx = a[0] - b[0], dy = a[1] - b[1], n = Math.hypot(dx, dy);
  if (n > 20) { S.up = [dx / n, dy / n]; S.plumbMode = 'manual'; toast(`${t('plumbStatus')}: ${(Math.atan2(S.up[0], -S.up[1]) * 180 / Math.PI).toFixed(2)}°`); }
  S.manualPts = null;
});

// ---------------- UI：狀態列與方向 ----------------
function renderChips() {
  $('#viewChips').innerHTML = VIEWS.map((vw, i) => `<button class="chip ${i === S.viewIdx ? 'cur' : ''} ${S.session?.views?.[vw] ? 'done' : ''}" data-i="${i}">${t('view_' + vw)}</button>`).join('');
}
$('#viewChips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; S.viewIdx = +b.dataset.i; renderChips(); if (S.phase === 'align') enterAlign(); });

let lastStatus = 0;
function renderStatus(detView) {
  const now = performance.now(); if (now - lastStatus < 250) return; lastStatus = now;
  const alpha = Math.atan2(S.up[0], -S.up[1]) * 180 / Math.PI;
  $('#status').textContent = [
    `${t('phase_' + S.phase)} · ${t('view_' + curView())}`, `${t('detected')}: ${detView ? t('view_' + detView) : '-'}`,
    `${S.fpsEMA.toFixed(0)} fps`, `${t('plumbStatus')}: ${t(S.plumbMode)} ${alpha.toFixed(1)}°`,
    `${t('scale')}: ${fin(S.liveScale) ? (S.liveScale * 1000).toFixed(2) + ' mm/px' : '-'}`,
    `${t('baseline')}: ${S.baseline ? t('set') : t('notSet')}`, fin(S.tilt) ? `${t('level')}: ${S.tilt.toFixed(1)}°` : '',
  ].filter(Boolean).join(' | ');
}

// ---------------- 結果頁 ----------------
const unitOf = n => (n.endsWith('_deg') ? '°' : n.endsWith('_cm') ? 'cm' : n.endsWith('_mps2') ? 'm/s²' : n.endsWith('_mps') ? 'm/s' : n.endsWith('_Nkg') ? 'N/kg' : n.endsWith('_BW') ? 'BW' : n.endsWith('_N') ? 'N' : n.endsWith('_m') ? 'm' : '');
const mirrorName = n => (n.startsWith('R_') ? 'L_' + n.slice(2) : n.startsWith('L_') ? 'R_' + n.slice(2) : null);

function renderResults(preferView) {
  const s = S.viewSession;
  const sel = $('#resView');
  const avail = VIEWS.filter(vw => s?.views?.[vw]?.result);
  if (!avail.length) { $('#resInfo').textContent = t('noSession'); $('#flags').innerHTML = ''; $('#summary').innerHTML = ''; $('#snapshot').removeAttribute('src'); return; }
  const cur = preferView && avail.includes(preferView) ? preferView : avail.includes(sel.value) ? sel.value : avail[0];
  sel.innerHTML = avail.map(vw => `<option value="${vw}" ${vw === cur ? 'selected' : ''}>${t('view_' + vw)}</option>`).join('');
  const V = s.views[cur], r = V.result;
  const vs = $('#resVar'), prev = vs.value;
  const names = Object.keys(r.filt).sort((a, b) => (KEY_VARS[cur].includes(b) - KEY_VARS[cur].includes(a)) || a.localeCompare(b));
  vs.innerHTML = names.map(n => `<option ${n === prev ? 'selected' : ''}>${n}</option>`).join('');
  $('#snapshot').src = V.snapshot || '';
  $('#resInfo').textContent = `${s.subject} · ${new Date(s.date).toLocaleString()} · ${t('qc')}: ${t('fps')} ${r.qc.fps.toFixed(1)}, ${t('validPct')} ${r.qc.validPct_keypoints}%, ${t('swapped')} ${r.qc.swappedFrames}${S.baseline ? ' · ' + t('deltaNote') : ''}`;
  const lang = getLang();
  $('#flags').innerHTML = V.flags.length ? V.flags.map(f => `<div class="flag ${f.sev}"><b>${lang === 'en' ? f.en : f.zh}</b>${fin(f.value) ? `${t('value')}: ${f.value.toFixed(1)} ${f.unit} (${t('threshold')} ${f.thr}) · ${t(f.sev)} · ` : ''}${t('slides')} ${f.slides}<br><small>${lang === 'en' ? f.tipEn : f.tipZh}</small></div>`).join('') : `<p>${t('noFlags')}</p>`;
  const rows = KEY_VARS[cur].filter(n => r.summary[n]).map(n => ({ name: n, s: r.summary[n] }));
  $('#summary').innerHTML = summaryTable(rows);
  drawChart();
}

async function drawChart() {
  const s = S.viewSession; if (!s) return;
  const view = $('#resView').value, name = $('#resVar').value, mode = $('#resCmp').value;
  const r = s.views?.[view]?.result; if (!r || !name) return;
  const cv = $('#chart'), unit = unitOf(name);
  if (mode === 'trend') {
    const all = (await store.listSessions()).filter(x => x.subject === s.subject && x.views?.[view]?.result?.summary?.[name]);
    const base = S.baseline?.views?.[view]?.[name];
    const pts = all.map(x => ({ date: x.date.slice(0, 10), y: x.views[view].result.summary[name].mean - (fin(base) && name.endsWith('_deg') ? base : 0) }));
    trend(cv, name, pts, `${name}${fin(base) ? ' Δ' : ''} (${unit})`);
    return;
  }
  const series = [{ label: `${name} (filtered)`, t: r.t, y: r.filt[name] }];
  if (mode === 'none' && r.raw[name]) series.push({ label: `${name} (raw)`, t: r.tRaw, y: r.raw[name], dash: true });
  if (mode === 'lr') { const m = mirrorName(name); if (m && r.filt[m]) series.push({ label: m, t: r.t, y: r.filt[m] }); }
  if (mode === 'session') {
    const c = S.compare?.views?.[view]?.result;
    if (c?.filt[name]) series.push({ label: `${name} (${S.compare.date.slice(0, 10)})`, t: c.t, y: c.filt[name], dash: true });
    else toast(t('btnCompare'));
  }
  timeSeries(cv, series, `${name} (${unit})`);
}
['#resView', '#resVar', '#resCmp'].forEach(id => $(id).addEventListener('change', () => (id === '#resView' ? renderResults($('#resView').value) : drawChart())));

// ---------------- 儲存 / 基準 / 匯出 ----------------
async function saveCurrent(silent) {
  if (!S.session || !Object.keys(S.session.views).length) { toast(t('noSession')); return; }
  await store.saveSession(S.session);
  if (!silent) toast(t('saved')); else toast(`${t('saved')} ✓`);
  renderHistory();
}
$('#saveBtn').onclick = () => { if (S.viewSession && S.viewSession !== S.session) store.saveSession(S.viewSession).then(() => toast(t('saved'))); else saveCurrent(); };
$('#baselineBtn').onclick = async () => {
  const s = S.viewSession; if (!s) return toast(t('noSession'));
  const views = {};
  for (const vw of VIEWS) { const r = s.views?.[vw]?.result; if (!r) continue; views[vw] = Object.fromEntries(Object.entries(r.summary).map(([k, st]) => [k, st.mean])); }
  S.baseline = { subject: s.subject, date: s.date, views };
  await store.saveBaseline(S.baseline); toast(`${t('baseline')}: ${t('set')}`);
};
$('#clearBaselineBtn').onclick = async () => { await store.deleteBaseline(cfg.subject); S.baseline = null; toast(`${t('baseline')}: ${t('notSet')}`); };
$('#csvBtn').onclick = () => (S.viewSession ? downloadCSV(S.viewSession, cfg.rawLm) : toast(t('noSession')));
$('#videoBtn').onclick = () => (S.viewSession ? downloadVideos(S.viewSession) : toast(t('noSession')));
$('#pngBtn').onclick = async () => { const u = chartPNG($('#chart')); if (u) download(await dataURLtoBlob(u), `chart_${$('#resVar').value}.png`); };
$('#snapBtn').onclick = async () => { const u = $('#snapshot').src; if (u) download(await dataURLtoBlob(u), `snapshot_${$('#resView').value}.jpg`); };
$('#reportBtn').onclick = () => {
  const s = S.viewSession; if (!s) return toast(t('noSession'));
  const imgs = []; const u = chartPNG($('#chart')); if (u) imgs.push(u);
  const html = reportHTML(s, imgs, S.compare, S.baseline?.views ?? null);
  const blob = new Blob([html], { type: 'text/html' });
  download(blob, `report_${s.subject}_${s.date.slice(0, 10)}.html`);
  const w = window.open(URL.createObjectURL(blob), '_blank'); // 開新分頁 → 列印 → 另存 PDF
  if (!w) toast('HTML downloaded');
};

// ---------------- 歷史 ----------------
async function renderHistory() {
  const list = (await store.listSessions()).reverse();
  $('#historyList').innerHTML = list.length ? list.map(s => `<div class="hist"><div><b>${s.subject}</b> · ${new Date(s.date).toLocaleString()}<br><small>${VIEWS.filter(vw => s.views?.[vw]).map(vw => t('view_' + vw)).join('、')}</small></div>
    <div class="btns small"><button data-act="load" data-id="${s.id}">${t('btnLoad')}</button><button data-act="cmp" data-id="${s.id}">${t('btnCompare')}</button><button data-act="del" data-id="${s.id}">${t('btnDelete')}</button></div></div>`).join('') : `<p class="hint">${t('noSession')}</p>`;
}
$('#historyList').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const s = await store.getSession(b.dataset.id); if (!s) return;
  if (b.dataset.act === 'load') { S.viewSession = s; S.baseline = (await store.getBaseline(s.subject)) ?? null; showTab('results'); renderResults(); }
  if (b.dataset.act === 'cmp') { S.compare = s; toast(`${t('btnCompare')}: ${s.date.slice(0, 10)}`); }
  if (b.dataset.act === 'del' && confirm(t('confirmDelete'))) { await store.deleteSession(s.id); toast(t('deleted')); renderHistory(); }
});

// ---------------- 設定 ----------------
function fillSettings() {
  const f = $('#settingsForm');
  for (const [k, val] of Object.entries(cfg)) {
    const el = f.elements[k]; if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!val; else if (k === 'thr') el.value = JSON.stringify(val, null, 2); else el.value = val;
  }
}
$('#settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, old = { ...cfg };
  for (const el of f.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') cfg[el.name] = el.checked;
    else if (el.name === 'thr') { try { cfg.thr = { ...DEFAULT_THR, ...JSON.parse(el.value) }; } catch { toast('JSON error'); return; } }
    else if (el.type === 'number') cfg[el.name] = +el.value;
    else cfg[el.name] = el.value;
  }
  saveCfg(); applyLang();
  if (old.subject !== cfg.subject) S.baseline = (await store.getBaseline(cfg.subject)) ?? null;
  if (S.session && !Object.keys(S.session.views).length) S.session = null;
  if (S.stream && (old.facing !== cfg.facing || old.res !== cfg.res)) startCamera();
  else if (S.stream && old.model !== cfg.model) ensureModel();
  toast(t('saved'));
});
$('#resetThrBtn').onclick = () => { $('#settingsForm').elements.thr.value = JSON.stringify(DEFAULT_THR, null, 2); };

// ---------------- 分頁、語言、按鈕 ----------------
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === `tab-${name}`));
  if (name === 'results') renderResults(); if (name === 'history') renderHistory();
}
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
function applyLang() {
  setLang(cfg.lang);
  $('#langBtn').textContent = cfg.lang === 'zh' ? 'EN' : '中文';
  $('#voiceBtn').textContent = t(S.voiceOn ? 'btnVoiceOn' : 'btnVoiceOff');
  renderChips();
  if (S.voiceOn) { stopListening(); startVoice(); }
}
$('#langBtn').onclick = () => { cfg.lang = cfg.lang === 'zh' ? 'en' : 'zh'; saveCfg(); applyLang(); fillSettings(); };
$('#camBtn').onclick = startCamera;
// 前/後鏡頭切換：存入設定；相機已開則立即重啟。鉛垂校正與鏡頭方向有關，切換後需重新校正
$('#flipBtn').onclick = () => {
  if (S.phase === 'record' || S.phase === 'countdown') return;
  cfg.facing = cfg.facing === 'user' ? 'environment' : 'user';
  saveCfg(); fillSettings();
  if (S.plumbMode !== 'none') { S.up = [0, -1]; S.plumbMode = 'none'; }
  S.liveScale = NaN; Object.values(S.trails).forEach(a => (a.length = 0));
  toast(`${t('camera')}: ${t(cfg.facing === 'user' ? 'camFront' : 'camBack')}`);
  if (S.stream) startCamera();
};
$('#guideBtn').onclick = () => {
  unlockAudio();
  S.session = newSession(); S.guided = true; S.viewIdx = 0;
  say('intro', { interrupt: true });
  setTimeout(enterAlign, 4500);
};
$('#capBtn').onclick = () => { unlockAudio(); startCountdown(); };
$('#nextBtn').onclick = () => command('next');
$('#retakeBtn').onclick = () => command('retake');
$('#stopBtn').onclick = () => command('stop');
$('#plumbSensorBtn').onclick = plumbSensor;
$('#plumbManualBtn').onclick = plumbManual;
$('#plumbResetBtn').onclick = () => { S.up = [0, -1]; S.plumbMode = 'none'; };
function startVoice() {
  return startListening(cmd => { toast(`🎤 ${cmd}`); command(cmd); }, txt => { $('#heard').textContent = t('liveVoiceHeard') + txt; });
}
$('#voiceBtn').onclick = () => {
  if (!speechSupported()) { toast(t('speechUnsupported')); return; }
  S.voiceOn = !S.voiceOn;
  if (S.voiceOn) startVoice(); else stopListening();
  $('#voiceBtn').textContent = t(S.voiceOn ? 'btnVoiceOn' : 'btnVoiceOff');
};

// ---------------- 啟動 ----------------
(async function init() {
  applyLang(); fillSettings();
  $('#verInfo').textContent = `v${APP_VERSION} · MediaPipe tasks-vision ${MP_VERSION} · Chart.js ${window.Chart?.version ?? '?'}`;
  S.baseline = (await store.getBaseline(cfg.subject).catch(() => null)) ?? null;
  store.requestPersist();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // 註冊 service worker；有新版時自動啟用並重新整理
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('New version — reloading…'); });
      });
    }).catch(e => console.warn('SW', e));
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }
  if (location.protocol === 'file:') toast(t('needHttps'));
  renderHistory();
})();
