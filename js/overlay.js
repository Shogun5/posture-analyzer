// overlay.js — 畫面疊加：骨架、角度弧與數值、鉛垂線/地板線、身高尺、軌跡尾巴、速度向量、即時數值面板
import { SKELETON, isSag } from './biomech.js';

const COLORS = { R: '#f97316', L: '#38bdf8', C: '#e5e7eb', plumb: '#facc15', floor: '#a3e635', COM: '#f43f5e', hipMid: '#a78bfa', R_heel: '#22d3ee', head: '#fde047' };
const sideOf = i => (i === 0 ? 'C' : [1, 2, 3, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31].includes(i) ? 'L' : 'R');

// 角度弧定義：[近端, 關節, 遠端, 變數名]
function arcDefs(view) {
  if (view === 'right') return [[8, 12, 24, 'R_neck_flex_deg'], [24, 12, 14, 'R_shoulder_flex_deg'], [12, 14, 16, 'R_elbow_flex_deg'], [14, 16, 20, 'R_wrist_flex_deg'],
    [12, 24, 26, 'R_hip_flex_deg'], [24, 26, 28, 'R_knee_flex_deg'], [26, 28, 32, 'R_ankle_DF_deg']];
  if (view === 'left') return [[7, 11, 23, 'L_neck_flex_deg'], [23, 11, 13, 'L_shoulder_flex_deg'], [11, 13, 15, 'L_elbow_flex_deg'], [13, 15, 19, 'L_wrist_flex_deg'],
    [11, 23, 25, 'L_hip_flex_deg'], [23, 25, 27, 'L_knee_flex_deg'], [25, 27, 31, 'L_ankle_DF_deg']];
  return [[24, 12, 14, 'R_shoulder_abd_deg'], [23, 11, 13, 'L_shoulder_abd_deg'], [12, 14, 16, 'R_elbow_valgus_deg'], [11, 13, 15, 'L_elbow_valgus_deg'],
    [12, 24, 26, 'R_hip_abd_deg'], [11, 23, 25, 'L_hip_abd_deg'], [24, 26, 28, 'R_knee_valgus_deg'], [23, 25, 27, 'L_knee_valgus_deg'],
    ...(view === 'back' ? [[26, 28, 30, 'R_rearfoot_valgus_deg'], [25, 27, 29, 'L_rearfoot_valgus_deg']] : [])];
}

function line(ctx, a, b, color, w = 2, dash = null) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w; if (dash) ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.restore();
}
// 文字最後才畫（flushText）：鏡像顯示時，圖形整張翻轉，但文字要在翻轉後的位置「正著」畫，才讀得懂；
// 錄影/快照用的主畫布則照常畫，不受鏡像影響。
const textQ = [];
export function queueText(op) { textQ.push(op); }   // op: { txt, x, y, font, fill, stroke, lw, align }
export function flushText(targets) {
  for (const { ctx, mirrorW } of targets) for (const o of textQ) {
    const x = mirrorW ? mirrorW - o.x : o.x;
    const align = mirrorW ? ({ left: 'right', right: 'left' }[o.align || 'left'] || 'center') : (o.align || 'left');
    ctx.save(); ctx.font = o.font; ctx.textAlign = align;
    if (o.stroke) { ctx.lineWidth = o.lw || 3; ctx.strokeStyle = o.stroke; ctx.strokeText(o.txt, x, o.y); }
    ctx.fillStyle = o.fill || '#fff'; ctx.fillText(o.txt, x, o.y); ctx.restore();
  }
  textQ.length = 0;
}
function label(ctx, txt, x, y, color = '#fff', size = 14) {
  queueText({ txt, x, y, font: `600 ${size}px system-ui, sans-serif`, fill: color, stroke: 'rgba(0,0,0,.75)', lw: 3 });
}
function arrow(ctx, from, to, color, w = 3) {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]), h = 10;
  line(ctx, from, to, color, w);
  ctx.save(); ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - h * Math.cos(ang - 0.4), to[1] - h * Math.sin(ang - 0.4));
  ctx.lineTo(to[0] - h * Math.cos(ang + 0.4), to[1] - h * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill(); ctx.restore();
}

/**
 * o: { lm, view, up, scale(m/px), vars, trails, vel, height_m, visThr, panel: [[label,value]], banner }
 * lm 為像素座標（已做鏡像修正的影像座標）
 */
