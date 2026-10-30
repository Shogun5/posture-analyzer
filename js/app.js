// app.js — 主控制：相機、即時分析迴圈、四方向引導拍攝狀態機、語音/手勢控制、校正、結果/歷史/設定 UI
import { t, v, setLang, getLang } from './i18n.js';
import { createPose, detect, MP_VERSION } from './pose.js';
import { VIEWS, isSag, makeTransform, computeVars, computeCOM, detectView, enforceLR, upFromGravity, processRecording, EYE_HEIGHT_RATIO } from './biomech.js';
import { assessPosture, DEFAULT_THR } from './posture.js';
import { drawOverlay } from './overlay.js';
import { speak, beep, unlockAudio, startListening, stopListening, speechSupported, isSpeaking } from './voice.js';
import { CanvasRecorder } from './recorder.js';
import * as store from './storage.js';
import { timeSeries, trend, chartPNG } from './charts.js';
import { downloadCSV, downloadVideos, download, dataURLtoBlob, reportHTML, KEY_VARS } from './export.js';
import { sgDerivative } from './filters.js';
import { MOVES, BASE_SEC, timeline, demoValueAt, cueText, analyzeRom, asymmetry } from './rom.js';
import { createDemo } from './romdemo.js';
import { requireAuth, signOut, useRedirectMode, redirectMode } from './auth.js';
import { loadModule, wrapModule } from './ectmodule.js';
import { renderPhoto, composeBoard, meanSDTable, varLabel } from './posturecard.js';

export const APP_VERSION = '1.4.1'; // 與 sw.js 的 CACHE 版本一起更新

const $ = s => document.querySelector(s);
const fin = Number.isFinite;

// ---------------- 設定 ----------------
const DEF = {
  lang: 'zh', subject: 'S01', height_cm: 170, mass_kg: 65, model: 'heavy', facing: 'environment', res: '720',
  captureSec: 5, countdownSec: 5, visThr: 0.5, mirrorFix: false, autoCapture: true, gesture: true, rawLm: false, thr: DEFAULT_THR,
  delegate: 'GPU', videoFmt: 'auto',
};
let cfg = loadCfg();
function loadCfg() {
  try { const c = JSON.parse(localStorage.getItem('pa.cfg') || '{}'); return { ...DEF, ...c, thr: { ...DEFAULT_THR, ...(c.thr || {}) } }; }
  catch { return { ...DEF }; }
}
const saveCfg = () => { try { localStorage.setItem('pa.cfg', JSON.stringify(cfg)); } catch { /* private mode */ } };

// ---------------- 當機追蹤（breadcrumb） ----------------
// 每個高風險步驟前記下目前階段；正常關閉頁面時記為 closed。
// 下次開啟若上次停在某階段（瀏覽器分頁當機不會觸發 pagehide），就顯示階段並自動改用較安全的設定。
// 記錄開始被細分：rec_audio（嗶聲+語音）→ rec_recorder（啟動錄影器）→ rec_running（錄影中逐幀）→ rec_snapshot（快照）
const CRASH_STAGES = ['camera', 'model', 'live', 'countdown', 'record', 'rec_audio', 'rec_recorder', 'rec_running', 'rec_snapshot', 'process', 'results', 'save'];
function crumb(stage, extra = {}) {
  try { localStorage.setItem('pa.crumb', JSON.stringify({ stage, t: Date.now(), delegate: cfg.delegate, videoFmt: cfg.videoFmt, model: cfg.model, ...extra })); } catch { /* ignore */ }
}
addEventListener('pagehide', () => crumb('closed'));
function recoverFromCrash() {
  let c = null;
  try { c = JSON.parse(localStorage.getItem('pa.crumb') || 'null'); } catch { /* ignore */ }
  if (!c || !CRASH_STAGES.includes(c.stage)) return null;
  const fixes = [];
  const stepDownVideo = () => {
    // 錄影編碼器當機：MP4(H.264) → WebM → 不錄影
    if (cfg.videoFmt === 'auto' || cfg.videoFmt === 'mp4') { cfg.videoFmt = 'webm'; fixes.push('video → WebM'); return true; }
    if (cfg.videoFmt === 'webm') { cfg.videoFmt = 'none'; fixes.push('video → off'); return true; }
    return false;
  };
  const toCPU = () => { if (cfg.delegate === 'GPU') { cfg.delegate = 'CPU'; fixes.push('GPU → CPU'); } };
  if (c.stage === 'rec_audio') { cfg.quietRec = true; fixes.push('record voice/beep → off'); }
  else if (c.stage === 'rec_snapshot') { cfg.noSnapshot = true; fixes.push('snapshot → off'); }
  else if (['record', 'rec_recorder', 'rec_running'].includes(c.stage)) { if (!stepDownVideo()) toCPU(); }
  else if (['model', 'live', 'countdown'].includes(c.stage)) toCPU();            // WebGL/GPU 推論當機
  saveCfg();
  const info = { ...c, fixes, at: new Date(c.t).toLocaleString() };
  try { localStorage.setItem('pa.lastCrash', JSON.stringify(info)); } catch { /* ignore */ }
  crumb('idle');
  return info;
}

// ---------------- 狀態 ----------------
const S = {
  pose: null, poseVariant: null, stream: null, looping: false, lastTs: 0, fpsEMA: 0,
  phase: 'idle', guided: false, viewIdx: 0, mode: 'posture', rom: null,
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
  if (!S.user) return;          // 未通過登入驗證不得開啟相機
  unlockAudio();
  if (!window.isSecureContext) { toast(t('needHttps')); return; }
  try {
    S.stream?.getTracks().forEach(tr => tr.stop());
    crumb('camera');
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
    $('#guideBtn').disabled = false; $('#capBtn').disabled = false; $('#romBtn').disabled = false;
    crumb('live');
    if (!S.looping) { S.looping = true; requestAnimationFrame(loop); }
    setCamButton(true);
  } catch (e) { crumb('idle'); toast(t('camErr') + e.message); console.error(e); }
}

