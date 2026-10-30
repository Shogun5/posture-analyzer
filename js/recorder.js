// recorder.js — 將疊加骨架的畫布錄成影片（本機，不上傳）
// 格式選擇 fmt：
//   auto：Safari（iOS/macOS）→ MP4（它只支援 MP4）；Chrome/Edge/Firefox → WebM VP8
//         （桌機 Chrome 以 MediaRecorder 錄 H.264 MP4 時，在部分 GPU/驅動上會讓分頁當機 STATUS_BREAKPOINT）
//   mp4 / webm：強制格式；none：不錄影（仍會記錄關鍵點與快照）
// WebM 可用 ffmpeg 轉 MP4：ffmpeg -i in.webm -c:v libx264 out.mp4
const MP4 = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'];
const WEBM = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];
const isSafari = () => /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(navigator.userAgent);

export function pickMime(fmt = 'auto') {
  if (!window.MediaRecorder || fmt === 'none') return null;
  const ok = list => list.find(t => MediaRecorder.isTypeSupported(t));
  if (fmt === 'mp4') return ok(MP4) ?? ok(WEBM) ?? '';
  if (fmt === 'webm') return ok(WEBM) ?? ok(MP4) ?? '';
  return (isSafari() ? ok(MP4) ?? ok(WEBM) : ok(WEBM) ?? ok(MP4)) ?? '';
}

export class CanvasRecorder {
  constructor(canvas, fps = 30, fmt = 'auto') { this.canvas = canvas; this.fps = fps; this.mime = pickMime(fmt); this.chunks = []; this.rec = null; }
  start() {
    if (this.mime === null) return false;
    const stream = this.canvas.captureStream(this.fps);
    this.chunks = [];
    this.rec = new MediaRecorder(stream, this.mime ? { mimeType: this.mime, videoBitsPerSecond: 4e6 } : undefined);
    this.rec.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
    return true;
  }
  /** 停止並回傳 {blob, ext}；未錄影回傳 null */
  stop() {
    return new Promise(res => {
      if (!this.rec || this.rec.state === 'inactive') return res(null);
      const done = () => {
        clearTimeout(timer);
        const type = this.rec.mimeType || this.mime || 'video/webm';
        res(this.chunks.length ? { blob: new Blob(this.chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' } : null);
      };
      // 保險：onstop 沒觸發時 3 秒後用已收到的片段結束，流程不會卡住
      const timer = setTimeout(done, 3000);
      this.rec.onstop = done;
      try { this.rec.stop(); } catch { done(); }
    });
  }
}
