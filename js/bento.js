// bento.js — 結果頁的便當格摘要：人體圖（問題關節標點）、大數字卡、%常模環形量規、AROM/PROM 啞鈴圖
import { t, getLang } from './i18n.js';
import { MOVES, asymmetry } from './rom.js';
import { refForFlag, refForMove } from './reflinks.js';

const fin = Number.isFinite;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const C = { accent: '#2EE6A8', warn: '#F5A524', bad: '#FF5A5F', ink: '#EDEFF2', muted: '#8A93A0', line: 'rgba(255,255,255,.10)' };

// ---------------- 人體圖（正面，受測者右側在畫面左邊） ----------------
const J = {
  head: [100, 30], neck: [100, 56], shR: [72, 68], shL: [128, 68], elR: [60, 116], elL: [140, 116], trunk: [100, 104], pelvis: [100, 146],
  hipR: [87, 152], hipL: [113, 152], knR: [85, 212], knL: [115, 212], anR: [83, 268], anL: [117, 268], ftR: [80, 284], ftL: [120, 284],
};
const SIL = [['head', 'neck'], ['shR', 'shL'], ['shR', 'elR'], ['elR', [55, 160]], ['shL', 'elL'], ['elL', [145, 160]], ['neck', 'pelvis'], ['hipR', 'hipL'],
  ['hipR', 'knR'], ['knR', 'anR'], ['hipL', 'knL'], ['knL', 'anL'], ['anR', 'ftR'], ['anL', 'ftL']];

// 姿勢問題 → 關節
function flagJoints(id) {
  let m;
  if (/^(forward_head|chin_up|head_tilt|head_shift)$/.test(id)) return ['head'];
  if (/^(uneven_shoulders|rounded_shoulder)$/.test(id)) return ['shR', 'shL'];
  if (/^(trunk_lean|trunk_shift|trunk_forward|trunk_back|scoliosis_pattern|sway_back)$/.test(id)) return ['trunk'];
  if (/^(pelvic_obliquity|pelvis_shift)$/.test(id)) return ['pelvis'];
  if ((m = /^([RL])_genu_/.exec(id))) return [`kn${m[1]}`];
  if (/^(gap_|genu_recurvatum|knee_flexed)/.test(id)) return ['knR', 'knL'];
  if ((m = /^([RL])_(rearfoot|toe)_/.exec(id))) return [`ft${m[1]}`];
  return [];
}
// AROM 動作 → 關節
function moveJoints(id, side) {
  const s = side || (/_R$|^R_/.test(id) ? 'R' : /_L$|^L_/.test(id) ? 'L' : '');
  if (/sh_/.test(id)) return s ? [`sh${s}`] : ['shR', 'shL'];
  if (/elbow/.test(id)) return [`el${s}`];
  if (/^neck/.test(id)) return ['neck'];
  if (/^trunk/.test(id)) return ['trunk'];
  if (/hip/.test(id)) return [`hip${s}`];
  if (/knee/.test(id)) return [`kn${s}`];
  return [];
}

