/* ============================================================
   config.js — the tunable model.
   Everything the admin panel edits lives here: flow timing and the
   abstraction layer stack. Layers are pure data so they can be
   exported, version-controlled, and re-authored against reference art.
   ============================================================ */

export const STORE_KEY = 'sayit.config.v1';

/* ---- facial anchors an abstraction can be pinned to -------------- */
export const ANCHORS = [
  'face', 'forehead', 'eyes', 'eyeL', 'eyeR', 'irisL', 'irisR',
  'browL', 'browR', 'brows', 'nose', 'mouth', 'lipUpper', 'lipLower',
  'jaw', 'chin', 'cheekL', 'cheekR'
];

/* ---- traceable contours (type: outline) -------------------------- */
export const CONTOURS = [
  'faceOval', 'lipsOuter', 'lipsInner', 'eyeL', 'eyeR', 'browL', 'browR'
];

/* ---- shape vocabulary -------------------------------------------- */
export const SHAPES = [
  'ellipse', 'ring', 'rect', 'polygon', 'bars', 'burst',
  'crosshair', 'blob', 'outline', 'mesh', 'text', 'image'
];

/* ---- live signals a layer can react to (0..1) --------------------- */
export const SIGNALS = [
  'none', 'jawOpen', 'mouthSmile', 'mouthPucker', 'mouthFunnel',
  'blinkL', 'blinkR', 'blink', 'browRaise', 'browDown', 'squint',
  'cheekPuff', 'yaw', 'pitch', 'roll', 'speech', 'time'
];

/* ---- parameters a signal can drive -------------------------------- */
export const TARGETS = [
  'none', 'scale', 'scaleX', 'scaleY', 'rotation', 'alpha',
  'strokeWidth', 'count', 'offsetX', 'offsetY', 'noise', 'hue'
];

export const BLENDS = ['source-over', 'screen', 'lighter', 'multiply', 'overlay', 'difference', 'exclusion'];

/* ---- a single abstraction layer ----------------------------------- */
export function makeLayer(shape = 'ring', i = 0) {
  return {
    id: 'L' + Math.random().toString(36).slice(2, 8),
    name: shape.toUpperCase() + ' ' + (i + 1),
    enabled: true,
    shape,
    anchor: 'face',
    contour: 'faceOval',      // used by outline / mesh
    // placement — offsets are multiples of the anchor's own size,
    // so a layer stays glued to the feature at any distance from camera
    offsetX: 0, offsetY: 0,
    scaleX: 1, scaleY: 1,
    rotation: 0,              // degrees, added to the anchor's own angle
    followAngle: true,        // inherit head/feature roll
    // look
    stroke: '#ff2f4d', strokeWidth: 2, dash: 0,
    fill: '#ff2f4d', fillAlpha: 0,
    alpha: 1, blend: 'source-over',
    // shape-specific
    sides: 6, count: 12, spread: 1, inner: 0.45, noise: 0,
    text: 'I LOVE YOU', fontSize: 0.5,
    imageId: '', imageFit: 'contain',
    // motion
    smoothing: 0.35,          // 0 = raw & jittery, 1 = molasses
    wobble: 0, wobbleSpeed: 1,
    // reactivity
    react: { signal: 'none', target: 'scale', amount: 0.5, curve: 1, bias: 0 },
    react2: { signal: 'none', target: 'none', amount: 0.5, curve: 1, bias: 0 }
  };
}

