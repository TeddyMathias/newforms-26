# SAY IT LIKE YOU MEAN IT

A kiosk web app. A person walks up, is told plainly that they are about to be
recorded **and facially tracked**, gets one prompt — *say “I love you”* — and is
then made to do it again: **SAY IT AGAIN LIKE YOU MEAN IT.** After the forced
second take they can keep going or call it done. The whole interaction is saved.

The participant only ever sees **themselves** — a plain mirror. The facial
tracking runs the entire time, hidden, and is written to a sidecar JSON next to
the video. The abstraction layer driven by that tracking is visible **only in
admin**, so it can be tuned against reference art before it is ever shown.

## Run

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

`getUserMedia` needs a secure context — `localhost` counts, a `file://` path
does not. Chrome is the target browser (MediaRecorder + `captureStream`).

- Boots into **admin** (that's the landing state).
- `?kiosk=1` skips admin and boots straight into the participant flow.
- `A` toggles admin, `Esc` closes it, `Space` begins / ends a take.

## What gets downloaded

One archive per session — `S<timestamp>_interaction.zip` — so a kiosk never
trips Chrome's "allow multiple downloads?" prompt:

```
S<timestamp>_take1.webm        raw camera + mic — their actual face, no overlay
S<timestamp>_take2.webm        …one file per take, the whole interaction
S<timestamp>_take2_fx.webm     optional: the abstraction layer as its own track
S<timestamp>_tracking.json     manifest + per-frame tracking for every take
```

`_tracking.json` holds, for each frame of each take: the named facial anchors
(`[x, y, w, h, angle]`, normalized), the expression signals, the head transform
matrix, and optionally the full 478-point mesh (*Capture → recordFullMesh*). It
also embeds the exact abstraction stack that was live, so any take can be
re-rendered later precisely as it was tuned, plus `capture.actual` — the frame
size and rate the camera really delivered, which is not always what was asked
for.

The optional `_fx.webm` track is a **preview**: it is viewport-sized and
cover-cropped, so it does not align 1:1 with the raw video (the manifest says so
in `capture.fx`). For exact compositing, re-render from the normalized `frames`
data at whatever resolution you need.

## Admin

**Abstractions** — the layer stack. Each layer pins a shape to a facial anchor:

| | |
|---|---|
| Anchors | face, forehead, eyes, eyeL/R, irisL/R, browL/R, brows, nose, mouth, lipUpper/Lower, jaw, chin, cheekL/R |
| Shapes | ellipse, ring, rect, polygon, bars, burst, crosshair, blob, outline, mesh, text, image |
| Contours (outline) | faceOval, lipsOuter, lipsInner, eyeL/R, browL/R |
| Signals | jawOpen, mouthSmile, mouthPucker, mouthFunnel, blinkL/R, browRaise, browDown, squint, cheekPuff, yaw, pitch, roll, speech, time |
| Targets | scale, scaleX/Y, rotation, alpha, strokeWidth, count, offsetX/Y, noise, hue |

Offsets and scales are expressed as multiples of the anchor's own size, so a
layer stays glued to its feature at any distance from the camera. Each layer has
two reaction slots (signal → target, with amount / curve / bias), plus smoothing
and wobble. *Show raw mesh* and *Solo selected* help while tuning.

**References** — drop reference images in. They render as a tracing overlay in
admin only (never in the participant view, never in a recording), and any loaded
image can also be used as artwork by an `image` layer pinned to a feature. This
is the hook for adapting the abstractions to the reference art you're adding.

**Flow** — script lines, countdown, take length, how many forced takes, capture
resolution/fps/audio, and what gets downloaded.

**Data** — export/import the config as JSON, reset to defaults, re-download the
last session.

Config auto-saves to `localStorage`. Camera resolution/fps/audio changes take
effect on reload.

## Supabase, later

Delivery is deliberately isolated: `SessionRecorder.deliver()` in
`js/recorder.js` is the only place that touches the filesystem. Swapping in
Supabase Storage means replacing that one method — upload each take blob plus
`manifest()` — and leaving the rest of the app alone.

## Files

```
index.html            screens + admin markup
css/styles.css        kiosk type, admin console
js/config.js          the tunable model: layer defaults, schemas, persistence
js/tracker.js         MediaPipe wrapper → named anchors + expression signals
js/abstractions.js    the layer renderer (shapes, reactivity, contours)
js/recorder.js        takes, tracking sidecar, downloads
js/admin.js           the console, built from the schemas in config.js
js/app.js             camera, render loop, kiosk state machine
assets/reference/     drop reference art here for your own bookkeeping
```

## Notes

- Preview is mirrored because people expect a mirror; the recorded file is not
  mirrored. Admin → Flow → *mirrorPreview* turns the mirror off (useful when a
  `text` layer reads backwards while tuning).
- MediaPipe's WASM and model load from a CDN — the kiosk needs network on first
  load. Vendor `@mediapipe/tasks-vision` locally if it has to run offline.
- Tracking is per-frame at render rate; the `speech` signal is derived from jaw
  motion, not from the microphone.
- Verified end-to-end in headless Chrome with a fake camera device: model load,
  forced retake, voluntary retry, per-frame tracking capture, and a valid ZIP.
  The fake device has no face in it, so those runs record `face: 0` frames —
  point a real camera at a real face to see anchors populate.
