// posture.js — 常見問題姿勢判讀（依 ECT 運動矯正講義 2026 修訂版 靜態姿勢評估章節）
// 規則以「平均值（濾波後）」與可調閾值比較。閾值為研究預設值，請依族群/儀器驗證後調整。
// 講義頁碼：P23–25 正面觀、P26–27 側面觀、P28–41 脊柱/側面姿勢型態、P42–52 背面觀與側彎、P57–62 良好/不良姿勢矩陣

export const DEFAULT_THR = {
  eye_tilt_deg: 3,            // 頭部側傾
  head_shift_cm: 2.5,         // 頭部側移
  shoulder_obliq_deg: 2.5,    // 肩膀高低
  pelvic_obliq_deg: 2,        // 骨盆側傾
  trunk_lateral_deg: 2,       // 軀幹側傾
  lateral_shift_cm: 2.5,      // 軀幹/骨盆相對雙踝中線側移
  knee_valgus_deg: 8,         // 膝外翻 FPPA
  knee_varus_deg: -4,         // 膝內翻 FPPA（負值）
  knee_gap_cm: 4,             // 膝內翻：雙踝併攏時膝間距
  ankle_gap_cm: 6,            // 膝外翻：雙膝併攏時踝間距
  rearfoot_valgus_deg: 6,     // 跟骨外翻（背面）
  rearfoot_varus_deg: -4,     // 跟骨內翻（背面）
  toe_out_deg: 20,            // 外八（3D，實驗性）
  toe_in_deg: -5,             // 內八
  forward_head_cm: 5,         // 耳在肩前方距離
  cva_deg: 50,                // 耳-肩與水平夾角（CVA 近似，<50 前傾）
  chin_up_deg: 5,             // 耳→鼻連線高於水平（下巴抬高）
  shoulder_fwd_cm: 4,         // 肩峰在髖（大轉子）前方 → 上背前移/圓肩近似
  sway_shoulder_back_cm: -3,  // 搖擺背：肩在髖後方
  hip_fwd_cm: 6,              // 搖擺背：髖在外踝前方
  knee_hyperext_deg: -5,      // 膝反屈
  knee_flexed_deg: 6,         // 站姿屈膝
  trunk_fwd_deg: 5,           // 軀幹前傾
  trunk_back_deg: -3,         // 軀幹後傾
};

const m = (S, k) => S[k]?.mean;
const fin = Number.isFinite;

function sev(val, thr) { // 超過閾值 1.5 倍以上 = 明顯
  const r = Math.abs(val) / Math.abs(thr || 1);
  return r >= 1.5 ? 'marked' : 'mild';
}

function F(id, zh, en, value, unit, thr, slides, tipZh, tipEn) {
  return { id, zh, en, value, unit, thr, sev: sev(value, thr), slides, tipZh, tipEn };
}