/** 關閉相機：中止進行中的拍攝/ROM 測試、停止串流與分析迴圈、清空畫面（已完成的結果保留） */
function stopCamera() {
  if (S.mode === 'rom') romCommand('stop'); else if (S.phase !== 'idle') command('stop');
  S.looping = false;
  S.stream?.getTracks().forEach(tr => tr.stop());   // 釋放相機（瀏覽器的相機指示燈會熄滅）
  S.stream = null; video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  S.hist = []; Object.values(S.trails).forEach(a => (a.length = 0)); S.liveScale = NaN;
  $('#guideBtn').disabled = true; $('#capBtn').disabled = true; $('#romBtn').disabled = true;
  $('#msg').textContent = ''; $('#status').textContent = t('cameraOff');
  crumb('idle');
  setCamButton(false);
}
function setCamButton(on) {
  const b = $('#camBtn');
  b.dataset.i18n = on ? 'btnCameraOff' : 'btnCamera';
  b.textContent = t(b.dataset.i18n);
  b.classList.toggle('primary', !on); b.classList.toggle('danger', on);
}
async function ensureModel() {
  const key = `${cfg.model}/${cfg.delegate}`;
  if (S.pose && S.poseVariant === key) return;
  crumb('model');
  $('#msg').textContent = t('loadingModel');
  S.pose?.close?.();
  S.pose = await createPose(cfg.model, cfg.delegate);
  S.poseVariant = key;
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
  // 不需鏡像修正時直接把 video 交給模型（MediaPipe 的標準用法）；需要時才用翻轉後的畫布
  try { det = detect(S.pose, cfg.mirrorFix ? canvas : video, now, W, H); } catch (e) { console.warn(e); }
  const view = S.mode === 'rom' ? romMove().view : curView();
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

  if (S.mode === 'rom') stepRom(now, det, detView, vars); else stepStateMachine(now, det, detView, lm);

  // 記錄
  if (S.phase === 'record' && det) S.recFrames.push({ t: now / 1000, lm, wlm: det.wlm, swapped });

  const panel = [];
  if (S.mode === 'rom') panel.push(...romPanel());
  else if (vars && !S.voiceOn) for (const k of KEY_VARS[view].filter(n => n !== 'COM_disp_m').slice(0, 9)) if (fin(vars[k])) panel.push([varLabel(k, view).replace(/（.*$/, '').slice(0, 10), `${vars[k].toFixed(1)}${k.endsWith('_deg') ? '°' : 'cm'}`]);
  let banner = '';
  if (S.phase === 'countdown') banner = String(Math.max(0, Math.ceil((S.countdownEnd - now) / 1000)));
  if (S.phase === 'record') banner = `REC ${((now - S.recStart) / 1000).toFixed(1)} s`;
  drawOverlay(ctx, { lm, view, up: S.up, scale: S.liveScale, vars, trails: S.trails, vel, height_m: cfg.height_cm / 100, visThr: cfg.visThr, panel, banner });
  if (S.phase === 'record' && !S.runningMarked) { S.runningMarked = true; crumb('rec_running'); }

  // 快照：記錄中段（姿勢模式；ROM 模式在口令「停住」結束時拍）
  if (S.mode !== 'rom' && S.phase === 'record' && !S.snapTaken && lm && now - S.recStart > cfg.captureSec * 500) {
    S.snapTaken = true;
    // 結果照片：存「未疊圖」的原始影格 + 該幀關鍵點，結果頁再裁切人物並標註（語言切換時可重畫）
    if (!cfg.noSnapshot && lm) {
      crumb('rec_snapshot');
      const off = document.createElement('canvas'); off.width = W; off.height = H;
      const oc = off.getContext('2d');
      if (cfg.mirrorFix) { oc.translate(W, 0); oc.scale(-1, 1); }
      oc.drawImage(video, 0, 0, W, H);
      S.photo = { img: off.toDataURL('image/jpeg', 0.88), lm: lm.map(p => [...p]), W, H, up: [...S.up] };
      crumb('rec_running');
    }
  }
  if (S.mode !== 'rom' && S.phase === 'record' && now - S.recStart >= cfg.captureSec * 1000) finishRecording();
  renderStatus(detView);
}

// ---------------- 對位檢查 ----------------
// 回傳語音提示的 key（null = 對位完成）。提示都以「受測者自己的方向」表達，一人操作時不必看螢幕也能調整
const VIEW_YAW = { front: 0, right: 90, back: 180, left: -90 };
const wrapDeg = a => ((a + 540) % 360) - 180;
function bodyYaw(w) {
  // world landmarks：x 影像右、z 越小越近鏡頭。面向鏡頭 0°、每向左轉 90° 加 90°（右側面 90、背面 180、左側面 −90）
  if (!w) return NaN;
  const pair = (l, r) => Math.atan2(w[l][2] - w[r][2], w[l][0] - w[r][0]) * 180 / Math.PI;
  const a = pair(11, 12), b = pair(23, 24);
  return Math.atan2(Math.sin(a * Math.PI / 180) + Math.sin(b * Math.PI / 180), Math.cos(a * Math.PI / 180) + Math.cos(b * Math.PI / 180)) * 180 / Math.PI;
}
function alignmentCue(det, detView) {
  if (!det) return 'noPerson';
  const n = det.norm, view = curView(), thr = cfg.visThr;
  const feetVis = Math.max(...[27, 28, 29, 30].map(i => n[i][3]));
  const shY = (n[11][1] + n[12][1]) / 2, top = n[0][1] - (shY - n[0][1]) * 0.9;
  const bottom = Math.max(n[29][1], n[30][1], n[27][1], n[28][1]);
  // 出界只看位置（腳的可信度在遠處常偏低，不能拿來判斷「太近」，否則會一下叫前進一下叫後退）
  const headCut = top < 0.005, feetCut = bottom > 0.985 || (feetVis < 0.2 && bottom > 0.9);
  if (headCut && feetCut) return 'backUp';
  if (headCut) return bottom < 0.9 ? 'camUp' : 'backUp';
  if (feetCut) return top > 0.1 ? 'camDown' : 'backUp';
  // 距離：可接受範圍放寬（人高佔畫面 40%–98%），避免前後來回
  if (bottom - top < 0.4) return 'comeCloser';
  // 左右置中：換算成受測者自己的方向（正面時影像右 = 受測者左；背面相反；側面為前後）
  const cx = (n[23][0] + n[24][0]) / 2;
  if (cx < 0.3 || cx > 0.7) {
    const toImgRight = cx < 0.5;
    return { front: toImgRight ? 'moveLeft' : 'moveRight', back: toImgRight ? 'moveRight' : 'moveLeft',
      right: toImgRight ? 'moveFwd' : 'moveBwd', left: toImgRight ? 'moveBwd' : 'moveFwd' }[view];
  }
  // 方向：正/背面只要求「正對或背對」（臉沒偵測到時正面常被誤判為背面，左右由 enforceLR 修正）；
  // 側面才分左右。若同一個轉身提示持續 6 秒仍不符，視為偵測誤差直接放行
  const planeOK = detView && isSag(detView) === isSag(view);
  const dirOK = planeOK && (!isSag(view) || detView === view);
  if (!dirOK) {
    S.turnSince ||= performance.now();
    if (!planeOK || performance.now() - S.turnSince < 6000) return `turn_${view}`;
  } else S.turnSince = 0;
  // 細部轉向：身體朝向與目標差 20–60°（> 60° 多半是背面左右標反，不採用）；同一提示超過 8 秒就放行
  const yaw = bodyYaw(det.wlm);
  if (fin(yaw)) {
    S.yaw = fin(S.yaw) ? S.yaw + 0.2 * wrapDeg(yaw - S.yaw) : yaw;
    const d = wrapDeg(S.yaw - VIEW_YAW[view]);
    if (Math.abs(d) > 20 && Math.abs(d) < 60) {
      S.fineSince ||= performance.now();
      if (performance.now() - S.fineSince < 8000) return d > 0 ? 'turnRightBit' : 'turnLeftBit';
    } else S.fineSince = 0;
  }
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
  setPhase('align'); S.okSince = 0; S.readyAnnounced = false; S.lastCue = performance.now() + 3000; S.yaw = NaN; S.fineSince = 0; S.turnSince = 0;
  say(`view_${curView()}`, { interrupt: true });
}

