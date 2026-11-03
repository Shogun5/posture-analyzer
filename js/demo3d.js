// demo3d.js — AROM／PROM 示範動畫（3D 人形，取代向量小人）
// 疊在相機畫面右上角；正面／側面依動作的觀測面換鏡頭位置；鏡像顯示時整張翻轉（文字另外疊在上面，不受影響）。
// 只有參數改變時才重畫，降低和相機姿勢分析同時運作的負擔。
import { makeFigure, loadLib } from './figure3d.js';

export async function createDemo3D(stage) {
  const { THREE } = await loadLib();
  const f = await makeFigure();
  const wrap = document.createElement('div'); wrap.className = 'demo3d'; wrap.hidden = true;
  wrap.innerHTML = '<canvas></canvas><div class="d3title"></div><div class="d3val"></div><div class="d3side"></div>';
  stage.appendChild(wrap);
  const cv = wrap.querySelector('canvas');
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'low-power' });
  r.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x15191f, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2, 3.5, 3); scene.add(key);
  const rim = new THREE.PointLight(0x2ee6a8, 5, 8, 2); rim.position.set(-1.5, 1.6, -1.4); scene.add(rim);
  // 地面刻度環＋鉛垂線（與 App 招牌圖形一致）
  const ring = Array.from({ length: 97 }, (_, i) => { const t = i / 96 * Math.PI * 2; return new THREE.Vector3(Math.cos(t) * 0.45, 0, Math.sin(t) * 0.45); });
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineBasicMaterial({ color: 0x2ee6a8, transparent: true, opacity: 0.5 })));
  const plumb = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.95, 0)]), new THREE.LineDashedMaterial({ color: 0x2ee6a8, dashSize: 0.04, gapSize: 0.04, transparent: true, opacity: 0.4 }));
  plumb.computeLineDistances(); scene.add(plumb);
  scene.add(f.root);
  const cam = new THREE.PerspectiveCamera(30, 0.8, 0.1, 50);
  let lastKey = '', size = '';

  const resize = () => {
    const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    const k = `${w}x${h}`; if (k === size) return; size = k;
    r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); lastKey = '';
  };

  /** 與 romdemo.render 相同的參數：view、示範參數、動作、標題、角度值、是否鏡像 */
  function render(view, params, move, title, values = [], mirror = false) {
    wrap.hidden = false; resize();
    const side = view === 'left' ? 'L' : 'R';
    const k = JSON.stringify([view, params, mirror, size]);
    const val = values.find(Number.isFinite);
    wrap.querySelector('.d3title').textContent = title || '';
    wrap.querySelector('.d3val').textContent = Number.isFinite(val) ? `${Math.round(Math.abs(val))}°` : '';
    wrap.querySelector('.d3side').textContent = view === 'front' ? (mirror ? '← L   R →' : '← R   L →') : view === 'back' ? '← L   R →' : `${side === 'R' ? 'R' : 'L'}`;
    if (k === lastKey) return;
    lastKey = k;
    f.pose(params, side);
    const d = 4.3, ty = 0.86;
    if (view === 'front') cam.position.set(0, ty + 0.15, d);
    else if (view === 'back') cam.position.set(0, ty + 0.15, -d);
    else if (view === 'right') cam.position.set(-d, ty + 0.15, 0.4);
    else cam.position.set(d, ty + 0.15, 0.4);
    cam.lookAt(0, ty, 0);
    cv.style.transform = mirror ? 'scaleX(-1)' : '';
    r.render(scene, cam);
  }
  const hide = () => { wrap.hidden = true; };
  const dispose = () => { r.dispose(); r.forceContextLoss?.(); wrap.remove(); };
  return { render, hide, dispose };
}
