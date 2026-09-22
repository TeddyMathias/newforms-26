/* ============================================================
   app.js — boot, camera, the render loop, and the kiosk state machine.

   Flow:  attract → prompt → TAKE 1 → "SAY IT AGAIN LIKE YOU MEAN IT"
          → TAKE 2 → choice (again / satisfied) → download everything.
   ============================================================ */

import { loadConfig, saveConfig } from './config.js';
import { Tracker } from './tracker.js';
import { AbstractionRenderer } from './abstractions.js';
import { SessionRecorder } from './recorder.js';
import { Admin, toast } from './admin.js';

const $ = s => document.querySelector(s);
const wait = ms => new Promise(r => setTimeout(r, ms));

const video = $('#cam');
const timerEl = $('#timer');
const fx = $('#fx');

const cfg = loadConfig();
const tracker = new Tracker();
const renderer = new AbstractionRenderer(fx);

let stream = null;
let admin = null;
let session = null;
let lastSession = null;
let state = 'boot';
let recording = false;
let idleTimer = null;
let abortTake = null;      // resolve() to cut a countdown / take short
let pendingChoice = null;  // resolve() for the try-again / satisfied fork
let runToken = 0;          // bumped by hardReset so a stale interaction bails

/* ---------------- screens ---------------- */
function show(name) {
  state = name;
  document.querySelectorAll('.screen').forEach(s =>
    s.classList.toggle('is-on', s.dataset.screen === name));
  resetIdle();
}

function resetIdle() {
  clearTimeout(idleTimer);
  const s = cfg.flow.idleResetSec;
  if (!s || state === 'attract' || state === 'recording' || state === 'boot') return;
  idleTimer = setTimeout(() => { if (!admin?.open) hardReset(); }, s * 1000);
}

/* ---------------- boot ---------------- */
async function boot() {
  const status = $('#bootStatus');
  show('boot');
  document.body.classList.toggle('no-mirror', !cfg.flow.mirrorPreview);

  try {
    status.textContent = 'requesting camera…';
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width:  { ideal: cfg.flow.width },
        height: { ideal: cfg.flow.height },
        frameRate: { ideal: cfg.flow.fps },
        facingMode: 'user'
      },
      audio: cfg.flow.audio ? { echoCancellation: true, noiseSuppression: false } : false
    });
  } catch (e) {
    status.innerHTML = 'CAMERA BLOCKED — allow access and reload.<br /><small>' + e.message + '</small>';
    return;
  }

  video.srcObject = stream;
  await video.play().catch(() => {});

  status.textContent = 'loading face model…';
  try {
    await tracker.init(cfg.tracking);
  } catch (e) {
    console.warn('[app] GPU delegate failed, retrying on CPU', e);
    try { await tracker.init({ ...cfg.tracking, delegate: 'CPU' }); }
    catch (e2) { status.textContent = 'face model failed to load: ' + e2.message; return; }
  }

  admin = new Admin(cfg, {
    onChange: c => saveConfig(c),
    onLaunch: () => hardReset(),
    onRedownload: () => {
      if (!lastSession) return toast('no session recorded yet');
      lastSession.deliver({ onlyChosen: cfg.flow.downloadOnlyChosen })
        .then(f => toast(`re-downloaded ${f.length} files`));
    },
    renderer
  });

  loop();

  // Admin mode is the landing state — operators tune, then hit LAUNCH.
  const kiosk = new URLSearchParams(location.search).has('kiosk');
  if (kiosk) hardReset();
  else { show('attract'); admin.toggle(true); }
}

