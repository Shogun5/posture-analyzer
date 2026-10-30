// rom.js — 關節活動度（ROM）測試：動作清單、口令時間軸、常模、分析
//
// 每個動作只在「適合的觀測面」量測（2D 只能量到與鏡頭平行的平面）：
//   正面（額狀面）：肩外展/內收、軀幹側彎、頸側屈、髖外展
//   側面（矢狀面）：肩屈曲/伸展、肘屈曲、髖屈曲/伸展、膝屈曲、軀幹前彎/後仰、頸屈曲/伸展
// 角度 = 變數（biomech.computeVars）× sign，以鉛垂線/解剖中立位為 0°（絕對角度）；起始姿勢另存（頸屈伸例外，見 analyzeRom）
// 常模：AAOS（Greene & Heckman 1994）；頸椎採講義 P138 修訂註記（AAOS/Youdas）；肩內收採 Magee

import { processRecording } from './biomech.js';
import { summarize } from './filters.js';

export const BASE_SEC = 1.5;   // 開始的靜態基準時間

// 口令時間軸：靜止 → 正向到最大 → 停住 → 回到 0 →（反向到最大 → 停住 → 回到 0）
// demo(v) 回傳示範人形的參數；arcs 指定示範圖上要畫角度弧的關節
export const MOVES = [
  // ---------- 正面 ----------
  { id: 'sh_abd', view: 'front', zh: '雙肩 外展／內收', en: 'Shoulder abduction / adduction (both)',
    vars: [{ name: 'R_shoulder_abd_deg', side: 'R' }, { name: 'L_shoulder_abd_deg', side: 'L' }],
    lm: [11, 12, 13, 14, 15, 16, 23, 24],
    introZh: '雙手放在身體兩側，手掌朝前。聽口令，雙手伸直從兩側往上舉到最高，再放下，在身體前方交叉。',
    introEn: 'Arms at your sides, palms forward. On cue, raise both straight arms out to the side and overhead, then lower and cross them in front of your body.',
    pos: { to: 170, zh: '外展', en: 'abduction', norm: 180, src: 'AAOS', cueZh: '雙手從兩側往上舉到最高', cueEn: 'Raise both arms out and up as high as you can', sZh: '雙手往上舉', sEn: 'Arms up' },
    neg: { to: -35, zh: '內收', en: 'adduction', norm: 50, src: 'Magee', cueZh: '雙手在身體前方交叉', cueEn: 'Cross your arms in front of your body', sZh: '雙手前面交叉', sEn: 'Cross arms' },
    demo: v => ({ shAbdR: v, shAbdL: v }), arcs: [['SR', 'trunkDown', 'armR'], ['SL', 'trunkDown', 'armL']] },
  { id: 'trunk_lat', view: 'front', zh: '軀幹 側彎（右／左）', en: 'Trunk lateral flexion (R / L)',
    vars: [{ name: 'trunk_seg_deg', side: '' }], lm: [11, 12, 23, 24],
    introZh: '雙腳與肩同寬，雙手放大腿外側。聽口令，身體往右側彎，手沿大腿往下滑，再往左側彎。臀部不要移動。',
    introEn: 'Feet shoulder-width, hands on the side of your thighs. On cue, bend to the right sliding your hand down the thigh, then to the left. Keep hips still.',
    pos: { to: 30, zh: '右側彎', en: 'right', norm: 25, src: 'AAOS', cueZh: '身體往右側彎到最低', cueEn: 'Bend to the right as far as you can', sZh: '往右彎', sEn: 'Bend right' },
    neg: { to: -30, zh: '左側彎', en: 'left', norm: 25, src: 'AAOS', cueZh: '身體往左側彎到最低', cueEn: 'Bend to the left as far as you can', sZh: '往左彎', sEn: 'Bend left' },
    demo: v => ({ trunkLat: v }), arcs: [['P', 'up', 'trunkUp']] },
  { id: 'neck_lat', view: 'front', zh: '頸部 側屈（右／左）', en: 'Neck lateral flexion (R / L)',
    vars: [{ name: 'eye_tilt_deg', side: '', sign: -1 }], lm: [0, 2, 5, 7, 8, 11, 12],
    introZh: '眼睛看前方，肩膀放鬆。聽口令，頭往右側彎，耳朵靠近右肩，再往左側彎。肩膀不要聳起，臉不要轉。',
    introEn: 'Look straight ahead, shoulders relaxed. On cue, tilt your head to the right, ear toward shoulder, then to the left. Do not shrug or turn your face.',
    pos: { to: 40, zh: '右側屈', en: 'right', norm: 45, src: 'AAOS（講義 P138：20–45）', cueZh: '頭往右側彎', cueEn: 'Tilt your head to the right', sZh: '頭往右彎', sEn: 'Head right' },
    neg: { to: -40, zh: '左側屈', en: 'left', norm: 45, src: 'AAOS（講義 P138：20–45）', cueZh: '頭往左側彎', cueEn: 'Tilt your head to the left', sZh: '頭往左彎', sEn: 'Head left' },
    demo: v => ({ neckLat: v }), arcs: [['N', 'trunkUp', 'head']] },
  { id: 'hip_abd_R', view: 'front', zh: '右髖 外展', en: 'Right hip abduction',
    vars: [{ name: 'R_hip_abd_deg', side: 'R' }], lm: [23, 24, 25, 26, 27, 28],
    introZh: '可以用左手扶牆或椅背。聽口令，右腳伸直往右側抬起到最高，身體保持直立不要側傾，再放下。',
    introEn: 'You may hold a wall or chair with your left hand. On cue, lift your straight right leg out to the side, keep your trunk upright, then lower it.',
    pos: { to: 40, zh: '外展', en: 'abduction', norm: 45, src: 'AAOS', cueZh: '右腳往右側抬到最高', cueEn: 'Lift your right leg out to the side', sZh: '右腳往旁抬', sEn: 'Right leg out' }, neg: null,
    demo: v => ({ hipAbdR: v }), arcs: [['HR', 'down', 'legR']] },
  { id: 'hip_abd_L', view: 'front', zh: '左髖 外展', en: 'Left hip abduction',
    vars: [{ name: 'L_hip_abd_deg', side: 'L' }], lm: [23, 24, 25, 26, 27, 28],
    introZh: '可以用右手扶牆或椅背。聽口令，左腳伸直往左側抬起到最高，身體保持直立，再放下。',
    introEn: 'You may hold a wall or chair with your right hand. On cue, lift your straight left leg out to the side, keep your trunk upright, then lower it.',
    pos: { to: 40, zh: '外展', en: 'abduction', norm: 45, src: 'AAOS', cueZh: '左腳往左側抬到最高', cueEn: 'Lift your left leg out to the side', sZh: '左腳往旁抬', sEn: 'Left leg out' }, neg: null,
    demo: v => ({ hipAbdL: v }), arcs: [['HL', 'down', 'legL']] },
  // ---------- 右側面 ----------
  ...sideMoves('R'),
  { id: 'trunk_flex', view: 'right', zh: '軀幹 前彎／後仰', en: 'Trunk flexion / extension',
    vars: [{ name: 'trunk_seg_deg', side: '' }], lm: [12, 24, 26, 28],
    introZh: '雙腳與髖同寬，膝蓋打直。聽口令，身體慢慢往前彎到最低，回正後雙手扶腰，身體往後仰。',
    introEn: 'Feet hip-width, knees straight. On cue, slowly bend forward as far as you can, come back up, then with hands on hips lean back.',
    pos: { to: 80, zh: '前彎', en: 'flexion', norm: 80, src: 'AAOS（胸腰椎）', cueZh: '身體慢慢往前彎到最低', cueEn: 'Bend forward slowly as far as you can', sZh: '往前彎', sEn: 'Bend forward' },
    neg: { to: -25, zh: '後仰', en: 'extension', norm: 25, src: 'AAOS（胸腰椎）', cueZh: '雙手扶腰，身體往後仰', cueEn: 'Hands on hips, lean back', sZh: '扶腰往後仰', sEn: 'Lean back' },
    demo: v => ({ trunkFlex: v }), arcs: [['P', 'up', 'trunkUp']] },
  { id: 'neck_flex', view: 'right', ref: 'start', zh: '頸部 屈曲／伸展', en: 'Neck flexion / extension',
    vars: [{ name: 'head_pitch_deg', side: '', sign: -1 }], lm: [0, 8, 12],
    introZh: '坐姿或站姿，身體不動。聽口令，下巴往胸口低頭到最低，回正後抬頭往後仰到最高。',
    introEn: 'Keep your trunk still. On cue, tuck your chin to your chest, come back, then look up and tilt your head back.',
    pos: { to: 60, zh: '屈曲', en: 'flexion', norm: 80, src: '講義 P138（80–90）', cueZh: '低頭，下巴靠近胸口', cueEn: 'Chin to chest', sZh: '低頭', sEn: 'Chin down' },
    neg: { to: -55, zh: '伸展', en: 'extension', norm: 70, src: '講義 P138', cueZh: '抬頭往後仰', cueEn: 'Look up and tilt your head back', sZh: '抬頭', sEn: 'Look up' },
    demo: v => ({ neckFlex: v }), arcs: [['N', 'trunkUp', 'head']] },
  // ---------- 左側面 ----------
  ...sideMoves('L'),
];

