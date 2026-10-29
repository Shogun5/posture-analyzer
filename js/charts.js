// charts.js — Chart.js 圖表：時間序列、左右/前後測疊圖、多日趨勢、摘要表
// Chart.js 以 <script> UMD 載入（全域 window.Chart）
import { t, getLang } from './i18n.js';

const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;
// 類別色固定順序（色盲安全驗證過的前三色），同一實體永遠同色
const SERIES = () => (dark() ? ['#3987e5', '#d95926', '#199e70'] : ['#2a78d6', '#eb6834', '#1baf7a']);
const INK = () => (dark() ? { text: '#c3c2b7', grid: 'rgba(255,255,255,.08)' } : { text: '#52514e', grid: 'rgba(0,0,0,.07)' });

const charts = new Map();
function mount(canvas, cfg) {
  charts.get(canvas)?.destroy();
  const c = new window.Chart(canvas, cfg);
  charts.set(canvas, c);
  return c;
}

function baseOptions(xTitle, yTitle) {
  const ink = INK();
  return {
    responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
    interaction: { mode: 'index', intersect: false },   // 十字準線式 tooltip
    plugins: {
      legend: { display: true, labels: { color: ink.text, usePointStyle: true, boxWidth: 8 } },
      tooltip: { callbacks: { label: c => `${c.dataset.label}: ${Number.isFinite(c.parsed.y) ? c.parsed.y.toFixed(2) : '-'}` } },
    },
    scales: {
      x: { type: 'linear', title: { display: true, text: xTitle, color: ink.text }, ticks: { color: ink.text }, grid: { color: ink.grid } },
      y: { title: { display: true, text: yTitle, color: ink.text }, ticks: { color: ink.text }, grid: { color: ink.grid } },
    },
  };
}

/** series: [{label, t:[], y:[]}]（最多 3 條；超過請分開畫） */
export function timeSeries(canvas, series, yTitle) {
  const col = SERIES();
  const datasets = series.slice(0, 3).map((s, i) => ({
    label: s.label, data: s.t.map((x, k) => ({ x, y: Number.isFinite(s.y[k]) ? s.y[k] : null })),
    borderColor: col[i], backgroundColor: col[i], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, spanGaps: false,
    borderDash: s.dash ? [6, 4] : undefined,
  }));
  return mount(canvas, { type: 'line', data: { datasets }, options: baseOptions(getLang() === 'en' ? 'time (s)' : '時間 (s)', yTitle) });
}

/** 多日趨勢：points [{date, y}]；以日期序號為 x，tick 顯示日期 */
export function trend(canvas, label, points, yTitle) {
  const col = SERIES();
  const opts = baseOptions(t('date'), yTitle);
  opts.scales.x.ticks.callback = v => points[v]?.date ?? '';
  opts.scales.x.ticks.stepSize = 1;
  opts.plugins.legend.display = false; // 單一系列：標題即名稱
  opts.plugins.tooltip.callbacks.title = items => points[items[0].parsed.x]?.date ?? '';
  return mount(canvas, {
    type: 'line',
    data: { datasets: [{ label, data: points.map((p, i) => ({ x: i, y: p.y })), borderColor: col[0], backgroundColor: col[0], borderWidth: 2, pointRadius: 5, pointHoverRadius: 7 }] },
    options: opts,
  });
}

export const chartPNG = canvas => charts.get(canvas)?.toBase64Image('image/png', 1);

const f = x => (Number.isFinite(x) ? x.toFixed(2) : '–');
/** 摘要表 HTML：rows [{name, s:{max,min,mean,rom,tmax,tmin}}] */
export function summaryTable(rows) {
  const h = ['variables', 'max', 'min', 'mean', 'rom', 'tmax', 'tmin'].map(k => `<th>${t(k)}</th>`).join('');
  const b = rows.map(r => `<tr><td>${r.name}</td><td>${f(r.s.max)}</td><td>${f(r.s.min)}</td><td>${f(r.s.mean)}</td><td>${f(r.s.rom)}</td><td>${f(r.s.tmax)}</td><td>${f(r.s.tmin)}</td></tr>`).join('');
  return `<table class="tbl"><thead><tr>${h}</tr></thead><tbody>${b}</tbody></table>`;
}
