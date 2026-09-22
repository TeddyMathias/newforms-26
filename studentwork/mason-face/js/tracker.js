/* ============================================================
   tracker.js — the hidden half of the app.
   Wraps MediaPipe FaceLandmarker, turns 478 raw points into a small
   set of named facial anchors + expression signals, and hands them to
   whoever wants to draw or record. The participant never sees any of it.
   ============================================================ */

import { FaceLandmarker, FilesetResolver } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

const WASM_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/* ---- ordered index loops for traceable features ------------------ */
export const CONTOUR_IDX = {
  faceOval: [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,
             152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109],
  lipsOuter: [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146],
  lipsInner: [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95],
  eyeR: [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246],
  eyeL: [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398],
  browR: [70,63,105,66,107,55,65,52,53,46],
  browL: [300,293,334,296,336,285,295,282,283,276]
};

/* ---- landmark indices used to build each anchor ------------------- */
const A = {
  face:    { a: 10,  b: 152, w: [234, 454] },   // top→chin, width across cheeks
  forehead:{ a: 109, b: 338, w: [109, 338] },
  eyeR:    { a: 33,  b: 133, w: [33, 133],  h: [159, 145] },
  eyeL:    { a: 362, b: 263, w: [362, 263], h: [386, 374] },
  irisR:   { a: 469, b: 471, w: [469, 471], h: [470, 472] },
  irisL:   { a: 474, b: 476, w: [474, 476], h: [475, 477] },
  browR:   { a: 70,  b: 107, w: [70, 107] },
  browL:   { a: 336, b: 300, w: [336, 300] },
  brows:   { a: 70,  b: 300, w: [70, 300] },
  eyes:    { a: 33,  b: 263, w: [33, 263] },
  nose:    { a: 168, b: 2,   w: [98, 327] },
  mouth:   { a: 61,  b: 291, w: [61, 291], h: [0, 17] },
  lipUpper:{ a: 61,  b: 291, w: [61, 291], h: [0, 13] },
  lipLower:{ a: 61,  b: 291, w: [61, 291], h: [14, 17] },
  jaw:     { a: 172, b: 397, w: [172, 397], h: [152, 152] },
  chin:    { a: 176, b: 400, w: [176, 400] },
  cheekR:  { a: 116, b: 205, w: [116, 205] },
  cheekL:  { a: 345, b: 425, w: [345, 425] }
};

const bs = (map, name) => map[name] || 0;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

export class Tracker {
  constructor() {
    this.landmarker = null;
    this.ready = false;
    this.lastVideoTime = -1;
    this.result = null;     // { lm, anchors, signals, blend, matrix, t }
    this.fps = 0;
    this._fpsT = 0; this._fpsN = 0;
    this._speech = 0;       // smoothed mouth activity, a cheap "is talking"
    this._prevJaw = 0;
  }

