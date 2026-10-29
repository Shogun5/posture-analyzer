// icon-draw.mjs — ECT 圖示繪製（瀏覽器 canvas 與 Node @napi-rs/canvas 共用）
// 設計：深藍→青綠漸層底、黃色虛線鉛垂線（姿勢分析意象）、橘黃動態弧線、
//       筆刷式（粗細漸變）抽象衝刺人形、斜體 ECT 字樣
// maskable：主體都在中心半徑 40% 的安全圓內

export function drawIcon(g, s) {
  const u = s / 100;
  const P = (x, y) => [x * u, y * u];

  // 筆刷：沿二次貝茲曲線畫一串圓，半徑由 w0 漸變到 w1（筆觸起收）
  function brush(p0, c, p1, w0, w1, color) {
    g.fillStyle = color;
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const t = i / N, a = (1 - t) ** 2, b = 2 * (1 - t) * t, d = t * t;
      const x = a * p0[0] + b * c[0] + d * p1[0], y = a * p0[1] + b * c[1] + d * p1[1];
      g.beginPath(); g.arc(x * u, y * u, (w0 + (w1 - w0) * t) / 2 * u, 0, Math.PI * 2); g.fill();
    }
  }

  // 1. 背景漸層 + 微光
  const bg = g.createLinearGradient(0, 0, s, s);
  bg.addColorStop(0, '#0a1a33');
  bg.addColorStop(1, '#0f766e');
  g.fillStyle = bg; g.fillRect(0, 0, s, s);
  const glow = g.createRadialGradient(...P(60, 38), 2 * u, ...P(60, 38), 42 * u);
  glow.addColorStop(0, 'rgba(250,204,21,0.18)'); glow.addColorStop(1, 'rgba(250,204,21,0)');
  g.fillStyle = glow; g.fillRect(0, 0, s, s);

  // 2. 鉛垂線（虛線）與地板線
  g.save();
  g.strokeStyle = 'rgba(250,204,21,0.55)'; g.lineWidth = 1.2 * u; g.setLineDash([3 * u, 2.4 * u]);
  g.beginPath(); g.moveTo(...P(49, 13)); g.lineTo(...P(49, 69)); g.stroke();
  g.restore();

  // 3. 動態弧線（彎月形，前粗後細，橘→黃）
  const sw = g.createLinearGradient(...P(16, 68), ...P(86, 20));
  sw.addColorStop(0, 'rgba(249,115,22,0)');
  sw.addColorStop(0.3, '#f97316');
  sw.addColorStop(1, '#facc15');
  g.fillStyle = sw;
  g.beginPath();
  g.moveTo(...P(16, 68));
  g.quadraticCurveTo(...P(52, 76), ...P(86, 20));
  g.quadraticCurveTo(...P(54, 62), ...P(16, 68));
  g.fill();

  // 4. 速度線（筆刷，由粗漸細）
  brush([24, 30], [28, 30], [34, 30], 0.6, 2.6, 'rgba(255,255,255,0.55)');
  brush([22, 37], [27, 37], [33, 37], 0.6, 2.6, 'rgba(255,255,255,0.38)');
  brush([24, 44], [28, 44], [33, 44], 0.6, 2.4, 'rgba(255,255,255,0.24)');

  // 5. 抽象衝刺人形（筆刷：近端粗、遠端細）；整組略往左下移，頭部才不會被圓形遮罩切到
  g.save(); g.translate(-3 * u, 4 * u);
  const W = '#ffffff';
  brush([60, 25], [56, 34], [50, 43], 7.2, 6.0, W);   // 軀幹
  brush([59, 28], [66, 37], [77, 31], 5.2, 2.2, W);   // 前臂
  brush([57, 28], [48, 27], [42, 20], 5.0, 2.0, W);   // 後臂
  brush([50, 43], [62, 46], [60, 61], 6.0, 2.4, W);   // 前腿
  brush([50, 43], [43, 55], [30, 53], 6.0, 2.2, W);   // 後腿
  g.fillStyle = W; g.beginPath(); g.arc(...P(64.5, 17), 5.2 * u, 0, Math.PI * 2); g.fill(); // 頭
  // 髖與膝的橘色關節點（姿勢關鍵點意象）
  g.fillStyle = '#f97316';
  [[50, 43], [58.6, 50]].forEach(p => { g.beginPath(); g.arc(...P(...p), 2.0 * u, 0, Math.PI * 2); g.fill(); });
  g.restore();

  // 6. ECT 字樣（粗斜體，橘色錯位陰影）
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = `italic 900 ${16 * u}px "Arial Black", "Segoe UI Black", Impact, sans-serif`;
  g.fillStyle = '#f97316'; g.fillText('ECT', ...P(51, 84));
  g.fillStyle = '#ffffff'; g.fillText('ECT', ...P(50, 83));
}
