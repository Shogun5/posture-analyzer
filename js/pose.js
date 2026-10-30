// pose.js — MediaPipe Pose Landmarker（Tasks Vision）封裝；全部在瀏覽器本機運算
import { PoseLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

export const MP_VERSION = '0.10.14';
export const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
export const MODEL_URLS = {
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};

let fileset = null;

/** 建立 PoseLandmarker（VIDEO 模式）。numPoses：平常 1 人；PROM 時 2 人（受測者＋協助者）。delegate='GPU' 時先試 GPU，失敗退回 CPU。 */
export async function createPose(variant = 'heavy', delegate = 'GPU', numPoses = 1) {
  fileset ??= await FilesetResolver.forVisionTasks(WASM_URL);
  const opts = delegate => ({
    baseOptions: { modelAssetPath: MODEL_URLS[variant], delegate },
    runningMode: 'VIDEO',
    numPoses,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
  if (delegate === 'CPU') return PoseLandmarker.createFromOptions(fileset, opts('CPU'));
  try { return await PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
  catch (e) { console.warn('GPU delegate failed, using CPU', e); return PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
}

/**
 * 對一張畫布偵測；回傳像素座標關鍵點 lm[i] = [x_px, y_px, z, visibility]
 * 與 world landmarks wlm[i] = [x_m, y_m, z_m, visibility]（以髖中點為原點）
 */
export function detect(landmarker, source, tsMs, W = source.width, H = source.height) {
  const r = landmarker.detectForVideo(source, tsMs);
  if (!r.landmarks?.length) return null;
  const all = r.landmarks.map((L, k) => ({
    lm: L.map(p => [p.x * W, p.y * H, p.z, p.visibility ?? 0]),
    wlm: r.worldLandmarks?.[k]?.map(p => [p.x, p.y, p.z, p.visibility ?? 0]) ?? null,
    norm: L.map(p => [p.x, p.y, p.z, p.visibility ?? 0]),
  }));
  return { ...all[0], all };
}
