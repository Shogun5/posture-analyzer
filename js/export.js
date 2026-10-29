// export.js — 匯出：CSV（長格式）、影片、PNG、HTML 報告（可列印為 PDF）。全部在本機產生下載。
import { LM_NAMES, VIEWS } from './biomech.js';
import { t, getLang } from './i18n.js';
import { MOVES, asymmetry } from './rom.js';

export function download(data, filename, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export const dataURLtoBlob = u => fetch(u).then(r => r.blob());
const fileBase = s => `posture_${s.subject || 'subject'}_${s.date.slice(0, 10)}`;

/**
 * 長格式 CSV：每列 = 一幀的一個變數
 * 欄位：subject, date, view, stage(raw|filtered), frame, time_s, variable, value
 * variable 名稱含單位後綴（_deg, _cm, _m, _mps, _mps2, _Nkg, _BW, _N, _px）
 * raw = 原始未濾波（原始幀時間）；filtered = 三次樣條內插 + 30 Hz 重取樣 + 移動平均
 */
export function sessionCSV(s, includeRawLandmarks = false) {
  const L = ['subject,date,view,stage,frame,time_s,variable,value'];
  const esc = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const num = x => (Number.isFinite(x) ? +x.toFixed(6) : '');
  for (const view of VIEWS) {
    const r = s.views?.[view]?.result; if (!r) continue;
    const pre = `${esc(s.subject)},${s.date},${view}`;
    for (const [name, arr] of Object.entries(r.raw)) arr.forEach((v, k) => L.push(`${pre},raw,${k},${num(r.tRaw[k])},${name},${num(v)}`));
    for (const [name, arr] of Object.entries(r.filt)) arr.forEach((v, k) => L.push(`${pre},filtered,${k},${num(r.t[k])},${name},${num(v)}`));
    if (includeRawLandmarks) r.rawFrames.forEach((f, k) => {
      f.lm.forEach((p, i) => {
        const n = LM_NAMES[i];
        L.push(`${pre},raw,${k},${num(r.tRaw[k])},lm_${n}_x_px,${num(p[0])}`, `${pre},raw,${k},${num(r.tRaw[k])},lm_${n}_y_px,${num(p[1])}`,
          `${pre},raw,${k},${num(r.tRaw[k])},lm_${n}_visibility,${num(p[3])}`);
        const w = f.wlm?.[i];
        if (w) L.push(`${pre},raw,${k},${num(r.tRaw[k])},world_${n}_x_m,${num(w[0])}`, `${pre},raw,${k},${num(r.tRaw[k])},world_${n}_y_m,${num(w[1])}`,
          `${pre},raw,${k},${num(r.tRaw[k])},world_${n}_z_m,${num(w[2])}`);
      });
    });
    // 每方向摘要（便於 Excel 直接讀）
    for (const [name, st] of Object.entries(r.summary))
      for (const k of ['mean', 'max', 'min', 'rom', 'tmax', 'tmin']) L.push(`${pre},summary,,,${name}__${k},${num(st[k])}`);
  }
  // ROM 測試：view 欄 = rom_<動作 id>；raw = 原始幀的帶號角度（未扣基準）；filtered = 相對 0° 基準
  for (const [id, r] of Object.entries(s.rom || {})) {
    const pre = `${esc(s.subject)},${s.date},rom_${id}`;
    for (const [vn, arr] of Object.entries(r.raw)) arr.forEach((v, k) => L.push(`${pre},raw,${k},${num(r.tRaw[k])},${vn},${num(v)}`));
    for (const [vn, arr] of Object.entries(r.series)) arr.forEach((v, k) => L.push(`${pre},filtered,${k},${num(r.t[k])},${vn.replace(/_deg$/, '_rel_deg')},${num(v)}`));
    for (const [vn, mt] of Object.entries(r.metrics)) {
      const b = vn.replace(/_deg$/, '');
      L.push(`${pre},summary,,,${b}__baseline_deg,${num(r.base[vn])}`, `${pre},summary,,,${b}__pos_peak_deg,${num(mt.pos)}`, `${pre},summary,,,${b}__pos_t_s,${num(mt.tPos)}`,
        `${pre},summary,,,${b}__neg_peak_deg,${num(mt.neg)}`, `${pre},summary,,,${b}__neg_t_s,${num(mt.tNeg)}`, `${pre},summary,,,${b}__rom_deg,${num(mt.rom)}`,
        `${pre},summary,,,${b}__pos_pct_norm,${num(mt.pctPos)}`, `${pre},summary,,,${b}__neg_pct_norm,${num(mt.pctNeg)}`, `${pre},summary,,,${b}__valid_pct,${num(mt.validPct)}`);
    }
  }
  return '﻿' + L.join('\n'); // BOM 讓 Excel 正確顯示中文
}

export function downloadCSV(s, includeRaw) { download(sessionCSV(s, includeRaw), `${fileBase(s)}.csv`, 'text/csv;charset=utf-8'); }

export function downloadVideos(s) {
  for (const v of VIEWS) {
    const vid = s.views?.[v]?.video;
    if (vid?.blob) download(vid.blob, `${fileBase(s)}_${v}.${vid.ext}`);
  }
  for (const [id, r] of Object.entries(s.rom || {})) if (r.video?.blob) download(r.video.blob, `${fileBase(s)}_rom_${id}.${r.video.ext}`);
}

/** 報告中的 ROM 段落 */
function romSection(s, compare) {
  const R = s.rom; if (!R || !Object.keys(R).length) return '';
  const en = getLang() === 'en', f = x => (Number.isFinite(x) ? x.toFixed(0) : '–'), C = compare?.rom;
  let rows = '';
  for (const m of MOVES) {
    const r = R[m.id]; if (!r) continue;
    for (const [vn, mt] of Object.entries(r.metrics)) {
      const c = C?.[m.id]?.metrics?.[vn];
      rows += `<tr><td>${escH(en ? m.en : m.zh)}</td><td>${mt.side}</td><td>${escH(en ? m.pos.en : m.pos.zh)} ${f(mt.pos)}° / ${m.pos.norm}° (${f(mt.pctPos)}%)</td>`
        + `<td>${m.neg ? `${escH(en ? m.neg.en : m.neg.zh)} ${f(-mt.neg)}° / ${m.neg.norm}° (${f(mt.pctNeg)}%)` : ''}</td><td>${f(mt.rom)}</td><td>${mt.validPct}</td>${C ? `<td>${f(c?.rom)}</td>` : ''}</tr>`;
    }
  }
  const asym = asymmetry(R).map(a => `<tr><td>${a.label}</td><td>${f(a.R)}</td><td>${f(a.L)}</td><td>${a.asymPct.toFixed(0)}%</td></tr>`).join('');
  const snaps = MOVES.filter(m => R[m.id]?.snapshots?.pos).map(m => `<figure style="display:inline-block;margin:4px;width:180px"><img src="${R[m.id].snapshots.pos}" style="width:100%"><figcaption style="font-size:11px">${escH(en ? m.en : m.zh)}</figcaption></figure>`).join('');
  return `<section><h2>ROM</h2><table><tr><th>${t('romMove')}</th><th>${t('side')}</th><th>+ (${t('norm')})</th><th>− (${t('norm')})</th><th>${t('romTotal')}</th><th>${t('validPct')}</th>${C ? `<th>${t('preRom')}</th>` : ''}</tr>${rows}</table>
    ${asym ? `<h3>${t('asym')}</h3><table><tr><th></th><th>${t('right')}</th><th>${t('left')}</th><th>${t('asymPct')}</th></tr>${asym}</table>` : ''}
    <p class="qc">${en ? 'Angles relative to the first 1.5 s of still standing (0°). Norms: AAOS; cervical per lecture P138; shoulder adduction per Magee. 2D projection — keep the moving limb parallel to the camera.' : '角度相對開始 1.5 秒靜止站姿（0°）。常模：AAOS；頸椎依講義 P138；肩內收依 Magee。2D 投影量測，動作肢段需與鏡頭平行。'}</p>${snaps}</section>`;
}

const f2 = x => (Number.isFinite(x) ? x.toFixed(1) : '–');
const escH = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 報告中每方向列出的重點變數
export const KEY_VARS = {
  front: ['eye_tilt_deg', 'head_shift_cm', 'shoulder_obliquity_deg', 'pelvic_obliquity_deg', 'trunk_seg_deg', 'shoulder_mid_shift_cm', 'pelvis_mid_shift_cm', 'COM_shift_cm',
    'R_knee_valgus_deg', 'L_knee_valgus_deg', 'R_hip_abd_deg', 'L_hip_abd_deg', 'R_toe_out_3D_deg', 'L_toe_out_3D_deg', 'COM_disp_m'],
  back: ['eye_tilt_deg', 'shoulder_obliquity_deg', 'pelvic_obliquity_deg', 'trunk_seg_deg', 'shoulder_mid_shift_cm', 'pelvis_mid_shift_cm', 'COM_shift_cm',
    'R_knee_valgus_deg', 'L_knee_valgus_deg', 'R_rearfoot_valgus_deg', 'L_rearfoot_valgus_deg', 'COM_disp_m'],
  right: ['ear_minus_shoulder_cm', 'CVA_proxy_deg', 'head_pitch_deg', 'shoulder_minus_hip_cm', 'ear_to_plumb_cm', 'shoulder_to_plumb_cm', 'hip_to_plumb_cm', 'knee_to_plumb_cm', 'COM_to_plumb_cm',
    'trunk_seg_deg', 'R_neck_flex_deg', 'R_shoulder_flex_deg', 'R_elbow_flex_deg', 'R_hip_flex_deg', 'R_knee_flex_deg', 'R_ankle_DF_deg', 'R_thigh_seg_deg', 'R_shank_seg_deg', 'COM_disp_m'],
  left: ['ear_minus_shoulder_cm', 'CVA_proxy_deg', 'head_pitch_deg', 'shoulder_minus_hip_cm', 'ear_to_plumb_cm', 'shoulder_to_plumb_cm', 'hip_to_plumb_cm', 'knee_to_plumb_cm', 'COM_to_plumb_cm',
    'trunk_seg_deg', 'L_neck_flex_deg', 'L_shoulder_flex_deg', 'L_elbow_flex_deg', 'L_hip_flex_deg', 'L_knee_flex_deg', 'L_ankle_DF_deg', 'L_thigh_seg_deg', 'L_shank_seg_deg', 'COM_disp_m'],
};

/** 自足的 HTML 報告（圖片以 dataURL 內嵌）；在瀏覽器開啟後按「列印」→ 另存 PDF */
export function reportHTML(s, chartImgs = [], compare = null, baseline = null) {
  const en = getLang() === 'en';
  const views = VIEWS.filter(v => s.views?.[v]?.result);
  const sec = views.map(v => {
    const V = s.views[v], r = V.result;
    const flags = (V.flags || []).map(fl => `<tr class="${fl.sev}"><td>${escH(en ? fl.en : fl.zh)}</td><td>${f2(fl.value)} ${fl.unit}</td><td>${f2(fl.thr)}</td><td>${fl.sev === 'info' ? '' : t(fl.sev)}</td><td>${fl.slides}</td><td>${escH(en ? fl.tipEn : fl.tipZh)}</td></tr>`).join('');
    const rows = KEY_VARS[v].filter(n => r.summary[n]).map(n => {
      const st = r.summary[n], c = compare?.views?.[v]?.result?.summary?.[n], b = baseline?.[v]?.[n];
      return `<tr><td>${n}</td><td>${f2(st.mean)}</td><td>${f2(st.min)}</td><td>${f2(st.max)}</td><td>${f2(st.rom)}</td><td>${f2(st.tmax)}</td>${compare ? `<td>${f2(c?.mean)}</td><td>${f2(st.mean - (c?.mean ?? NaN))}</td>` : ''}${baseline ? `<td>${f2(st.mean - (b ?? NaN))}</td>` : ''}</tr>`;
    }).join('');
    return `<section><h2>${t('view_' + v)}</h2>
      <div class="row">${V.snapshot ? `<img src="${V.snapshot}" alt="${v}">` : ''}
      <div><p class="qc">${t('qc')}: ${t('fps')} ${f2(r.qc.fps)} · ${t('validPct')} ${r.qc.validPct_keypoints}% · ${t('swapped')} ${r.qc.swappedFrames} · ${t('scale')} ${(r.qc.scale_m_per_px * 1000).toFixed(3)} mm/px · plumb ${f2(r.qc.plumb_alpha_deg)}°</p>
      <h3>${t('flags')}</h3>${flags ? `<table><tr><th>${t('flags')}</th><th>${t('value')}</th><th>${t('threshold')}</th><th>${t('severity')}</th><th>${t('slides')}</th><th>${t('note')}</th></tr>${flags}</table>` : `<p>${t('noFlags')}</p>`}</div></div>
      <h3>${t('summary')}</h3><table><tr><th>${t('variables')}</th><th>${t('mean')}</th><th>${t('min')}</th><th>${t('max')}</th><th>${t('rom')}</th><th>${t('tmax')}</th>${compare ? `<th>${en ? 'Pre mean' : '前測平均'}</th><th>Δ</th>` : ''}${baseline ? `<th>Δ ${t('baseline')}</th>` : ''}</tr>${rows}</table></section>`;
  }).join('');
  const imgs = chartImgs.map(u => `<img class="chart" src="${u}">`).join('');
  return `<!doctype html><html lang="${en ? 'en' : 'zh-Hant'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t('reportTitle')} ${escH(s.subject)} ${s.date.slice(0, 10)}</title>
<style>body{font:14px/1.5 system-ui,"Noto Sans TC",sans-serif;margin:24px;color:#111;background:#fff}h1{font-size:22px}h2{border-bottom:2px solid #0f766e;padding-bottom:4px}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:12px}td,th{border:1px solid #ccc;padding:3px 6px;text-align:left;vertical-align:top}th{background:#f1f5f9}
tr.marked td:first-child{font-weight:700;color:#b91c1c}tr.mild td:first-child{color:#b45309}tr.info td{color:#475569;font-style:italic}
.row{display:flex;gap:16px;flex-wrap:wrap}.row img{max-width:320px;max-height:480px;border:1px solid #ccc}.row>div{flex:1;min-width:280px}.qc{color:#475569;font-size:12px}
img.chart{max-width:100%;margin:8px 0;border:1px solid #eee}section{page-break-inside:avoid;margin-bottom:24px}@media print{button{display:none}body{margin:8mm}}</style></head><body>
<button onclick="print()">🖨 ${en ? 'Print / Save as PDF' : '列印 / 另存 PDF'}</button>
<h1>${t('reportTitle')}</h1>
<p>${t('subject')}: <b>${escH(s.subject)}</b> · ${t('date')}: ${new Date(s.date).toLocaleString()} · ${t('height')}: ${f2(s.height_m * 100)} · ${t('mass')}: ${f2(s.mass_kg)} · ${t('model')}: MediaPipe Pose ${escH(s.model)} · ${t('plumbStatus')}: ${escH(s.plumbMode)}</p>
${compare ? `<p>${en ? 'Compared with' : '比較對象'}: ${new Date(compare.date).toLocaleString()}</p>` : ''}
${sec}${romSection(s, compare)}${imgs ?`<section><h2>${en ? 'Charts' : '圖表'}</h2>${imgs}</section>` : ''}
<section><h2>${t('method')}</h2><p>${en
    ? 'MediaPipe Pose Landmarker (33 landmarks, local inference). Low-visibility points (< threshold) removed, gaps filled by natural cubic spline, resampled to 30 Hz, moving-average smoothed; derivatives by Savitzky–Golay. Scale from stature (eye height = 0.936 × stature). Angles relative to the calibrated plumb line; anatomical convention (neutral = 0°). COM by Winter (2009) segment parameters.'
    : 'MediaPipe Pose Landmarker（33 點，本機推論）。可信度低於閾值的點視為缺值，以自然三次樣條內插並重取樣至 30 Hz，再以移動平均平滑；速度/加速度以 Savitzky–Golay 導數求得。比例尺以身高換算（眼高 = 0.936 × 身高）。角度以校正後鉛垂線為基準、解剖學定義（中立 = 0°）。COM 依 Winter (2009) 節段參數。'}</p>
<h2>${t('limits')}</h2><p>${en
    ? '2D projection error, occlusion of the far side in lateral views, lens distortion, and landmark bias (hip joint centre ≠ ASIS/PSIS; no spinal landmarks). Results are screening indicators, not diagnoses.'
    : '2D 投影誤差、側面拍攝時遠側肢體遮擋、鏡頭畸變、關鍵點偏差（髖關節中心 ≠ ASIS/PSIS，無脊椎標記點）。結果為篩檢指標，非臨床診斷。'}</p></section>
</body></html>`;
}
