// gate3d.js — 登入畫面的 3D 開場：發光骨架人形在刻度地面上緩慢轉身、雙手外展（呼應 AROM）
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

  const fig = new THREE.Group(); scene.add(fig);

  // 骨架：以實際比例（公尺）定義關節，身高約 1.7 m
  const J = {
    head: [0, 1.62, 0], neck: [0, 1.47, 0], chest: [0, 1.3, 0], pelvis: [0, 0.98, 0],
    shR: [-0.19, 1.43, 0], shL: [0.19, 1.43, 0], hipR: [-0.1, 0.95, 0], hipL: [0.1, 0.95, 0],
    knR: [-0.11, 0.52, 0.02], knL: [0.11, 0.52, 0.02], anR: [-0.11, 0.08, 0], anL: [0.11, 0.08, 0],
    toeR: [-0.12, 0.02, 0.16], toeL: [0.12, 0.02, 0.16],
  };
  const v = a => new THREE.Vector3(...a);
  const boneMat = new THREE.MeshStandardMaterial({ color: 0x252b35, metalness: 0.35, roughness: 0.35 });
  const jointMat = new THREE.MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 1.1, roughness: 0.3 });
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 14, 1);
  const bone = (r) => { const m = new THREE.Mesh(unitCyl, boneMat); m.userData.r = r; fig.add(m); return m; };
  const place = (m, a, b) => {   // 圓柱放在兩點之間
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    m.position.copy(a).addScaledVector(d, 0.5);
    m.scale.set(m.userData.r, len, m.userData.r);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  };
  // 柔光貼圖（加法混合的光暈）
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(46,230,168,1)'); gr.addColorStop(0.35, 'rgba(46,230,168,.35)'); gr.addColorStop(1, 'rgba(46,230,168,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.75, toneMapped: false });
  const joints = [];
  const joint = (p, s = 0.028) => { const m = new THREE.Mesh(new THREE.SphereGeometry(s, 16, 12), jointMat); m.position.copy(p); fig.add(m);
    const g = new THREE.Sprite(glowMat); g.scale.setScalar(s * 6); g.position.copy(p); fig.add(g); joints.push({ m, g, base: s * 6 }); return { m, g }; };

  // 頭（玻璃感）
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 32, 24), new THREE.MeshPhysicalMaterial({ color: 0x1b2028, metalness: 0.1, roughness: 0.15, clearcoat: 1 }));
  head.position.copy(v(J.head)); fig.add(head);
  // 固定的骨段
  const fixed = [['neck', 'chest', 0.035], ['chest', 'pelvis', 0.05], ['shR', 'shL', 0.03], ['hipR', 'hipL', 0.035], ['hipR', 'knR', 0.045], ['knR', 'anR', 0.038],
    ['hipL', 'knL', 0.045], ['knL', 'anL', 0.038], ['anR', 'toeR', 0.025], ['anL', 'toeL', 0.025], ['neck', 'shR', 0.028], ['neck', 'shL', 0.028]];
  for (const [a, b, r] of fixed) place(bone(r), v(J[a]), v(J[b]));
  for (const k of ['neck', 'shR', 'shL', 'pelvis', 'hipR', 'hipL', 'knR', 'knL', 'anR', 'anL']) joint(v(J[k]));
  // 手臂（動態：肩外展）
  const arm = { R: { ua: bone(0.032), fa: bone(0.027), el: joint(new THREE.Vector3()), wr: joint(new THREE.Vector3(), 0.022) }, L: { ua: bone(0.032), fa: bone(0.027), el: joint(new THREE.Vector3()), wr: joint(new THREE.Vector3(), 0.022) } };
  const setArms = deg => {
    for (const [s, sh, sign] of [['R', v(J.shR), -1], ['L', v(J.shL), 1]]) {
      const a = THREE.MathUtils.degToRad(deg), dir = new THREE.Vector3(sign * Math.sin(a), -Math.cos(a), 0.04);
      const el = sh.clone().addScaledVector(dir, 0.29), wr = el.clone().addScaledVector(dir, 0.26);
      place(arm[s].ua, sh, el); place(arm[s].fa, el, wr);
      arm[s].el.m.position.copy(el); arm[s].el.g.position.copy(el); arm[s].wr.m.position.copy(wr); arm[s].wr.g.position.copy(wr);
    }
  };
  setArms(10);

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
    setArms(10 + 150 * (0.5 - 0.5 * Math.cos(t * 0.9)));               // 雙手外展 10° ↔ 160°
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