/** pins: [{ joint, level: 'bad'|'warn', text, ref }] → SVG */
function bodySVG(pins) {
  const P = k => (Array.isArray(k) ? k : J[k]);
  const by = {};
  for (const p of pins) { const g = (by[p.joint] ??= { level: 'warn', texts: [], ref: p.ref }); if (p.level === 'bad') g.level = 'bad'; g.texts.push(p.text); g.ref ||= p.ref; }
  const sil = SIL.map(([a, b]) => `<line x1="${P(a)[0]}" y1="${P(a)[1]}" x2="${P(b)[0]}" y2="${P(b)[1]}"/>`).join('');
  const pinsSvg = Object.entries(by).map(([k, g]) => {
    const [x, y] = J[k], col = g.level === 'bad' ? C.bad : C.warn;
    return `<g class="pin${g.ref ? ' reflink' : ''}" data-joint="${k}"${g.ref ? ` data-ref="${esc(g.ref)}"` : ''}><title>${esc(g.texts.join('\n'))}</title>
      <circle class="halo" cx="${x}" cy="${y}" r="11" fill="${col}"/><circle cx="${x}" cy="${y}" r="5.5" fill="${col}" stroke="#0E1014" stroke-width="2"/></g>`;
  }).join('');
  return `<svg viewBox="0 0 200 300" role="img" aria-label="body map">
    <line x1="100" y1="6" x2="100" y2="296" stroke="${C.accent}" stroke-opacity=".35" stroke-dasharray="3 4"/>
    ${Array.from({ length: 15 }, (_, i) => `<line x1="96" x2="104" y1="${10 + i * 20}" y2="${10 + i * 20}" stroke="${C.accent}" stroke-opacity=".25"/>`).join('')}
    <g class="sil"><g stroke="rgba(255,255,255,.16)" stroke-width="13" stroke-linecap="round" fill="none">${sil}</g>
    <circle cx="${J.head[0]}" cy="${J.head[1] - 4}" r="17" fill="rgba(255,255,255,.12)"/></g>
    ${pinsSvg}
    <text x="14" y="294" fill="${C.muted}" font-size="10" font-family="Barlow Condensed, sans-serif" letter-spacing="2">R</text>
    <text x="180" y="294" fill="${C.muted}" font-size="10" font-family="Barlow Condensed, sans-serif" letter-spacing="2">L</text>
  </svg>`;
}
const legend = () => `<div class="legend"><span><i style="background:${C.bad}"></i>${t('lvBad')}</span><span><i style="background:${C.warn}"></i>${t('lvWarn')}</span><span>${t('tapPin')}</span></div>`;
/** 動作短名：取第一個詞（雙肩、右髖、軀幹…），名稱本身沒有左右時才補上側別 */
function shortName(full, side) {
  const base = String(full).split(/\s/)[0];
  return side && !/^[右左RL]/.test(base) ? `${base}（${side === 'R' ? t('right') : t('left')}）` : base;
}
/** 左右差異列的中文名稱 */
export const asymName = label => (getLang() === 'en' ? label : ({ 'shoulder abd': '肩外展', 'shoulder add': '肩內收', 'trunk lat flex': '軀幹側彎', 'neck lat flex': '頸側屈', 'hip abd': '髖外展', 'shoulder flex': '肩屈曲',
  'shoulder ext': '肩伸展', 'elbow flex': '肘屈曲', 'hip flex': '髖屈曲', 'knee flex': '膝屈曲', 'hip ER': '髖外轉', 'hip IR': '髖內轉', 'shoulder ER': '肩外轉', 'shoulder IR': '肩內轉' }[label] || label));