function sideMoves(S) {
  const zh = S === 'R' ? '右' : '左', en = S === 'R' ? 'Right' : 'Left', view = S === 'R' ? 'right' : 'left';
  const L = S === 'R' ? { sh: 12, el: 14, wr: 16, hip: 24, kn: 26, an: 28 } : { sh: 11, el: 13, wr: 15, hip: 23, kn: 25, an: 27 };
  return [
    { id: `${S}_sh_flex`, view, zh: `${zh}肩 屈曲／伸展`, en: `${en} shoulder flexion / extension`,
      vars: [{ name: `${S}_shoulder_flex_deg`, side: S }], lm: [L.sh, L.el, L.wr, L.hip],
      introZh: `${zh}手伸直放身體旁邊，手掌朝內。聽口令，${zh}手從前方往上舉到最高，再放下，往後伸到最遠。身體不要後仰。`,
      introEn: `${en} arm straight at your side. On cue, raise it forward and overhead as high as you can, lower it, then reach backward. Do not lean back.`,
      pos: { to: 170, zh: '屈曲', en: 'flexion', norm: 180, src: 'AAOS', cueZh: `${zh}手從前方往上舉到最高`, cueEn: 'Raise your arm forward and up', sZh: '手往前舉高', sEn: 'Arm up' },
      neg: { to: -50, zh: '伸展', en: 'extension', norm: 60, src: 'AAOS', cueZh: `${zh}手往後伸到最遠`, cueEn: 'Reach your arm backward', sZh: '手往後伸', sEn: 'Arm back' },
      demo: v => ({ shFlex: v }), arcs: [['S', 'trunkDown', 'arm']] },
    { id: `${S}_elbow`, view, zh: `${zh}肘 屈曲`, en: `${en} elbow flexion`,
      vars: [{ name: `${S}_elbow_flex_deg`, side: S }], lm: [L.sh, L.el, L.wr],
      introZh: `${zh}上臂貼住身體，手掌朝前。聽口令，手肘彎曲，手掌盡量靠近肩膀，再伸直。`,
      introEn: `${en} upper arm against your body, palm forward. On cue, bend the elbow bringing your hand to your shoulder, then straighten.`,
      pos: { to: 140, zh: '屈曲', en: 'flexion', norm: 150, src: 'AAOS', cueZh: '手肘彎曲，手掌靠近肩膀', cueEn: 'Bend your elbow fully', sZh: '彎手肘', sEn: 'Bend elbow' }, neg: null,
      demo: v => ({ elbowFlex: v }), arcs: [['E', 'arm', 'forearm']] },
    { id: `${S}_hip_flex`, view, zh: `${zh}髖 屈曲／伸展`, en: `${en} hip flexion / extension`,
      vars: [{ name: `${S}_hip_flex_deg`, side: S }], lm: [L.sh, L.hip, L.kn, L.an],
      introZh: `可以扶牆。聽口令，${zh}膝彎曲，大腿往前往上抬到最高，放下後${zh}腳伸直往後抬。身體保持直立。`,
      introEn: `You may hold a wall. On cue, bend your ${en.toLowerCase()} knee and lift the thigh as high as you can, lower it, then extend the straight leg backward. Keep upright.`,
      pos: { to: 110, zh: '屈曲', en: 'flexion', norm: 120, src: 'AAOS（屈膝）', cueZh: '大腿往前往上抬到最高', cueEn: 'Lift your thigh up', sZh: '抬大腿', sEn: 'Thigh up' },
      neg: { to: -20, zh: '伸展', en: 'extension', norm: 30, src: 'AAOS', cueZh: '腳伸直往後抬', cueEn: 'Extend your leg backward', sZh: '腳往後抬', sEn: 'Leg back' },
      demo: v => ({ hipFlex: v, kneeFlex: v > 0 ? v * 0.9 : 0 }), arcs: [['Hp', 'down', 'thigh']] },
    { id: `${S}_knee`, view, zh: `${zh}膝 屈曲`, en: `${en} knee flexion`,
      vars: [{ name: `${S}_knee_flex_deg`, side: S }], lm: [L.hip, L.kn, L.an],
      introZh: `可以扶牆，大腿保持垂直。聽口令，${zh}腳跟往後往上，盡量靠近臀部，再放下。`,
      introEn: `You may hold a wall; keep the thigh vertical. On cue, bring your ${en.toLowerCase()} heel up toward your buttock, then lower it.`,
      pos: { to: 120, zh: '屈曲', en: 'flexion', norm: 135, src: 'AAOS', cueZh: '腳跟往後往上，靠近臀部', cueEn: 'Heel toward your buttock', sZh: '腳跟靠臀部', sEn: 'Heel up' }, neg: null,
      demo: v => ({ kneeFlex: v }), arcs: [['K', 'thigh', 'shank']] },
  ];
}