function stepStateMachine(now, det, detView) {
  if (S.phase === 'align' || S.phase === 'idle') {
    if (gestureFired(det, now) && S.phase === 'align') { say('lowerArm', { interrupt: true }); startCountdown(Math.max(cfg.countdownSec, 4)); return; }
  }
  if (S.phase === 'align') {
    const cue = S.gestureSince ? null : alignmentCue(det, detView);
    // 一人操作（語音模式）：大字顯示「目前方向＋要做的調整」
    $('#msg').textContent = S.voiceOn ? `${t('view_' + curView())}\n${cue ? v(cue) : '✓ ' + t('holdStill')}` : (cue ? v(cue) : '✓');
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
  crumb('countdown');
  setPhase('countdown');
}

function startRecording(now) {
  crumb('rec_audio');
  if (!cfg.quietRec) { beep(1046, 300); say('recording', { interrupt: true }); }
  S.recFrames = []; S.recStart = now; S.snapTaken = false; S.snapshot = null; S.runningMarked = false;
  S.recorder = new CanvasRecorder(canvas, 30, cfg.videoFmt);
  crumb('rec_recorder', { mime: S.recorder.mime });
  try { S.recorder.start(); } catch (e) { console.warn('recorder', e); S.recorder = null; } // 錄影失敗仍繼續記錄關鍵點
  setPhase('record');
  $('#msg').textContent = '';
}

async function finishRecording() {
  setPhase('done');
  const view = curView();
  let clip = null;
  try { clip = await S.recorder?.stop(); } catch (e) { console.warn(e); }
  crumb('process');
  const frames = S.recFrames;
  if (frames.length < 5) { toast('Too few frames'); crumb('live'); enterAlign(); return; }
  const baseline = S.baseline?.views?.[view] ?? null;
  let result;
  try {
    result = processRecording(frames, {
      view, W: canvas.width, H: canvas.height, up: S.up, height_m: cfg.height_cm / 100, mass_kg: cfg.mass_kg, visThr: cfg.visThr, baseline,
    });
  } catch (e) { console.error(e); toast(`Analysis error: ${e.message}`); crumb('live'); setPhase('idle'); return; }
  crumb('results');
  const flags = assessPosture(result.summary, view, cfg.thr);
  S.session.views[view] = { result, flags, photo: S.photo, video: clip };
  S.photo = null;
  S.session.plumbMode = S.plumbMode; S.session.up = S.up;
  S.viewSession = S.session;
  beep(880, 120); speak(`${v('view_' + view).split(/[，。,.]/)[0]}${getLang() === 'en' ? '. ' : ''}${v('viewDone')}`, { interrupt: true });
  const nFlags = flags.filter(f => f.sev !== 'info').length;
  toast(`${t('view_' + view)} ✓  ${t('flags')}: ${nFlags}`);
  // 腳不在畫面：比例尺/原點改用替代方法，下肢與鉛垂偏移指標無法計算 → 畫面與語音提醒
  if (result.qc.feetVisiblePct < 50) { $('#msg').textContent = t('feetMissing'); say('backUp'); }
  renderResults(view);
  crumb('live');

  if (S.guided) {
    const next = VIEWS.findIndex((vw, i) => i > S.viewIdx && !S.session.views[vw]);
    if (next >= 0) {
      S.viewIdx = next; renderChips();
      if (S.voiceOn) $('#msg').textContent = `${t('view_' + view)} ✓\n${t('nextView')}${t('view_' + VIEWS[next])}`;
      setTimeout(() => { if (S.guided && S.phase === 'done') enterAlign(); }, 1800);
    }
    else { S.guided = false; setPhase('idle'); say('allDone'); $('#msg').textContent = S.voiceOn ? t('allDoneShort') : ''; await saveCurrent(true); showTab('results'); }
  } else setPhase('idle');
}

// ---------------- ROM 測試 ----------------
// 流程（每個動作）：intro（語音說明 + 示範動畫循環）→ align（朝向、相關關節入鏡、靜止）
//   → countdown 3 s → record（口令時間軸 + 示範同步；開始 1.5 s 為 0° 基準）→ 分析 → 下一個動作
const romDemo = createDemo($('#romDemo'));
const romMove = () => S.rom.list[S.rom.idx];
const romName = m => (getLang() === 'en' ? m.en : m.zh);
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;

function startRomTest() {
  unlockAudio();
  if (!S.pose) { toast(t('cameraOff')); return; }
  const list = MOVES.filter(m => !cfg.romSel || cfg.romSel.includes(m.id));
  if (!list.length) { toast(t('romNone')); showTab('rom'); return; }
  S.mode = 'rom'; S.guided = false;
  S.session = newSession(); S.session.rom = {};
  S.rom = { list, idx: 0, phaseStart: 0, cueIdx: 0, live: {}, snaps: {} };
  $('#romDemo').toggleAttribute('hidden', false); // SVG 元素沒有 .hidden 屬性
  speak(v('romIntro'), { interrupt: true });
  enterRomIntro(true);
}
function enterRomIntro(queue = false) {
  const m = romMove();
  S.viewIdx = VIEWS.indexOf(m.view);
  setPhase('intro'); S.rom.phaseStart = performance.now();
  const intro = getLang() === 'en' ? m.introEn : m.introZh;
  speak(`${S.rom.idx + 1}. ${romName(m)}。${intro}`, { interrupt: !queue });
}
function endRomTest(completed) {
  S.mode = 'posture'; setPhase('idle'); $('#romDemo').toggleAttribute('hidden', true); $('#msg').textContent = '';
  if (completed) say('romAllDone');
  if (S.session?.rom && Object.keys(S.session.rom).length) { saveCurrent(true); renderRom(); if (completed) showTab('rom'); }
}
// 對位：方向正確、此動作相關的關鍵點都入鏡、身體靜止
function romAlignCue(det, detView, m) {
  if (!det) return 'noPerson';
  const n = det.norm;
  if (m.lm.some(i => n[i][3] < cfg.visThr || n[i][0] < 0.01 || n[i][0] > 0.99 || n[i][1] < 0.01 || n[i][1] > 0.99)) return 'backUp';
  if (detView !== m.view) return `turn_${m.view}`;
  const h = S.hist.slice(-15);
  if (h.length < 10) return 'still';
  const xs = h.map(e => (e.n[23][0] + e.n[24][0]) / 2), ys = h.map(e => (e.n[23][1] + e.n[24][1]) / 2);
  if (Math.max(...xs) - Math.min(...xs) > 0.015 || Math.max(...ys) - Math.min(...ys) > 0.015) return 'still';
  return null;
}
function stepRom(now, det, detView, vars) {
  const m = romMove(), lang = getLang(), { keys, duration } = timeline(m);
  let demoT = ((now - S.rom.phaseStart) / 1000) % duration;   // intro/align：示範動畫循環播放
  if (S.phase === 'intro') {
    if (now - S.rom.phaseStart > 2500 && !isSpeaking()) { setPhase('align'); S.okSince = 0; S.lastCue = now; }
  } else if (S.phase === 'align') {
    const cue = romAlignCue(det, detView, m);
    $('#msg').textContent = cue ? v(cue) : '✓';
    if (cue) { S.okSince = 0; if (now - S.lastCue > 3500 && !isSpeaking()) { say(cue); S.lastCue = now; } }
    else { S.okSince ||= now; if (now - S.okSince > 800) { S.countdownEnd = now + 3000; S.lastCount = -1; crumb('countdown'); setPhase('countdown'); } }
  } else if (S.phase === 'countdown') {
    demoT = 0;
    const left = Math.ceil((S.countdownEnd - now) / 1000);
    if (left !== S.lastCount && left > 0) { S.lastCount = left; beep(660, 120); speak(v('nums')[left]); }
    if (now >= S.countdownEnd) startRomRecording(now);
  } else if (S.phase === 'record') {
    const el = (now - S.recStart) / 1000;
    demoT = el;                                                  // 示範動畫與口令同步
    while (S.rom.cueIdx < keys.length && keys[S.rom.cueIdx].t <= el) {
      const k = keys[S.rom.cueIdx++];
      if (!k.cue) continue;
      const txt = cueText(m, k.cue, lang);
      speak(txt, { interrupt: true }); $('#msg').textContent = txt;
      if (k.cue === 'back') romSnap('pos'); else if (k.cue === 'back2') romSnap('neg');
    }
    // 即時角度（相對開始 1.5 s 的靜態基準）
    for (const vd of m.vars) {
      const x = vars?.[vd.name]; if (!fin(x)) continue;
      const val = (vd.sign ?? 1) * x, L = (S.rom.live[vd.name] ??= { base: [], cur: NaN, max: -Infinity, min: Infinity });
      if (el < BASE_SEC) L.base.push(val);
      L.cur = val - (L.base.length ? avg(L.base) : val);
      if (el >= BASE_SEC) { L.max = Math.max(L.max, L.cur); L.min = Math.min(L.min, L.cur); }
    }
    if (el >= duration) finishRomRecording();
  } else if (S.phase === 'done') demoT = 0;
  const dv = demoValueAt(m, demoT);
  romDemo.render(m.view, m.demo(dv), m, `${S.rom.idx + 1}/${S.rom.list.length}  ${romName(m)}`, m.arcs.map(() => dv));
}
function romPanel() {
  if (!S.rom) return [];
  const m = romMove(), rows = [[`${S.rom.idx + 1}/${S.rom.list.length}`, romName(m)]];
  for (const vd of m.vars) {
    const L = S.rom.live[vd.name];
    const f = x => (fin(x) ? `${x.toFixed(0)}°` : '–');
    rows.push([`${vd.side || ''} ${getLang() === 'en' ? 'now' : '目前'}`, f(L?.cur)], [`${vd.side || ''} max / min`, `${f(L?.max)} / ${f(L?.min)}`]);
  }
  return rows;
}
function romSnap(key) {
  if (cfg.noSnapshot) return;
  crumb('rec_snapshot'); S.rom.snaps[key] = canvas.toDataURL('image/jpeg', 0.8); crumb('rec_running');
}
function startRomRecording(now) {
  crumb('rec_audio');
  if (!cfg.quietRec) beep(1046, 250);
  S.recFrames = []; S.recStart = now; S.rom.cueIdx = 0; S.rom.live = {}; S.rom.snaps = {}; S.runningMarked = false;
  S.recorder = new CanvasRecorder(canvas, 30, cfg.videoFmt);
  crumb('rec_recorder', { mime: S.recorder.mime });
  try { S.recorder.start(); } catch (e) { console.warn('recorder', e); S.recorder = null; }
  setPhase('record');
}
async function finishRomRecording() {
  setPhase('done');
  const m = romMove();
  let clip = null;
  try { clip = await S.recorder?.stop(); } catch (e) { console.warn(e); }
  crumb('process');
  if (S.recFrames.length >= 10) {
    try {
      const res = analyzeRom(m, S.recFrames, { W: canvas.width, H: canvas.height, up: S.up, height_m: cfg.height_cm / 100, mass_kg: cfg.mass_kg, visThr: cfg.visThr });
      res.snapshots = S.rom.snaps; res.video = clip; res.date = new Date().toISOString();
      S.session.rom[m.id] = res; S.viewSession = S.session;
      // 語音報告結果，例如「右肩 屈曲 165 度，伸展 48 度」
      const parts = Object.values(res.metrics).map(mt => {
        const side = mt.side === 'R' ? t('right') : mt.side === 'L' ? t('left') : '';
        const p = getLang() === 'en' ? m.pos.en : m.pos.zh, n = m.neg ? (getLang() === 'en' ? m.neg.en : m.neg.zh) : '';
        return `${side} ${p} ${fin(mt.pos) ? Math.round(mt.pos) : '-'} ${v('deg')}${m.neg ? `，${n} ${fin(mt.neg) ? Math.round(-mt.neg) : '-'} ${v('deg')}` : ''}`;
      });
      speak(parts.join('；'), { interrupt: true });
      renderRom();
    } catch (e) { console.error(e); toast(`ROM error: ${e.message}`); }
  } else toast('Too few frames');
  crumb('live');
  S.rom.idx++;
  if (S.mode !== 'rom') return;                       // 使用者已停止
  if (S.rom.idx < S.rom.list.length) setTimeout(() => { if (S.mode === 'rom') enterRomIntro(true); }, 1500);
  else endRomTest(true);
}
function romCommand(cmd) {
  if (cmd === 'capture') { if (S.phase === 'intro' || S.phase === 'align') { S.countdownEnd = performance.now() + 3000; S.lastCount = -1; setPhase('countdown'); } }
  else if (cmd === 'next') { if (S.phase === 'record') return; S.rom.idx++; if (S.rom.idx < S.rom.list.length) enterRomIntro(); else endRomTest(true); }
  else if (cmd === 'retake') {
    if (S.phase === 'record') return;
    // 剛做完下一個動作的說明階段（6 秒內）→ 回到上一個動作重做
    if (S.phase === 'intro' && S.rom.idx > 0 && performance.now() - S.rom.phaseStart < 6000) S.rom.idx--;
    enterRomIntro();
  }
  else if (cmd === 'stop') { S.recorder?.stop(); speechSynthesis.cancel(); endRomTest(false); }
  else if (cmd === 'repeat') enterRomIntro();
}

// 指令（語音/按鈕共用）
function command(cmd) {
  if (S.mode === 'rom') { romCommand(cmd); return; }
  if (cmd === 'capture') {
    // 語音模式 = 一人操作：說「開始」就進入引導拍攝，從目前方向開始，每面拍完自動換到下一面
    if (S.voiceOn && !S.guided && S.phase === 'idle' && S.stream) {
      S.guided = true;
      if (!S.session || VIEWS.every(vw => S.session.views[vw])) { S.session = newSession(); S.viewIdx = 0; }
      const todo = VIEWS.findIndex((vw, i) => i >= S.viewIdx && !S.session.views[vw]);
      S.viewIdx = todo >= 0 ? todo : VIEWS.findIndex(vw => !S.session.views[vw]);
      enterAlign();
    } else if (S.phase === 'align' || S.phase === 'idle') startCountdown();
  }
  else if (cmd === 'next') { S.viewIdx = (S.viewIdx + 1) % 4; if (S.guided) enterAlign(); else renderChips(); }
  else if (cmd === 'retake') { if (S.phase !== 'record') { S.guided = true; enterAlign(); } }
  else if (cmd === 'stop') { S.guided = false; S.recorder?.stop(); setPhase('idle'); if (S.stream) crumb('live'); speechSynthesis.cancel(); $('#msg').textContent = ''; }
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
  if (!avail.length) { $('#resInfo').textContent = t('noSession'); $('#board').innerHTML = ''; return; }
  // 進階圖表的選單（變數以中文名稱顯示）
  const cur = preferView && avail.includes(preferView) ? preferView : avail.includes(sel.value) ? sel.value : avail[0];
  sel.innerHTML = avail.map(vw => `<option value="${vw}" ${vw === cur ? 'selected' : ''}>${t('view_' + vw)}</option>`).join('');
  const r = s.views[cur].result;
  const vs = $('#resVar'), prev = vs.value;
  const names = Object.keys(r.filt).sort((a, b) => (KEY_VARS[cur].includes(b) - KEY_VARS[cur].includes(a)) || a.localeCompare(b));
  // 預設選第一個有數值的變數（沿用上次選擇，除非它整段都是缺值）
  const hasData = n => fin(r.summary[n]?.mean);
  const pick = names.includes(prev) && hasData(prev) ? prev : names.find(hasData) ?? names[0];
  vs.innerHTML = names.map(n => `<option value="${n}" ${n === pick ? 'selected' : ''}>${varLabel(n, cur)}</option>`).join('');
  const feetLow = avail.filter(vw => s.views[vw].result.qc.feetVisiblePct < 50).map(vw => t('view_' + vw));
  $('#resInfo').textContent = `${s.subject} · ${new Date(s.date).toLocaleString()} · ${t('resNote')}${S.baseline ? ' · ' + t('deltaNote') : ''}${feetLow.length ? ` · ⚠ ${feetLow.join('、')}：${t('feetMissing')}` : ''}`;
  renderBoard(s);
  drawChart();
}

// 四面姿勢照片卡片：照片（裁切人物＋標註）、問題姿勢、平均 ± SD
const photoCache = new Map();   // `${session.id}|${view}|${lang}` → canvas
async function photoCanvas(s, vw) {
  const V = s.views?.[vw]; if (!V?.photo) return null;
  const key = `${s.id}|${vw}|${getLang()}`;
  if (!photoCache.has(key)) photoCache.set(key, await renderPhoto(V.photo, vw, V.result, V.flags, { title: `${t('view_' + vw)} · ${s.subject}`, visThr: cfg.visThr }));
  return photoCache.get(key);
}
let boardToken = 0;
async function renderBoard(s) {
  const token = ++boardToken, lang = getLang();
  $('#board').innerHTML = VIEWS.map(vw => {
    const V = s.views?.[vw];
    if (!V?.result) return `<div class="pcard"><h3>${t('view_' + vw)}</h3><div class="empty">${t('notCaptured')}</div></div>`;
    const flags = V.flags || [];
    const fl = flags.filter(f => f.sev !== 'info'), info = flags.filter(f => f.sev === 'info');
    const tip = f => (lang === 'en' ? f.tipEn : f.tipZh);
    const flagHtml = (fl.length ? fl.map(f => `<div class="flag ${f.sev}"><b>${lang === 'en' ? f.en : f.zh}</b>${fin(f.value) ? `${t('value')} ${Math.abs(f.value).toFixed(1)} ${f.unit}（${t('threshold')} ${Math.abs(f.thr)}）· ${t(f.sev)} · ` : ''}${t('slides')} ${f.slides}${tip(f) ? `<br><small>${tip(f)}</small>` : ''}</div>`).join('') : `<p>${t('noFlags')}</p>`)
      + info.map(f => `<div class="flag info">${lang === 'en' ? f.en : f.zh}</div>`).join('');
    const img = V.photo ? `<img data-view="${vw}" alt="${t('view_' + vw)}">` : V.snapshot ? `<img src="${V.snapshot}" alt="${t('view_' + vw)}">` : `<div class="empty">${t('noPhoto')}</div>`;
    return `<div class="pcard"><h3>${t('view_' + vw)}</h3>${img}<h4>${t('flags')}</h4>${flagHtml}<h4>${t('postureTable')}</h4><div class="scroll">${meanSDTable(V.result, vw, flags, S.baseline?.views?.[vw] ?? null)}</div></div>`;
  }).join('');
  for (const vw of VIEWS) {
    const el = $(`#board img[data-view="${vw}"]`); if (!el) continue;
    try { const cv = await photoCanvas(s, vw); if (token !== boardToken) return; if (cv) el.src = cv.toDataURL('image/jpeg', 0.9); }
    catch (e) { console.warn('photo', e); }
  }
}
// 點照片：全螢幕原尺寸檢視（手機上標註字較小時可放大、捲動），再點一下關閉
$('#board').addEventListener('click', e => {
  const im = e.target.closest('.pcard img'); if (!im?.src) return;
  const box = document.createElement('div'); box.className = 'lightbox';
  box.innerHTML = `<img src="${im.src}" alt="">`;
  box.onclick = () => box.remove();
  document.body.appendChild(box);
});

async function drawChart() {
  const s = S.viewSession; if (!s) return;
  const view = $('#resView').value, name = $('#resVar').value, mode = $('#resCmp').value;
  const r = s.views?.[view]?.result; if (!r || !name) return;
  const cv = $('#chart'), unit = unitOf(name), lbl = varLabel(name, view);
  if (mode === 'trend') {
    const all = (await store.listSessions()).filter(x => x.subject === s.subject && x.views?.[view]?.result?.summary?.[name]);
    const base = S.baseline?.views?.[view]?.[name];
    const pts = all.map(x => ({ date: x.date.slice(0, 10), y: x.views[view].result.summary[name].mean - (fin(base) && name.endsWith('_deg') ? base : 0) }));
    trend(cv, lbl, pts, `${lbl}${fin(base) ? ' Δ' : ''} (${unit})`);
    return;
  }
  const series = [{ label: `${lbl}`, t: r.t, y: r.filt[name] }];
  if (mode === 'none' && r.raw[name]) series.push({ label: `${lbl} (raw)`, t: r.tRaw, y: r.raw[name], dash: true });
  if (mode === 'lr') { const m = mirrorName(name); if (m && r.filt[m]) series.push({ label: varLabel(m, view), t: r.t, y: r.filt[m] }); }
  if (mode === 'session') {
    const c = S.compare?.views?.[view]?.result;
    if (c?.filt[name]) series.push({ label: `${lbl} (${S.compare.date.slice(0, 10)})`, t: c.t, y: c.filt[name], dash: true });
    else toast(t('btnCompare'));
  }
  timeSeries(cv, series, `${lbl} (${unit})`);
}
['#resView', '#resVar', '#resCmp'].forEach(id => $(id).addEventListener('change', () => (id === '#resView' ? renderResults($('#resView').value) : drawChart())));

// ---------------- 儲存 / 基準 / 匯出 ----------------
async function saveCurrent(silent) {
  if (!S.session || (!Object.keys(S.session.views).length && !Object.keys(S.session.rom || {}).length)) { toast(t('noSession')); return; }
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
// 四面照片合成一張 PNG（2×2）
$('#boardBtn').onclick = async () => {
  const s = S.viewSession; if (!s) return toast(t('noSession'));
  const cvs = []; for (const vw of VIEWS) cvs.push(await photoCanvas(s, vw).catch(() => null));
  const board = composeBoard(cvs); if (!board) return toast(t('noPhoto'));
  download(await dataURLtoBlob(board.toDataURL('image/jpeg', 0.92)), `posture_${s.subject}_${s.date.slice(0, 10)}.jpg`);
};
$('#reportBtn').onclick = async () => {
  const s = S.viewSession; if (!s) return toast(t('noSession'));
  const w = window.open('', '_blank');          // 先開分頁（在點擊當下，避免被擋），照片畫好後再填入
  const photos = {};
  for (const vw of VIEWS) { const cv = await photoCanvas(s, vw).catch(() => null); if (cv) photos[vw] = cv.toDataURL('image/jpeg', 0.88); }
  const html = reportHTML(s, photos, S.compare, S.baseline?.views ?? null);
  const blob = new Blob([html], { type: 'text/html' });
  download(blob, `report_${s.subject}_${s.date.slice(0, 10)}.html`);
  if (w) w.location.href = URL.createObjectURL(blob);   // 新分頁 → 列印 → 另存 PDF
  else toast('HTML downloaded');
};

// ---------------- ROM 分頁 ----------------
function renderRomChecklist() {
  const sel = cfg.romSel ?? MOVES.map(m => m.id);
  let html = '', lastView = '';
  for (const m of MOVES) {
    if (m.view !== lastView) { lastView = m.view; html += `<h4>${t('view_' + m.view)}</h4>`; }
    const norms = `${getLang() === 'en' ? m.pos.en : m.pos.zh} ${m.pos.norm}°${m.neg ? ` / ${getLang() === 'en' ? m.neg.en : m.neg.zh} ${m.neg.norm}°` : ''}`;
    html += `<label><input type="checkbox" data-id="${m.id}" ${sel.includes(m.id) ? 'checked' : ''}><span>${romName(m)} <small class="hint">(${norms})</small></span></label>`;
  }
  $('#romChecklist').innerHTML = html;
}
$('#romChecklist').addEventListener('change', () => {
  cfg.romSel = [...document.querySelectorAll('#romChecklist input:checked')].map(i => i.dataset.id); saveCfg();
});
$('#romAllBtn').onclick = () => { cfg.romSel = MOVES.map(m => m.id); saveCfg(); renderRomChecklist(); };
$('#romNoneBtn').onclick = () => { cfg.romSel = []; saveCfg(); renderRomChecklist(); };

function renderRom() {
  const s = S.viewSession, R = s?.rom, C = S.compare?.rom;
  const ids = R ? MOVES.map(m => m.id).filter(id => R[id]) : [];
  if (!ids.length) { $('#romInfo').textContent = t('romNone'); $('#romTable').innerHTML = ''; $('#romAsym').innerHTML = ''; $('#romSnaps').innerHTML = ''; $('#romSel').innerHTML = ''; return; }
  $('#romInfo').textContent = `${s.subject} · ${new Date(s.date).toLocaleString()}${C ? ` · ${t('preRom')}: ${S.compare.date.slice(0, 10)}` : ''}`;
  const f = x => (fin(x) ? x.toFixed(0) : '–');
  const pctCell = p => `<td class="${fin(p) && p < 75 ? 'low' : fin(p) && p < 90 ? 'warn' : ''}">${fin(p) ? p.toFixed(0) + '%' : '–'}</td>`;
  const en = getLang() === 'en';
  const head = `<tr><th>${t('romMove')}</th><th>${t('side')}</th><th>${t('direction')}</th><th>${t('peak')}</th><th>${t('norm')}</th><th>${t('pctNorm')}</th><th>${t('direction')}</th><th>${t('peak')}</th><th>${t('norm')}</th><th>${t('pctNorm')}</th><th>${t('romTotal')}</th><th>${t('validPct')}</th>${C ? `<th>${t('preRom')}</th><th>Δ</th>` : ''}</tr>`;
  let rows = '';
  for (const id of ids) {
    const m = MOVES.find(x => x.id === id);
    for (const [vn, mt] of Object.entries(R[id].metrics)) {
      const c = C?.[id]?.metrics?.[vn];
      rows += `<tr><td>${romName(m)}</td><td>${mt.side ? t(mt.side === 'R' ? 'right' : 'left') : ''}</td><td>${en ? m.pos.en : m.pos.zh}</td><td>${f(mt.pos)}</td><td>${m.pos.norm}</td>${pctCell(mt.pctPos)}`
        + (m.neg ? `<td>${en ? m.neg.en : m.neg.zh}</td><td>${f(-mt.neg)}</td><td>${m.neg.norm}</td>${pctCell(mt.pctNeg)}` : '<td></td><td></td><td></td><td></td>')
        + `<td>${f(mt.rom)}</td><td>${mt.validPct}</td>${C ? `<td>${f(c?.rom)}</td><td>${fin(c?.rom) ? (mt.rom - c.rom >= 0 ? '+' : '') + (mt.rom - c.rom).toFixed(0) : '–'}</td>` : ''}</tr>`;
    }
  }
  $('#romTable').innerHTML = `<table class="tbl">${head}${rows}</table><p class="hint">%常模 &lt; 75% 紅色、&lt; 90% 橘色。常模：AAOS；頸椎依講義 P138；肩內收依 Magee。</p>`;
  const asym = asymmetry(R);
  $('#romAsym').innerHTML = asym.length ? `<table class="tbl"><tr><th>${t('romMove')}</th><th>${t('right')}</th><th>${t('left')}</th><th>${t('asymPct')}</th></tr>${asym.map(a => `<tr><td>${a.label}</td><td>${f(a.R)}</td><td>${f(a.L)}</td><td class="${a.asymPct > 15 ? 'low' : a.asymPct > 10 ? 'warn' : ''}">${a.asymPct.toFixed(0)}%</td></tr>`).join('')}</table>` : '';
  const prev = $('#romSel').value;
  $('#romSel').innerHTML = ids.map(id => `<option value="${id}" ${id === prev ? 'selected' : ''}>${romName(MOVES.find(x => x.id === id))}</option>`).join('');
  $('#romSnaps').innerHTML = ids.flatMap(id => Object.entries(R[id].snapshots || {}).map(([k, u]) => {
    const m = MOVES.find(x => x.id === id), d = k === 'pos' ? m.pos : m.neg;
    return `<figure><img src="${u}" alt=""><figcaption>${romName(m)} · ${en ? d.en : d.zh}</figcaption></figure>`;
  })).join('');
  drawRomChart();
}
function drawRomChart() {
  const R = S.viewSession?.rom, id = $('#romSel').value; if (!R?.[id]) return;
  const res = R[id], series = Object.entries(res.series).map(([vn, y]) => ({ label: `${vn.replace(/_deg$/, '')} Δ`, t: res.t, y }));
  const c = S.compare?.rom?.[id];
  if (c && series.length < 3) { const [vn, y] = Object.entries(c.series)[0]; series.push({ label: `${vn.replace(/_deg$/, '')} (${S.compare.date.slice(0, 10)})`, t: c.t, y, dash: true }); }
  timeSeries($('#romChart'), series, 'Δ angle (°)');
}
$('#romSel').addEventListener('change', drawRomChart);
$('#romCsvBtn').onclick = () => (S.viewSession ? downloadCSV(S.viewSession, cfg.rawLm) : toast(t('noSession')));
$('#romVideoBtn').onclick = () => (S.viewSession ? downloadVideos(S.viewSession) : toast(t('noSession')));
$('#romPngBtn').onclick = async () => { const u = chartPNG($('#romChart')); if (u) download(await dataURLtoBlob(u), `rom_${$('#romSel').value}.png`); };
$('#romReportBtn').onclick = () => $('#reportBtn').onclick();
$('#romBtn').onclick = startRomTest;

// ---------------- ECT 互動評估模組 ----------------
async function loadEct() {
  if (!S.user) return;
  $('#ectStatus').textContent = t('ectLoading');
  try {
    const { html, source } = await loadModule();
    $('#ectFrame').srcdoc = wrapModule(html);
    S.ectLoaded = true;
    $('#ectStatus').textContent = t(source === 'net' ? 'ectNet' : source === 'offline' ? 'ectOffline' : 'ectCache');
  } catch (e) {
    $('#ectStatus').textContent = e.reason === 'no_module' ? t('ectNoModule') : e.reason ? t('ectDenied') + e.reason : t('ectError') + e.message;
  }
}
$('#ectReload').onclick = () => { S.ectLoaded = false; loadEct(); };

// ---------------- 歷史 ----------------
async function renderHistory() {
  const list = (await store.listSessions()).reverse();
  $('#historyList').innerHTML = list.length ? list.map(s => `<div class="hist"><div><b>${s.subject}</b> · ${new Date(s.date).toLocaleString()}<br><small>${VIEWS.filter(vw => s.views?.[vw]).map(vw => t('view_' + vw)).join('、')}${s.rom && Object.keys(s.rom).length ? ` · ROM ×${Object.keys(s.rom).length}` : ''}</small></div>
    <div class="btns small"><button data-act="load" data-id="${s.id}">${t('btnLoad')}</button><button data-act="cmp" data-id="${s.id}">${t('btnCompare')}</button><button data-act="del" data-id="${s.id}">${t('btnDelete')}</button></div></div>`).join('') : `<p class="hint">${t('noSession')}</p>`;
}
$('#historyList').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const s = await store.getSession(b.dataset.id); if (!s) return;
  if (b.dataset.act === 'load') {
    S.viewSession = s; S.baseline = (await store.getBaseline(s.subject)) ?? null;
    showTab(Object.keys(s.views || {}).length ? 'results' : 'rom');   // 只有 ROM 的紀錄直接開 ROM 分頁
  }
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
  else if (S.stream && (old.model !== cfg.model || old.delegate !== cfg.delegate)) ensureModel();
  toast(t('saved'));
});
// 還原自動安全模式所改的設定，並清除當機紀錄
$('#resetSafeBtn').onclick = () => {
  Object.assign(cfg, { delegate: 'GPU', videoFmt: 'auto', quietRec: false, noSnapshot: false });
  saveCfg(); fillSettings();
  try { localStorage.removeItem('pa.lastCrash'); } catch { /* ignore */ }
  $('#crashInfo').textContent = ''; toast(t('saved'));
};
$('#resetThrBtn').onclick =() => { $('#settingsForm').elements.thr.value = JSON.stringify(DEFAULT_THR, null, 2); };