export function drawOverlay(ctx, o) {
  const { lm, view, up = [0, -1], visThr = 0.5 } = o;
  const W = ctx.canvas.width, H = ctx.canvas.height, k = Math.max(W, H) / 900;
  if (lm) {
    const ok = i => lm[i][3] >= visThr;
    const P = i => [lm[i][0], lm[i][1]];
    const perp = [-up[1], up[0]];
    const heelY = [29, 30].filter(ok).map(i => lm[i]);
    const base = heelY.length ? [heelY.reduce((s, p) => s + p[0], 0) / heelY.length, heelY.reduce((s, p) => s + p[1], 0) / heelY.length] : P(28);

    // 地板水平線（垂直於真正鉛垂）
    line(ctx, [base[0] - perp[0] * W, base[1] - perp[1] * W], [base[0] + perp[0] * W, base[1] + perp[1] * W], COLORS.floor, 2 * k, [8, 6]);
    // 鉛垂線：矢狀面通過外踝；額狀面通過雙踝中點
    const foot = isSag(view) ? P(view === 'right' ? 28 : 27) : [(lm[27][0] + lm[28][0]) / 2, (lm[27][1] + lm[28][1]) / 2];
    line(ctx, [foot[0] - up[0] * H * 1.2, foot[1] - up[1] * H * 1.2], [foot[0] + up[0] * H * 1.2, foot[1] + up[1] * H * 1.2], COLORS.plumb, 2 * k, [10, 6]);
    // 通過各關節的鉛垂短線（姿勢評估用）
    const joints = isSag(view) ? (view === 'right' ? [8, 12, 24, 26] : [7, 11, 23, 25]) : [];
    for (const j of joints) if (ok(j)) line(ctx, [lm[j][0] - up[0] * 30 * k, lm[j][1] - up[1] * 30 * k], [lm[j][0] + up[0] * 30 * k, lm[j][1] + up[1] * 30 * k], COLORS.plumb, 1.5 * k);
    // 額狀面：肩線、骨盆線、眼線（觀察左右高低）
    if (!isSag(view)) for (const [a, b] of [[11, 12], [23, 24], [2, 5]]) if (ok(a) && ok(b)) {
      const m = [(lm[a][0] + lm[b][0]) / 2, (lm[a][1] + lm[b][1]) / 2];
      line(ctx, [m[0] - perp[0] * 120 * k, m[1] - perp[1] * 120 * k], [m[0] + perp[0] * 120 * k, m[1] + perp[1] * 120 * k], 'rgba(250,204,21,.5)', 1 * k);
      line(ctx, P(a), P(b), '#fde68a', 2 * k);
    }
    // 身高尺：自地板沿鉛垂向上，每 10 cm 一格
    if (o.scale > 0 && o.height_m) {
      const x0 = [base[0] - perp[0] * 0.28 * W, base[1] - perp[1] * 0.28 * W];
      const hp = o.height_m / o.scale;
      line(ctx, x0, [x0[0] + up[0] * hp, x0[1] + up[1] * hp], '#fff', 2 * k);
      for (let cm = 0; cm <= o.height_m * 100 + 0.1; cm += 10) {
        const p = [x0[0] + up[0] * cm / 100 / o.scale, x0[1] + up[1] * cm / 100 / o.scale];
        const L = cm % 50 === 0 ? 12 : 6;
        line(ctx, p, [p[0] + perp[0] * L * k, p[1] + perp[1] * L * k], '#fff', 1.5 * k);
        if (cm % 50 === 0) label(ctx, `${cm}`, p[0] + 14 * k, p[1] + 4, '#fff', 11 * k);
      }
    }
    // 骨架
    for (const [a, b] of SKELETON) if (ok(a) && ok(b)) line(ctx, P(a), P(b), COLORS[sideOf(a) === sideOf(b) ? sideOf(a) : 'C'], 3 * k);
    for (let i = 0; i < 33; i++) if (ok(i) && (i === 0 || i > 6)) {
      ctx.fillStyle = COLORS[sideOf(i)]; ctx.beginPath(); ctx.arc(lm[i][0], lm[i][1], 3.5 * k, 0, 7); ctx.fill();
    }
    // 角度弧與數值
    if (o.vars) for (const [a, j, b, name] of arcDefs(view)) {
      const val = o.vars[name];
      if (!Number.isFinite(val) || !ok(a) || !ok(j) || !ok(b)) continue;
      const a1 = Math.atan2(lm[a][1] - lm[j][1], lm[a][0] - lm[j][0]), a2 = Math.atan2(lm[b][1] - lm[j][1], lm[b][0] - lm[j][0]);
      let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2 * k; ctx.beginPath();
      ctx.arc(lm[j][0], lm[j][1], 20 * k, a1, a1 + d, d < 0); ctx.stroke(); ctx.restore();
      const mid = a1 + d / 2;
      label(ctx, `${val.toFixed(0)}°`, lm[j][0] - Math.cos(mid) * 34 * k - 10 * k, lm[j][1] - Math.sin(mid) * 34 * k + 5 * k, '#fff', 13 * k);
    }
  }
  // 軌跡尾巴
  if (o.trails) for (const [name, pts] of Object.entries(o.trails)) {
    ctx.save(); ctx.strokeStyle = COLORS[name] || '#fff'; ctx.lineWidth = 2 * k; ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
    const last = pts[pts.length - 1];
    if (last) { ctx.fillStyle = COLORS[name] || '#fff'; ctx.beginPath(); ctx.arc(last[0], last[1], 5 * k, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  // COM 速度向量（放大 0.5 s 的位移以便看見）
  if (o.vel && Number.isFinite(o.vel.v[0])) {
    const s = 0.5 * (o.velGain || 4);
    arrow(ctx, o.vel.p, [o.vel.p[0] + o.vel.v[0] * s, o.vel.p[1] + o.vel.v[1] * s], COLORS.COM, 3 * k);
  }
  // 即時數值面板
  if (o.panel?.length) {
    const fs = 13 * k, lh = fs * 1.35, w = 230 * k, h = lh * o.panel.length + 10 * k;
    ctx.save(); ctx.fillStyle = 'rgba(15,23,42,.72)'; ctx.fillRect(8 * k, 8 * k, w, h); ctx.restore();
    const font = `500 ${fs}px ui-monospace, "Noto Sans TC", monospace`;
    o.panel.forEach(([kk, vv], i) => {
      queueText({ txt: kk, x: 14 * k, y: 8 * k + lh * (i + 1), font, fill: '#cbd5e1' });
      queueText({ txt: vv, x: 8 * k + w - 8 * k, y: 8 * k + lh * (i + 1), font, fill: '#fff', align: 'right' });
    });
  }
  if (o.banner) {
    const fs = 42 * k;
    queueText({ txt: o.banner, x: W / 2, y: H * 0.14, font: `800 ${fs}px system-ui`, fill: '#fff', stroke: 'rgba(0,0,0,.6)', lw: 6 * k, align: 'center' });
  }
}
