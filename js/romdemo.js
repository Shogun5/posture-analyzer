// romdemo.js — ROM 示範動畫（SVG 向量人形）。正面圖：受測者右側在畫面左邊（與相機畫面一致）；
// 側面圖：右側面朝畫面右、左側面朝畫面左。只更新 SVG 屬性，不重建節點。
const NS = 'http://www.w3.org/2000/svg';
const R = Math.PI / 180;
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const vec = deg => [Math.sin(deg * R), Math.cos(deg * R)]; // 0° = 畫面向下，正值往 +x（前方）轉

export function createDemo(svg) {
  svg.setAttribute('viewBox', '0 0 200 250');
  svg.innerHTML = '';
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.appendChild(e); return e; };
  mk('rect', { x: 0, y: 0, width: 200, height: 250, rx: 14, fill: 'rgba(10,26,51,0.82)' });
  mk('line', { x1: 20, y1: 232, x2: 180, y2: 232, stroke: '#a3e635', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' });
  const plumb = mk('line', { x1: 100, y1: 22, x2: 100, y2: 232, stroke: 'rgba(250,204,21,.5)', 'stroke-width': 1, 'stroke-dasharray': '4 4' });
  const far = mk('path', { fill: 'none', stroke: 'rgba(255,255,255,.28)', 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  const body = mk('path', { fill: 'none', stroke: '#fff', 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  const hot = mk('path', { fill: 'none', stroke: '#f97316', 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  const head = mk('circle', { r: 12, fill: '#fff' });
  const nose = mk('path', { fill: 'none', stroke: '#0a1a33', 'stroke-width': 2.5, 'stroke-linecap': 'round' });
  const arcs = [0, 1].map(() => mk('path', { fill: 'rgba(250,204,21,.18)', stroke: '#facc15', 'stroke-width': 2 }));
  const labels = [0, 1].map(() => mk('text', { fill: '#facc15', 'font-size': 15, 'font-weight': 700, 'text-anchor': 'middle', 'font-family': 'system-ui' }));
  const title = mk('text', { x: 100, y: 16, fill: '#e5e7eb', 'font-size': 11, 'text-anchor': 'middle', 'font-family': 'system-ui' });
  const sideTag = mk('text', { x: 12, y: 246, fill: '#94a3b8', 'font-size': 10, 'font-family': 'system-ui' });

  const poly = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

  /** view: front/back/right/left；p: 關節角度參數；move: 動作（arcs、hot 段）；text: 標題 */
  function render(view, p, move, text, values = []) {
    const sx = view === 'left' ? -1 : 1;   // 左側面：水平鏡射
    const X = q => [100 + (q[0] - 100) * sx, q[1]];
    const P = [100, 150];
    let pts, dirs, segs, farSegs = [], hotSegs = [];
    if (view === 'front' || view === 'back') {
      const a = (p.trunkLat || 0) * R;
      const up = [-Math.sin(a), -Math.cos(a)], pr = [-Math.cos(a), Math.sin(a)];  // pr：受測者右側（畫面左）
      const N = add(P, up, 62), S0 = add(N, up, -8);
      const hd = ((p.trunkLat || 0) + (p.neckLat || 0)) * R, hdir = [-Math.sin(hd), -Math.cos(hd)];
      const H = add(N, hdir, 20);
      const arm = (sgn, b) => { const d = [Math.cos(b * R) * -up[0] + Math.sin(b * R) * pr[0] * sgn, Math.cos(b * R) * -up[1] + Math.sin(b * R) * pr[1] * sgn]; return d; };
      const SR = add(S0, pr, 26), SL = add(S0, pr, -26);
      const aR = arm(1, p.shAbdR || 0), aL = arm(-1, p.shAbdL || 0);
      const ER = add(SR, aR, 34), WR = add(ER, aR, 30), EL = add(SL, aL, 34), WL = add(EL, aL, 30);
      const HR = [P[0] - 14, P[1]], HL = [P[0] + 14, P[1]];
      const lR = [-Math.sin((p.hipAbdR || 0) * R), Math.cos((p.hipAbdR || 0) * R)], lL = [Math.sin((p.hipAbdL || 0) * R), Math.cos((p.hipAbdL || 0) * R)];
      const KR = add(HR, lR, 40), AR = add(KR, lR, 40), KL = add(HL, lL, 40), AL = add(HL, lL, 80);
      pts = { P, N, H, SR, SL, HR, HL };
      dirs = { up: [0, -1], down: [0, 1], trunkUp: up, trunkDown: [-up[0], -up[1]], head: hdir, armR: aR, armL: aL, legR: lR, legL: lL };
      segs = [[P, N], [SR, SL], [SR, ER, WR], [SL, EL, WL], [HR, HL], [HR, KR, AR, add(AR, [-8, 0])], [HL, KL, AL, add(AL, [8, 0])]];
      const hotMap = { shAbdR: [[SR, ER, WR]], shAbdL: [[SL, EL, WL]], hipAbdR: [[HR, KR, AR]], hipAbdL: [[HL, KL, AL]], trunkLat: [[P, N]], neckLat: [] };
      for (const k of Object.keys(move?.demo?.(1) || {})) hotSegs.push(...(hotMap[k] || []));
      head.setAttribute('cx', H[0]); head.setAttribute('cy', H[1]);
      // 正面畫眼睛；背面不畫臉
      nose.setAttribute('d', view === 'front' ? `M${H[0] - 5} ${H[1] - 2} h0.1 M${H[0] + 5} ${H[1] - 2} h0.1` : '');
      sideTag.textContent = view === 'front' ? '← R   L →' : '← L   R →';
    } else {
      const f = p.trunkFlex || 0;
      const up = vec(180 - f), down = vec(-f);
      const N = add(P, up, 62), S = add(N, up, -8);
      const hdirDeg = 180 - f - (p.neckFlex || 0), hdir = vec(hdirDeg);
      const H = add(N, hdir, 20);
      const ua = vec(-f + (p.shFlex || 0)), fa = vec(-f + (p.shFlex || 0) + (p.elbowFlex || 0));
      const E = add(S, ua, 34), W = add(E, fa, 30);
      const th = vec(p.hipFlex || 0), sh = vec((p.hipFlex || 0) - (p.kneeFlex || 0)), ft = vec((p.hipFlex || 0) - (p.kneeFlex || 0) + 90);
      const Hp = P, K = add(Hp, th, 40), A = add(K, sh, 40), T = add(A, ft, 16);
      // 遠側（不動）肢體
      farSegs = [[S, add(S, down, 34), add(add(S, down, 34), down, 30)], [Hp, add(Hp, [0, 1], 40), add(Hp, [0, 1], 80), add(add(Hp, [0, 1], 80), [16, 0])]];
      pts = { P, N, H, S, E, Hp, K };
      dirs = { up: [0, -1], down: [0, 1], trunkUp: up, trunkDown: down, head: hdir, arm: ua, forearm: fa, thigh: th, shank: sh };
      segs = [[P, N], [S, E, W], [Hp, K, A, T]];
      const hotMap = { shFlex: [[S, E, W]], elbowFlex: [[E, W]], hipFlex: [[Hp, K]], kneeFlex: [[K, A, T]], trunkFlex: [[P, N]], neckFlex: [] };
      for (const k of Object.keys(move?.demo?.(1) || {})) hotSegs.push(...(hotMap[k] || []));
      const hc = X(H); head.setAttribute('cx', hc[0]); head.setAttribute('cy', hc[1]);
      const fwd = vec(hdirDeg - 90);  // 臉的方向（垂直於頭軸、朝前）
      const n1 = X(add(H, fwd, 9)), n2 = X(add(H, fwd, 15));
      nose.setAttribute('d', `M${n1[0]} ${n1[1]} L${n2[0]} ${n2[1]}`);
      nose.setAttribute('stroke', '#fff'); nose.setAttribute('stroke-width', 5);
      sideTag.textContent = view === 'right' ? 'R →' : '← L';
    }
    if (view === 'front' || view === 'back') { nose.setAttribute('stroke', '#0a1a33'); nose.setAttribute('stroke-width', 3.5); }
    const tr = segsArr => segsArr.map(s => poly(s.map(X))).join(' ');
    far.setAttribute('d', tr(farSegs));
    body.setAttribute('d', tr(segs));
    hot.setAttribute('d', tr(hotSegs));
    // 角度弧
    (move?.arcs || []).forEach(([c, d1, d2], i) => {
      const C = pts[c], u1 = dirs[d1], u2 = dirs[d2];
      if (!C || !u1 || !u2) return;
      const r = 22, A1 = X(add(C, u1, r)), A2 = X(add(C, u2, r)), cc = X(C);
      const cross = (u1[0] * u2[1] - u1[1] * u2[0]) * sx;
      arcs[i].setAttribute('d', `M${cc[0]} ${cc[1]} L${A1[0]} ${A1[1]} A${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${A2[0]} ${A2[1]} Z`);
      const mid = X(add(C, [(u1[0] + u2[0]), (u1[1] + u2[1])], 20));
      labels[i].setAttribute('x', mid[0]); labels[i].setAttribute('y', mid[1] + 5);
      labels[i].textContent = Number.isFinite(values[i]) ? `${Math.round(Math.abs(values[i]))}°` : '';
    });
    for (let i = (move?.arcs || []).length; i < 2; i++) { arcs[i].setAttribute('d', ''); labels[i].textContent = ''; }
    plumb.setAttribute('opacity', view === 'front' || view === 'back' ? 1 : 0.6);
    title.textContent = text || '';
  }
  return { render };
}
