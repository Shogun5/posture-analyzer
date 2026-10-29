// config.js — 登入設定（管理者填寫）
// clientId：Google Cloud Console → API 和服務 → 憑證 → OAuth 用戶端 ID（網頁應用程式）
// scriptUrl：Apps Script 部署的網頁應用程式 /exec 網址
// 這兩個值都不是機密（會出現在網頁原始碼中），真正的名單與簽章密鑰存在 Google Sheet / Apps Script。
export const AUTH = {
  enabled: true,
  clientId: '822559901418-kei8as7i6qemq2797dtoqsqb557g2j22.apps.googleusercontent.com',
  scriptUrl: 'https://script.google.com/macros/s/AKfycbwN-5xcttYQAEXyJksQkfIhC2XC_GQhUBwN_r5MpCQk0siFal2iLqQj9I9ISUDe6YL1/exec',
};
