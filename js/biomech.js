// biomech.js — 座標轉換、關節/節段角度、全身重心 COM、紀錄後處理
//
// 座標系（身體座標，單位 m）：
//   原點 = 第一幀（濾波後）右腳跟 (landmark 30) 位置
//   y 軸 = 真正鉛垂向上（經鉛垂校正）
//   x 軸 = 矢狀面拍攝（左/右側）：受測者「向前」為正
//          額狀面拍攝（正/背面）：受測者「右側」為正（額狀面沒有前後方向）
// 角度：解剖學定義，中立站姿 = 0°，屈曲/外展/外翻為正（詳見 docs/BIOMECHANICS.md）

import { splineResample, movingAverage, sgDerivative, summarize } from './filters.js';

export const FPS = 30;              // 分析用等間隔取樣率 (Hz)
export const G = 9.81;              // m/s²
export const EYE_HEIGHT_RATIO = 0.936; // 眼高 / 身高（Drillis & Contini, 1966）

export const LM = {
  nose: 0, lEye: 2, rEye: 5, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16,
  lIdx: 19, rIdx: 20, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lHe: 29, rHe: 30, lFt: 31, rFt: 32,
};
export const LM_NAMES = ['nose', 'L_eye_inner', 'L_eye', 'L_eye_outer', 'R_eye_inner', 'R_eye', 'R_eye_outer', 'L_ear', 'R_ear',
  'mouth_L', 'mouth_R', 'L_shoulder', 'R_shoulder', 'L_elbow', 'R_elbow', 'L_wrist', 'R_wrist', 'L_pinky', 'R_pinky',
  'L_index', 'R_index', 'L_thumb', 'R_thumb', 'L_hip', 'R_hip', 'L_knee', 'R_knee', 'L_ankle', 'R_ankle',
  'L_heel', 'R_heel', 'L_foot_index', 'R_foot_index'];
// 左右成對的關鍵點（用於背面/正面左右標籤修正）
const LR_PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
export const SKELETON = [[11, 12], [11, 13], [13, 15], [15, 19], [12, 14], [14, 16], [16, 20], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], [7, 8], [0, 7], [0, 8]];

export const VIEWS = ['front', 'right', 'back', 'left'];
// x_body = VIEW_SIGN × x_image（影像 x 向右）
export const VIEW_SIGN = { front: -1, back: +1, right: +1, left: -1 };
export const isSag = v => v === 'right' || v === 'left';

const D = 180 / Math.PI;
const fin = Number.isFinite;
const wrap = a => ((a + 180) % 360 + 360) % 360 - 180;

// Winter (2009) Table 4.1 節段質量比例與質心位置（自近端起算之比例）
// p/d：近端/遠端關鍵點索引（陣列 = 取平均）
export const SEGMENTS = [
  { name: 'head_neck', m: 0.081, p: [7, 8], d: [7, 8], r: 0 },       // 質心近似在耳道
  { name: 'trunk', m: 0.497, p: [11, 12], d: [23, 24], r: 0.50 },
  { name: 'R_upperarm', m: 0.028, p: [12], d: [14], r: 0.436 }, { name: 'L_upperarm', m: 0.028, p: [11], d: [13], r: 0.436 },
  { name: 'R_forearm', m: 0.016, p: [14], d: [16], r: 0.430 }, { name: 'L_forearm', m: 0.016, p: [13], d: [15], r: 0.430 },
  { name: 'R_hand', m: 0.006, p: [16], d: [20], r: 0.506 }, { name: 'L_hand', m: 0.006, p: [15], d: [19], r: 0.506 },
  { name: 'R_thigh', m: 0.100, p: [24], d: [26], r: 0.433 }, { name: 'L_thigh', m: 0.100, p: [23], d: [25], r: 0.433 },
  { name: 'R_leg', m: 0.0465, p: [26], d: [28], r: 0.433 }, { name: 'L_leg', m: 0.0465, p: [25], d: [27], r: 0.433 },
  { name: 'R_foot', m: 0.0145, p: [30], d: [32], r: 0.50 }, { name: 'L_foot', m: 0.0145, p: [29], d: [31], r: 0.50 },
];

