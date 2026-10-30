// floorguide.js — 地面 A4 紙擺位參考框：可拖曳四角的透視框（遠小近大）＋ 井字線 ＋ 延伸中線
// 用法：第一次把 A4 紙放正後，拖動四個角對齊紙的四角並儲存；之後每次拍攝只要看紙邊是否與框重合即可知道紙有沒有放正。
// 角點順序：0 遠左、1 遠右、2 近右、3 近左（正規化座標 0–1，與畫布同方向）

export const DEFAULT_QUAD = [[0.42, 0.80], [0.58, 0.80], [0.62, 0.93], [0.38, 0.93]];

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

/** 畫參考框。quadPx：像素座標四角；editing：顯示拖曳把手 */
export function drawFloorGuide(ctx, quadPx, { editing = false, k = 1 } = {}) {
  const H = homography(quadPx);
  const seg = (u0, v0, u1, v1, color, w, dash) => {
    const a = H(u0, v0), b = H(u1, v1);
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w * k; if (dash) ctx.setLineDash(dash.map(x => x * k));
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.restore();
  };
  // 延伸中線（虛線）：朝向鏡頭的前後軸與左右軸，幫助對齊身體方向
  seg(0.5, -2, 0.5, 1.6, 'rgba(34,211,238,.55)', 1.5, [8, 6]);
  seg(-1.2, 0.5, 2.2, 0.5, 'rgba(34,211,238,.55)', 1.5, [8, 6]);
  // 井字線
  for (const f of [1 / 3, 2 / 3]) { seg(f, 0, f, 1, 'rgba(34,211,238,.9)', 2); seg(0, f, 1, f, 'rgba(34,211,238,.9)', 2); }
  // 外框
  ctx.save(); ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 3 * k; ctx.beginPath();
  quadPx.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke(); ctx.restore();
  if (editing) {
    const handles = [...quadPx, H(0.5, 0.5)];
    handles.forEach((p, i) => {
      ctx.save(); ctx.fillStyle = i === 4 ? 'rgba(250,204,21,.85)' : 'rgba(34,211,238,.85)'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2 * k;
      ctx.beginPath(); ctx.arc(p[0], p[1], (i === 4 ? 12 : 14) * k, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
    });
  }
}
