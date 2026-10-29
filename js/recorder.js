// recorder.js — 將疊加骨架的畫布錄成影片（本機，不上傳）
// MP4 支援：Safari (iOS/macOS) 與 Chrome/Edge 126+；不支援時退回 WebM（可用 HandBrake/ffmpeg 轉檔）
const TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function pickMime() {
  if (!window.MediaRecorder) return null;
  return TYPES.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
}

export class CanvasRecorder {
  constructor(canvas, fps = 30) { this.canvas = canvas; this.fps = fps; this.mime = pickMime(); this.chunks = []; this.rec = null; }
  start() {
    if (this.mime === null) return false;
    const stream = this.canvas.captureStream(this.fps);
    this.chunks = [];
    this.rec = new MediaRecorder(stream, this.mime ? { mimeType: this.mime, videoBitsPerSecond: 4e6 } : undefined);
    this.rec.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
    return true;
  }
  /** 停止並回傳 {blob, ext} */
  stop() {
    return new Promise(res => {
      if (!this.rec || this.rec.state === 'inactive') return res(null);
      this.rec.onstop = () => {
        const type = this.rec.mimeType || this.mime || 'video/webm';
        res({ blob: new Blob(this.chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' });
      };
      this.rec.stop();
    });
  }
}