export const moveById = id => MOVES.find(m => m.id === id);

/** 口令時間軸 keys: [{t, v, cueKey}]（cueKey: ready/pos/hold/back/neg/hold2/back2） */
export function timeline(m) {
  const k = [{ t: 0, v: 0, cue: 'ready' }, { t: BASE_SEC, v: 0, cue: 'pos' }, { t: BASE_SEC + 2.5, v: m.pos.to, cue: 'hold' },
    { t: BASE_SEC + 4, v: m.pos.to, cue: 'back' }, { t: BASE_SEC + 6, v: 0 }];
  if (m.neg) k.push({ t: BASE_SEC + 6.3, v: 0, cue: 'neg' }, { t: BASE_SEC + 8.5, v: m.neg.to, cue: 'hold2' },
    { t: BASE_SEC + 10, v: m.neg.to, cue: 'back2' }, { t: BASE_SEC + 12, v: 0 });
  return { keys: k, duration: k[k.length - 1].t + 0.8 };
}
const ease = x => 0.5 - 0.5 * Math.cos(Math.PI * x);
export function demoValueAt(m, t) {
  const { keys } = timeline(m);
  for (let i = 1; i < keys.length; i++) if (t <= keys[i].t) {
    const a = keys[i - 1], b = keys[i], f = (t - a.t) / Math.max(1e-6, b.t - a.t);
    return a.v + (b.v - a.v) * ease(Math.min(1, Math.max(0, f)));
  }
  return 0;
}
/** 口令文字；short = 簡易版（只講動作） */
export function cueText(m, cue, lang, short = false) {
  const zh = lang !== 'en';
  const pick = c => (short ? (zh ? c.sZh : c.sEn) : (zh ? c.cueZh : c.cueEn));
  switch (cue) {
    case 'ready': return short ? (zh ? '不要動' : 'Still') : (zh ? '保持不動' : 'Hold still');
    case 'pos': return pick(m.pos);
    case 'neg': return pick(m.neg);
    case 'hold': case 'hold2': return zh ? '停住' : 'Hold';
    case 'back': case 'back2': return short ? (zh ? '回來' : 'Back') : (zh ? '慢慢回來' : 'Slowly come back');
    default: return '';
  }
}

