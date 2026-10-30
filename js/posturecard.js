// posturecard.js — 靜態姿勢結果：中文變數名稱、平均 ± SD 表、四面姿勢照片（裁切人物 + 角度/距離標註 + 問題點標紅）
import { isSag } from './biomech.js';
import { getLang } from './i18n.js';

const fin = Number.isFinite;

// 方向用語：[正值, 負值]
const DIRS = {
  hi: { zh: ['右高', '左高'], en: ['R high', 'L high'] },
  lat: { zh: ['偏右', '偏左'], en: ['to R', 'to L'] },
  latLean: { zh: ['向右傾', '向左傾'], en: ['lean R', 'lean L'] },
  sagLean: { zh: ['前傾', '後傾'], en: ['forward', 'backward'] },
  valg: { zh: ['外翻', '內翻'], en: ['valgus', 'varus'] },
  toe: { zh: ['外八', '內八'], en: ['toe-out', 'toe-in'] },
  ap: { zh: ['在前', '在後'], en: ['anterior', 'posterior'] },
  knee: { zh: ['屈曲', '過伸'], en: ['flexed', 'hyperext.'] },
  chin: { zh: ['抬下巴', '低頭'], en: ['chin up', 'chin down'] },
  flex: { zh: ['屈曲', '伸展'], en: ['flexion', 'extension'] },
  df: { zh: ['背屈', '蹠屈'], en: ['dorsiflex.', 'plantarflex.'] },
};

// 變數 → 中文/英文名稱、照片上的短名、單位、方向用語（R_/L_ 前綴另外加「右/左」）
const VARS = {
  eye_tilt_deg: { zh: '雙眼連線傾斜', en: 'Eye-line tilt', s: '雙眼', se: 'Eyes', u: '°', d: 'hi' },
  head_shift_cm: { zh: '頭部側移（相對雙踝中線）', en: 'Head lateral shift', s: '頭', se: 'Head', u: 'cm', d: 'lat' },
  shoulder_obliquity_deg: { zh: '肩膀高低（肩線傾斜）', en: 'Shoulder obliquity', s: '肩膀', se: 'Shoulders', u: '°', d: 'hi' },
  pelvic_obliquity_deg: { zh: '骨盆高低（髖線傾斜）', en: 'Pelvic obliquity', s: '骨盆', se: 'Pelvis', u: '°', d: 'hi' },
  trunk_seg_deg: { zh: '軀幹傾斜', en: 'Trunk lean', s: '軀幹', se: 'Trunk', u: '°' },
  shoulder_mid_shift_cm: { zh: '肩中點側移', en: 'Shoulder-midpoint shift', s: '肩中點', se: 'Shoulder mid', u: 'cm', d: 'lat' },
  pelvis_mid_shift_cm: { zh: '骨盆中點側移', en: 'Pelvis-midpoint shift', s: '骨盆位置', se: 'Pelvis shift', u: 'cm', d: 'lat' },
  COM_shift_cm: { zh: '身體重心側移', en: 'Centre-of-mass shift', s: '重心', se: 'COM', u: 'cm', d: 'lat' },
  knee_valgus_deg: { zh: '膝外翻角（FPPA；X 型為外翻、O 型為內翻）', en: 'Knee FPPA (valgus +)', s: '膝', se: 'Knee', u: '°', d: 'valg' },
  rearfoot_valgus_deg: { zh: '跟骨角（外翻 / 內翻）', en: 'Rearfoot angle (valgus +)', s: '跟骨', se: 'Rearfoot', u: '°', d: 'valg' },
  toe_out_3D_deg: { zh: '足尖外開角（3D 實驗性）', en: 'Toe-out (3D, experimental)', s: '足尖', se: 'Toe', u: '°', d: 'toe' },
  ear_minus_shoulder_cm: { zh: '頭前傾距離（耳垂相對肩峰）', en: 'Forward head (ear vs acromion)', s: '頭前傾 耳', se: 'Ear vs shoulder', u: 'cm', d: 'ap' },
  CVA_proxy_deg: { zh: '頭頸角（CVA 近似，越小越前傾）', en: 'Craniovertebral angle (proxy)', s: '頭頸角', se: 'CVA', u: '°' },
  head_pitch_deg: { zh: '下巴角度（耳–鼻連線）', en: 'Head pitch (ear–nose)', s: '下巴', se: 'Chin', u: '°', d: 'chin' },
  neck_flex_deg: { zh: '頸部相對軀幹角度', en: 'Neck vs trunk', s: '頸', se: 'Neck', u: '°', d: 'flex' },
  shoulder_minus_hip_cm: { zh: '肩峰相對大轉子前後位置（圓肩近似）', en: 'Acromion vs greater trochanter', s: '肩峰', se: 'Shoulder', u: 'cm', d: 'ap' },
  ear_to_plumb_cm: { zh: '耳垂 距鉛垂線（外踝）', en: 'Ear to plumb line', s: '耳垂', se: 'Ear', u: 'cm', d: 'ap' },
  shoulder_to_plumb_cm: { zh: '肩峰 距鉛垂線', en: 'Shoulder to plumb line', s: '肩峰', se: 'Shoulder', u: 'cm', d: 'ap' },
  hip_to_plumb_cm: { zh: '大轉子 距鉛垂線', en: 'Hip to plumb line', s: '大轉子', se: 'Hip', u: 'cm', d: 'ap' },
  knee_to_plumb_cm: { zh: '膝 距鉛垂線', en: 'Knee to plumb line', s: '膝位置', se: 'Knee pos.', u: 'cm', d: 'ap' },
  COM_to_plumb_cm: { zh: '身體重心 距鉛垂線', en: 'COM to plumb line', s: '重心', se: 'COM', u: 'cm', d: 'ap' },
  hip_flex_deg: { zh: '髖關節角度', en: 'Hip angle', s: '髖', se: 'Hip', u: '°', d: 'flex' },
  knee_flex_deg: { zh: '膝關節角度（過伸 = 膝反屈）', en: 'Knee angle (hyperext. −)', s: '膝', se: 'Knee', u: '°', d: 'knee' },
  ankle_DF_deg: { zh: '踝關節角度', en: 'Ankle angle', s: '踝', se: 'Ankle', u: '°', d: 'df' },
};

