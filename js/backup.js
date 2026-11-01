// backup.js — 受測者與紀錄的備份檔（.json）匯出／匯入：換裝置、多台裝置合併資料用
// 內容：受測者名冊、每次測試紀錄（含照片）、0° 基準。影片很大，預設不含（可選擇加入）。
import * as store from './storage.js';

const FORMAT = 'posture-analyzer-backup', FORMAT_VER = 1;

const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
const dataURLtoBlob = async u => (await fetch(u)).blob();

/** 走訪紀錄裡所有影片欄位（四面、AROM、PROM） */
function videoSlots(s) {
  const out = [];
  for (const V of Object.values(s.views || {})) if (V?.video) out.push(V);
  for (const set of [s.rom, s.prom]) for (const r of Object.values(set || {})) if (r?.video) out.push(r);
  return out;
}

/**
 * 產生備份檔。subjectIds：只匯出這些受測者（null = 全部）；includeVideo：是否包含影片
 * 回傳 { blob, counts }
 */
export async function exportBackup({ subjectIds = null, includeVideo = false, appVersion = '' } = {}) {
  const pick = id => !subjectIds || subjectIds.includes(id);
  const subjects = (await store.listSubjects()).filter(p => pick(p.id));
  const sessions = [];
  for (const s0 of (await store.listSessions()).filter(s => pick(s.subject))) {
    const s = structuredClone(s0);
    for (const slot of videoSlots(s)) {
      if (includeVideo && slot.video?.blob instanceof Blob) slot.video = { ext: slot.video.ext, dataURL: await blobToDataURL(slot.video.blob) };
      else delete slot.video;
    }
    sessions.push(s);
  }
  const baselines = (await store.listBaselines()).filter(b => pick(b.subject));
  const data = { format: FORMAT, formatVersion: FORMAT_VER, appVersion, exported: new Date().toISOString(), subjects, sessions, baselines };
  return { blob: new Blob([JSON.stringify(data)], { type: 'application/json' }), counts: { subjects: subjects.length, sessions: sessions.length } };
}

/**
 * 匯入備份檔並與本機資料合併：
 * 受測者：同編號 → 保留較新修改的那筆（以 updated/created 判斷）；紀錄：同 id 已存在就略過；基準：同受測者以檔案為準
 */
export async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('not_json'); }
  if (data?.format !== FORMAT) throw new Error('not_backup');
  const local = new Map((await store.listSubjects()).map(p => [p.id, p]));
  const have = new Set((await store.listSessions()).map(s => s.id));
  const n = { subjectsNew: 0, subjectsUpdated: 0, sessionsNew: 0, sessionsSkipped: 0 };
  const stamp = p => p?.updated || p?.created || '';
  for (const p of data.subjects || []) {
    if (!p?.id) continue;
    const cur = local.get(p.id);
    if (!cur) { await store.saveSubject(p); n.subjectsNew++; }
    else if (stamp(p) > stamp(cur)) { await store.saveSubject(p); n.subjectsUpdated++; }
  }
  for (const s of data.sessions || []) {
    if (!s?.id || have.has(s.id)) { n.sessionsSkipped++; continue; }
    for (const slot of videoSlots(s)) if (slot.video?.dataURL) slot.video = { ext: slot.video.ext, blob: await dataURLtoBlob(slot.video.dataURL) };
    await store.saveSession(s); n.sessionsNew++;
    // 只有紀錄、名冊裡沒有這位受測者 → 自動補一筆，避免紀錄「看不到」
    if (s.subject && !local.has(s.subject) && !(data.subjects || []).some(p => p.id === s.subject)) {
      local.set(s.subject, { id: s.subject }); await store.saveSubject({ id: s.subject, name: '', height_cm: s.height_m ? Math.round(s.height_m * 1000) / 10 : '', mass_kg: s.mass_kg || '', created: s.date });
      n.subjectsNew++;
    }
  }
  for (const b of data.baselines || []) if (b?.subject) await store.saveBaseline(b);
  return n;
}