/** 角度展開：相鄰兩點跳超過 180° 視為繞圈（例如手舉過頭 170° → −175°），補回 ±360° 讓曲線連續 */
export function unwrapDeg(a) {
  const out = [...a]; let off = 0, prev = NaN;
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i])) continue;
    if (Number.isFinite(prev)) { const d = out[i] + off - prev; if (d > 180) off -= 360; else if (d < -180) off += 360; }
    out[i] += off; prev = out[i];
  }
  return out;
}

/** 起始姿勢角度：開始 ~2 秒內「最穩定」的 0.5 秒（標準差最小）取中位數。受測者聽到口令時晃動也不影響 */
export function stableStart(f, t, until = BASE_SEC + 0.5, win = 0.5) {
  let best = { sd: Infinity, med: NaN };
  for (let i = 0; i < f.length && t[i] <= until - win; i++) {
    const w = []; for (let j = i; j < f.length && t[j] <= t[i] + win; j++) if (Number.isFinite(f[j])) w.push(f[j]);
    if (w.length < 5) continue;
    const mu = w.reduce((s, x) => s + x, 0) / w.length, sd = Math.sqrt(w.reduce((s, x) => s + (x - mu) ** 2, 0) / w.length);
    if (sd < best.sd) { w.sort((a, b) => a - b); best = { sd, med: w[w.length >> 1] }; }
  }
  return Number.isFinite(best.med) ? best.med : f.find(Number.isFinite) ?? NaN;
}