/** 靜態姿勢表要列出的變數（只留姿勢相關；其餘從 CSV 匯出） */
export function postureVars(view) {
  if (view === 'front') return ['eye_tilt_deg', 'head_shift_cm', 'shoulder_obliquity_deg', 'pelvic_obliquity_deg', 'trunk_seg_deg', 'shoulder_mid_shift_cm', 'pelvis_mid_shift_cm', 'COM_shift_cm',
    'R_knee_valgus_deg', 'L_knee_valgus_deg', 'R_toe_out_3D_deg', 'L_toe_out_3D_deg'];
  if (view === 'back') return ['eye_tilt_deg', 'shoulder_obliquity_deg', 'pelvic_obliquity_deg', 'trunk_seg_deg', 'shoulder_mid_shift_cm', 'pelvis_mid_shift_cm', 'COM_shift_cm',
    'R_knee_valgus_deg', 'L_knee_valgus_deg', 'R_rearfoot_valgus_deg', 'L_rearfoot_valgus_deg'];
  const S = view === 'right' ? 'R' : 'L';
  return ['ear_minus_shoulder_cm', 'CVA_proxy_deg', 'head_pitch_deg', `${S}_neck_flex_deg`, 'shoulder_minus_hip_cm', 'trunk_seg_deg',
    'ear_to_plumb_cm', 'shoulder_to_plumb_cm', 'hip_to_plumb_cm', 'knee_to_plumb_cm', 'COM_to_plumb_cm', `${S}_hip_flex_deg`, `${S}_knee_flex_deg`, `${S}_ankle_DF_deg`];
}

