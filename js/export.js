// export.js — 匯出：CSV（長格式）、影片、PNG、HTML 報告（可列印為 PDF）。全部在本機產生下載。
import { LM_NAMES, VIEWS } from './biomech.js';
import { t, getLang } from './i18n.js';
import { MOVES, asymmetry } from './rom.js';
import { meanSD, meanSDTable } from './posturecard.js';

export function download(data, filename, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export const dataURLtoBlob = u => fetch(u).then(r => r.blob());
// 檔名：受測者_類型_日期_時分（本地時間），例如 S01_posture_2026-10-30_1425、S01_AROM_2026-10-30_1502
export const sessionKind = s => (Object.keys(s.views || {}).length ? 'posture' : 'AROM');
export function fileBase(s, kind = sessionKind(s)) {
  const d = new Date(s.date), p = n => String(n).padStart(2, '0');
  return `${s.subject || 'subject'}_${kind}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

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
      for (const k of ['mean', 'sd', 'max', 'min', 'rom', 'tmax', 'tmin']) L.push(`${pre},summary,,,${name}__${k},${num(k === 'sd' ? meanSD(r.filt[name]).sd : st[k])}`);
  }
  // ROM 測試：view 欄 = rom_<動作 id>；raw = 原始幀角度；filtered = 濾波後角度（相對鉛垂/中立位；頸屈伸相對起始姿勢）
  for (const [id, r] of Object.entries(s.rom || {})) {
    const pre = `${esc(s.subject)},${s.date},rom_${id}`;
    for (const [vn, arr] of Object.entries(r.raw)) arr.forEach((v, k) => L.push(`${pre},raw,${k},${num(r.tRaw[k])},${vn},${num(v)}`));
    for (const [vn, arr] of Object.entries(r.series)) arr.forEach((v, k) => L.push(`${pre},filtered,${k},${num(r.t[k])},${vn.replace(/_deg$/, r.ref === 'start' ? '_rel_start_deg' : '_abs_deg')},${num(v)}`));
    for (const [vn, mt] of Object.entries(r.metrics)) {
      const b = vn.replace(/_deg$/, '');
      L.push(`${pre},summary,,,${b}__start_deg,${num(r.base[vn])}`, `${pre},summary,,,${b}__pos_rel_start_deg,${num(mt.relPos)}`, `${pre},summary,,,${b}__neg_rel_start_deg,${num(mt.relNeg)}`, `${pre},summary,,,${b}__pos_peak_deg,${num(mt.pos)}`, `${pre},summary,,,${b}__pos_t_s,${num(mt.tPos)}`,
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
      rows += `<tr><td>${escH(en ? m.en : m.zh)}</td><td>${mt.side}</td><td>${f(mt.start)}°</td><td>${escH(en ? m.pos.en : m.pos.zh)} ${f(mt.pos)}° / ${m.pos.norm}° (${f(mt.pctPos)}%)</td>`
        + `<td>${m.neg ? `${escH(en ? m.neg.en : m.neg.zh)} ${f(-mt.neg)}° / ${m.neg.norm}° (${f(mt.pctNeg)}%)` : ''}</td><td>${f(mt.rom)}</td><td>${mt.validPct}</td>${C ? `<td>${f(c?.rom)}</td>` : ''}</tr>`;
    }
  }
  const asym = asymmetry(R).map(a => `<tr><td>${a.label}</td><td>${f(a.R)}</td><td>${f(a.L)}</td><td>${a.asymPct.toFixed(0)}%</td></tr>`).join('');
  const snaps = MOVES.filter(m => R[m.id]?.snapshots?.pos).map(m => `<figure style="display:inline-block;margin:4px;width:180px"><img src="${R[m.id].snapshots.pos}" style="width:100%"><figcaption style="font-size:11px">${escH(en ? m.en : m.zh)}</figcaption></figure>`).join('');
  return `<section><h2>AROM</h2><table><tr><th>${t('romMove')}</th><th>${t('side')}</th><th>${t('romStart')}</th><th>+ (${t('norm')})</th><th>− (${t('norm')})</th><th>${t('romTotal')}</th><th>${t('validPct')}</th>${C ? `<th>${t('preRom')}</th>` : ''}</tr>${rows}</table>
    ${asym ? `<h3>${t('asym')}</h3><table><tr><th></th><th>${t('right')}</th><th>${t('left')}</th><th>${t('asymPct')}</th></tr>${asym}</table>` : ''}
    <p class="qc">${t('romRefNote')}</p>${snaps}</section>`;
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
// kind：'posture'（四面靜態姿勢）或 'AROM'（關節活動度），兩種報告分開
export function reportHTML(s, photos = {}, compare = null, baseline = null, kind = sessionKind(s)) {
  const en = getLang() === 'en', arom = kind === 'AROM';
  const title = t(arom ? 'reportTitleRom' : 'reportTitle');
  const views = arom ? [] : VIEWS.filter(v => s.views?.[v]?.result);
  // 每個方向：標註照片 + 問題姿勢 + 姿勢指標平均 ± SD（完整統計請下載 CSV）
  const sec = views.map(v => {
    const V = s.views[v], r = V.result, img = photos[v] || V.snapshot;
    const flags = (V.flags || []).filter(fl => fl.sev !== 'info').map(fl => `<tr class="${fl.sev}"><td>${escH(en ? fl.en : fl.zh)}</td><td>${f2(Math.abs(fl.value))} ${fl.unit}</td><td>${f2(Math.abs(fl.thr))}</td><td>${t(fl.sev)}</td><td>${fl.slides}</td><td>${escH(en ? fl.tipEn : fl.tipZh)}</td></tr>`).join('');
    const info = (V.flags || []).filter(fl => fl.sev === 'info').map(fl => `<p class="qc">${escH(en ? fl.en : fl.zh)}</p>`).join('');
    return `<section><h2>${t('view_' + v)}</h2>
      ${img ? `<img class="photo" src="${img}" alt="${v}">` : ''}
      <h3>${t('flags')}</h3>${flags ? `<table><tr><th>${t('flags')}</th><th>${t('value')}</th><th>${t('threshold')}</th><th>${t('severity')}</th><th>${t('slides')}</th><th>${t('note')}</th></tr>${flags}</table>` : `<p>${t('noFlags')}</p>`}${info}
      <h3>${t('postureTable')}</h3>${meanSDTable(r, v, V.flags, baseline?.[v] ?? null)}
      <p class="qc">${t('qc')}: ${t('validPct')} ${r.qc.validPct_keypoints}% · ${t('feetPct')} ${r.qc.feetVisiblePct ?? '-'}% · ${t('scale')} ${(r.qc.scale_m_per_px * 1000).toFixed(3)} mm/px · plumb ${f2(r.qc.plumb_alpha_deg)}°</p></section>`;
  }).join('');
  const imgs = '';
  return `<!doctype html><html lang="${en ? 'en' : 'zh-Hant'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} ${escH(fileBase(s, kind))}</title>
<style>body{font:14px/1.5 system-ui,"Noto Sans TC",sans-serif;margin:24px;color:#111;background:#fff}h1{font-size:22px}h2{border-bottom:2px solid #0f766e;padding-bottom:4px}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:12px}td,th{border:1px solid #ccc;padding:3px 6px;text-align:left;vertical-align:top}th{background:#f1f5f9}
tr.marked td:first-child{font-weight:700;color:#b91c1c}tr.mild td:first-child{color:#b45309}tr.info td{color:#475569;font-style:italic}
.row{display:flex;gap:16px;flex-wrap:wrap}.row img{max-width:320px;max-height:480px;border:1px solid #ccc}img.photo{display:block;max-width:100%;max-height:150mm;margin:8px auto;border:1px solid #ccc}tr.bad td{color:#b91c1c;font-weight:700}.row>div{flex:1;min-width:280px}.qc{color:#475569;font-size:12px}
img.chart{max-width:100%;margin:8px 0;border:1px solid #eee}section{page-break-inside:avoid;margin-bottom:24px}@media print{button{display:none}body{margin:8mm}}</style></head><body>
<button onclick="print()">🖨 ${en ? 'Print / Save as PDF' : '列印 / 另存 PDF'}</button>
<h1>${title}</h1>
<p>${t('subject')}: <b>${escH(s.subject)}</b> · ${t('date')}: ${new Date(s.date).toLocaleString()} · ${t('height')}: ${f2(s.height_m * 100)} · ${t('mass')}: ${f2(s.mass_kg)} · ${t('model')}: MediaPipe Pose ${escH(s.model)} · ${t('plumbStatus')}: ${escH(s.plumbMode)}</p>
${compare ? `<p>${en ? 'Compared with' : '比較對象'}: ${new Date(compare.date).toLocaleString()}</p>` : ''}
${sec}${arom ? romSection(s, compare) : ''}${imgs ?`<section><h2>${en ? 'Charts' : '圖表'}</h2>${imgs}</section>` : ''}
<section><h2>${t('method')}</h2><p>${en
    ? 'MediaPipe Pose Landmarker (33 landmarks, local inference). Low-visibility points (< threshold) removed, gaps filled by natural cubic spline, resampled to 30 Hz, moving-average smoothed; derivatives by Savitzky–Golay. Scale from stature (eye height = 0.936 × stature). Angles relative to the calibrated plumb line; anatomical convention (neutral = 0°). COM by Winter (2009) segment parameters.'
    : 'MediaPipe Pose Landmarker（33 點，本機推論）。可信度低於閾值的點視為缺值，以自然三次樣條內插並重取樣至 30 Hz，再以移動平均平滑；速度/加速度以 Savitzky–Golay 導數求得。比例尺以身高換算（眼高 = 0.936 × 身高）。角度以校正後鉛垂線為基準、解剖學定義（中立 = 0°）。COM 依 Winter (2009) 節段參數。'}</p>
<h2>${t('limits')}</h2><p>${en
    ? '2D projection error, occlusion of the far side in lateral views, lens distortion, and landmark bias (hip joint centre ≠ ASIS/PSIS; no spinal landmarks). Results are screening indicators, not diagnoses.'
    : '2D 投影誤差、側面拍攝時遠側肢體遮擋、鏡頭畸變、關鍵點偏差（髖關節中心 ≠ ASIS/PSIS，無脊椎標記點）。結果為篩檢指標，非臨床診斷。'}</p></section>
</body></html>`;
}