/* ---------------- render loop ---------------- */
function loop() {
  const step = () => {
    renderer.resize();
    const now = performance.now();
    const res = tracker.detect(video, now);

    // The abstraction layer is computed whenever someone needs to see or
    // record it; the participant screen keeps it hidden either way.
    const needFx = (admin && admin.open) || (recording && cfg.flow.recordFxTrack);
    if (needFx) renderer.draw(res, cfg.layers, video, now / 1000);
    else renderer.clear();

    if (recording && session) {
      session.pushFrame(tracker.serializeFrame(res, session.elapsedMs, cfg.flow.recordFullMesh));
      timerEl.textContent = (session.elapsedMs / 1000).toFixed(1);
    }

    if (admin && admin.open) admin.setFps(tracker.fps);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------------- flow helpers ---------------- */
/** Break a line of copy near its middle so big type sits in two balanced rows. */
function twoLines(text) {
  const w = text.trim().split(/\s+/);
  if (w.length < 3) return text;
  let best = 1, delta = Infinity;
  for (let i = 1; i < w.length; i++) {
    const d = Math.abs(w.slice(0, i).join(' ').length - w.slice(i).join(' ').length);
    if (d < delta) { delta = d; best = i; }
  }
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return esc(w.slice(0, best).join(' ')) + '<br />' + esc(w.slice(best).join(' '));
}

function countdown(elm, sec) {
  return new Promise(resolve => {
    let n = Math.max(0, Math.round(sec));
    const tick = () => {
      elm.textContent = n > 0 ? n : 'GO';
      if (n-- <= 0) { setTimeout(resolve, 450); return; }
      setTimeout(tick, 900);
    };
    tick();
  });
}

async function runTake() {
  const rec = session;                 // hardReset may clear `session` mid-take
  show('recording');
  $('#takeLabel').textContent = 'TAKE ' + (rec.takeCount + 1);
  $('#liveLine').textContent = cfg.flow.liveLine;
  timerEl.textContent = '0.0';

  rec.start(stream, fx);
  recording = true;

  await new Promise(resolve => {
    abortTake = resolve;
    if (cfg.flow.autoStop) setTimeout(() => { if (abortTake === resolve) resolve(); }, cfg.flow.takeSec * 1000);
  });
  abortTake = null;

  recording = false;
  return rec.stop();
}

/* ---------------- the interaction ---------------- */
async function runInteraction() {
  // If the kiosk is reset (idle timeout, operator, LAUNCH) mid-interaction,
  // this token goes stale and the orphaned flow unwinds instead of fighting
  // the attract screen for control.
  const my = ++runToken;
  const alive = () => my === runToken;

  session = new SessionRecorder(cfg);
  lastSession = session;

  // TAKE 1 — the honest, unprepared one
  $('#promptText').textContent = cfg.flow.prompt;
  show('prompt');
  await countdown($('#countdown'), cfg.flow.countdownSec);
  if (!alive()) return;
  await runTake();
  if (!alive()) return;

  // the forced retake — the whole point of the piece
  while (session.takeCount < cfg.flow.minTakes) {
    $('.screen[data-screen="again"] .mega').innerHTML = twoLines(cfg.flow.retakeLine);
    show('again');
    await countdown($('#againCount'), cfg.flow.countdownSec);
    if (!alive()) return;
    await runTake();
    if (!alive()) return;
  }

  // then it's theirs to keep or repeat
  for (;;) {
    $('#choiceTake').textContent = session.takeCount;
    show('choice');
    const choice = await new Promise(resolve => { pendingChoice = resolve; });
    pendingChoice = null;
    if (!alive()) return;
    if (choice === 'satisfied') break;

    $('#promptText').textContent = 'ONE MORE TIME';
    show('prompt');
    await countdown($('#countdown'), cfg.flow.countdownSec);
    if (!alive()) return;
    await runTake();
    if (!alive()) return;
  }

  session.markChosen(session.takeCount);
  show('done');
  const sub = $('#doneSub');
  sub.textContent = 'downloading the whole interaction…';

  const files = await session.deliver({ onlyChosen: cfg.flow.downloadOnlyChosen });
  sub.textContent = `${files.length} files saved · ${session.takeCount} takes`;
  admin && admin.log(
    `${session.sessionId}\n` +
    files.map(f => '  ' + f).join('\n') +
    `\n\ntakes: ${session.takeCount}  chosen: ${session.chosenTake}` +
    `\nframes: ${session.takes.map(t => t.frames.length).join(', ')}`
  );

  await wait(6000);
  if (state === 'done') hardReset();
}

function hardReset() {
  runToken++;
  recording = false;
  if (abortTake) { const a = abortTake; abortTake = null; a(); }
  if (pendingChoice) { const p = pendingChoice; pendingChoice = null; p('reset'); }
  if (session) { try { session.stop(); } catch (e) {} }
  session = null;
  show('attract');
}

/* ---------------- input ---------------- */
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  resetIdle();
  if (!btn) return;
  switch (btn.dataset.action) {
    case 'begin':     if (state === 'attract') runInteraction(); break;
    case 'stop':      if (abortTake) { const a = abortTake; abortTake = null; a(); } break;
    case 'satisfied': pendingChoice && pendingChoice('satisfied'); break;
    case 'retry':     pendingChoice && pendingChoice('retry'); break;
    case 'reset':     hardReset(); break;
  }
});

document.addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (state === 'attract') runInteraction();
    else if (state === 'recording' && abortTake) { const a = abortTake; abortTake = null; a(); }
  }
});

window.addEventListener('beforeunload', e => {
  if (recording) { e.preventDefault(); e.returnValue = ''; }
});

boot();
