// figure3d.js — 共用的 3D 人形（Xbot，App 配色）：AROM 示範動畫、結果頁人體圖
// 模型與 three.js 只載入一次（之後由 service worker 快取）。動作以「世界座標軸」旋轉骨骼：
//   X = 受測者左方、Y = 上、Z = 前方（面向鏡頭）。正負號依解剖學定義（外展、屈曲、外轉為正）。
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
const GLTF_URL = 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/loaders/GLTFLoader.js/+esm';
const MODEL_URL = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r169/examples/models/gltf/Xbot.glb';
export const ACCENT = 0x2ee6a8, SHELL = 0xedeff2;

let libP = null;
/** 載入 three、GLTFLoader 與模型（只做一次）。回傳 { THREE, gltf } */
export function loadLib() {
  libP ??= (async () => {
    const [THREE, { GLTFLoader }] = await Promise.all([import(THREE_URL), import(GLTF_URL)]);
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    return { THREE, gltf };
  })();
  libP.catch(() => { libP = null; });
  return libP;
}

/** 建一個人形：複製模型骨架、換 App 配色、身高 1.65 m、腳踩 y=0。回傳 { root, pose(params, side), bone(name) } */
export async function makeFigure({ rim = true, focus = rim } = {}) {
  const { THREE, gltf } = await loadLib();
  const { clone } = await import('https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/utils/SkeletonUtils.js/+esm');
  const body = clone(gltf.scene);
  // 受測肢段標示：每根骨骼一個權重（1 = 受測），依頂點的蒙皮權重混合 → 受測肢段變成發光的強調色，其餘身體變暗
  let skel = null;
  body.traverse(o => { if (o.isSkinnedMesh && !skel) skel = o.skeleton; });
  const NB = skel?.bones.length || 1;
  const hiU = { uHi: { value: new Float32Array(NB) }, uFocus: { value: 0 } };
  const patchHi = (mat, glow, rimOn) => {
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, hiU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
        uniform float uHi[${NB}];
        varying float vHi;`).replace('#include <skinning_vertex>', `#include <skinning_vertex>
        #ifdef USE_SKINNING
          vHi = uHi[int(skinIndex.x)] * skinWeight.x + uHi[int(skinIndex.y)] * skinWeight.y + uHi[int(skinIndex.z)] * skinWeight.z + uHi[int(skinIndex.w)] * skinWeight.w;
        #else
          vHi = 0.0;
        #endif`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uFocus;
        varying float vHi;`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float hi = smoothstep(0.35, 0.65, vHi) * uFocus;
        float dim = uFocus * (1.0 - hi);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.5, dim);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.90, 0.66), hi * ${glow ? '0.75' : '0.3'});
        totalEmissiveRadiance *= 1.0 - 0.7 * dim;
        totalEmissiveRadiance += vec3(0.18, 0.90, 0.66) * hi * ${glow ? '0.55' : '0.6'};
        ${rimOn ? `float fr = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0);
        totalEmissiveRadiance += vec3(0.18, 0.90, 0.66) * fr * (0.5 * (1.0 - dim) + hi * 1.2);` : ''}`);
    };
  };
  const shell = new THREE.MeshPhysicalMaterial({ color: SHELL, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.15 });
  const joint = new THREE.MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.4, roughness: 0.35 });
  patchHi(shell, true, rim); patchHi(joint, false, false);
  body.traverse(o => { if (o.isMesh) { o.material = /Joints/i.test(o.material?.name || '') ? joint : shell; o.frustumCulled = false; } });
  body.updateMatrixWorld(true);                        // 複製的骨架要先更新，量出來的身高才正確
  const box = new THREE.Box3().setFromObject(body), size = box.getSize(new THREE.Vector3());
  body.scale.setScalar(1.65 / size.y); body.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(body), c2 = box2.getCenter(new THREE.Vector3());
  body.position.set(-c2.x, -box2.min.y, -c2.z); body.updateMatrixWorld(true);
  const root = new THREE.Group(); root.add(body);

  // 基準姿勢 = 待機動畫的一格（雙手自然下垂）
  const mixer = new THREE.AnimationMixer(body), idle = gltf.animations.find(a => a.name === 'idle');
  if (idle) { mixer.clipAction(idle).play(); mixer.setTime(0.6); }
  const bone = n => body.getObjectByName(`mixamorig${n}`) || body.getObjectByName(`mixamorig:${n}`);
  const names = ['Spine', 'Spine1', 'Neck', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'];
  const base = new Map(names.map(n => bone(n)).filter(Boolean).map(b => [b, b.quaternion.clone()]));
  const restY = root.position.y;
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion(), pq = new THREE.Quaternion(), ax = new THREE.Vector3();
  const rot = (n, axis, deg) => {   // 繞世界座標軸旋轉骨骼（在父骨骼座標中計算，旋轉中心 = 該關節）
    const b = bone(n); if (!b || !deg) return;
    b.parent.updateWorldMatrix(true, false); b.parent.getWorldQuaternion(pq);
    ax.copy(axis).applyQuaternion(pq.invert()).normalize();
    b.quaternion.premultiply(q.setFromAxisAngle(ax, THREE.MathUtils.degToRad(deg)));
    b.updateWorldMatrix(false, true);
  };

  /**
   * 擺姿勢。p：AROM 動作的示範參數（rom.js 的 m.demo(v)）；side：'R'/'L'（側面動作作用在面向鏡頭的那一側）
   * 正負號：外展、屈曲、外轉、往右側彎為正
   */
  const pose = (p = {}, side = 'R') => {
    for (const [b, q0] of base) b.quaternion.copy(q0);
    root.position.y = restY; body.updateMatrixWorld(true);
    const S = side === 'L' ? 'Left' : 'Right', sgn = side === 'L' ? 1 : -1;     // 左側在 +X
    // 軀幹、頸
    rot('Spine', Z, p.trunkLat || 0); rot('Spine', X, p.trunkFlex || 0);
    rot('Neck', Z, (p.neckLat || 0) * 0.7); rot('Head', Z, (p.neckLat || 0) * 0.3);
    rot('Neck', X, (p.neckFlex || 0) * 0.6); rot('Head', X, (p.neckFlex || 0) * 0.4);
    // 雙肩外展／內收（正面）
    // 內收（負值）時手臂先往前抬，雙手在身體前方交叉，才不會穿進身體裡看不到
    const addFwd = v => (v < 0 ? Math.min(1, -v / 10) * (32 + -v * 0.3) : 0);   // 手在肚子前交叉；0°→-10° 之間漸進，避免動畫跳動
    // 外展：繞前後軸往外抬；內收：手臂先往前抬，再繞垂直軸水平往中線收，雙手在胸前交叉
    // 真人交叉時一手在前、一手在後：右手抬高較多（在前上方），左手較少，手臂不會互相穿過
    for (const [n, v, sg, lift] of [['RightArm', p.shAbdR, -1, 1.18], ['LeftArm', p.shAbdL, 1, 0.82]]) {
      if (v === undefined) continue;
      if (v >= 0) rot(n, Z, sg * v);
      else { rot(n, X, -addFwd(v) * lift); rot(n, Y, -sg * -v * 1.3); }
    }
    // 肩屈曲／伸展、肘屈曲（側面）
    if ('shFlex' in p) rot(`${S}Arm`, X, -(p.shFlex || 0));
    if ('elbowFlex' in p) rot(`${S}ForeArm`, X, -(p.elbowFlex || 0));
    // 肩外展 90° 下的內外轉：上臂外展 90°、前臂朝前，再繞上臂長軸轉
    if ('shRot' in p) {
      rot(`${S}Arm`, Z, sgn * 90);
      rot(`${S}ForeArm`, Y, -sgn * 90);
      rot(`${S}Arm`, X, -(p.shRot || 0));
    }
    // 髖
    if ('hipAbdR' in p) rot('RightUpLeg', Z, -(p.hipAbdR || 0));
    if ('hipAbdL' in p) rot('LeftUpLeg', Z, p.hipAbdL || 0);
    if ('hipFlex' in p) rot(`${S}UpLeg`, X, -(p.hipFlex || 0));
    if ('kneeFlex' in p) rot(`${S}Leg`, X, p.kneeFlex || 0);
    // 單腳站立髖內外轉：另一腳站立，測試腳髖、膝各屈 90°，再繞大腿長軸轉小腿（外轉 = 腳往身體中線）
    if ('hipRotR' in p) { rot('RightUpLeg', X, -90); rot('RightLeg', X, 90); rot('RightUpLeg', Z, p.hipRotR || 0); }
    if ('hipRotL' in p) { rot('LeftUpLeg', X, -90); rot('LeftLeg', X, 90); rot('LeftUpLeg', Z, -(p.hipRotL || 0)); }
    body.updateMatrixWorld(true);
    if (focus) highlight(p, S);
  };
  // 依示範參數決定受測肢段：[骨骼, 是否含所有子骨骼]
  const SEG = {
    shAbdR: [['RightArm', 1]], shAbdL: [['LeftArm', 1]], shFlex: [['#Arm', 1]], shRot: [['#Arm', 1]], elbowFlex: [['#ForeArm', 1]],
    hipAbdR: [['RightUpLeg', 1]], hipAbdL: [['LeftUpLeg', 1]], hipFlex: [['#UpLeg', 1]], kneeFlex: [['#Leg', 1]],
    hipRotR: [['RightLeg', 1]], hipRotL: [['LeftLeg', 1]],
    trunkLat: [['Spine', 0], ['Spine1', 0], ['Spine2', 0]], trunkFlex: [['Spine', 0], ['Spine1', 0], ['Spine2', 0]],
    neckLat: [['Neck', 1]], neckFlex: [['Neck', 1]],
  };
  function highlight(p, S) {
    const on = new Set();
    for (const k of Object.keys(p)) for (const [n, deep] of SEG[k] || []) {
      const b = bone(n.replace('#', S)); if (!b) continue;
      if (deep) b.traverse(c => on.add(c)); else on.add(b);
    }
    const a = hiU.uHi.value; a.fill(0);
    skel?.bones.forEach((b, i) => { if (on.has(b)) a[i] = 1; });
    hiU.uFocus.value = on.size ? 1 : 0;
  }
  pose({});
  return { THREE, root, body, pose, bone };
}

