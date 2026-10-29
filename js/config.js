// config.js — 登入設定（管理者填寫）
// clientId：Google Cloud Console → API 和服務 → 憑證 → OAuth 用戶端 ID（網頁應用程式）
// scriptUrl：Apps Script 部署的網頁應用程式 /exec 網址
// 這兩個值都不是機密（會出現在網頁原始碼中），真正的名單與簽章密鑰存在 Google Sheet / Apps Script。
export const AUTH = {
  enabled: true,
  clientId: 'PASTE_YOUR_CLIENT_ID.apps.googleusercontent.com',
  scriptUrl: 'PASTE_YOUR_APPS_SCRIPT_EXEC_URL',
};
