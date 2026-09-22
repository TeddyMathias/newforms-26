/* ============================================================
   abstractions.js — draws the layer stack onto a canvas.
   Pure function of (tracker result, config.layers, time). No DOM
   reads beyond the canvas, so the same renderer serves the admin
   preview and the optional offline FX video track.
   ============================================================ */

import { CONTOUR_IDX } from './tracker.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* cheap deterministic noise so wobble is smooth, not random per frame */
function wave(seed, t) {
  return Math.sin(t * 1.3 + seed * 12.9898) * 0.6 +
         Math.sin(t * 2.7 + seed * 78.233) * 0.4;
}

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export class AbstractionRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = new Map();   // layerId -> smoothed anchor
    this.images = new Map();  // refId -> HTMLImageElement
    this.showMesh = false;
    this.solo = null;
  }

  setImages(refs) {
    this.images.clear();
    for (const r of refs || []) {
      const img = new Image();
      img.src = r.src;
      this.images.set(r.id, img);
    }
  }

  /** Match backing store to the element's box (and DPR). */
  resize() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  clear() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }

  /**
   * @param res    tracker result (or null)
   * @param layers config.layers
   * @param video  the source <video>, for cover-fit mapping
   * @param tSec   seconds, for wobble
   */
  draw(res, layers, video, tSec) {
    const ctx = this.ctx, c = this.canvas;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!res || !video.videoWidth) return;

    const vw = video.videoWidth, vh = video.videoHeight;
    const s = Math.max(c.width / vw, c.height / vh);
    const ox = (c.width - vw * s) / 2, oy = (c.height - vh * s) / 2;
    const map = {
      x: nx => ox + nx * vw * s,
      y: ny => oy + ny * vh * s,
      w: nw => nw * vw * s,
      h: nh => nh * vh * s
    };

    if (this.showMesh) this._mesh(res, map);

    for (const L of layers) {
      if (!L.enabled) continue;
      if (this.solo && L.id !== this.solo) continue;
      const a = res.anchors[L.anchor];
      if (!a) continue;
      try { this._layer(L, a, res, map, tSec); }
      catch (e) { /* one bad layer must never kill the frame */ }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /* ---- per-layer -------------------------------------------------- */
  _layer(L, anchorRaw, res, map, tSec) {
    const ctx = this.ctx;

    // 1. temporal smoothing of the anchor itself
    const k = clamp(L.smoothing ?? 0, 0, 0.95);
    let st = this.state.get(L.id);
    if (!st) { st = { ...anchorRaw }; this.state.set(L.id, st); }
    st.x = lerp(anchorRaw.x, st.x, k);
    st.y = lerp(anchorRaw.y, st.y, k);
    st.w = lerp(anchorRaw.w, st.w, k);
    st.h = lerp(anchorRaw.h, st.h, k);
    st.angle = lerp(anchorRaw.angle, st.angle, k);

    // 2. reactive parameter overrides
    const p = {
      scale: 1, scaleX: L.scaleX, scaleY: L.scaleY, rotation: L.rotation,
      alpha: L.alpha, strokeWidth: L.strokeWidth, count: L.count,
      offsetX: L.offsetX, offsetY: L.offsetY, noise: L.noise, hue: 0
    };
    for (const r of [L.react, L.react2]) {
      if (!r || r.signal === 'none' || r.target === 'none') continue;
      let v = res.signals[r.signal] ?? 0;
      v = clamp(v + (r.bias || 0), -1, 1);
      v = Math.sign(v) * Math.pow(Math.abs(v), r.curve || 1);
      const amt = v * (r.amount ?? 0);
      switch (r.target) {
        case 'scale':       p.scale += amt; break;
        case 'scaleX':      p.scaleX *= (1 + amt); break;
        case 'scaleY':      p.scaleY *= (1 + amt); break;
        case 'rotation':    p.rotation += amt * 180; break;
        case 'alpha':       p.alpha = clamp(p.alpha + amt, 0, 1); break;
        case 'strokeWidth': p.strokeWidth = Math.max(0, p.strokeWidth * (1 + amt)); break;
        case 'count':       p.count = Math.max(1, Math.round(p.count * (1 + amt))); break;
        case 'offsetX':     p.offsetX += amt; break;
        case 'offsetY':     p.offsetY += amt; break;
        case 'noise':       p.noise = Math.max(0, p.noise + amt * 0.25); break;
        case 'hue':         p.hue += amt * 180; break;
      }
    }

    // 3. wobble
    if (L.wobble) {
      const t = tSec * (L.wobbleSpeed || 1);
      p.offsetX += wave(1, t) * L.wobble;
      p.offsetY += wave(2, t) * L.wobble;
    }

    // 4. geometry in pixels
    const aw = map.w(st.w), ah = map.h(st.h);
    const cx = map.x(st.x) + p.offsetX * aw;
    const cy = map.y(st.y) + p.offsetY * ah;
    const rx = Math.max(0.5, aw * p.scaleX * p.scale / 2);
    const ry = Math.max(0.5, ah * p.scaleY * p.scale / 2);
    const rot = (L.followAngle ? st.angle : 0) + p.rotation * Math.PI / 180;

    ctx.save();
    ctx.globalAlpha = clamp(p.alpha, 0, 1);
    ctx.globalCompositeOperation = L.blend || 'source-over';
    ctx.lineWidth = p.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash(L.dash ? [L.dash, L.dash] : []);
    ctx.strokeStyle = p.hue ? this._shift(L.stroke, p.hue) : L.stroke;
    ctx.fillStyle = hexToRgba(L.fill, L.fillAlpha);

    // contour shapes live in absolute space; everything else is local
    if (L.shape === 'outline' || L.shape === 'mesh') {
      this._contour(L, res, map, p, tSec);
    } else {
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      this._shape(L, p, rx, ry, tSec);
    }
    ctx.restore();
  }

  _shift(hex, deg) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let hh = 0;
    if (d) {
      if (max === r) hh = ((g - b) / d) % 6;
      else if (max === g) hh = (b - r) / d + 2;
      else hh = (r - g) / d + 4;
    }
    hh = (hh * 60 + deg + 360) % 360;
    const l = (max + min) / 510, sat = d ? d / (255 - Math.abs(2 * l * 255 - 255) || 1) : 0;
    return `hsl(${hh.toFixed(0)} ${clamp(sat * 100, 0, 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
  }

  /* ---- shape vocabulary ------------------------------------------- */
  _shape(L, p, rx, ry, tSec) {
    const ctx = this.ctx;
    const strokeFill = () => {
      if (L.fillAlpha > 0) ctx.fill();
      if (p.strokeWidth > 0) ctx.stroke();
    };

    switch (L.shape) {
      case 'ellipse':
      case 'ring': {
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
        strokeFill();
        if (L.shape === 'ring' && L.inner > 0 && L.inner < 1) {
          ctx.beginPath();
          ctx.ellipse(0, 0, rx * L.inner, ry * L.inner, 0, 0, TAU);
          ctx.stroke();
        }
        break;
      }
      case 'rect':
        ctx.beginPath();
        ctx.rect(-rx, -ry, rx * 2, ry * 2);
        strokeFill();
        break;

      case 'polygon': {
        const n = Math.max(3, L.sides | 0);
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
          const th = (i / n) * TAU - Math.PI / 2;
          const x = Math.cos(th) * rx, y = Math.sin(th) * ry;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
        strokeFill();
        break;
      }
      case 'bars': {
        const n = Math.max(1, p.count | 0);
        const step = (rx * 2 * (L.spread || 1)) / n;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = -rx * (L.spread || 1) + step * (i + 0.5);
          const k = 1 - Math.abs(i / (n - 1 || 1) - 0.5) * 2 * (1 - (L.inner || 0));
          ctx.moveTo(x, -ry * k);
          ctx.lineTo(x, ry * k);
        }
        ctx.stroke();
        break;
      }
      case 'burst': {
        const n = Math.max(1, p.count | 0);
        const inner = L.inner ?? 0.9, spread = L.spread ?? 1;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const th = (i / n) * TAU;
          const c = Math.cos(th), s = Math.sin(th);
          ctx.moveTo(c * rx * inner, s * ry * inner);
          ctx.lineTo(c * rx * (inner + spread * 0.6), s * ry * (inner + spread * 0.6));
        }
        ctx.stroke();
        break;
      }
      case 'crosshair':
        ctx.beginPath();
        ctx.moveTo(-rx, 0); ctx.lineTo(rx, 0);
        ctx.moveTo(0, -ry); ctx.lineTo(0, ry);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(0, 0, rx * (L.inner || 0.25), ry * (L.inner || 0.25), 0, 0, TAU);
        strokeFill();
        break;

      case 'blob': {
        const n = 42, t = tSec * (L.wobbleSpeed || 1);
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
          const th = (i / n) * TAU;
          const d = 1 + wave(i * 0.7, t) * (p.noise || 0);
          const x = Math.cos(th) * rx * d, y = Math.sin(th) * ry * d;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
        strokeFill();
        break;
      }
      case 'text': {
        const size = Math.max(4, ry * 2 * (L.fontSize || 0.5));
        ctx.font = `800 ${size}px ${getComputedStyle(document.body).fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (L.fillAlpha > 0) ctx.fillText(L.text || '', 0, 0);
        if (p.strokeWidth > 0) ctx.strokeText(L.text || '', 0, 0);
        break;
      }
      case 'image': {
        const img = this.images.get(L.imageId);
        if (!img || !img.complete || !img.naturalWidth) break;
        let w = rx * 2, h = ry * 2;
        if (L.imageFit !== 'stretch') {
          const ar = img.naturalWidth / img.naturalHeight;
          const box = L.imageFit === 'cover' ? Math.max(w / ar, h) : Math.min(w / ar, h);
          h = box; w = box * ar;
        }
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        break;
      }
    }
  }

  /* ---- contour tracing (outline / mesh) ---------------------------- */
  _contour(L, res, map, p, tSec) {
    const ctx = this.ctx;
    const idx = CONTOUR_IDX[L.contour] || CONTOUR_IDX.faceOval;
    const lm = res.lm;
    if (!lm) return;
    const t = tSec * (L.wobbleSpeed || 1);
    const a = res.anchors[L.anchor] || res.anchors.face;
    const cx = map.x(a.x), cy = map.y(a.y);

    ctx.beginPath();
    for (let i = 0; i <= idx.length; i++) {
      const pt = lm[idx[i % idx.length]];
      if (!pt) continue;
      let x = map.x(pt.x), y = map.y(pt.y);
      // scale the whole contour about its anchor, then rough it up
      x = cx + (x - cx) * p.scaleX * p.scale + p.offsetX * map.w(a.w);
      y = cy + (y - cy) * p.scaleY * p.scale + p.offsetY * map.h(a.h);
      if (p.noise) {
        x += wave(i, t) * p.noise * map.w(a.w);
        y += wave(i + 50, t) * p.noise * map.h(a.h);
      }
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    if (L.fillAlpha > 0) ctx.fill();
    if (p.strokeWidth > 0) ctx.stroke();
  }

  /* ---- admin-only: the raw 478-point cloud ------------------------- */
  _mesh(res, map) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#44e0ff';
    for (const p of res.lm) {
      ctx.fillRect(map.x(p.x) - 1, map.y(p.y) - 1, 2, 2);
    }
    ctx.restore();
  }
}