// ---------------- 結果頁人體圖：正面靜態圖＋關節在圖上的座標（viewBox 200×300） ----------------
let mapP = null;
export function renderBodyMap() {
  mapP ??= (async () => {
    const { THREE } = await loadLib();
    const f = await makeFigure({ rim: false });
    f.pose({ shAbdR: 22, shAbdL: 22 });                     // 雙手微張，關節點不重疊
    const W = 400, H = 600, r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.setSize(W, H); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x15191f, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1.5, 3, 4); scene.add(key);
    scene.add(f.root);
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 50); cam.position.set(0, 0.86, 4.0); cam.lookAt(0, 0.84, 0);
    r.render(scene, cam);
    const url = r.domElement.toDataURL('image/png');
    const v = new THREE.Vector3(), proj = (name, dy = 0) => { const b = f.bone(name); if (!b) return null; b.getWorldPosition(v); v.y += dy; v.project(cam); return [(v.x + 1) / 2 * 200, (1 - v.y) / 2 * 300]; };
    const pts = {
      head: proj('Head', 0.09), neck: proj('Neck'), shR: proj('RightArm'), shL: proj('LeftArm'), elR: proj('RightForeArm'), elL: proj('LeftForeArm'),
      trunk: proj('Spine1'), pelvis: proj('Hips'), hipR: proj('RightUpLeg'), hipL: proj('LeftUpLeg'), knR: proj('RightLeg'), knL: proj('LeftLeg'),
      anR: proj('RightFoot'), anL: proj('LeftFoot'), ftR: proj('RightToeBase'), ftL: proj('LeftToeBase'),
    };
    r.dispose(); r.forceContextLoss?.();
    return { url, pts };
  })();
  mapP.catch(() => { mapP = null; });
  return mapP;
}