function meta(name, view) {
  const m = /^([RL])_(.+)$/.exec(name);
  const base = m ? m[2] : name, d = VARS[base] ?? { zh: name, en: name, s: name, se: name, u: name.endsWith('_deg') ? '°' : name.endsWith('_cm') ? 'cm' : '' };
  const side = m ? { zh: m[1] === 'R' ? '右' : '左', en: m[1] === 'R' ? 'R ' : 'L ' } : { zh: '', en: '' };
  let zh = side.zh + d.zh, en = side.en + d.en;
  if (base === 'eye_tilt_deg' && view === 'back') { zh = '雙耳連線傾斜'; en = 'Ear-line tilt'; }
  const dir = d.d ?? (base === 'trunk_seg_deg' ? (isSag(view) ? 'sagLean' : 'latLean') : null);
  const short = side.zh + (base === 'eye_tilt_deg' && view === 'back' ? '雙耳' : d.s), shortEn = side.en + (base === 'eye_tilt_deg' && view === 'back' ? 'Ears' : d.se);
  return { zh, en, short, shortEn, u: d.u, dir };
}

/** 名稱（依目前語言） */
export const varLabel = (name, view) => { const m = meta(name, view); return getLang() === 'en' ? m.en : m.zh; };

/** 平均與樣本標準差（忽略缺值） */
export function meanSD(arr) {
  const a = (arr || []).filter(fin), n = a.length;
  if (!n) return { mean: NaN, sd: NaN, n: 0 };
  const mean = a.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { mean, sd, n };
}

/** 帶方向的數值文字：例如「右高 2.3°」；|值| < 0.05 視為 0 */
function dirText(name, view, mean, digits = 1) {
  const m = meta(name, view), en = getLang() === 'en';
  if (!fin(mean)) return '-';
  const v = Math.abs(mean).toFixed(digits) + m.u;
  if (!m.dir || Math.abs(mean) < 0.05) return (m.dir ? Math.abs(mean) : mean).toFixed(digits) + m.u;
  const w = DIRS[m.dir][en ? 'en' : 'zh'][mean > 0 ? 0 : 1];
  return `${w} ${v}`;
}

// 問題姿勢 → 對應的變數（照片與表格中標紅）
const FLAG_VARS = {
  head_tilt: ['eye_tilt_deg'], head_shift: ['head_shift_cm'], uneven_shoulders: ['shoulder_obliquity_deg'], pelvic_obliquity: ['pelvic_obliquity_deg'],
  trunk_lean: ['trunk_seg_deg'], pelvis_shift: ['pelvis_mid_shift_cm'], scoliosis_pattern: ['shoulder_obliquity_deg', 'pelvic_obliquity_deg'], trunk_shift: ['shoulder_mid_shift_cm', 'pelvis_mid_shift_cm'],
  gap_varum: ['R_knee_valgus_deg', 'L_knee_valgus_deg'], gap_valgum: ['R_knee_valgus_deg', 'L_knee_valgus_deg'],
  forward_head: ['ear_minus_shoulder_cm', 'CVA_proxy_deg'], rounded_shoulder: ['shoulder_minus_hip_cm'], sway_back: ['hip_to_plumb_cm', 'shoulder_minus_hip_cm'],
  chin_up: ['head_pitch_deg'], trunk_forward: ['trunk_seg_deg'], trunk_back: ['trunk_seg_deg'],
};
export function flaggedVars(flags, view) {
  const S = view === 'right' ? 'R' : 'L', out = new Set();
  for (const f of flags || []) {
    if (f.sev === 'info') continue;
    (FLAG_VARS[f.id] || []).forEach(n => out.add(n));
    let m;
    if ((m = /^([RL])_genu_/.exec(f.id))) out.add(`${m[1]}_knee_valgus_deg`);
    if ((m = /^([RL])_rearfoot_/.exec(f.id))) out.add(`${m[1]}_rearfoot_valgus_deg`);
    if ((m = /^([RL])_toe_/.exec(f.id))) out.add(`${m[1]}_toe_out_3D_deg`);
    if (f.id === 'genu_recurvatum' || f.id === 'knee_flexed') out.add(`${S}_knee_flex_deg`);
  }
  return out;
}