  async init(tracking = {}) {
    const files = await FilesetResolver.forVisionTasks(WASM_URL);
    this.landmarker = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: tracking.delegate || 'GPU' },
      runningMode: 'VIDEO',
      numFaces: tracking.numFaces ?? 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: tracking.minDetectionConfidence ?? 0.5,
      minTrackingConfidence: tracking.minTrackingConfidence ?? 0.5
    });
    this.ready = true;
    return this;
  }

  /** Run one detection against the current video frame. */
  detect(video, nowMs) {
    if (!this.ready || video.readyState < 2) return this.result;
    if (video.currentTime === this.lastVideoTime) return this.result;
    this.lastVideoTime = video.currentTime;

    let raw;
    try { raw = this.landmarker.detectForVideo(video, nowMs); }
    catch (e) { return this.result; }

    this._fpsN++;
    if (nowMs - this._fpsT > 500) {
      this.fps = Math.round(this._fpsN / ((nowMs - this._fpsT) / 1000));
      this._fpsT = nowMs; this._fpsN = 0;
    }

    const lm = raw.faceLandmarks && raw.faceLandmarks[0];
    if (!lm) { this.result = null; return null; }

    const blend = {};
    const cats = raw.faceBlendshapes && raw.faceBlendshapes[0];
    if (cats) for (const c of cats.categories) blend[c.categoryName] = c.score;

    const matrix = raw.facialTransformationMatrixes &&
                   raw.facialTransformationMatrixes[0] &&
                   raw.facialTransformationMatrixes[0].data;

    const anchors = this._anchors(lm);
    const signals = this._signals(blend, matrix, nowMs);

    this.result = { lm, anchors, signals, blend, matrix, t: nowMs };
    return this.result;
  }

  /* anchors are in normalized video space: x,y 0..1, w/h 0..1, angle rad */
  _anchors(lm) {
    const out = {};
    for (const key in A) {
      const d = A[key];
      const p1 = lm[d.a], p2 = lm[d.b];
      if (!p1 || !p2) continue;
      const wA = lm[d.w[0]], wB = lm[d.w[1]];
      const hA = d.h ? lm[d.h[0]] : p1, hB = d.h ? lm[d.h[1]] : p2;
      if (!wA || !wB || !hA || !hB) continue;

      const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
      const w = Math.hypot(wB.x - wA.x, wB.y - wA.y) || 0.001;
      const h = (Math.hypot(hB.x - hA.x, hB.y - hA.y) || w * 0.6);
      const angle = Math.atan2(wB.y - wA.y, wB.x - wA.x);
      out[key] = { x: cx, y: cy, w, h, angle, z: (p1.z + p2.z) / 2 };
    }
    // face gets a generous box: the whole head, not just top-to-chin midpoint
    if (out.face) {
      const top = lm[10], chin = lm[152], l = lm[234], r = lm[454];
      out.face.x = (l.x + r.x) / 2;
      out.face.y = (top.y + chin.y) / 2;
      out.face.w = Math.hypot(r.x - l.x, r.y - l.y);
      out.face.h = Math.hypot(chin.x - top.x, chin.y - top.y);
      out.face.angle = Math.atan2(r.y - l.y, r.x - l.x);
    }
    return out;
  }

  _signals(b, m, nowMs) {
    const jaw = bs(b, 'jawOpen');
    // speech ≈ how fast the jaw is changing, low-pass filtered
    const dJaw = Math.abs(jaw - this._prevJaw);
    this._prevJaw = jaw;
    this._speech = this._speech * 0.85 + clamp01(dJaw * 12) * 0.15;

    let yaw = 0, pitch = 0, roll = 0;
    if (m && m.length === 16) {
      // column-major 4x4 → rough euler, normalized to -1..1
      yaw   = Math.atan2(-m[8], Math.hypot(m[9], m[10])) / (Math.PI / 4);
      pitch = Math.atan2(m[9], m[10]) / (Math.PI / 4);
      roll  = Math.atan2(m[4], m[0]) / (Math.PI / 4);
    }
    return {
      none: 0,
      jawOpen: jaw,
      mouthSmile: (bs(b,'mouthSmileLeft') + bs(b,'mouthSmileRight')) / 2,
      mouthPucker: bs(b, 'mouthPucker'),
      mouthFunnel: bs(b, 'mouthFunnel'),
      blinkL: bs(b, 'eyeBlinkLeft'),
      blinkR: bs(b, 'eyeBlinkRight'),
      blink: (bs(b,'eyeBlinkLeft') + bs(b,'eyeBlinkRight')) / 2,
      browRaise: (bs(b,'browInnerUp') + bs(b,'browOuterUpLeft') + bs(b,'browOuterUpRight')) / 3,
      browDown: (bs(b,'browDownLeft') + bs(b,'browDownRight')) / 2,
      squint: (bs(b,'eyeSquintLeft') + bs(b,'eyeSquintRight')) / 2,
      cheekPuff: bs(b, 'cheekPuff'),
      yaw, pitch, roll,
      speech: clamp01(this._speech),
      time: (nowMs / 1000) % 1
    };
  }

  /** Compact, downloadable frame record. */
  serializeFrame(res, tMs, full = false) {
    if (!res) return { t: Math.round(tMs), face: 0 };
    const r3 = v => Math.round(v * 1000) / 1000;
    const rec = { t: Math.round(tMs), face: 1, a: {}, s: {} };
    for (const k in res.anchors) {
      const v = res.anchors[k];
      rec.a[k] = [r3(v.x), r3(v.y), r3(v.w), r3(v.h), r3(v.angle)];
    }
    for (const k in res.signals) if (k !== 'none') rec.s[k] = r3(res.signals[k]);
    if (res.matrix) rec.m = Array.from(res.matrix, r3);
    if (full && res.lm) rec.lm = res.lm.map(p => [r3(p.x), r3(p.y), r3(p.z)]);
    return rec;
  }
}