/** S: summary（各變數 {mean,...}）、view、thr → 問題清單 */
export function assessPosture(S, view, thr = DEFAULT_THR) {
  const out = [];
  const side = x => (x > 0 ? { zh: '右', en: 'right' } : { zh: '左', en: 'left' });

  if (view === 'front' || view === 'back') {
    const eye = m(S, 'eye_tilt_deg');
    if (fin(eye) && Math.abs(eye) > thr.eye_tilt_deg) {
      const low = side(-eye); // 低的一側 = 頭偏向該側
      out.push(F('head_tilt', `頭部側傾（向${low.zh}）`, `Head tilt (to ${low.en})`, eye, '°', thr.eye_tilt_deg, 'P24, P44, P57',
        '可能與同側上斜方肌/提肩胛肌緊繃或斜頸有關；確認是否伴隨對側旋轉受限。', 'May relate to ipsilateral upper trapezius/levator tightness or torticollis.'));
    }
    const hs = m(S, 'head_shift_cm');
    if (fin(hs) && Math.abs(hs) > thr.head_shift_cm)
      out.push(F('head_shift', `頭部側移（偏${side(hs).zh}）`, `Head lateral shift (${side(hs).en})`, hs, 'cm', thr.head_shift_cm, 'P23, P57', '頭部不在雙踝中線上。', 'Head off the mid-ankle plumb line.'));

    const so = m(S, 'shoulder_obliquity_deg');
    if (fin(so) && Math.abs(so) > thr.shoulder_obliq_deg) {
      const hi = side(so);
      out.push(F('uneven_shoulders', `肩膀高低不一（${hi.zh}肩高）`, `Uneven shoulders (${hi.en} high)`, so, '°', thr.shoulder_obliq_deg, 'P24, P44, P46, P58',
        `講義矩陣：高側斜方肌/提肩胛肌緊繃、背闊肌無力；常見脊椎側彎或胸廓代償。`, 'High side: upper trapezius/levator tight, latissimus weak; check scoliosis.'));
    }
    const po = m(S, 'pelvic_obliquity_deg');
    if (fin(po) && Math.abs(po) > thr.pelvic_obliq_deg) {
      const hi = side(po);
      out.push(F('pelvic_obliquity', `骨盆側傾（${hi.zh}側高）`, `Pelvic obliquity (${hi.en} high)`, po, '°', thr.pelvic_obliq_deg, 'P24, P44, P48, P55–56, P60',
        '以髖關節中心近似 ASIS/PSIS。建議觸診 ASIS/PSIS 並做真實腿長測量（ASIS→內踝），區分結構性長短腳與功能性代償。',
        'Hip-centre proxy for ASIS/PSIS. Palpate and measure true leg length to separate structural vs functional.'));
    }
    const tl = m(S, 'trunk_seg_deg');
    const ps = m(S, 'pelvis_mid_shift_cm'), ss = m(S, 'shoulder_mid_shift_cm');
    if (fin(tl) && Math.abs(tl) > thr.trunk_lateral_deg)
      out.push(F('trunk_lean', `軀幹側傾（向${side(tl).zh}）`, `Trunk lateral lean (${side(tl).en})`, tl, '°', thr.trunk_lateral_deg, 'P44, P49–52', '', ''));
    if (fin(ps) && Math.abs(ps) > thr.lateral_shift_cm)
      out.push(F('pelvis_shift', `骨盆側移（偏${side(ps).zh}）`, `Pelvic lateral shift (${side(ps).en})`, ps, 'cm', thr.lateral_shift_cm, 'P48', '', ''));
    // 肩與骨盆反向傾斜 → 脊柱側彎型態（需前彎測試確認結構性/功能性）
    if (fin(so) && fin(po) && Math.abs(so) > thr.shoulder_obliq_deg && Math.abs(po) > thr.pelvic_obliq_deg && Math.sign(so) !== Math.sign(po))
      out.push(F('scoliosis_pattern', '疑似脊柱側彎型態（肩/骨盆反向傾斜）', 'Possible scoliotic pattern (shoulder/pelvis tilt opposite)', so - po, '°', thr.shoulder_obliq_deg + thr.pelvic_obliq_deg, 'P44, P49–52',
        '請做 Adam 前彎測試：前彎時肋骨隆起仍在 → 結構性；消失 → 功能性。', 'Confirm with Adam forward-bend test (rib hump persists = structural).'));
    else if (fin(ss) && fin(ps) && Math.abs(ss - ps) > thr.lateral_shift_cm)
      out.push(F('trunk_shift', '軀幹相對骨盆側移（側彎/代償篩檢）', 'Thorax shifted over pelvis (scoliosis screen)', ss - ps, 'cm', thr.lateral_shift_cm, 'P49–52', '建議 Adam 前彎測試。', 'Adam forward-bend test advised.'));

    for (const [S_, zh, en] of [['R', '右', 'Right'], ['L', '左', 'Left']]) {
      const kv = m(S, `${S_}_knee_valgus_deg`);
      if (fin(kv) && kv > thr.knee_valgus_deg)
        out.push(F(`${S_}_genu_valgum`, `${zh}膝外翻（X 型腿）`, `${en} genu valgum (knock-knee)`, kv, '°', thr.knee_valgus_deg, 'P25, P61',
          '講義：膝外翻/內翻可引發對側骨盆與腰椎代償；檢查足旋前與髖內旋。', 'May drive pelvic/lumbar compensation; check foot pronation and hip IR.'));
      if (fin(kv) && kv < thr.knee_varus_deg)
        out.push(F(`${S_}_genu_varum`, `${zh}膝內翻（O 型腿）`, `${en} genu varum (bow-leg)`, kv, '°', thr.knee_varus_deg, 'P25, P61', '', ''));
      if (view === 'back') {
        const rf = m(S, `${S_}_rearfoot_valgus_deg`);
        if (fin(rf) && rf > thr.rearfoot_valgus_deg)
          out.push(F(`${S_}_rearfoot_valgus`, `${zh}跟骨外翻（足旋前/扁平足傾向）`, `${en} rearfoot valgus (pronation)`, rf, '°', thr.rearfoot_valgus_deg, 'P62',
            '以腳跟與腳踝關鍵點近似跟骨與小腿二等分線；建議以量角器量測跟骨角確認。', 'Heel/ankle landmarks approximate calcaneal bisection; verify with goniometer.'));
        if (fin(rf) && rf < thr.rearfoot_varus_deg)
          out.push(F(`${S_}_rearfoot_varus`, `${zh}跟骨內翻（足旋後/高弓足傾向）`, `${en} rearfoot varus (supination)`, rf, '°', thr.rearfoot_varus_deg, 'P62', '', ''));
      }
      if (view === 'front') {
        const to = m(S, `${S_}_toe_out_3D_deg`);
        if (fin(to) && to > thr.toe_out_deg)
          out.push(F(`${S_}_toe_out`, `${zh}足尖外開（外八，3D 實驗性）`, `${en} toe-out (3D, experimental)`, to, '°', thr.toe_out_deg, 'P25, P62', '可能與股骨後傾/脛骨外旋有關。', 'May relate to femoral retroversion / tibial external torsion.'));
        if (fin(to) && to < thr.toe_in_deg)
          out.push(F(`${S_}_toe_in`, `${zh}足尖內收（內八，3D 實驗性）`, `${en} toe-in (3D, experimental)`, to, '°', thr.toe_in_deg, 'P25', '可能與股骨前傾有關。', 'May relate to femoral anteversion.'));
      }
    }
    // 雙踝/雙膝間距（需雙腳併攏站姿才有意義，僅提示）
    const kg = m(S, 'knee_gap_cm'), ag = m(S, 'ankle_gap_cm');
    if (fin(kg) && fin(ag) && kg - ag > thr.knee_gap_cm)
      out.push(F('gap_varum', '膝間距 > 踝間距（O 型腿型態）', 'Knee gap > ankle gap (varum pattern)', kg - ag, 'cm', thr.knee_gap_cm, 'P61', '雙腳併攏站立時才可判讀。', 'Valid only with feet together.'));
    if (fin(kg) && fin(ag) && ag - kg > thr.ankle_gap_cm)
      out.push(F('gap_valgum', '踝間距 > 膝間距（X 型腿型態）', 'Ankle gap > knee gap (valgum pattern)', ag - kg, 'cm', thr.ankle_gap_cm, 'P61', '雙膝併攏站立時才可判讀。', 'Valid only with knees together.'));
  } else {
    const S_ = view === 'right' ? 'R' : 'L', zh = view === 'right' ? '右' : '左';
    const es = m(S, 'ear_minus_shoulder_cm'), cva = m(S, 'CVA_proxy_deg');
    if ((fin(es) && es > thr.forward_head_cm) || (fin(cva) && cva < thr.cva_deg))
      out.push(F('forward_head', '頭部前傾（Forward head）', 'Forward head posture', fin(es) ? es : cva, fin(es) ? 'cm' : '°', fin(es) ? thr.forward_head_cm : thr.cva_deg, 'P26–27, P57',
        `耳垂應落在肩峰正上方。CVA 近似值 ${fin(cva) ? cva.toFixed(1) : '-'}°（以肩峰代替 C7，數值偏大）。常伴隨上頸伸展、下頸屈曲、深層頸屈肌無力。`,
        `Ear should be over acromion. CVA proxy ${fin(cva) ? cva.toFixed(1) : '-'}° (acromion instead of C7).`));
    const sh = m(S, 'shoulder_minus_hip_cm');
    if (fin(sh) && sh > thr.shoulder_fwd_cm)
      out.push(F('rounded_shoulder', '肩峰前移（圓肩／上背前移近似）', 'Anterior shoulder (rounded shoulder proxy)', sh, 'cm', thr.shoulder_fwd_cm, 'P38–40, P58',
        '2D 關鍵點無法量測胸椎曲度；圓背/駝背請以傾斜儀或 Flexicurve 確認。', 'Thoracic curve not measurable from landmarks; verify kyphosis with inclinometer.'));
    const hp = m(S, 'hip_to_plumb_cm'), tr = m(S, 'trunk_seg_deg');
    if (fin(sh) && fin(hp) && sh < thr.sway_shoulder_back_cm && hp > thr.hip_fwd_cm)
      out.push(F('sway_back', '搖擺背型態（Sway-back）：骨盆前移、胸廓後移', 'Sway-back pattern', hp, 'cm', thr.hip_fwd_cm, 'P33–34',
        '講義 P34：變長/無力—單關節髖屈肌、腹外斜肌、下胸椎伸肌、下腹肌、頸屈肌；變短—腿後肌群、髖伸肌、腹內斜肌上側纖維。', 'P34: long/weak one-joint hip flexors, external oblique, lower thoracic extensors; short hamstrings, hip extensors.'));
    const hpitch = m(S, 'head_pitch_deg');
    if (fin(hpitch) && hpitch > thr.chin_up_deg)
      out.push(F('chin_up', '下巴過度抬高（Chin up）', 'Chin up too high', hpitch, '°', thr.chin_up_deg, 'P57', '耳-鼻連線高於水平；常與頭部前傾合併出現（上頸椎伸展代償）。', 'Ear–nose line above horizontal; often with forward head.'));
    if (fin(tr) && tr > thr.trunk_fwd_deg)
      out.push(F('trunk_forward', '軀幹前傾', 'Trunk forward lean', tr, '°', thr.trunk_fwd_deg, 'P26–27', '', ''));
    if (fin(tr) && tr < thr.trunk_back_deg)
      out.push(F('trunk_back', '軀幹後傾', 'Trunk backward lean', tr, '°', thr.trunk_back_deg, 'P33–34', '', ''));
    const kf = m(S, `${S_}_knee_flex_deg`);
    if (fin(kf) && kf < thr.knee_hyperext_deg)
      out.push(F('genu_recurvatum', `${zh}膝反屈（膝過伸）`, `${view} genu recurvatum`, kf, '°', thr.knee_hyperext_deg, 'P27, P61',
        '常見於搖擺背/前凸型姿勢；後關節囊與膕繩肌承受張力。', 'Common with sway-back/lordotic posture.'));
    if (fin(kf) && kf > thr.knee_flexed_deg)
      out.push(F('knee_flexed', `${zh}站姿屈膝`, `${view} flexed-knee stance`, kf, '°', thr.knee_flexed_deg, 'P27, P35–37', '可能與平背或髖屈肌緊繃有關。', 'May accompany flat-back or tight hip flexors.'));
    // 無法由 2D 關鍵點判定的項目：提示研究者
    out.push({ id: 'info_spine', zh: '提醒：腰椎前凸、胸椎後凸、骨盆前/後傾（ASIS–PSIS）無法由 MediaPipe 關鍵點直接量測，請以觸診/傾斜儀確認（講義 P28–41, P47）。',
      en: 'Note: lumbar lordosis, thoracic kyphosis and ASIS–PSIS pelvic tilt are not measurable from MediaPipe landmarks; confirm by palpation/inclinometer.', value: NaN, unit: '', thr: NaN, sev: 'info', slides: 'P28–41, P47', tipZh: '', tipEn: '' });
  }
  return out;
}
