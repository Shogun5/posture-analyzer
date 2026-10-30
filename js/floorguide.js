// floorguide.js — 地面 A4 紙擺位參考框：置中的等腰梯形（透視：遠窄近寬）＋ 井字線 ＋ 延伸中線
// 受測者要站在畫面正中間，所以框固定左右置中，只需調三個量：
//   下底（寬度 + 上下位置）、高、兩腰傾斜角度（0° = 長方形，角度越大上底越窄）
// 調整點用虛線拉到框外，不會遮住紙。
// f = { by: 下底 y（0–1）, w: 下底寬（0–1，相對畫面寬）, h: 高（0–1，相對畫面高）, ang: 腰傾斜角（度） }

import { queueText } from './overlay.js';

export const DEFAULT_FLOOR ={ by: 0.93, w: 0.24, h: 0.13, ang: 12 };

/** 依參數算出像素座標四角（0 遠左、1 遠右、2 近右、3 近左） */
export function floorQuad(f, W, H) {
  const cx = W / 2, by = f.by * H, hb = f.w * W / 2, hp = f.h * H;
  const ht = Math.max(hb * 0.05, hb - hp * Math.tan(f.ang * Math.PI / 180));
  return [[cx - ht, by - hp], [cx + ht, by - hp], [cx + hb, by], [cx - hb, by]];
}

/** 單位正方形 (u,v) → 四邊形的投影轉換（Heckbert 1989），讓井字線符合透視 */
export function homography(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
    g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  return (u, v) => { const w = g * u + h * v + 1; return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w]; };
}

/** 三個調整點（在框外）與各自連到的框上位置：base = 下底（寬/位置）、height = 高、angle = 傾斜角 */
export function floorHandles(f, W, H, k = 1) {
  const q = floorQuad(f, W, H), off = 46 * k;
  return [
    { id: 'base', at: [q[2][0] + off, q[2][1] + off * 0.6], to: q[2] },
    { id: 'height', at: [W / 2, q[0][1] - off], to: [W / 2, q[0][1]] },
    { id: 'angle', at: [q[1][0] + off, q[1][1] - off * 0.4], to: q[1] },
  ];
}

/** 拖曳調整點 → 更新參數。p：像素座標 */
export function dragFloor(f, id, p, W, H, k = 1) {
  const off = 46 * k, cx = W / 2, by = f.by * H, hp = f.h * H, hb = f.w * W / 2, clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  if (id === 'base') {
    f.w = clamp(2 * (Math.abs(p[0] - cx) - off) / W, 0.04, 0.95);
    f.by = clamp((p[1] - off * 0.6) / H, f.h + 0.02, 1);
  } else if (id === 'height') {
    f.h = clamp((by - (p[1] + off)) / H, 0.02, f.by - 0.02);
  } else if (id === 'angle') {
    const ht = clamp(p[0] - off - cx, hb * 0.05, hb * 1.5);
    f.ang = clamp(Math.atan2(hb - ht, hp) * 180 / Math.PI, -30, 80);
  }
  return f;
}

/** 畫參考框；editing 時顯示框外的小調整點與虛線 */
export function drawFloorGuide(ctx, f, { editing = false, k = 1, labels = {} } = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height, q = floorQuad(f, W, H), T = homography(q);
  const line = (a, b, color, w, dash) => {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w * k; if (dash) ctx.setLineDash(dash.map(x => x * k));
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.restore();
  };
  const seg = (u0, v0, u1, v1, color, w, dash) => line(T(u0, v0), T(u1, v1), color, w, dash);
  // 延伸中線（虛線）：前後軸、左右軸
  seg(0.5, -2, 0.5, 1.6, 'rgba(34,211,238,.5)', 1.2, [8, 6]);
  seg(-1.2, 0.5, 2.2, 0.5, 'rgba(34,211,238,.5)', 1.2, [8, 6]);
  // 井字線 + 外框（細線，不遮紙）
  for (const s of [1 / 3, 2 / 3]) { seg(s, 0, s, 1, 'rgba(34,211,238,.9)', 1.5); seg(0, s, 1, s, 'rgba(34,211,238,.9)', 1.5); }
  ctx.save(); ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2 * k; ctx.beginPath();
  q.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke(); ctx.restore();
  if (!editing) return;
  for (const hd of floorHandles(f, W, H, k)) {
    line(hd.to, hd.at, 'rgba(250,204,21,.95)', 1.5, [5, 4]);
    ctx.save(); ctx.fillStyle = '#facc15'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2 * k;
    ctx.beginPath(); ctx.arc(hd.at[0], hd.at[1], 8 * k, 0, 7); ctx.fill(); ctx.stroke();
    ctx.restore();
    const txt = labels[hd.id] || '';
    if (txt) queueText({ txt, x: hd.at[0] + 12 * k, y: hd.at[1] + 5 * k, font: `700 ${13 * k}px system-ui, "Noto Sans TC", sans-serif`, fill: '#fde047', stroke: 'rgba(0,0,0,.7)', lw: 3 * k });
  }
}