const avgPt = (P, idx) => {
  let x = 0, y = 0;
  for (const i of idx) { x += P[i][0]; y += P[i][1]; }
  return [x / idx.length, y / idx.length];
};

/** 全身重心：Σ(m_i · r_i) / Σm_i；對任何仿射座標（像素或公尺）皆成立 */
export function computeCOM(P) {
  let x = 0, y = 0, M = 0;
  for (const s of SEGMENTS) {
    const a = avgPt(P, s.p), b = avgPt(P, s.d);
    const cx = a[0] + s.r * (b[0] - a[0]), cy = a[1] + s.r * (b[1] - a[1]);
    if (!fin(cx) || !fin(cy)) continue;
    x += s.m * cx; y += s.m * cy; M += s.m;
  }
  return M > 0.8 ? [x / M, y / M] : [NaN, NaN]; // 缺太多節段則不計
}

// ---------------------------------------------------------------------------
// 影像 → 身體座標
// up：影像中「真正向上」的單位向量（影像座標 y 向下，理想值 (0,-1)）
export function makeTransform({ W, H, up = [0, -1], scale = NaN, origin = null, view = 'front' }) {
  const alpha = Math.atan2(up[0], -up[1]);         // 鉛垂偏離影像垂直的角度
  const ca = Math.cos(alpha), sa = Math.sin(alpha), cx = W / 2, cy = H / 2;
  const rot = (x, y) => { const dx = x - cx, dy = y - cy; return [ca * dx + sa * dy, -sa * dx + ca * dy]; };
  const sx = VIEW_SIGN[view] ?? 1;
  const o = origin ?? [0, 0];                      // origin 以「旋轉後像素」表示
  return {
    alpha, rot, sx, scale,
    toBody(x, y) { const [rx, ry] = rot(x, y); return [sx * (rx - o[0]) * scale, -(ry - o[1]) * scale]; },
  };
}

/** 由加速度計（含重力）求影像中的「上」方向；camSign: 後鏡頭 +1、前鏡頭 -1 */
export function upFromGravity(ax, ay, screenAngleDeg, camSign) {
  const a = screenAngleDeg / D;
  let sx = ax * Math.cos(a) - ay * Math.sin(a), sy = ax * Math.sin(a) + ay * Math.cos(a);
  if (sy < 0) { sx = -sx; sy = -sy; }              // iOS 舊版符號相反；假設手機為直立而非倒置
  const n = Math.hypot(sx, sy) || 1;
  return [camSign * sx / n, -sy / n];
}

/** 以 normalized 關鍵點判斷受測者朝向（未鏡像影像） */
export function detectView(lm) {
  if (!lm) return null;
  const sh = Math.abs(lm[11][0] - lm[12][0]);
  const torso = Math.hypot((lm[11][0] + lm[12][0] - lm[23][0] - lm[24][0]) / 2, (lm[11][1] + lm[12][1] - lm[23][1] - lm[24][1]) / 2);
  if (torso <= 0) return null;
  if (sh / torso < 0.42) {                          // 肩寬投影很窄 → 側面
    const earX = (lm[7][0] + lm[8][0]) / 2;
    return lm[0][0] > earX ? 'right' : 'left';      // 鼻子在耳前方：朝影像右 = 右側面對鏡頭
  }
  const face = (lm[0][3] + lm[2][3] + lm[5][3]) / 3;
  if (face < 0.35) return 'back';
  return lm[11][0] > lm[12][0] ? 'front' : 'back';  // 面對鏡頭時，左肩出現在影像右邊
}

/** 正/背面強制左右標籤一致（MediaPipe 對背面常把左右標反） */
export function enforceLR(lm, view) {
  if (view !== 'front' && view !== 'back') return { lm, swapped: false };
  let score = 0;
  for (const [l, r] of [[11, 12], [23, 24], [25, 26], [27, 28]]) score += Math.sign(lm[l][0] - lm[r][0]);
  const want = view === 'front' ? 1 : -1;
  if (score * want >= 0) return { lm, swapped: false };
  const out = lm.map(p => p.slice());
  for (const [l, r] of LR_PAIRS) { out[l] = lm[r].slice(); out[r] = lm[l].slice(); }
  return { lm: out, swapped: true };
}

