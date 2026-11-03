// gate3d.js — 登入畫面的 3D 開場：有曲線的女性人形（深色緞面＋青綠輪廓光、關節發光點）在刻度地面上緩慢轉身、雙手外展（呼應 AROM）
// 只在需要登入時才動態載入 three.js（r169）；登入後 stop() 釋放 GPU 資源。
// 效能不足或 prefers-reduced-motion：只畫一張靜態畫面。WebGL 不可用：什麼都不做（保留 CSS 漸層背景）。
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';
const ACCENT = 0x2ee6a8;

export async function startGate3D(host) {
  let THREE;
  try { THREE = await import(THREE_URL); } catch { return () => {}; }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const weak = (navigator.hardwareConcurrency || 8) <= 2;

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); } catch { return () => {}; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const cv = renderer.domElement; cv.className = 'gate3d'; cv.setAttribute('aria-hidden', 'true');
  host.prepend(cv);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0e1014, 6, 13);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);

  // 光：冷色天光＋主色側光（邊緣發亮）＋暖色補光
  scene.add(new THREE.HemisphereLight(0x9fb6c8, 0x0e1014, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(2.5, 4, 3); scene.add(key);
  const rim = new THREE.PointLight(ACCENT, 9, 8, 2); rim.position.set(-1.6, 1.6, -1.4); scene.add(rim);
  const rim2 = new THREE.PointLight(0x7fb8ff, 5, 8, 2); rim2.position.set(1.7, 1.2, -1.2); scene.add(rim2);   // 另一側冷色輪廓光，曲線更明顯

  const fig = new THREE.Group(); scene.add(fig);

  // 女性人形（身高約 1.65 m）：軀幹與四肢用旋轉曲面做出曲線，深色緞面材質＋青綠輪廓光；
  // 關節處保留小發光點，像 MediaPipe 偵測到的關鍵點
  const skin = new THREE.MeshPhysicalMaterial({ color: 0x1c222b, roughness: 0.42, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.35, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(ACCENT) });
  const jointMat = new THREE.MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 1.1, roughness: 0.3 });
  // 旋轉曲面：profile = [[半徑, 高度]...]；depth 壓扁前後厚度（人體不是圓柱）
  const lathe = (profile, depth = 1, seg = 40) => {
    const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.001), y)), seg);
    g.scale(1, 1, depth); g.computeVertexNormals();
    return new THREE.Mesh(g, skin);
  };
  // 柔光貼圖（加法混合的光暈）
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(46,230,168,1)'); gr.addColorStop(0.35, 'rgba(46,230,168,.35)'); gr.addColorStop(1, 'rgba(46,230,168,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7, toneMapped: false });
  const joints = [];
  const joint = (parent, x, y, z = 0, s = 0.016) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), jointMat); m.position.set(x, y, z); parent.add(m);
    const g = new THREE.Sprite(glowMat); g.scale.setScalar(s * 7); g.position.set(x, y, z); parent.add(g); joints.push({ g, base: s * 7 });
  };

  // 軀幹：骨盆 → 腰 → 胸廓 → 胸 → 肩 → 頸根（腰細、臀與胸較寬）
  const torso = lathe([[0, 0.80], [0.085, 0.805], [0.13, 0.84], [0.165, 0.9], [0.172, 0.96], [0.155, 1.01], [0.118, 1.07], [0.112, 1.1], [0.125, 1.16],
    [0.142, 1.23], [0.15, 1.28], [0.146, 1.33], [0.14, 1.38], [0.115, 1.42], [0.07, 1.455], [0.05, 1.47], [0, 1.47]], 0.62);
  fig.add(torso);
  // 胸部：兩個柔和的橢球，帶出女性輪廓（低調）
  for (const sx of [-1, 1]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 16), skin); b.scale.set(1, 0.9, 0.8); b.position.set(sx * 0.062, 1.285, 0.058); fig.add(b); }
  // 肩膀圓弧（三角肌）
  for (const sx of [-1, 1]) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.052, 20, 14), skin); d.scale.set(1, 0.85, 0.9); d.position.set(sx * 0.165, 1.405, 0); fig.add(d); }
  // 頸、頭（略長的橢球）、後腦髮髻
  const neck = lathe([[0.042, 1.45], [0.038, 1.5], [0.04, 1.54]], 1, 20); fig.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 32, 24), skin); head.scale.set(0.86, 1.08, 0.95); head.position.set(0, 1.635, 0.005); fig.add(head);
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.048, 20, 14), skin); bun.position.set(0, 1.69, -0.085); fig.add(bun);

  // 腿：大腿粗 → 膝細 → 小腿肚 → 腳踝（每條腿一個旋轉曲面，向內微收）
  const legProfile = [[0.0, 0.0], [0.03, 0.005], [0.03, 0.07], [0.04, 0.16], [0.052, 0.27], [0.05, 0.34], [0.043, 0.45], [0.05, 0.52], [0.068, 0.62], [0.078, 0.72], [0.08, 0.8], [0.06, 0.86], [0, 0.86]];
  for (const sx of [-1, 1]) {
    const leg = lathe(legProfile, 0.92, 28); leg.position.set(sx * 0.088, 0.035, 0); leg.rotation.z = sx * 0.035; fig.add(leg);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 18, 12), skin); foot.scale.set(0.9, 0.55, 2.4); foot.position.set(sx * 0.09, 0.03, 0.06); fig.add(foot);
    joint(fig, sx * 0.095, 0.92); joint(fig, sx * 0.092, 0.5, 0.03); joint(fig, sx * 0.09, 0.08, 0.02);   // 髖、膝、踝
  }
  joint(fig, 0, 1.47, 0.02, 0.013);   // 頸根

  // 手臂：每側一個以肩為軸的群組；上臂與前臂逐漸變細，手肘微彎
  const armProfile = (len, r0, r1) => [[0, 0], [r1 * 0.9, 0.005], [r1, len * 0.15], [(r0 + r1) / 2, len * 0.6], [r0, len * 0.92], [r0 * 0.7, len], [0, len]];
  const arms = {};
  for (const [s, sx] of [['R', -1], ['L', 1]]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * 0.175, 1.405, 0); fig.add(pivot);
    const ua = lathe(armProfile(0.28, 0.042, 0.032), 1, 22); ua.rotation.z = Math.PI; pivot.add(ua);          // 往下長
    const elbow = new THREE.Group(); elbow.position.set(0, -0.28, 0); elbow.rotation.x = -0.12; pivot.add(elbow);
    const fa = lathe(armProfile(0.25, 0.032, 0.022), 1, 20); fa.rotation.z = Math.PI; elbow.add(fa);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), skin); hand.scale.set(0.6, 1.3, 0.9); hand.position.set(0, -0.29, 0); elbow.add(hand);
    joint(pivot, 0, 0, 0.02); joint(elbow, 0, 0, 0.02); joint(elbow, 0, -0.25, 0.015, 0.013);   // 肩、肘、腕
    arms[s] = { pivot, sx };
  }
  // 肩外展：手臂群組繞前後軸旋轉
  const setArms = deg => { for (const { pivot, sx } of Object.values(arms)) pivot.rotation.z = sx * THREE.MathUtils.degToRad(deg); };
  setArms(12);

  // 地面：同心刻度環＋放射刻度＋鉛垂線（招牌圖形）
  const lineMat = o => new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: o });
  for (const [r, o] of [[0.45, 0.55], [0.9, 0.3], [1.5, 0.16], [2.3, 0.08]]) {
    const pts = Array.from({ length: 129 }, (_, i) => { const t = i / 128 * Math.PI * 2; return new THREE.Vector3(Math.cos(t) * r, 0.001, Math.sin(t) * r); });
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(o)));
  }
  const ticks = [];
  for (let i = 0; i < 72; i++) { const t = i / 72 * Math.PI * 2, r0 = i % 6 ? 0.86 : 0.8; ticks.push(Math.cos(t) * r0, 0.001, Math.sin(t) * r0, Math.cos(t) * 0.94, 0.001, Math.sin(t) * 0.94); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
  scene.add(new THREE.LineSegments(tg, lineMat(0.35)));
  const plumb = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 2.1, 0)]), new THREE.LineDashedMaterial({ color: ACCENT, dashSize: 0.04, gapSize: 0.04, transparent: true, opacity: 0.45 }));
  plumb.computeLineDistances(); scene.add(plumb);
  // 地面的柔光盤
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.002; scene.add(disc);

  // 版面：寬螢幕時人形在登入卡右側；手機時在卡片後方、整體較淡
  const layout = () => {
    const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    const wide = w / h > 1.1;
    if (wide) { cam.position.set(-2.0, 1.3, 5.8); cam.lookAt(-0.85, 0.9, 0); }
    else { cam.position.set(0, 0.9, 9.5); cam.lookAt(0, -0.6, 0); }   // 手機：卡片在下方，人形顯示在上半部
    cv.style.opacity = wide ? '1' : '.9';
  };
  layout(); addEventListener('resize', layout);

  let raf = 0, t0 = performance.now(), stopped = false;
  const frame = now => {
    if (stopped) return;
    const t = (now - t0) / 1000;
    fig.rotation.y = t * 0.32;                                         // 慢慢轉身（約 20 秒一圈）
    setArms(12 + 148 * (0.5 - 0.5 * Math.cos(t * 0.9)));               // 雙手外展 10° ↔ 160°
    for (const j of joints) j.g.scale.setScalar(j.base * (0.85 + 0.15 * Math.sin(t * 2 + j.base * 40)));   // 關節光點呼吸
    renderer.render(scene, cam);
    raf = requestAnimationFrame(frame);
  };
  if (reduce || weak) { fig.rotation.y = 0.6; setArms(80); renderer.render(scene, cam); }
  else raf = requestAnimationFrame(frame);

  return () => {
    stopped = true; cancelAnimationFrame(raf); removeEventListener('resize', layout);
    scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { x.map?.dispose?.(); x.dispose?.(); }); });
    renderer.dispose(); renderer.forceContextLoss?.(); cv.remove();
  };
}