const stat = (cls, lab, num, unit, sub) => `<div class="stat ${cls}"><div class="lab">${lab}</div><div class="num"><span class="num-anim" data-to="${fin(num) ? num : ''}">${fin(num) ? 0 : esc(num)}</span>${unit ? `<small>${unit}</small>` : ''}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

// ---------------- 靜態姿勢摘要 ----------------
export function postureBento(s) {
  const views = ['front', 'right', 'back', 'left'].filter(v => s?.views?.[v]?.result);
  if (!views.length) return '';
  const en = getLang() === 'en', flags = views.flatMap(v => (s.views[v].flags || []).filter(f => f.sev !== 'info'));
  const marked = flags.filter(f => f.sev === 'marked');
  const pins = flags.flatMap(f => flagJoints(f.id).map(joint => ({ joint, level: f.sev === 'marked' ? 'bad' : 'warn', text: en ? f.en : f.zh, ref: refForFlag(f.id) })));
  const top = (marked[0] || flags[0]);
  return `<div class="bento stagger">
    <div class="b-map bodymap">${bodySVG(pins)}${legend()}</div>
    <div class="b-stat statgrid">
      ${stat(flags.length ? 'warn' : 'hero', t('sumFindings'), flags.length, t('items'), marked.length ? `${t('sumMarked')} ${marked.length}` : t('noFlagsShort'))}
      ${stat('', t('sumViews'), views.length, '/ 4', views.map(v => t('view_' + v)).join('、'))}
    </div>
    <div class="b-stat stat ${top ? (top.sev === 'marked' ? 'warn' : '') : 'hero'}"><div class="lab">${t('sumTop')}</div>
      <div style="font-size:22px;font-weight:700;margin:8px 0 4px">${top ? esc(en ? top.en : top.zh) : t('noFlagsShort')}</div>
      ${top && fin(top.value) ? `<div class="sub">${t('value')} ${Math.abs(top.value).toFixed(1)} ${top.unit} · ${t('threshold')} ${Math.abs(top.thr)}</div>` : ''}</div>
  </div>`;
}

// ---------------- AROM／PROM 摘要 ----------------
const ring = (pct, label) => {
  const p = fin(pct) ? Math.max(0, Math.min(100, pct)) : 0, r = 34, L = 2 * Math.PI * r, col = !fin(pct) ? C.muted : pct < 75 ? C.bad : pct < 90 ? C.warn : C.accent;
  return `<div class="ring"><svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="${r}" fill="none" stroke="${C.line}" stroke-width="7"/>
    <circle cx="42" cy="42" r="${r}" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(L * p / 100).toFixed(1)} ${L.toFixed(1)}" transform="rotate(-90 42 42)"/>
    <text x="42" y="49" text-anchor="middle" fill="${C.ink}" font-size="21" font-weight="700" font-family="Barlow Condensed, sans-serif">${fin(pct) ? Math.round(pct) : '–'}<tspan font-size="11" fill="${C.muted}">%</tspan></text></svg>
    <div class="rl">${esc(label)}</div></div>`;
};

export function aromBento(s, nameOf) {
  const R = s?.rom || {}, P = s?.prom || {}, ids = MOVES.map(m => m.id).filter(id => R[id] || P[id]);
  if (!ids.length) return '';
  const en = getLang() === 'en';
  const rows = [], pcts = [], pins = [];
  for (const id of ids) {
    const m = MOVES.find(x => x.id === id), A = R[id], Pp = P[id];
    for (const vn of Object.keys((A || Pp).metrics)) {
      const am = A?.metrics?.[vn], pm = Pp?.metrics?.[vn], side = (am || pm).side;
      const sideTxt = side ? (side === 'R' ? t('right') : t('left')) : '';
      for (const dir of m.neg ? ['pos', 'neg'] : ['pos']) {
        const d = dir === 'pos' ? m.pos : m.neg, val = mt => (mt ? (dir === 'pos' ? mt.pos : -mt.neg) : NaN), pc = mt => (mt ? (dir === 'pos' ? mt.pctPos : mt.pctNeg) : NaN);
        const painA = A?.pain?.[dir]?.[vn], painP = Pp?.pain?.[dir]?.[vn], pain = painA ?? painP;
        rows.push({ label: `${shortName(nameOf(m), side)} · ${en ? d.en : d.zh}`, norm: d.norm, a: val(am), p: val(pm), pct: pc(am), painA: fin(painA) ? Math.abs(painA) : NaN, painP: fin(painP) ? Math.abs(painP) : NaN });
        if (fin(pc(am))) pcts.push(pc(am));
        if ((fin(pc(am)) && pc(am) < 90) || fin(pain) || am?.comp?.warn)
          moveJoints(id, side).forEach(joint => pins.push({ joint, level: (fin(pc(am)) && pc(am) < 75) || fin(pain) ? 'bad' : 'warn', text: `${nameOf(m)} ${sideTxt} ${en ? d.en : d.zh} ${fin(val(am)) ? Math.round(val(am)) + '°' : ''}${fin(pain) ? ' ⚡' : ''}`, ref: refForMove(id) }));
      }
    }
  }
  const mean = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : NaN, limited = pcts.filter(p => p < 90).length;
  const asym = asymmetry(R).sort((a, b) => b.asymPct - a.asymPct)[0];
  const gains = rows.filter(r => fin(r.p) && fin(r.a)).map(r => r.p - r.a), maxGain = gains.length ? Math.max(...gains) : NaN;

  // 環形量規：每個動作 × 側取最差方向的 %常模
  const ringsHtml = ids.flatMap(id => {
    const m = MOVES.find(x => x.id === id), A = R[id]; if (!A) return [];
    return Object.values(A.metrics).map(mt => ring(Math.min(...[mt.pctPos, mt.pctNeg].filter(fin)), shortName(nameOf(m), mt.side)));
  }).join('');

  // 啞鈴圖：常模刻度（灰）、AROM（白點）、PROM（青綠點），中間線長 = 被動多出的角度
  const max = Math.max(180, ...rows.flatMap(r => [r.norm, r.a, r.p]).filter(fin)), LW = 190, W = 640, rowH = 26, X = v => LW + (W - LW - 60) * Math.max(0, v) / max;
  // AROM 長條：從 0 畫到 AROM 值，顏色依 %常模（≥90 青綠、75–89 琥珀、<75 紅）；PROM 多出的部分接在後面
  const barCol = p => (!fin(p) ? C.muted : p < 75 ? C.bad : p < 90 ? C.warn : C.accent);
  const db = rows.map((r, i) => {
    const y = 18 + i * rowH;
    return `<g><text x="0" y="${y + 4}" fill="${C.ink}" font-size="12">${esc(r.label)}</text>
      <line x1="${X(0)}" x2="${X(max)}" y1="${y}" y2="${y}" stroke="${C.line}"/>
      <line x1="${X(r.norm)}" x2="${X(r.norm)}" y1="${y - 8}" y2="${y + 8}" stroke="${C.muted}" stroke-width="2"/>
      ${fin(r.a) ? `<line x1="${X(0)}" x2="${X(r.a)}" y1="${y}" y2="${y}" stroke="${barCol(r.pct)}" stroke-width="9" stroke-linecap="round" opacity=".9"/>` : ''}
      ${fin(r.a) && fin(r.p) ? `<line x1="${X(r.a)}" x2="${X(r.p)}" y1="${y}" y2="${y}" stroke="${C.accent}" stroke-opacity=".6" stroke-width="5" stroke-linecap="round"/>` : ''}
      ${[r.painA, r.painP].filter(fin).map(v => `<path d="M${X(v)} ${y - 11} l4 7 h-8 z" fill="${C.bad}"/>`).join('')}
      ${fin(r.a) ? `<circle cx="${X(r.a)}" cy="${y}" r="6" fill="${C.ink}"/>` : ''}
      ${fin(r.p) ? `<circle cx="${X(r.p)}" cy="${y}" r="6" fill="${C.accent}"/>` : ''}
      <text x="${W - 4}" y="${y + 4}" text-anchor="end" fill="${C.muted}" font-size="12" font-family="Barlow Condensed, sans-serif">${fin(r.a) ? Math.round(r.a) : '–'}${fin(r.p) ? ` / ${Math.round(r.p)}` : ''}°</text></g>`;
  }).join('');
  const ticks = [0, 45, 90, 135, 180].filter(v => v <= max).map(v => `<text x="${X(v)}" y="${18 + rows.length * rowH}" text-anchor="middle" fill="${C.muted}" font-size="10" font-family="Barlow Condensed, sans-serif">${v}°</text>`).join('');

  return `<div class="bento stagger">
    <div class="b-map bodymap">${bodySVG(pins)}${legend()}</div>
    <div class="b-stat statgrid">
      ${stat('hero', t('sumMeanNorm'), fin(mean) ? Math.round(mean) : '–', '%', t('sumMeanNormSub'))}
      ${stat(limited ? 'warn' : '', t('sumLimited'), limited, t('items'), '< 90%')}
    </div>
    <div class="b-stat statgrid">
      ${stat(asym && asym.asymPct > 15 ? 'warn' : '', t('sumAsym'), asym ? Math.round(asym.asymPct) : '–', '%', asym ? esc(asymName(asym.label)) : '')}
      ${fin(maxGain) ? stat('', t('sumPromGain'), Math.round(maxGain), '°', 'PROM − AROM') : ''}
    </div>
    <div class="b-wide"><div class="rings">${ringsHtml}</div></div>
    <div class="b-wide dumbbell"><div class="legend"><span><i style="background:linear-gradient(90deg,${C.bad},${C.warn},${C.accent});border-radius:3px;width:22px"></i>AROM（${t('barLegend')}）</span><span><i style="background:${C.accent}"></i>PROM</span><span><i style="background:${C.muted};border-radius:1px;width:3px"></i>${t('norm')}</span><span><i style="background:${C.bad};border-radius:0;clip-path:polygon(50% 0,100% 100%,0 100%)"></i>${t('painAt')}</span></div>
      <svg viewBox="0 0 ${W} ${rows.length * rowH + 28}">${db}${ticks}</svg></div>
  </div>`;
}

/** 人體圖換成 3D 人物（與登入畫面同一個）：背景換圖、紅／琥珀點移到人物的真實關節位置；載入失敗就維持線條人形 */
export async function upgradeBodyMaps(root) {
  let map;
  try { map = await (await import('./figure3d.js')).renderBodyMap(); } catch { return; }
  for (const svg of root.querySelectorAll('.bodymap svg')) {
    if (svg.querySelector('image.fig')) continue;
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    img.setAttribute('class', 'fig'); img.setAttribute('href', map.url); img.setAttribute('x', 0); img.setAttribute('y', 0); img.setAttribute('width', 200); img.setAttribute('height', 300);
    const sil = svg.querySelector('.sil'); sil?.replaceWith(img);
    for (const pin of svg.querySelectorAll('.pin[data-joint]')) {
      const p = map.pts[pin.dataset.joint]; if (!p) continue;
      for (const c of pin.querySelectorAll('circle')) { c.setAttribute('cx', p[0].toFixed(1)); c.setAttribute('cy', p[1].toFixed(1)); }
    }
  }
}

/** 數字由 0 跑到結果值（約 0.8 秒，ease-out） */
export function countUp(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { root.querySelectorAll('.num-anim[data-to]').forEach(el => { if (el.dataset.to !== '') el.textContent = el.dataset.to; }); return; }
  root.querySelectorAll('.num-anim[data-to]').forEach(el => {
    const to = +el.dataset.to; if (el.dataset.to === '' || !fin(to)) return;
    const t0 = performance.now(), dur = 800;
    const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3; el.textContent = Math.round(to * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