/**
 * 分析一次 ROM 記錄：沿用姿勢分析的前處理（內插、30 Hz、移動平均）。
 * 主要結果 = 「絕對角度」：以校正後鉛垂線/解剖中立位為 0°（手臂自然下垂、身體直立 = 0°），不扣起始姿勢，
 *   開始時受測者若晃動也不會影響結果。
 * 例外：頸部屈伸（耳–鼻連線）沒有可靠的解剖 0°，改以起始姿勢為 0°（m.ref = 'start'）。
 * 另外保留起始姿勢角度（start）與相對起始的變化量（relPos / relNeg）。
 */
export function analyzeRom(m, frames, ctx) {
  const r = processRecording(frames, { ...ctx, view: m.view });
  const t = r.t, out = { id: m.id, view: m.view, ref: m.ref ?? 'abs', t, tRaw: r.tRaw, series: {}, raw: {}, base: {}, metrics: {}, qc: r.qc };
  for (const v of m.vars) {
    const sign = v.sign ?? 1;
    const abs = unwrapDeg((r.filt[v.name] || []).map(x => sign * x));
    const start = stableStart(abs, t);
    const f = out.ref === 'start' ? abs.map(x => x - start) : abs;   // 主要結果曲線
    const st = summarize(f, t);
    const valid = Math.round(100 * (r.raw[v.name] || []).filter(Number.isFinite).length / Math.max(1, r.tRaw.length));
    const pos = st.max, neg = m.neg ? st.min : NaN;
    out.series[v.name] = f;
    out.raw[v.name] = unwrapDeg((r.raw[v.name] || []).map(x => sign * x));
    out.base[v.name] = start;
    const ref0 = out.ref === 'start' ? 0 : start;
    out.metrics[v.name] = {
      side: v.side, start, pos, tPos: st.tmax, neg, tNeg: m.neg ? st.tmin : NaN, rom: m.neg ? pos - neg : pos,
      relPos: pos - ref0, relNeg: m.neg ? neg - ref0 : NaN,
      normPos: m.pos.norm, normNeg: m.neg?.norm ?? NaN,
      pctPos: 100 * pos / m.pos.norm, pctNeg: m.neg ? 100 * -neg / m.neg.norm : NaN, validPct: valid,
    };
  }
  return out;
}

/** 左右不對稱：成對動作（R_/L_ 或雙側同時測）回傳 [{label, R, L, asymPct}] */
export function asymmetry(romResults) {
  const rows = [];
  const pair = (label, a, b) => { if (Number.isFinite(a) && Number.isFinite(b)) rows.push({ label, R: a, L: b, asymPct: 100 * Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-6) }); };
  const g = (id, v, k = 'pos') => romResults?.[id]?.metrics?.[v]?.[k];
  pair('shoulder abd', g('sh_abd', 'R_shoulder_abd_deg'), g('sh_abd', 'L_shoulder_abd_deg'));
  pair('trunk lat flex', g('trunk_lat', 'trunk_seg_deg'), -g('trunk_lat', 'trunk_seg_deg', 'neg'));
  pair('neck lat flex', g('neck_lat', 'eye_tilt_deg'), -g('neck_lat', 'eye_tilt_deg', 'neg'));
  pair('hip abd', g('hip_abd_R', 'R_hip_abd_deg'), g('hip_abd_L', 'L_hip_abd_deg'));
  pair('shoulder flex', g('R_sh_flex', 'R_shoulder_flex_deg'), g('L_sh_flex', 'L_shoulder_flex_deg'));
  pair('shoulder ext', -g('R_sh_flex', 'R_shoulder_flex_deg', 'neg'), -g('L_sh_flex', 'L_shoulder_flex_deg', 'neg'));
  pair('elbow flex', g('R_elbow', 'R_elbow_flex_deg'), g('L_elbow', 'L_elbow_flex_deg'));
  pair('hip flex', g('R_hip_flex', 'R_hip_flex_deg'), g('L_hip_flex', 'L_hip_flex_deg'));
  pair('knee flex', g('R_knee', 'R_knee_flex_deg'), g('L_knee', 'L_knee_flex_deg'));
  return rows;
}
