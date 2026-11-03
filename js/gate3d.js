// gate3d.js — 登入畫面的 3D 開場：人形模型 Xbot（three.js 範例，Mixamo）換成 App 配色
// ・外殼 = 米白（App 文字色 #EDEFF2）亮面＋青綠輪廓光；關節 = 唯一主色 #2EE6A8 微發光（像量測關鍵點）
// ・播放內建「待機」動作（呼吸晃動），疊加週期性的肩外展（呼應 AROM），緩慢左右轉身；掃描光環上下移動
// 只在需要登入時才動態載入（three r169 + GLTFLoader + 模型約 2.9 MB，之後由 service worker 快取）；登入後 stop() 釋放。
// 效能不足或 prefers-reduced-motion：只畫一張靜態畫面。WebGL 或模型載入失敗：保留 CSS 漸層背景。
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
const GLTF_URL = 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/loaders/GLTFLoader.js/+esm';   // 與上面同一份 three
const MODEL_URL = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r169/examples/models/gltf/Xbot.glb';
const ACCENT = 0x2ee6a8, SHELL = 0xedeff2;

export async function startGate3D(host) {
  let THREE, GLTFLoader;
  try { [THREE, { GLTFLoader }] = await Promise.all([import(THREE_URL), import(GLTF_URL)]); } catch { return () => {}; }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const weak = (navigator.hardwareConcurrency || 8) <= 2;

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); } catch { return () => {}; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const cv = renderer.domElement; cv.className = 'gate3d'; cv.setAttribute('aria-hidden', 'true'); cv.style.opacity = '0';
  host.prepend(cv);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0e1014, 6, 14);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x15191f, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(2.2, 3.5, 3.2); scene.add(key);
  const rim = new THREE.PointLight(ACCENT, 7, 8, 2); rim.position.set(-1.6, 1.7, -1.3); scene.add(rim);
  const rim2 = new THREE.PointLight(0x8fbfff, 3, 8, 2); rim2.position.set(1.6, 1.2, -1.3); scene.add(rim2);

  // ---- 地面：同心刻度環＋放射刻度＋鉛垂線（招牌圖形）；掃描光環 ----
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(46,230,168,1)'); gr.addColorStop(0.35, 'rgba(46,230,168,.35)'); gr.addColorStop(1, 'rgba(46,230,168,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const lineMat = o => new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: o });
  const ring = (r, y = 0.001) => Array.from({ length: 129 }, (_, i) => { const t = i / 128 * Math.PI * 2; return new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r); });
  for (const [r, o] of [[0.45, 0.55], [0.9, 0.3], [1.5, 0.16], [2.3, 0.08]]) scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring(r)), lineMat(o)));
  const ticks = [];
  for (let i = 0; i < 72; i++) { const t = i / 72 * Math.PI * 2, r0 = i % 6 ? 0.86 : 0.8; ticks.push(Math.cos(t) * r0, 0.001, Math.sin(t) * r0, Math.cos(t) * 0.94, 0.001, Math.sin(t) * 0.94); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
  scene.add(new THREE.LineSegments(tg, lineMat(0.35)));
  const plumb = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 2.05, 0)]), new THREE.LineDashedMaterial({ color: ACCENT, dashSize: 0.04, gapSize: 0.04, transparent: true, opacity: 0.35 }));
  plumb.computeLineDistances(); scene.add(plumb);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.002; scene.add(disc);
  const scan = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring(0.36, 0)), new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.8, toneMapped: false }));
  const scanGlow = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.4, 64), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  scanGlow.rotation.x = -Math.PI / 2; scan.add(scanGlow); scene.add(scan);

  // ---- 人形模型（換成 App 配色） ----
  let gltf;
  try { gltf = await new GLTFLoader().loadAsync(MODEL_URL); } catch { renderer.dispose(); cv.remove(); return () => {}; }
  const body = gltf.scene;
  const shell = new THREE.MeshPhysicalMaterial({ color: SHELL, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.15 });
  shell.onBeforeCompile = sh => {   // 邊緣青綠輪廓光，身形在深色背景中浮出來
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float fr = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0);
      totalEmissiveRadiance += vec3(0.18, 0.90, 0.66) * fr * 0.55;`);
  };
  const joint = new THREE.MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.4, roughness: 0.35 });
  body.traverse(o => { if (o.isMesh) { o.material = /Joints/i.test(o.material?.name || '') ? joint : shell; o.frustumCulled = false; } });
  const box = new THREE.Box3().setFromObject(body), size = box.getSize(new THREE.Vector3());
  body.scale.setScalar(1.65 / size.y);
  const box2 = new THREE.Box3().setFromObject(body), c2 = box2.getCenter(new THREE.Vector3());
  body.position.set(-c2.x, -box2.min.y, -c2.z);
  const fig = new THREE.Group(); fig.add(body); scene.add(fig);

  // 待機動作（呼吸晃動）
  const mixer = new THREE.AnimationMixer(body);
  const idle = gltf.animations.find(a => a.name === 'idle') || gltf.animations[0];
  if (idle) mixer.clipAction(idle).play();
  // 肩外展：在待機姿勢上，再把上臂繞身體前後軸往外抬（在父骨骼座標中計算）
  const bone = n => body.getObjectByName(`mixamorig${n}`) || body.getObjectByName(`mixamorig:${n}`);
  const armL = bone('LeftArm'), armR = bone('RightArm');
  const fwd = new THREE.Vector3(0, 0, 1), q = new THREE.Quaternion(), pq = new THREE.Quaternion(), ax = new THREE.Vector3();
  // 待機動畫不一定每幀重設上臂骨骼 → 每幀先還原成「動畫姿勢」再加外展，否則角度會一直累加（手臂亂轉）
  const baseQ = new Map();
  const restoreArms = () => { for (const [b, q0] of baseQ) b.quaternion.copy(q0); };
  const saveArms = () => { for (const b of [armL, armR]) if (b) baseQ.set(b, b.quaternion.clone()); };
  const raiseArms = deg => {
    const a = THREE.MathUtils.degToRad(deg);
    for (const [b, side] of [[armL, 1], [armR, -1]]) {   // 正值 = 往身體外側抬起
      if (!b) continue;
      b.parent.updateWorldMatrix(true, false); b.parent.getWorldQuaternion(pq);
      ax.copy(fwd).applyQuaternion(fig.quaternion).applyQuaternion(pq.invert()).normalize();
      b.quaternion.premultiply(q.setFromAxisAngle(ax, side * a));
    }
  };

  // 版面：寬螢幕時人形在登入卡右側；手機時人形在上方、卡片在下方
  const layout = () => {
    const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    if (w / h > 1.1) { cam.position.set(-2.0, 1.3, 5.8); cam.lookAt(-0.85, 0.9, 0); }
    else { cam.position.set(0, 0.9, 9.5); cam.lookAt(0, -0.6, 0); }
  };
  layout(); addEventListener('resize', layout);

  let raf = 0, last = performance.now(), t = 0, stopped = false;
  const draw = dt => {
    t += dt;
    restoreArms(); mixer.update(dt); saveArms();
    fig.rotation.y = Math.sin(t * 0.22) * 0.85;                            // 左右轉身展示，臉多半朝向觀眾
    raiseArms(150 * Math.max(0, Math.sin(t * 0.5)) ** 2);                // 肩外展：0° → 150°（舉過頭）再放下，中間有停頓
    scan.position.y = 0.08 + 1.6 * (0.5 - 0.5 * Math.cos(t * 0.55));
    renderer.render(scene, cam);
  };
  const frame = now => { if (stopped) return; const dt = Math.min(0.05, (now - last) / 1000); last = now; draw(dt); raf = requestAnimationFrame(frame); };
  cv.style.transition = 'opacity .8s'; requestAnimationFrame(() => { cv.style.opacity = '1'; });
  if (reduce || weak) { mixer.update(0.5); saveArms(); fig.rotation.y = 0.35; raiseArms(80); scan.position.y = 1.1; renderer.render(scene, cam); }
  else raf = requestAnimationFrame(frame);

  return () => {
    stopped = true; cancelAnimationFrame(raf); removeEventListener('resize', layout); mixer.stopAllAction();
    scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { x.map?.dispose?.(); x.dispose?.(); }); });
    renderer.dispose(); renderer.forceContextLoss?.(); cv.remove();
  };
}
