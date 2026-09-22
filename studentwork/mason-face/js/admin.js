/* ============================================================
   admin.js — the tuning console.
   Builds itself from the schemas in config.js, so adding a new
   abstraction parameter is a one-line change there, not here.
   ============================================================ */

import {
  PARAM_SCHEMA, FLOW_SCHEMA, SHAPES, SIGNALS, TARGETS,
  makeLayer, saveConfig, defaultConfig
} from './config.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

export class Admin {
  constructor(cfg, hooks) {
    this.cfg = cfg;
    this.hooks = hooks;              // { onChange, onLaunch, onRedownload, renderer }
    this.sel = cfg.layers[0]?.id || null;
    this.open = false;
    this._buildOverlay();
    this._wire();
    this.renderLayers();
    this.renderFlow();
    this.renderRefs();
  }

  /* ---------- shell ---------- */
  _buildOverlay() {
    this.overlay = el('div');
    this.overlay.id = 'refOverlay';
    document.body.appendChild(this.overlay);
  }

  _wire() {
    $('#adminToggle').onclick = () => this.toggle();
    $('#closeAdmin').onclick = () => this.toggle(false);
    $('#launchBtn').onclick = () => { this.toggle(false); this.hooks.onLaunch(); };

    document.addEventListener('keydown', e => {
      if (e.target.matches('input,select,textarea')) return;
      if (e.key === 'a' || e.key === 'A') this.toggle();
      if (e.key === 'Escape' && this.open) this.toggle(false);
    });

    document.querySelectorAll('.tab').forEach(t => {
      t.onclick = () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.toggle('is-on', x === t));
        document.querySelectorAll('.tabpane').forEach(p =>
          p.classList.toggle('is-on', p.dataset.pane === t.dataset.tab));
      };
    });

    const shapeSel = $('#addShape');
    SHAPES.forEach(s => shapeSel.appendChild(new Option(s, s)));
    $('#addLayer').onclick = () => {
      const l = makeLayer(shapeSel.value, this.cfg.layers.length);
      this.cfg.layers.push(l); this.sel = l.id; this.commit(); this.renderLayers();
    };
    $('#dupLayer').onclick = () => {
      const src = this.current(); if (!src) return;
      const copy = { ...structuredClone(src), id: makeLayer().id, name: src.name + ' COPY' };
      this.cfg.layers.splice(this.cfg.layers.indexOf(src) + 1, 0, copy);
      this.sel = copy.id; this.commit(); this.renderLayers();
    };
    $('#delLayer').onclick = () => {
      const src = this.current(); if (!src) return;
      this.cfg.layers.splice(this.cfg.layers.indexOf(src), 1);
      this.sel = this.cfg.layers[0]?.id || null;
      this.commit(); this.renderLayers();
    };

    $('#showFx').onchange = e => document.body.classList.toggle('fx-visible', e.target.checked);
    $('#showMesh').onchange = e => { this.hooks.renderer.showMesh = e.target.checked; };
    $('#soloLayer').onchange = e => { this.hooks.renderer.solo = e.target.checked ? this.sel : null; };

    /* references */
    const dz = $('#dropzone');
    dz.onclick = () => {
      const inp = el('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
      inp.onchange = () => this.addRefs(inp.files);
      inp.click();
    };
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => {
      e.preventDefault(); dz.classList.add('hot');
    }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => {
      e.preventDefault(); dz.classList.remove('hot');
    }));
    dz.addEventListener('drop', e => this.addRefs(e.dataTransfer.files));
    $('#clearRefs').onclick = () => {
      this.cfg.refs = []; this.overlay.innerHTML = ''; this.commit(); this.renderRefs();
    };
    $('#refOpacity').oninput = e => {
      this.overlay.style.opacity = e.target.value;
    };
    this.overlay.style.opacity = $('#refOpacity').value;

    /* data */
    $('#exportCfg').onclick = () => {
      const blob = new Blob([JSON.stringify(this.cfg, null, 2)], { type: 'application/json' });
      const a = el('a'); a.href = URL.createObjectURL(blob);
      a.download = 'abstractions-config.json'; a.click();
    };
    $('#importCfg').onclick = () => {
      const inp = el('input'); inp.type = 'file'; inp.accept = 'application/json';
      inp.onchange = async () => {
        try {
          const txt = await inp.files[0].text();
          Object.assign(this.cfg, JSON.parse(txt));
          this.sel = this.cfg.layers[0]?.id;
          this.commit(); this.renderLayers(); this.renderFlow(); this.renderRefs();
          toast('config imported');
        } catch (e) { toast('bad config file'); }
      };
      inp.click();
    };
    $('#resetCfg').onclick = () => {
      if (!confirm('Reset all abstractions and flow settings to defaults?')) return;
      Object.assign(this.cfg, defaultConfig());
      this.sel = this.cfg.layers[0]?.id;
      this.commit(); this.renderLayers(); this.renderFlow(); this.renderRefs();
    };
    $('#testDownload').onclick = () => this.hooks.onRedownload();
  }

  toggle(force) {
    this.open = force === undefined ? !this.open : force;
    $('#admin').hidden = !this.open;
    document.body.classList.toggle('admin-open', this.open);
    document.body.classList.toggle('fx-visible', this.open && $('#showFx').checked);
    if (!this.open) { this.hooks.renderer.showMesh = false; this.hooks.renderer.solo = null; }
    else { this.hooks.renderer.showMesh = $('#showMesh').checked; }
  }

  current() { return this.cfg.layers.find(l => l.id === this.sel); }

  commit() {
    saveConfig(this.cfg);
    this.hooks.onChange && this.hooks.onChange(this.cfg);
  }

  setFps(v) { $('#adminFps').textContent = v ? v + ' fps' : '–'; }

  log(text) { $('#sessionLog').textContent = text; }

  /* ---------- layer list + props ---------- */
  renderLayers() {
    const ul = $('#layerList');
    ul.innerHTML = '';
    this.cfg.layers.forEach((L, i) => {
      const li = el('li');
      li.classList.toggle('is-sel', L.id === this.sel);

      const on = el('input'); on.type = 'checkbox'; on.checked = L.enabled;
      on.onclick = e => { e.stopPropagation(); L.enabled = on.checked; this.commit(); };

      const sw = el('span', 'sw'); sw.style.background = L.stroke;
      const nm = el('span', 'nm', L.name);
      const ty = el('span', 'ty', L.shape);

      const up = el('span', 'mv', '↑'), dn = el('span', 'mv', '↓');
      up.onclick = e => { e.stopPropagation(); this.move(i, -1); };
      dn.onclick = e => { e.stopPropagation(); this.move(i, 1); };

      li.append(on, sw, nm, ty, up, dn);
      li.onclick = () => {
        this.sel = L.id;
        if ($('#soloLayer').checked) this.hooks.renderer.solo = L.id;
        this.renderLayers();
      };
      ul.appendChild(li);
    });
    this.renderProps();
  }

  move(i, d) {
    const j = i + d;
    if (j < 0 || j >= this.cfg.layers.length) return;
    const [x] = this.cfg.layers.splice(i, 1);
    this.cfg.layers.splice(j, 0, x);
    this.commit(); this.renderLayers();
  }

  renderProps() {
    const box = $('#layerProps');
    box.innerHTML = '';
    const L = this.current();
    if (!L) { box.appendChild(el('p', 'hint', 'No layer selected.')); return; }

    /* identity */
    const g0 = el('div', 'group');
    g0.appendChild(el('h3', null, 'Layer'));
    g0.appendChild(this.field(L, { k: 'name', t: 'text' }));
    g0.appendChild(this.field(L, { k: 'shape', t: 'select', opts: SHAPES }, () => this.renderLayers()));
    box.appendChild(g0);

    /* schema-driven groups */
    for (const grp of PARAM_SCHEMA) {
      const fields = grp.fields.filter(f => !f.only || f.only.includes(L.shape));
      if (!fields.length) continue;
      const g = el('div', 'group');
      g.appendChild(el('h3', null, grp.group));
      const wrap = el('div', grp.group === 'Placement' || grp.group === 'Look' ? 'grid2' : '');
      fields.forEach(f => wrap.appendChild(this.field(L, f)));
      g.appendChild(wrap);
      box.appendChild(g);
    }

    /* reactivity */
    ['react', 'react2'].forEach((key, n) => {
      const g = el('div', 'group');
      g.appendChild(el('h3', null, 'Reaction ' + (n + 1)));
      const wrap = el('div', 'grid2');
      wrap.appendChild(this.field(L[key], { k: 'signal', t: 'select', opts: SIGNALS }));
      wrap.appendChild(this.field(L[key], { k: 'target', t: 'select', opts: TARGETS }));
      wrap.appendChild(this.field(L[key], { k: 'amount', t: 'range', min: -3, max: 3, step: 0.01 }));
      wrap.appendChild(this.field(L[key], { k: 'curve',  t: 'range', min: 0.2, max: 4, step: 0.05 }));
      wrap.appendChild(this.field(L[key], { k: 'bias',   t: 'range', min: -1, max: 1, step: 0.01 }));
      g.appendChild(wrap);
      box.appendChild(g);
    });
  }

  renderFlow() {
    const box = $('#flowProps');
    box.innerHTML = '';
    for (const grp of FLOW_SCHEMA) {
      const g = el('div', 'group');
      g.appendChild(el('h3', null, grp.group));
      grp.fields.forEach(f => g.appendChild(this.field(this.cfg.flow, f, () => {
        if (['width', 'height', 'fps', 'audio'].includes(f.k))
          toast('camera settings apply on next reload');
        if (f.k === 'mirrorPreview')
          document.body.classList.toggle('no-mirror', !this.cfg.flow.mirrorPreview);
      })));
      box.appendChild(g);
    }
    const g = el('div', 'group');
    g.appendChild(el('h3', null, 'Storage'));
    g.appendChild(el('p', 'hint',
      'Delivery is local download only. When Supabase is wired up, replace SessionRecorder.deliver() in js/recorder.js — the manifest shape stays the same.'));
    box.appendChild(g);
  }

  /* ---------- generic field factory ---------- */
  field(obj, f, after) {
    const wrap = el('div', 'field');
    const lab = el('label');
    lab.appendChild(el('span', null, f.k));
    const val = el('span', 'val');
    lab.appendChild(val);
    wrap.appendChild(lab);

    const done = () => { this.commit(); after && after(); };

    let input;
    switch (f.t) {
      case 'range':
        input = el('input'); input.type = 'range';
        input.min = f.min; input.max = f.max; input.step = f.step;
        input.value = obj[f.k];
        val.textContent = (+obj[f.k]).toFixed(String(f.step).includes('.') ? 2 : 0);
        input.oninput = () => {
          obj[f.k] = parseFloat(input.value);
          val.textContent = (+input.value).toFixed(String(f.step).includes('.') ? 2 : 0);
          done();
        };
        break;
      case 'color':
        input = el('input'); input.type = 'color'; input.value = obj[f.k];
        input.oninput = () => { obj[f.k] = input.value; done(); };
        break;
      case 'bool':
        input = el('input'); input.type = 'checkbox'; input.checked = !!obj[f.k];
        input.onchange = () => { obj[f.k] = input.checked; done(); };
        break;
      case 'select':
        input = el('select');
        f.opts.forEach(o => input.appendChild(new Option(o, o)));
        input.value = obj[f.k];
        input.onchange = () => {
          const raw = input.value;
          obj[f.k] = (typeof f.opts[0] === 'number') ? parseFloat(raw) : raw;
          done();
        };
        break;
      case 'ref':
        input = el('select');
        input.appendChild(new Option('— none —', ''));
        this.cfg.refs.forEach(r => input.appendChild(new Option(r.name, r.id)));
        input.value = obj[f.k] || '';
        input.onchange = () => { obj[f.k] = input.value; done(); };
        break;
      default:
        input = el('input'); input.type = 'text'; input.value = obj[f.k] ?? '';
        input.oninput = () => { obj[f.k] = input.value; done(); };
    }
    wrap.appendChild(input);
    return wrap;
  }

  /* ---------- reference images ---------- */
  async addRefs(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const src = await shrink(file, 1200);
      this.cfg.refs.push({ id: 'R' + Math.random().toString(36).slice(2, 8), name: file.name, src });
    }
    this.commit();
    this.renderRefs();
    this.hooks.renderer.setImages(this.cfg.refs);
    this.renderProps();
  }

  renderRefs() {
    const list = $('#refList');
    list.innerHTML = '';
    this.cfg.refs.forEach(r => {
      const fig = el('figure');
      const img = el('img'); img.src = r.src;
      const cap = el('figcaption', null, r.name);
      fig.append(img, cap);
      fig.onclick = () => {
        const on = !fig.classList.contains('is-on');
        list.querySelectorAll('figure').forEach(f => f.classList.remove('is-on'));
        this.overlay.innerHTML = '';
        if (on) {
          fig.classList.add('is-on');
          const big = el('img'); big.src = r.src;
          this.overlay.appendChild(big);
        }
      };
      list.appendChild(fig);
    });
    this.hooks.renderer.setImages(this.cfg.refs);
  }
}

/* downscale + re-encode so localStorage stays viable */
function shrink(file, max) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/webp', 0.82));
    };
    img.src = URL.createObjectURL(file);
  });
}

let toastT;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('is-on'), 2200);
}