// ---------------- 分頁、語言、按鈕 ----------------
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === `tab-${name}`));
  if (name === 'results') renderResults(); if (name === 'history') renderHistory();
  if (name === 'rom') { renderRomChecklist(); renderRom(); }
  if (name === 'ect' && !S.ectLoaded) loadEct();
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
$('#camBtn').onclick = () => (S.stream ? stopCamera() : startCamera());
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
$('#capBtn').onclick = () => {
  unlockAudio();
  // 「立即拍攝」略過對位檢查，所以腳不在畫面時先提醒
  const n = S.hist.at(-1)?.n;
  if (!n || [27, 28, 29, 30].every(i => n[i][3] < cfg.visThr)) toast(t('capWarn'));
  startCountdown();
};
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
  unlockAudio();
  S.voiceOn = !S.voiceOn;
  if (S.voiceOn) startVoice(); else stopListening();
  $('#voiceBtn').textContent = t(S.voiceOn ? 'btnVoiceOn' : 'btnVoiceOff');
  // 一人操作模式：放大提示字；說明怎麼用
  $('.stage').classList.toggle('solo', S.voiceOn);
  if (S.voiceOn) { say('voiceHint', { interrupt: true }); if (S.phase === 'idle') $('#msg').textContent = t('voiceHintShort'); }
  else if (S.phase === 'idle') $('#msg').textContent = '';
};

