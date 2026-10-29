// filters.js — 訊號處理：三次樣條內插/重取樣、移動平均、Savitzky–Golay 導數
// 所有函式都允許 NaN（缺值），不會修改輸入陣列。

const fin = Number.isFinite;

/** 自然三次樣條 (natural cubic spline)：回傳 f(x)。xs 需遞增。 */
export function naturalSpline(xs, ys) {
  const n = xs.length;
  if (n === 0) return () => NaN;
  if (n === 1) return () => ys[0];
  if (n === 2) return x => ys[0] + (ys[1] - ys[0]) * (x - xs[0]) / (xs[1] - xs[0]);
  const h = new Float64Array(n - 1), alpha = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) h[i] = xs[i + 1] - xs[i];
  for (let i = 1; i < n - 1; i++) alpha[i] = 3 / h[i] * (ys[i + 1] - ys[i]) - 3 / h[i - 1] * (ys[i] - ys[i - 1]);
  // 三對角系統（Thomas algorithm）求二階係數 c
  const l = new Float64Array(n), mu = new Float64Array(n), z = new Float64Array(n), c = new Float64Array(n);
  l[0] = 1;
  for (let i = 1; i < n - 1; i++) {
    l[i] = 2 * (xs[i + 1] - xs[i - 1]) - h[i - 1] * mu[i - 1];
    mu[i] = h[i] / l[i];
    z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
  }
  l[n - 1] = 1;
  const b = new Float64Array(n - 1), d = new Float64Array(n - 1);
  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (ys[j + 1] - ys[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
    d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
  }
  return x => {
    // 二分搜尋所在區間
    let lo = 0, hi = n - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (xs[m] <= x) lo = m; else hi = m - 1; }
    const dx = x - xs[lo];
    return ys[lo] + b[lo] * dx + c[lo] * dx * dx + d[lo] * dx * dx * dx;
  };
}

/**
 * 以三次樣條把 (t, y) 重取樣到 tNew；同時完成缺值內插。
 * 超出有效資料範圍的點以最近有效值保持（不外插，避免爆衝）。
 */
export function splineResample(t, y, tNew) {
  const xs = [], ys = [];
  for (let i = 0; i < t.length; i++) if (fin(y[i]) && fin(t[i])) { xs.push(t[i]); ys.push(y[i]); }
  if (xs.length === 0) return tNew.map(() => NaN);
  const f = naturalSpline(xs, ys);
  const t0 = xs[0], t1 = xs[xs.length - 1];
  return tNew.map(x => x <= t0 ? ys[0] : x >= t1 ? ys[ys.length - 1] : f(x));
}

/** 置中移動平均（window 為奇數；忽略 NaN，端點用可用樣本）。 */
export function movingAverage(a, w = 5) {
  const h = Math.floor(w / 2), out = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let s = 0, n = 0;
    for (let k = i - h; k <= i + h; k++) if (k >= 0 && k < a.length && fin(a[k])) { s += a[k]; n++; }
    out[i] = n ? s / n : NaN;
  }
  return out;
}

// --- Savitzky–Golay -------------------------------------------------------
function solve(A, B) { // Gauss-Jordan，A: n×n，B: n×m
  const n = A.length, m = B[0].length;
  const M = A.map((r, i) => [...r, ...B[i]]);
  for (let col = 0; col < n; col++) {
    let p = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[p][col])) p = r;
    [M[col], M[p]] = [M[p], M[col]];
    const pv = M[col][col];
    for (let k = 0; k < n + m; k++) M[col][k] /= pv;
    for (let r = 0; r < n; r++) if (r !== col) {
      const f = M[r][col];
      for (let k = 0; k < n + m; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map(r => r.slice(n));
}
const fact = k => (k <= 1 ? 1 : k * fact(k - 1));

/**
 * SG 係數：視窗位置 z = -m..m，多項式階數 p，於位置 z0 求 d 階導數。
 * c = e^T (JᵀJ)⁻¹ Jᵀ，e_k = k!/(k-d)! · z0^(k-d)
 */
export function sgCoeffs(m, p, d, z0 = 0) {
  const z = []; for (let i = -m; i <= m; i++) z.push(i);
  const J = z.map(zi => Array.from({ length: p + 1 }, (_, k) => zi ** k));
  const JtJ = Array.from({ length: p + 1 }, (_, a) => Array.from({ length: p + 1 }, (_, b) => J.reduce((s, r) => s + r[a] * r[b], 0)));
  const Jt = Array.from({ length: p + 1 }, (_, a) => J.map(r => r[a]));
  const C = solve(JtJ, Jt); // (p+1) × n
  const e = Array.from({ length: p + 1 }, (_, k) => (k < d ? 0 : fact(k) / fact(k - d) * z0 ** (k - d)));
  return z.map((_, j) => e.reduce((s, ek, k) => s + ek * C[k][j], 0));
}

/**
 * Savitzky–Golay 導數（等間隔 dt）。win 奇數、order < win。
 * 端點使用第一/最後一個完整視窗的多項式在對應位置求導（不縮短輸出）。
 */
export function sgDerivative(y, dt, win = 11, order = 2, deriv = 1) {
  const n = y.length;
  if (n < 3) return y.map(() => NaN);
  if (win > n) win = n % 2 ? n : n - 1;
  if (order >= win) order = win - 1;
  const m = (win - 1) / 2, scale = 1 / dt ** deriv, out = new Array(n);
  const cache = new Map();
  const coeff = z0 => { if (!cache.has(z0)) cache.set(z0, sgCoeffs(m, order, deriv, z0)); return cache.get(z0); };
  for (let i = 0; i < n; i++) {
    let center = Math.min(Math.max(i, m), n - 1 - m);
    const c = coeff(i - center);
    let s = 0;
    for (let j = -m; j <= m; j++) s += c[j + m] * y[center + j];
    out[i] = s * scale;
  }
  return out;
}

/** 摘要統計：max/min/mean/ROM/發生時間 */
export function summarize(arr, t) {
  let max = -Infinity, min = Infinity, s = 0, n = 0, imax = -1, imin = -1;
  arr.forEach((x, i) => {
    if (!fin(x)) return;
    s += x; n++;
    if (x > max) { max = x; imax = i; }
    if (x < min) { min = x; imin = i; }
  });
  if (!n) return { max: NaN, min: NaN, mean: NaN, rom: NaN, tmax: NaN, tmin: NaN, n: 0 };
  return { max, min, mean: s / n, rom: max - min, tmax: t[imax], tmin: t[imin], n };
}
