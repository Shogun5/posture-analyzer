// reflinks.js — 結果 → ECT 互動評估模組（⑥ 參考資料）對應頁面
// 值為模組中的頁面標題（模組左側章節按鈕上的文字）；依標題尋找，模組增減頁面時不必改編號。

// 靜態姿勢：問題姿勢 id → 講義頁面
const POSTURE = [
  [/^(forward_head|chin_up|rounded_shoulder)$/, '下巴前突與上交叉症候群'],
  [/^(sway_back|trunk_forward|trunk_back|knee_flexed|genu_recurvatum)$/, '矢狀面姿勢分型'],
  [/^(head_tilt|head_shift|uneven_shoulders|trunk_lean|trunk_shift|pelvis_shift|scoliosis_pattern)$/, '側移與脊柱側彎'],
  [/^pelvic_obliquity$/, '骨盆骨性標記'],
  [/_genu_(valgum|varum)$|^gap_/, '膝關節力學狀態與姿勢'],
  [/_rearfoot_|_toe_(out|in)$/, '足部姿勢指數 FPI-6'],
];
export function refForFlag(id) { return POSTURE.find(([re]) => re.test(id))?.[1] ?? null; }

// AROM：動作 id → 講義頁面
const ROM = [
  [/^(sh_abd|[RL]_sh_flex|[RL]_sh_rot)$/, '疼痛弧與肩關節導航'],
  [/^[RL]_elbow$/, '肘關節活動度與功能性弧度'],
  [/^(neck_lat|neck_flex)$/, '頸椎活動度與阻力測試'],
  [/^(trunk_lat|trunk_flex)$/, '胸椎活動度與胸廓擴張'],
  [/^(hip_abd_[RL]|[RL]_hip_flex|hip_rot_[RL])$/, '功能性活動度'],
  [/^[RL]_knee$/, '膝關節力學狀態與姿勢'],
];
export function refForMove(id) { return ROM.find(([re]) => re.test(id))?.[1] ?? null; }
// 左右差異列（asymmetry 的 label）→ 講義頁面
const ASYM = { 'shoulder abd': 'sh_abd', 'shoulder flex': 'R_sh_flex', 'shoulder ext': 'R_sh_flex', 'shoulder ER': 'R_sh_rot', 'shoulder IR': 'R_sh_rot', 'elbow flex': 'R_elbow',
  'trunk lat flex': 'trunk_lat', 'neck lat flex': 'neck_lat', 'hip abd': 'hip_abd_R', 'hip flex': 'R_hip_flex', 'hip ER': 'hip_rot_R', 'hip IR': 'hip_rot_R', 'knee flex': 'R_knee' };
export const refForAsym = label => (ASYM[label] ? refForMove(ASYM[label]) : null);
// 多個關節同時受限時，可參考關節囊受限模式
export const CAPSULAR = '關節囊受限模式';
