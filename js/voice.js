// voice.js — 語音引導（Text-to-Speech）、提示音、語音指令（SpeechRecognition）
import { getLang, COMMANDS } from './i18n.js';

let audioCtx = null;
let lastSpoken = '', lastTime = 0;

/** iOS 需在使用者點擊時先「解鎖」語音與音訊 */
export function unlockAudio() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0; speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

function pickVoice(lang) {
  const vs = speechSynthesis.getVoices();
  const want = lang === 'zh' ? ['zh-TW', 'zh-HK', 'zh-CN', 'zh'] : ['en-US', 'en-GB', 'en'];
  for (const w of want) { const v = vs.find(x => x.lang?.replace('_', '-').startsWith(w)); if (v) return v; }
  return null;
}

/** 說話；interrupt=true 會打斷目前語音。相同句子 minGapMs 內不重複 */
export function speak(text, { interrupt = false, minGapMs = 0, rate = 1 } = {}) {
  if (!('speechSynthesis' in window) || !text) return;
  const now = performance.now();
  if (text === lastSpoken && now - lastTime < minGapMs) return;
  lastSpoken = text; lastTime = now;
  if (interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const lang = getLang();
  u.lang = lang === 'zh' ? 'zh-TW' : 'en-US';
  const v = pickVoice(lang); if (v) u.voice = v;
  u.rate = rate;
  speechSynthesis.speak(u);
}
export const isSpeaking = () => 'speechSynthesis' in window && speechSynthesis.speaking;

/** 提示音（倒數嗶聲） */
export function beep(freq = 880, ms = 150, vol = 0.3) {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq; g.gain.value = vol;
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + ms / 1000);
  } catch (e) { /* ignore */ }
}

// --- 語音指令 ---------------------------------------------------------------
let rec = null, wanted = false;

export const speechSupported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

/**
 * 開始持續聆聽；onCommand(cmd, transcript)，cmd ∈ capture/next/retake/stop/repeat
 * 注意：Chrome/Safari 的語音辨識由瀏覽器廠商的雲端服務處理「聲音」，影像不會上傳。
 */
export function startListening(onCommand, onHeard) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return false;
  wanted = true;
  rec = new SR();
  rec.lang = getLang() === 'zh' ? 'zh-TW' : 'en-US';
  rec.continuous = true;
  rec.interimResults = false;
  rec.onresult = ev => {
    const res = ev.results[ev.results.length - 1];
    const text = res[0].transcript.trim().toLowerCase();
    onHeard?.(text);
    const dict = COMMANDS[getLang()];
    for (const [cmd, words] of Object.entries(dict)) {
      if (words.some(w => text.includes(w.toLowerCase()))) { onCommand(cmd, text); return; }
    }
  };
  rec.onerror = e => console.warn('speech error', e.error);
  rec.onend = () => { if (wanted) setTimeout(() => { try { rec.start(); } catch (e) { /* already started */ } }, 300); }; // 自動重啟
  try { rec.start(); } catch (e) { /* ignore */ }
  return true;
}
export function stopListening() { wanted = false; try { rec?.stop(); } catch (e) { /* ignore */ } rec = null; }