/* ---- the default stack: a legible starting point ------------------ */
function defaultLayers() {
  const L = [];
  const push = (over) => { const l = makeLayer(over.shape || 'ring', L.length); L.push(Object.assign(l, over)); };

  push({
    name: 'FACE FIELD', shape: 'blob', anchor: 'face',
    scaleX: 1.08, scaleY: 1.18, stroke: '#44e0ff', strokeWidth: 1.5,
    fill: '#44e0ff', fillAlpha: 0.04, noise: 0.06, wobble: 0.02, wobbleSpeed: 0.5,
    blend: 'screen', smoothing: 0.55,
    react: { signal: 'speech', target: 'noise', amount: 0.9, curve: 1, bias: 0 }
  });
  push({
    name: 'EYE RINGS L', shape: 'ring', anchor: 'eyeL',
    scaleX: 1.7, scaleY: 1.7, stroke: '#f6f4ef', strokeWidth: 2, blend: 'screen',
    react: { signal: 'blinkL', target: 'scaleY', amount: -0.85, curve: 1.6, bias: 0 }
  });
  push({
    name: 'EYE RINGS R', shape: 'ring', anchor: 'eyeR',
    scaleX: 1.7, scaleY: 1.7, stroke: '#f6f4ef', strokeWidth: 2, blend: 'screen',
    react: { signal: 'blinkR', target: 'scaleY', amount: -0.85, curve: 1.6, bias: 0 }
  });
  push({
    name: 'MOUTH TRACE', shape: 'outline', anchor: 'mouth', contour: 'lipsOuter',
    stroke: '#ff2f4d', strokeWidth: 3, fill: '#ff2f4d', fillAlpha: 0.12, blend: 'screen',
    smoothing: 0.2,
    react: { signal: 'jawOpen', target: 'strokeWidth', amount: 1.6, curve: 1, bias: 0 }
  });
  push({
    name: 'MOUTH BURST', shape: 'burst', anchor: 'mouth',
    scaleX: 1.2, scaleY: 1.2, count: 18, spread: 1.6, inner: 0.9,
    stroke: '#ff2f4d', strokeWidth: 1.5, alpha: 0.85, blend: 'screen',
    react: { signal: 'jawOpen', target: 'scale', amount: 1.4, curve: 1.3, bias: 0 },
    react2: { signal: 'mouthSmile', target: 'count', amount: 1.2, curve: 1, bias: 0 }
  });
  push({
    name: 'BROW BARS', shape: 'bars', anchor: 'brows',
    scaleX: 1.15, scaleY: 0.5, count: 7, spread: 1, stroke: '#44e0ff', strokeWidth: 3,
    blend: 'screen', alpha: 0.8,
    react: { signal: 'browRaise', target: 'offsetY', amount: -0.6, curve: 1, bias: 0 }
  });
  push({
    name: 'NOSE CROSS', shape: 'crosshair', anchor: 'nose',
    scaleX: 0.9, scaleY: 0.9, stroke: '#f6f4ef', strokeWidth: 1, alpha: 0.5, blend: 'screen'
  });
  return L;
}

/* ---- full document ------------------------------------------------ */
export function defaultConfig() {
  return {
    version: 1,
    flow: {
      prompt: 'SAY “I LOVE YOU”',
      liveLine: 'SAY “I LOVE YOU”',
      retakeLine: 'SAY IT AGAIN LIKE YOU MEAN IT',
      countdownSec: 3,
      takeSec: 6,                 // auto-stop length of a take
      minTakes: 2,                // forced re-record after take 1
      autoStop: true,
      idleResetSec: 90,           // kiosk returns to attract if abandoned
      mirrorPreview: true,
      // capture
      width: 1280, height: 720, fps: 30,
      audio: true,
      recordFullMesh: false,      // 478 pts/frame vs compact anchors+blendshapes
      recordFxTrack: false,       // also save the abstraction layer as its own video
      downloadOnlyChosen: false   // false = download every take (whole interaction)
    },
    tracking: {
      numFaces: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      delegate: 'GPU'
    },
    layers: defaultLayers(),
    refs: []                      // {id, name, src(dataURL)}
  };
}

/* ---- persistence --------------------------------------------------- */
export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultConfig();
    const saved = JSON.parse(raw);
    const base = defaultConfig();
    return {
      ...base, ...saved,
      flow: { ...base.flow, ...(saved.flow || {}) },
      tracking: { ...base.tracking, ...(saved.tracking || {}) },
      layers: (saved.layers && saved.layers.length)
        ? saved.layers.map(l => ({ ...makeLayer(l.shape), ...l,
            react: { ...makeLayer().react, ...(l.react || {}) },
            react2: { ...makeLayer().react2, ...(l.react2 || {}) } }))
        : base.layers,
      refs: saved.refs || []
    };
  } catch (e) {
    console.warn('[config] falling back to defaults', e);
    return defaultConfig();
  }
}

