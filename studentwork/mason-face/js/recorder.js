/* ============================================================
   recorder.js — captures the interaction.
   Video/audio come straight off the getUserMedia stream, so the file
   holds exactly what the participant saw of themselves: their face,
   no overlay. The tracking runs in parallel and is written to a
   sidecar JSON. Downloads are local-only for now; swapping in
   Supabase means replacing `deliver()`.
   ============================================================ */

import { makeZip } from './zip.js';

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4'
];

export function pickMime() {
  for (const m of MIME_CANDIDATES) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

const stamp = (d = new Date()) =>
  d.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

export class SessionRecorder {
  constructor(cfg) {
    this.cfg = cfg;
    this.sessionId = 'S' + stamp();
    this.startedAt = new Date().toISOString();
    this.takes = [];
    this.chosenTake = null;
    this.current = null;
    this.mime = pickMime();
    this.actual = null;   // what the camera really gave us
    this.fxGeom = null;   // FX canvas geometry, for later compositing
  }

  get takeCount() { return this.takes.length; }

  /**
   * @param stream   the raw camera stream (what we record)
   * @param fxCanvas optional canvas whose stream becomes a second track
   */
  start(stream, fxCanvas) {
    // Requested settings are a wish; record what the device actually did.
    const vt = stream.getVideoTracks()[0];
    if (vt) {
      const st = vt.getSettings();
      this.actual = { width: st.width, height: st.height, frameRate: st.frameRate, deviceId: st.deviceId };
    }

    const idx = this.takes.length + 1;
    const take = {
      index: idx,
      startedAt: new Date().toISOString(),
      t0: performance.now(),
      durationMs: 0,
      frames: [],
      chunks: [],
      fxChunks: [],
      blob: null,
      fxBlob: null,
      chosen: false
    };

    const rec = new MediaRecorder(stream, this.mime ? { mimeType: this.mime, videoBitsPerSecond: 6_000_000 } : {});
    rec.ondataavailable = e => { if (e.data && e.data.size) take.chunks.push(e.data); };
    take.rec = rec;
    rec.start(200);

    if (this.cfg.flow.recordFxTrack && fxCanvas && fxCanvas.captureStream) {
      try {
        const fxStream = fxCanvas.captureStream(this.cfg.flow.fps || 30);
        this.fxGeom = { width: fxCanvas.width, height: fxCanvas.height };
        const fxRec = new MediaRecorder(fxStream, this.mime ? { mimeType: this.mime } : {});
        fxRec.ondataavailable = e => { if (e.data && e.data.size) take.fxChunks.push(e.data); };
        take.fxRec = fxRec;
        fxRec.start(200);
      } catch (e) { console.warn('[rec] fx track unavailable', e); }
    }

    this.current = take;
    this.takes.push(take);
    return take;
  }

  /** Called every animation frame while recording. */
  pushFrame(frameRecord) {
    if (!this.current) return;
    this.current.frames.push(frameRecord);
  }

  get elapsedMs() {
    return this.current ? performance.now() - this.current.t0 : 0;
  }

  stop() {
    const take = this.current;
    if (!take) return Promise.resolve(null);
    this.current = null;
    take.durationMs = Math.round(performance.now() - take.t0);

    const finish = (rec, chunks) => new Promise(res => {
      if (!rec || rec.state === 'inactive') return res(null);
      rec.onstop = () => res(new Blob(chunks, { type: this.mime || 'video/webm' }));
      rec.stop();
    });

    return Promise.all([
      finish(take.rec, take.chunks),
      finish(take.fxRec, take.fxChunks)
    ]).then(([blob, fxBlob]) => {
      take.blob = blob;
      take.fxBlob = fxBlob;
      return take;
    });
  }

  /** Drop everything from the last take onward (participant chose to redo). */
  markChosen(index) {
    this.chosenTake = index;
    this.takes.forEach(t => { t.chosen = t.index === index; });
  }

  manifest() {
    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      prompt: this.cfg.flow.prompt,
      retakeLine: this.cfg.flow.retakeLine,
      chosenTake: this.chosenTake,
      capture: {
        mime: this.mime,
        requested: { width: this.cfg.flow.width, height: this.cfg.flow.height, fps: this.cfg.flow.fps },
        actual: this.actual,          // the real frame size of the .webm files
        audio: this.cfg.flow.audio,
        fullMesh: this.cfg.flow.recordFullMesh,
        // The FX track is a viewport-sized, cover-cropped preview — it does NOT
        // align 1:1 with the raw video. Re-render from `frames` for exact work.
        fx: this.fxGeom ? { ...this.fxGeom, fit: 'cover', alignedToRaw: false } : null
      },
      // the abstraction recipe that was live during this session, so any
      // take can be re-rendered later exactly as it was tuned
      abstractions: this.cfg.layers,
      takes: this.takes.map(t => ({
        index: t.index,
        startedAt: t.startedAt,
        durationMs: t.durationMs,
        chosen: t.chosen,
        frameCount: t.frames.length,
        video: `${this.sessionId}_take${t.index}.webm`,
        fxVideo: t.fxBlob ? `${this.sessionId}_take${t.index}_fx.webm` : null,
        frames: t.frames
      }))
    };
  }

  /** Local delivery: the whole interaction as one archive.
      Replace this method with a Supabase upload later — `manifest()`
      and the blob list below are the only things it needs. */
  async deliver({ onlyChosen = false } = {}) {
    const entries = [];
    for (const t of this.takes) {
      if (onlyChosen && this.chosenTake && t.index !== this.chosenTake) continue;
      if (t.blob) entries.push({ name: `${this.sessionId}_take${t.index}.webm`, blob: t.blob });
      if (t.fxBlob) entries.push({ name: `${this.sessionId}_take${t.index}_fx.webm`, blob: t.fxBlob });
    }
    entries.push({
      name: `${this.sessionId}_tracking.json`,
      blob: new Blob([JSON.stringify(this.manifest(), null, 1)], { type: 'application/json' })
    });

    // One file, so a kiosk never trips Chrome's multiple-download prompt.
    const zip = await makeZip(entries);
    await downloadBlob(zip, `${this.sessionId}_interaction.zip`);
    return entries.map(e => e.name);
  }

  dispose() {
    this.takes.forEach(t => { t.chunks = []; t.fxChunks = []; });
  }
}

export function downloadBlob(blob, filename) {
  return new Promise(res => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); res(); }, 200);
  });
}
