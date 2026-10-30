// Feedback.gs — 在 Apps Script 專案中新增一個指令碼檔案「Feedback」，貼上本檔全部內容。
// 另外在 Code.gs 的 doPost 裡加兩行（見 docs/AUTH_SETUP.md 第 G 節）。
// ---------------- 使用者回饋與錯誤紀錄 ----------------
// 只接受有效 session（已登入的工作人員）；寫入名冊試算表的 Feedback / Errors 工作表（不存在就自動建立）
function sheet_(name, header) {
  const ss = roster_();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); sh.setFrozenRows(1); sh.getRange(1, 1, 1, header.length).setFontWeight('bold'); }
  return sh;
}
function sessionEmail_(session) {
  const p = verify_(session);
  return p && p.exp > Date.now() ? p.email : null;
}
/** 回饋：類別、內容、自動附帶的環境資訊；選擇附圖時把相機畫面存到雲端硬碟資料夾並放連結 */
function feedback_(b) {
  const email = sessionEmail_(b.session);
  if (!email) return { ok: false, reason: 'bad_session' };
  let link = '';
  if (b.image && /^data:image\/jpeg;base64,/.test(b.image)) {
    try {
      const it = DriveApp.getFoldersByName('posture-analyzer feedback');
      const folder = it.hasNext() ? it.next() : DriveApp.createFolder('posture-analyzer feedback');
      const blob = Utilities.newBlob(Utilities.base64Decode(b.image.split(',')[1]), 'image/jpeg',
        Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd_HHmmss') + '_' + email.split('@')[0] + '.jpg');
      link = folder.createFile(blob).getUrl();
    } catch (e) { link = '（圖片儲存失敗：' + e + '）'; }
  }
  sheet_('Feedback', ['時間', '帳號', '類別', '內容', '版本', '所在步驟', '裝置／瀏覽器', '環境資訊', '圖片', '處理狀態', '回覆／備註'])
    .appendRow([new Date(), email, String(b.category || ''), String(b.text || '').slice(0, 5000), String(b.ver || ''), String(b.step || ''),
      String(b.ua || '').slice(0, 300), String(b.ctx || '').slice(0, 2000), link, '未處理', '']);
  return { ok: true };
}
/** 錯誤紀錄：前端自動回報的 JavaScript 錯誤（不含影像與受測者資料） */
function errlog_(b) {
  const email = sessionEmail_(b.session);
  if (!email) return { ok: false, reason: 'bad_session' };
  const rows = (Array.isArray(b.errors) ? b.errors : []).slice(0, 20).map(x => [new Date(x.t || Date.now()), email, String(b.ver || ''), String(x.step || ''),
    String(x.msg || '').slice(0, 500), String(x.stack || '').slice(0, 1500), String(b.ua || '').slice(0, 300)]);
  if (rows.length) {
    const sh = sheet_('Errors', ['時間', '帳號', '版本', '所在步驟', '錯誤訊息', '堆疊', '裝置／瀏覽器']);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
  return { ok: true, n: rows.length };
}