export function saveConfig(cfg) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); }
  catch (e) { console.warn('[config] save failed (refs may be too large)', e); }
}

/* ---- slider schema used to build the admin UI ---------------------- */
export const PARAM_SCHEMA = [
  { group: 'Placement', fields: [
    { k: 'anchor',   t: 'select', opts: ANCHORS },
    { k: 'offsetX',  t: 'range', min: -2, max: 2, step: 0.01 },
    { k: 'offsetY',  t: 'range', min: -2, max: 2, step: 0.01 },
    { k: 'scaleX',   t: 'range', min: 0, max: 4, step: 0.01 },
    { k: 'scaleY',   t: 'range', min: 0, max: 4, step: 0.01 },
    { k: 'rotation', t: 'range', min: -180, max: 180, step: 1 },
    { k: 'followAngle', t: 'bool' }
  ]},
  { group: 'Look', fields: [
    { k: 'stroke',      t: 'color' },
    { k: 'strokeWidth', t: 'range', min: 0, max: 24, step: 0.1 },
    { k: 'dash',        t: 'range', min: 0, max: 40, step: 1 },
    { k: 'fill',        t: 'color' },
    { k: 'fillAlpha',   t: 'range', min: 0, max: 1, step: 0.01 },
    { k: 'alpha',       t: 'range', min: 0, max: 1, step: 0.01 },
    { k: 'blend',       t: 'select', opts: BLENDS }
  ]},
  { group: 'Shape', fields: [
    { k: 'sides',    t: 'range', min: 3, max: 20, step: 1, only: ['polygon'] },
    { k: 'count',    t: 'range', min: 1, max: 60, step: 1, only: ['bars', 'burst'] },
    { k: 'spread',   t: 'range', min: 0, max: 3, step: 0.01, only: ['bars', 'burst'] },
    { k: 'inner',    t: 'range', min: 0, max: 2, step: 0.01, only: ['burst', 'ring', 'polygon'] },
    { k: 'noise',    t: 'range', min: 0, max: 0.5, step: 0.005, only: ['blob', 'outline', 'mesh'] },
    { k: 'contour',  t: 'select', opts: CONTOURS, only: ['outline'] },
    { k: 'text',     t: 'text',  only: ['text'] },
    { k: 'fontSize', t: 'range', min: 0.05, max: 3, step: 0.01, only: ['text'] },
    { k: 'imageId',  t: 'ref',   only: ['image'] },
    { k: 'imageFit', t: 'select', opts: ['contain', 'cover', 'stretch'], only: ['image'] }
  ]},
  { group: 'Motion', fields: [
    { k: 'smoothing',   t: 'range', min: 0, max: 0.95, step: 0.01 },
    { k: 'wobble',      t: 'range', min: 0, max: 0.5, step: 0.005 },
    { k: 'wobbleSpeed', t: 'range', min: 0, max: 6, step: 0.05 }
  ]}
];

export const FLOW_SCHEMA = [
  { group: 'Script', fields: [
    { k: 'prompt',     t: 'text' },
    { k: 'liveLine',   t: 'text' },
    { k: 'retakeLine', t: 'text' }
  ]},
  { group: 'Timing', fields: [
    { k: 'countdownSec', t: 'range', min: 0, max: 10, step: 1 },
    { k: 'takeSec',      t: 'range', min: 2, max: 30, step: 0.5 },
    { k: 'minTakes',     t: 'range', min: 1, max: 5, step: 1 },
    { k: 'autoStop',     t: 'bool' },
    { k: 'idleResetSec', t: 'range', min: 15, max: 300, step: 5 }
  ]},
  { group: 'Capture', fields: [
    { k: 'width',  t: 'select', opts: [640, 960, 1280, 1920] },
    { k: 'height', t: 'select', opts: [360, 540, 720, 1080] },
    { k: 'fps',    t: 'select', opts: [24, 30, 60] },
    { k: 'audio',  t: 'bool' },
    { k: 'mirrorPreview',      t: 'bool' },
    { k: 'recordFullMesh',     t: 'bool' },
    { k: 'recordFxTrack',      t: 'bool' },
    { k: 'downloadOnlyChosen', t: 'bool' }
  ]}
];