const escH = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 平均 ± SD 表（HTML）。baseline：{變數: 基準平均} → 多一欄 Δ */
export function meanSDTable(result, view, flags, baseline = null) {
  const en = getLang() === 'en', bad = flaggedVars(flags, view);
  const rows = postureVars(view).map(n => {
    const st = meanSD(result.filt?.[n]);
    if (!st.n) return '';
    const b = baseline?.[n];
    return `<tr class="${bad.has(n) ? 'bad' : ''}"><td>${escH(varLabel(n, view))}</td><td>${dirText(n, view, st.mean)}</td><td>${st.mean.toFixed(1)} ± ${st.sd.toFixed(1)}</td>${baseline ? `<td>${fin(b) ? (st.mean - b >= 0 ? '+' : '') + (st.mean - b).toFixed(1) : '-'}</td>` : ''}</tr>`;
  }).join('');
  return `<table class="tbl mtbl"><thead><tr><th>${en ? 'Measure' : '項目'}</th><th>${en ? 'Reading' : '判讀'}</th><th>${en ? 'Mean ± SD' : '平均 ± SD'}</th>${baseline ? `<th>Δ ${en ? 'vs baseline' : '相對基準'}</th>` : ''}</tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------------- 姿勢照片 ----------------
const mid = (lm, a, b) => [(lm[a][0] + lm[b][0]) / 2, (lm[a][1] + lm[b][1]) / 2];
const pt = (lm, i) => [lm[i][0], lm[i][1]];

/** 每個標註：[錨點座標, 變數名] */
function anchors(lm, view) {
  if (isSag(view)) {
    const [ear, sh, hip, kn, an] = view === 'right' ? [8, 12, 24, 26, 28] : [7, 11, 23, 25, 27], S = view === 'right' ? 'R' : 'L';
    const trunk = [(lm[sh][0] + lm[hip][0]) / 2, (lm[sh][1] + lm[hip][1]) / 2];
    return [[pt(lm, ear), 'ear_minus_shoulder_cm'], [pt(lm, ear), 'CVA_proxy_deg'], [pt(lm, 0), 'head_pitch_deg'], [pt(lm, sh), 'shoulder_minus_hip_cm'],
      [trunk, 'trunk_seg_deg'], [pt(lm, hip), 'hip_to_plumb_cm'], [pt(lm, kn), `${S}_knee_flex_deg`], [pt(lm, kn), 'knee_to_plumb_cm'], [pt(lm, an), `${S}_ankle_DF_deg`]];
  }
  const eyes = view === 'front' ? mid(lm, 2, 5) : mid(lm, 7, 8), head = view === 'front' ? pt(lm, 0) : mid(lm, 7, 8);
  const shM = mid(lm, 11, 12), hipM = mid(lm, 23, 24), trunk = [(shM[0] + hipM[0]) / 2, (shM[1] + hipM[1]) / 2];
  const a = [[eyes, 'eye_tilt_deg'], [head, 'head_shift_cm'], [shM, 'shoulder_obliquity_deg'], [trunk, 'trunk_seg_deg'], [hipM, 'pelvic_obliquity_deg'], [hipM, 'pelvis_mid_shift_cm'],
    [pt(lm, 26), 'R_knee_valgus_deg'], [pt(lm, 25), 'L_knee_valgus_deg']];
  if (view === 'back') a.push([pt(lm, 30), 'R_rearfoot_valgus_deg'], [pt(lm, 29), 'L_rearfoot_valgus_deg']);
  if (view === 'front') a.push([pt(lm, 32), 'R_toe_out_3D_deg'], [pt(lm, 31), 'L_toe_out_3D_deg']);
  return a;
}

function loadImg(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}

/**
 * 產生標註後的姿勢照片（canvas）。
 * photo: { img: dataURL（未疊圖的原始影格）, lm: 像素座標關鍵點, W, H, up }
 * 照片只裁出人物範圍，左右留白放標籤；有問題的項目以紅字與紅圈標示。數值為整段記錄的平均值。
 */
export async function renderPhoto(photo, view, result, flags, { title = '', visThr = 0.5 } = {}) {
  const im = await loadImg(photo.img), lm = photo.lm, W = photo.W || im.width, H = photo.H || im.height;
  const en = getLang() === 'en', bad = flaggedVars(flags, view);
  const ok = i => lm[i] && lm[i][3] >= visThr;
  // 人物範圍
  const idx = [...Array(33).keys()].filter(ok);
  const xs = idx.map(i => lm[i][0]), ys = idx.map(i => lm[i][1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const shY = (lm[11][1] + lm[12][1]) / 2, headTop = lm[0][1] - (shY - lm[0][1]) * 0.9;
  y0 = Math.min(y0, headTop);
  const bh = y1 - y0 || H;
  y0 -= bh * 0.05; y1 += bh * 0.05;
  const cx = (x0 + x1) / 2, cw = Math.max((x1 - x0) * 1.3, bh * 0.5);
  x0 = cx - cw / 2; x1 = cx + cw / 2;
  x0 = Math.max(0, x0); x1 = Math.min(W, x1); y0 = Math.max(0, y0); y1 = Math.min(H, y1);
  const cropW = x1 - x0, cropH = y1 - y0;

  const IH = 900, s = IH / cropH, IW = Math.round(cropW * s), PANEL = 300, HEAD = 60;
  const cv = document.createElement('canvas');
  cv.width = IW + PANEL * 2; cv.height = IH + HEAD;
  const c = cv.getContext('2d');
  c.fillStyle = '#0f172a'; c.fillRect(0, 0, cv.width, cv.height);
  c.drawImage(im, x0, y0, cropW, cropH, PANEL, HEAD, IW, IH);
  const X = p => PANEL + (p[0] - x0) * s, Y = p => HEAD + (p[1] - y0) * s;
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
  const seg = (a, b, color, w, dash) => { c.save(); c.strokeStyle = color; c.lineWidth = w; if (dash) c.setLineDash(dash); c.beginPath(); c.moveTo(X(a), Y(a)); c.lineTo(X(b), Y(b)); c.stroke(); c.restore(); };
  c.save(); c.beginPath(); c.rect(PANEL, HEAD, IW, IH); c.clip();

  const up = photo.up || [0, -1], perp = [-up[1], up[0]];
  // 鉛垂線：側面通過外踝，正/背面通過雙踝中點
  const foot = isSag(view) ? pt(lm, view === 'right' ? 28 : 27) : mid(lm, 27, 28);
  seg([foot[0] - up[0] * H, foot[1] - up[1] * H], [foot[0] + up[0] * H, foot[1] + up[1] * H], '#facc15', 3, [12, 8]);
  // 骨架（淡）
  const bones = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], [7, 0], [8, 0]];
  for (const [a, b] of bones) if (ok(a) && ok(b)) seg(pt(lm, a), pt(lm, b), 'rgba(255,255,255,.55)', 2.5);
  if (!isSag(view)) {
    // 水平參考線（綠虛線）與實際連線（黃）：眼/耳、肩、骨盆
    for (const [a, b] of [view === 'front' ? [2, 5] : [7, 8], [11, 12], [23, 24]]) if (ok(a) && ok(b)) {
      const m = mid(lm, a, b), L = Math.abs(lm[a][0] - lm[b][0]) * 0.9 + 20 / s;
      seg([m[0] - perp[0] * L, m[1] - perp[1] * L], [m[0] + perp[0] * L, m[1] + perp[1] * L], 'rgba(74,222,128,.9)', 2, [8, 6]);
      seg(pt(lm, a), pt(lm, b), '#fde047', 3.5);
    }
  } else {
    // 側面：各標記點到鉛垂線的水平距離
    for (const i of view === 'right' ? [8, 12, 24, 26] : [7, 11, 23, 25]) if (ok(i)) {
      const p = pt(lm, i), tt = (p[1] - foot[1]) / up[1], q = [foot[0] + up[0] * tt, p[1]];
      seg(p, q, 'rgba(250,204,21,.8)', 2);
    }
  }
  c.restore();

  // 標籤：依錨點左右分到兩側欄，依高度排序避免重疊
  const items = anchors(lm, view).filter(([, n]) => fin(meanSD(result.filt?.[n]).mean)).map(([p, n], k) => {
    const m = meta(n, view), st = meanSD(result.filt[n]);
    return { p, n, bad: bad.has(n), text: `${en ? m.shortEn : m.short} ${dirText(n, view, st.mean)}`, k };
  });
  const bodyCx = (X(pt(lm, 23)) + X(pt(lm, 24))) / 2;
  items.forEach((it, i) => { const dx = X(it.p) - bodyCx; it.side = Math.abs(dx) > 25 ? (dx < 0 ? 'L' : 'R') : (i % 2 ? 'R' : 'L'); });
  const LH = 40, FS = 25;
  for (const side of ['L', 'R']) {
    const col = items.filter(it => it.side === side).sort((a, b) => Y(a.p) - Y(b.p));
    let prev = HEAD + 10;
    col.forEach(it => { it.y = Math.max(Y(it.p), prev + LH); prev = it.y; });
    const over = (col.at(-1)?.y ?? 0) - (cv.height - 14);
    if (over > 0) { let next = cv.height - 14; for (let i = col.length - 1; i >= 0; i--) { col[i].y = Math.min(col[i].y, next); next = col[i].y - LH; } }
    for (const it of col) {
      const color = it.bad ? '#f87171' : '#e2e8f0';
      c.font = font(it.bad ? 800 : 600, FS);
      const tw = c.measureText((it.bad ? '⚠ ' : '') + it.text).width;
      const tx = side === 'L' ? PANEL - 10 - tw : PANEL + IW + 10, ex = side === 'L' ? PANEL - 4 : PANEL + IW + 4;
      c.save(); c.strokeStyle = it.bad ? 'rgba(248,113,113,.9)' : 'rgba(226,232,240,.5)'; c.lineWidth = it.bad ? 2.5 : 1.5;
      c.beginPath(); c.moveTo(ex, it.y - 7); c.lineTo(X(it.p), Y(it.p)); c.stroke(); c.restore();
      c.fillStyle = color; c.fillText((it.bad ? '⚠ ' : '') + it.text, tx, it.y);
      c.beginPath(); c.arc(X(it.p), Y(it.p), it.bad ? 13 : 5, 0, 7);
      if (it.bad) { c.strokeStyle = '#ef4444'; c.lineWidth = 4; c.stroke(); } else { c.fillStyle = '#e2e8f0'; c.fill(); }
    }
  }
  // 標題列
  const nBad = (flags || []).filter(f => f.sev !== 'info').length;
  c.fillStyle = '#0f766e'; c.fillRect(0, 0, cv.width, HEAD);
  c.fillStyle = '#fff'; c.font = font(800, 28); c.fillText(title, 16, 38);
  c.font = font(700, 22); c.textAlign = 'right';
  c.fillStyle = nBad ? '#fecaca' : '#ccfbf1';
  c.fillText(nBad ? (en ? `${nBad} finding(s)` : `問題 ${nBad} 項`) : (en ? 'No findings' : '未見明顯問題'), cv.width - 16, 37);
  c.textAlign = 'left';
  return cv;
}

/** 四面合成一張（2×2），供下載 */
export function composeBoard(canvases) {
  const list = canvases.filter(Boolean); if (!list.length) return null;
  const cellH = 956, cellW = Math.max(...list.map(cv => cv.width * cellH / cv.height));
  const cols = list.length > 1 ? 2 : 1, rows = Math.ceil(list.length / cols), gap = 12;
  const out = document.createElement('canvas');
  out.width = Math.round(cols * cellW + (cols + 1) * gap); out.height = Math.round(rows * cellH + (rows + 1) * gap);
  const c = out.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, out.width, out.height);
  list.forEach((cv, i) => {
    const w = cv.width * cellH / cv.height, col = i % cols, row = Math.floor(i / cols);
    c.drawImage(cv, gap + col * (cellW + gap) + (cellW - w) / 2, gap + row * (cellH + gap), w, cellH);
  });
  return out;
}