// ---------------- 登入閘門 UI ----------------
const gateUI = {
  state: '', buttonEl: $('#gsiBtn'), get lang() { return getLang(); },
  show(state, detail, email) {
    this.state = state;
    $('#gate').classList.remove('hidden');
    const el = $('#gateMsg');
    let msg = t(`gate_${state}`);
    if (state === 'denied') msg = (t(`gate_${detail}`) || detail) + (email ? email : '') + (['not_listed', 'disabled', 'expired'].includes(detail) ? t('gate_contact') : '');
    el.textContent = msg;
    el.classList.toggle('bad', state === 'denied' || state === 'error' || state === 'setup');
    $('#gsiBtn').hidden = !['login', 'denied'].includes(state);
    const redirect = redirectMode();
    $('#gateRedirect').textContent = ['login', 'denied'].includes(state) ? t(redirect ? 'gateRedirectOff' : 'gateRedirectOn') : '';
    $('#gateRedirect').onclick = e => { e.preventDefault(); useRedirectMode(!redirect); };
  },
  diag(txt) { $('#gateDiag').textContent = `v${APP_VERSION} · ${txt}`; },
  hide() { this.state = 'ok'; $('#gate').classList.add('hidden'); },
};
$('#signOutBtn').onclick = () => signOut();

// ---------------- 啟動 ----------------
(async function init() {
  const crash = recoverFromCrash();   // 必須在 fillSettings 前，讓自動修正的設定顯示出來
  applyLang(); fillSettings();
  if (crash) {
    const msg = `${t('crashPrev')}「${t('stage_' + crash.stage)}」${crash.fixes.length ? ' → ' + t('crashFixed') + crash.fixes.join(', ') : ''}`;
    $('#msg').textContent = msg; setTimeout(() => { if ($('#msg').textContent === msg) $('#msg').textContent = ''; }, 12000);
  }
  try { const lc = JSON.parse(localStorage.getItem('pa.lastCrash') || 'null'); if (lc) $('#crashInfo').textContent = `${t('crashPrev')} ${lc.at}「${t('stage_' + lc.stage)}」${lc.mime ? ' (' + lc.mime + ')' : ''} ${lc.fixes.join(', ')}`; } catch { /* ignore */ }
  $('#verInfo').textContent = `v${APP_VERSION} · MediaPipe tasks-vision ${MP_VERSION} · Chart.js ${window.Chart?.version ?? '?'}`;
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

  // 登入閘門（service worker 已先註冊，被擋的人也能收到更新）；通過前不載入任何資料
  S.user = await requireAuth(gateUI);
  gateUI.hide();                     // AUTH.enabled = false 時也要移除閘門
  $('#userInfo').textContent = S.user?.email ? `${t('signedInAs')}${S.user.name ? S.user.name + ' ' : ''}<${S.user.email}>${S.user.offline ? t('offlineMode') : ''}` : '';
  $('#signOutBtn').hidden = !S.user?.email;
  S.baseline = (await store.getBaseline(cfg.subject).catch(() => null)) ?? null;
  store.requestPersist();
  renderHistory();
})();