// ---------------------------------------------------------------------------
// 每幀變數（P：33 點身體座標 [x,y] m；W：world landmarks [x,y,z] m 或 null）
export function computeVars(P, view, W = null) {
  const v = {};
  const mid = (a, b) => [(P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2];
  // 節段角：從下端(遠端)指向上端(近端)的向量相對鉛垂線；上端偏 +x 為正
  const seg = (lo, hi) => Math.atan2(hi[0] - lo[0], hi[1] - lo[1]) * D;
  const shM = mid(11, 12), hipM = mid(23, 24), earM = mid(7, 8), anM = mid(27, 28);
  const trunk = seg(hipM, shM);
  v.trunk_seg_deg = trunk;
  const com = computeCOM(P);

  if (isSag(view)) {
    const S = view === 'right' ? 'R' : 'L', o = view === 'right' ? 1 : 0; // 只分析面向鏡頭的一側
    const I = k => P[LM[(o ? 'r' : 'l') + k]];
    const sh = I('Sh'), el = I('El'), wr = I('Wr'), ix = I('Idx'), hp = I('Hip'), kn = I('Kn'), an = I('An'), he = I('He'), ft = I('Ft'), ear = I('Ear');
    const ua = seg(el, sh), fa = seg(wr, el), hand = seg(ix, wr), thigh = seg(kn, hp), shank = seg(an, kn), head = seg(sh, ear);
    const foot = Math.atan2(ft[1] - he[1], ft[0] - he[0]) * D; // 足部：相對水平，腳尖上抬為正
    Object.assign(v, {
      [`${S}_upperarm_seg_deg`]: ua, [`${S}_forearm_seg_deg`]: fa, [`${S}_thigh_seg_deg`]: thigh,
      [`${S}_shank_seg_deg`]: shank, [`${S}_foot_seg_deg`]: foot, head_seg_deg: head,
      [`${S}_neck_flex_deg`]: wrap(head - trunk),
      [`${S}_shoulder_flex_deg`]: wrap(trunk - ua),
      [`${S}_elbow_flex_deg`]: wrap(ua - fa),
      [`${S}_wrist_flex_deg`]: wrap(fa - hand),
      [`${S}_hip_flex_deg`]: wrap(trunk - thigh),
      [`${S}_knee_flex_deg`]: wrap(shank - thigh),
      [`${S}_ankle_DF_deg`]: wrap(shank + foot),
      CVA_proxy_deg: Math.atan2(ear[1] - sh[1], ear[0] - sh[0]) * D, // 耳-肩連線與水平夾角（90° = 耳在肩正上方）
      head_pitch_deg: Math.atan2(P[0][1] - ear[1], P[0][0] - ear[0]) * D, // 耳→鼻相對水平，抬下巴為正
      // Kendall 鉛垂線：以外踝 (ankle) 為基準的前後偏移，向前為正
      ear_to_plumb_cm: (ear[0] - an[0]) * 100,
      shoulder_to_plumb_cm: (sh[0] - an[0]) * 100,
      hip_to_plumb_cm: (hp[0] - an[0]) * 100,
      knee_to_plumb_cm: (kn[0] - an[0]) * 100,
      COM_to_plumb_cm: (com[0] - an[0]) * 100,
      ear_minus_shoulder_cm: (ear[0] - sh[0]) * 100,
      shoulder_minus_hip_cm: (sh[0] - hp[0]) * 100,
    });
  } else {
    // 額狀面：x = 受測者右側為正。左側的符號乘 -1，使「外展 / 外翻」兩側皆為正
    for (const [S, k, sg] of [['R', 'r', 1], ['L', 'l', -1]]) {
      const I = n => P[LM[k + n]];
      const sh = I('Sh'), el = I('El'), wr = I('Wr'), ix = I('Idx'), hp = I('Hip'), kn = I('Kn'), an = I('An'), he = I('He');
      const ua = seg(el, sh), fa = seg(wr, el), hand = seg(ix, wr), thigh = seg(kn, hp), shank = seg(an, kn), heel = seg(he, an);
      Object.assign(v, {
        [`${S}_upperarm_seg_deg`]: ua, [`${S}_forearm_seg_deg`]: fa, [`${S}_thigh_seg_deg`]: thigh, [`${S}_shank_seg_deg`]: shank,
        [`${S}_shoulder_abd_deg`]: wrap(sg * (trunk - ua)),
        [`${S}_elbow_valgus_deg`]: wrap(sg * (ua - fa)),          // 投影攜帶角（需手掌朝前才有意義）
        [`${S}_wrist_dev_deg`]: wrap(sg * (fa - hand)),
        [`${S}_hip_abd_deg`]: wrap(sg * (trunk - thigh)),
        [`${S}_knee_valgus_deg`]: wrap(sg * (thigh - shank)),     // FPPA：膝外翻(X)為正、內翻(O)為負
        [`${S}_rearfoot_valgus_deg`]: wrap(sg * (shank - heel)),  // 背面才準：跟骨外翻為正
      });
    }
    const tilt = (r, l) => Math.atan2(P[r][1] - P[l][1], P[r][0] - P[l][0]) * D; // 右高為正
    const headM = view === 'front' ? P[0] : earM;
    Object.assign(v, {
      head_lat_flex_deg: wrap(seg(shM, earM) - trunk),  // 頭相對軀幹側屈，向右為正
      eye_tilt_deg: view === 'front' ? tilt(5, 2) : tilt(8, 7),
      shoulder_obliquity_deg: tilt(12, 11),
      pelvic_obliquity_deg: tilt(24, 23),
      shoulder_height_diff_cm: (P[12][1] - P[11][1]) * 100,
      pelvis_height_diff_cm: (P[24][1] - P[23][1]) * 100,
      // 相對雙踝中點鉛垂線的側向偏移（向受測者右側為正）
      head_shift_cm: (headM[0] - anM[0]) * 100,
      shoulder_mid_shift_cm: (shM[0] - anM[0]) * 100,
      pelvis_mid_shift_cm: (hipM[0] - anM[0]) * 100,
      COM_shift_cm: (com[0] - anM[0]) * 100,
      knee_gap_cm: Math.abs(P[26][0] - P[25][0]) * 100,
      ankle_gap_cm: Math.abs(P[28][0] - P[27][0]) * 100,
    });
    // 3D world landmarks（MediaPipe：x 影像右、y 下、z 越小越靠近鏡頭）→ 足尖外開角（實驗性）
    if (W && view === 'front') {
      const toe = (h, f, s) => Math.atan2(s * -(W[f][0] - W[h][0]), -(W[f][2] - W[h][2])) * D;
      v.R_toe_out_3D_deg = toe(30, 32, 1);
      v.L_toe_out_3D_deg = toe(29, 31, -1);
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
const median = a => { const b = a.filter(fin).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };

export const ANKLE_HEIGHT_RATIO = 0.039; // 外踝高 / 身高（Drillis & Contini, 1966）

/**
 * 以身高求比例尺 (m/px)，依序嘗試：
 *   1. 眼睛→腳跟 的鉛垂像素距離 = 0.936 H
 *   2. 眼睛→腳踝 = (0.936 − 0.039) H（腳跟看不到時）
 *   3. world landmarks：軀幹（肩中點→髖中點）公尺長度 / 像素長度（腳都不在畫面時）
 * 回傳 { scale, source }
 */
export function scaleFromHeight(frames, rot, height_m, visThr) {
  const ok = (lm, ids) => ids.filter(i => lm[i][3] >= visThr);
  const yOf = (lm, ids) => ids.reduce((s, i) => s + rot(lm[i][0], lm[i][1])[1], 0) / ids.length;
  const eyeY = lm => yOf(lm, [2, 5]);
  const per = (ids, ratio) => median(frames.map(({ lm }) => {
    const v = ok(lm, ids); if (!v.length) return NaN;
    const d = yOf(lm, v) - eyeY(lm);
    return d > 0 ? ratio * height_m / d : NaN;
  }));
  let s = per([29, 30], EYE_HEIGHT_RATIO);
  if (fin(s)) return { scale: s, source: 'eye-heel' };
  s = per([27, 28], EYE_HEIGHT_RATIO - ANKLE_HEIGHT_RATIO);
  if (fin(s)) return { scale: s, source: 'eye-ankle' };
  s = median(frames.map(({ lm, wlm }) => {
    if (!wlm || ok(lm, [11, 12, 23, 24]).length < 4) return NaN;
    const m = (P, a, b) => P[a].map((x, k) => (x + P[b][k]) / 2);
    const pxS = m(lm, 11, 12), pxH = m(lm, 23, 24), wS = m(wlm, 11, 12), wH = m(wlm, 23, 24);
    const px = Math.hypot(pxS[0] - pxH[0], pxS[1] - pxH[1]), w = Math.hypot(wS[0] - wH[0], wS[1] - wH[1], wS[2] - wH[2]);
    return px > 0 ? w / px : NaN;
  }));
  return { scale: s, source: fin(s) ? 'world-torso' : 'none' };
}

/**
 * 一次記錄（一個方向）的完整後處理
 * frames: [{t (s), lm:[[x_px,y_px,z,vis]×33], wlm:[[x,y,z,vis]×33]}]
 * 流程：可信度遮罩 → 三次樣條內插並重取樣至 30 Hz → 移動平均 → 身體座標 → 變數 → SG 導數 → 摘要
 */
export function processRecording(frames, { view, W, H, up, height_m, mass_kg, visThr, maWin = 5, sgWin = 11, sgOrder = 2, baseline = null }) {
  const n = frames.length;
  const tRaw = frames.map(f => f.t - frames[0].t);
  const T = tRaw[n - 1];
  const tF = []; for (let k = 0; k * (1 / FPS) <= T + 1e-9; k++) tF.push(k / FPS);

  const tf0 = makeTransform({ W, H, up, view });
  const { scale, source: scaleSource } = scaleFromHeight(frames, tf0.rot, height_m, visThr);

  // 旋轉後像素；低可信度 → NaN
  const rotRaw = frames.map(f => f.lm.map(p => (p[3] >= visThr ? tf0.rot(p[0], p[1]) : [NaN, NaN])));
  // 濾波後（旋轉像素）
  const filtRot = Array.from({ length: tF.length }, () => new Array(33));
  const validPct = new Array(33);
  for (let i = 0; i < 33; i++) {
    const xs = rotRaw.map(r => r[i][0]), ys = rotRaw.map(r => r[i][1]);
    validPct[i] = 100 * xs.filter(fin).length / n;
    const fx = movingAverage(splineResample(tRaw, xs, tF), maWin), fy = movingAverage(splineResample(tRaw, ys, tF), maWin);
    for (let k = 0; k < tF.length; k++) filtRot[k][i] = [fx[k], fy[k]];
  }
  // world landmarks 也重取樣（用於 3D 足角）
  const wF = Array.from({ length: tF.length }, () => new Array(33));
  for (let i = 0; i < 33; i++) {
    const comp = [0, 1, 2].map(c => movingAverage(splineResample(tRaw, frames.map(f => (f.wlm && f.wlm[i][3] >= visThr ? f.wlm[i][c] : NaN)), tF), maWin));
    for (let k = 0; k < tF.length; k++) wF[k][i] = [comp[0][k], comp[1][k], comp[2][k]];
  }

  // 原點：第一幀（濾波後）右腳跟 → 雙踝中點 → 髖中點（腳不在畫面時，y=0 位於髖高度）
  const f0 = filtRot[0], midOf = (a, b) => [(f0[a][0] + f0[b][0]) / 2, (f0[a][1] + f0[b][1]) / 2];
  const originCands = [['R_heel', f0[30]], ['mid_ankle', midOf(27, 28)], ['mid_hip', midOf(23, 24)], ['mid_shoulder', midOf(11, 12)]];
  const [originSource, o] = originCands.find(([, p]) => fin(p[0]) && fin(p[1])) ?? ['none', [0, 0]];
  const sx = VIEW_SIGN[view];
  const toBody = ([rx, ry]) => [sx * (rx - o[0]) * scale, -(ry - o[1]) * scale];

  const raw = {}, filt = {};
  const push = (dst, k, name, val, len) => { (dst[name] ??= new Array(len).fill(NaN))[k] = val; };
  const traj = P => {
    const com = computeCOM(P), hip = [(P[23][0] + P[24][0]) / 2, (P[23][1] + P[24][1]) / 2], head = [(P[7][0] + P[8][0]) / 2, (P[7][1] + P[8][1]) / 2];
    return { COM: com, hipMid: hip, R_heel: P[30], head };
  };
  const emit = (dst, k, P, Wl, len) => {
    const vars = computeVars(P, view, Wl);
    for (const [name, val] of Object.entries(vars)) push(dst, k, name, val, len);
    for (const [name, p] of Object.entries(traj(P))) { push(dst, k, `${name}_x_m`, p[0], len); push(dst, k, `${name}_y_m`, p[1], len); }
  };
  rotRaw.forEach((pts, k) => emit(raw, k, pts.map(toBody), frames[k].wlm, n));
  filtRot.forEach((pts, k) => emit(filt, k, pts.map(toBody), wF[k], tF.length));

  // 位移（相對第一幀）與 SG 速度/加速度、以體重正規化的淨外力估計
  const dt = 1 / FPS;
  for (const p of ['COM', 'hipMid', 'R_heel', 'head']) {
    const x = filt[`${p}_x_m`], y = filt[`${p}_y_m`];
    filt[`${p}_disp_m`] = x.map((xi, k) => Math.hypot(xi - x[0], y[k] - y[0]));
    filt[`${p}_vx_mps`] = sgDerivative(x, dt, sgWin, sgOrder, 1);
    filt[`${p}_vy_mps`] = sgDerivative(y, dt, sgWin, sgOrder, 1);
  }
  const ax = sgDerivative(filt.COM_x_m, dt, sgWin, sgOrder, 2), ay = sgDerivative(filt.COM_y_m, dt, sgWin, sgOrder, 2);
  filt.COM_ax_mps2 = ax; filt.COM_ay_mps2 = ay;
  filt.Fx_est_Nkg = ax.slice();                  // F/m = a
  filt.Fy_est_Nkg = ay.map(a => a + G);          // 垂直：F/m = a + g
  filt.Fx_est_BW = ax.map(a => a / G);
  filt.Fy_est_BW = ay.map(a => (a + G) / G);
  filt.Fy_est_N = ay.map(a => mass_kg * (a + G));

  // 角位移：相對 0° 基準（若有）否則相對第一幀
  for (const name of Object.keys(filt)) {
    if (!name.endsWith('_deg')) continue;
    const ref = baseline && fin(baseline[name]) ? baseline[name] : filt[name][0];
    filt[name.replace(/_deg$/, '_delta_deg')] = filt[name].map(a => a - ref);
  }

  const summary = {};
  for (const [name, arr] of Object.entries(filt)) summary[name] = summarize(arr, tF);

  const qc = {
    frames: n, duration_s: T, fps: T > 0 ? (n - 1) / T : NaN,
    validPct_keypoints: Math.round([11, 12, 23, 24, 25, 26, 27, 28, 29, 30].reduce((s, i) => s + validPct[i], 0) / 10),
    swappedFrames: frames.filter(f => f.swapped).length,
    scale_m_per_px: scale, scale_source: scaleSource, origin_source: originSource, plumb_alpha_deg: tf0.alpha * D,
    feetVisiblePct: Math.round((validPct[27] + validPct[28] + validPct[29] + validPct[30]) / 4),
  };
  return { view, tRaw, t: tF, raw, filt, summary, qc, rawFrames: frames };
}
