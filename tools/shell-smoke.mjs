#!/usr/bin/env node
/**
 * Shell + panels smoke test with a minimal DOM stub.
 *
 * Verifies the eight panels can be created, updated with a link snapshot and
 * disposed without throwing, and that the shell toggles / disposes cleanly.
 *
 *   node tools/shell-smoke.mjs
 */

/* ---------------- minimal DOM ---------------- */

let ctxCalls = { drawImage: 0, fillText: 0, stroke: 0 };
const texts = [];
const CJK = /[一-鿿]/;

function fakeCtx() {
  const noop = () => {};
  return {
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000',
    lineWidth: 1, font: '10px monospace', textBaseline: 'top', textAlign: 'left', filter: 'none',
    setTransform: noop, resetTransform: noop, save: noop, restore: noop, scale: noop, rotate: noop,
    translate: noop, clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, arc: noop, arcTo: noop, rect: noop, clip: noop, fill: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop,
    stroke: () => { ctxCalls.stroke++; },
    fillText: (t) => { ctxCalls.fillText++; texts.push(String(t)); },
    measureText: () => ({ width: 10 }),
    drawImage: () => { ctxCalls.drawImage++; },
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop })
  };
}

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.dataset = {};
    this._html = '';
    this._w = 300;
    this._h = 150;
    this.textContent = '';
    this._className = '';
    this.classList = {
      _s: new Set(),
      add: (c) => this.classList._s.add(c),
      remove: (c) => this.classList._s.delete(c),
      toggle: (c, v) => { if (v === undefined) v = !this.classList._s.has(c); v ? this.classList._s.add(c) : this.classList._s.delete(c); },
      contains: (c) => this.classList._s.has(c)
    };
  }
  set className(v) {
    this._className = String(v || '');
    this.classList._s = new Set(this._className.split(/\s+/).filter(Boolean));
  }
  get className() { return this._className; }
  set innerHTML(v) {
    this._html = String(v);
    this.children = [];
    // minimal nested parser: enough for the panels' generated markup
    const stack = [this];
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    let m;
    while ((m = re.exec(this._html)) !== null) {
      const [, close, tag, attrs] = m;
      if (close) { if (stack.length > 1) stack.pop(); continue; }
      const el = new FakeEl(tag);
      const cm = /class="([^"]*)"/.exec(attrs);
      if (cm) { el.className = cm[1]; cm[1].split(/\s+/).filter(Boolean).forEach((c) => el.classList._s.add(c)); }
      const tm = /data-k="([^"]*)"/.exec(attrs);
      if (tm) el.dataset.k = tm[1];
      stack[stack.length - 1].appendChild(el);
      if (!/\/$/.test(attrs)) stack.push(el);
    }
  }
  get innerHTML() { return this._html; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  appendChild(c) { this.children.push(c); c.parentElement = this; return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); }
  remove() {}
  setAttribute(k, v) { this[`_attr_${k}`] = String(v); }
  getAttribute(k) { return this[`_attr_${k}`] !== undefined ? this[`_attr_${k}`] : null; }
  addEventListener() {}
  removeEventListener() {}
  getContext() { return fakeCtx(); }
  set width(v) { this._w = v; }
  get width() { return this._w; }
  set height(v) { this._h = v; }
  get height() { return this._h; }
  getBoundingClientRect() { return { width: 200, height: 120, left: 0, top: 0 }; }

  _walk(fn) {
    for (const c of this.children) { fn(c); c._walk(fn); }
  }
  _matches(el, sel) {
    if (sel.startsWith('.')) return el.classList._s.has(sel.slice(1));
    return el.tagName === sel.toUpperCase();
  }
  querySelector(sel) {
    let found = null;
    this._walk((el) => { if (!found && this._matches(el, sel)) found = el; });
    return found;
  }
  querySelectorAll(sel) {
    const out = [];
    this._walk((el) => { if (this._matches(el, sel)) out.push(el); });
    return out;
  }
}

globalThis.document = {
  createElement: (tag) => new FakeEl(tag),
  createElementNS: (ns, tag) => new FakeEl(tag),
  head: new FakeEl('head'),
  body: new FakeEl('body'),
  addEventListener() {},
  removeEventListener() {},
  fullscreenElement: null,
  exitFullscreen: async () => {},
  documentElement: new FakeEl('html')
};
globalThis.document.documentElement.requestFullscreen = async () => {};

globalThis.window = { devicePixelRatio: 2 };
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.setTimeout = setTimeout;
globalThis.clearTimeout = clearTimeout;
globalThis.setInterval = setInterval;
globalThis.clearInterval = clearInterval;

/* ---------------- run ---------------- */

const { PANELS } = await import('../src/ui/panels.js');
const { createShell } = await import('../src/ui/shell.js');
const { createSimulatedSource } = await import('../src/data/simulate.js');
const { createHaloflux } = await import('../src/engine/index.js');

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

// ---- panels directly ----
const sample = {
  link: {
    running: true, activity: 1, tps: 24.5, totalTokens: 1200, inputTokens: 900, outputTokens: 300,
    input: 900, output: 300, cacheReadTokens: 600,
    contextTokens: 24000, contextLimit: 65536, turn: 3, step: 7, model: 'deepseek-chat',
    tools: [{ name: 'read_file', state: 'ok' }, { name: 'bash', state: 'running' }],
    feed: [{ kind: 'tool', text: 'read_file(…)', t: Date.now() }],
    recentText: 'hello world'
  }
};

const created = [];
const CANVAS_PANELS = new Set(['idx']);
for (const def of PANELS) {
  const host = new FakeEl('div');
  const body = new FakeEl('div');
  if (CANVAS_PANELS.has(def.key)) {
    body.appendChild(new FakeEl('canvas'));
  } else {
    body.className = def.key;
  }
  host.appendChild(body);
  let p = null;
  try { p = def.create(host); } catch (e) {
    check(`panel ${def.key} created`, false, e.message);
    continue;
  }
  created.push({ key: def.key, def, p, body });
  try { p.update(sample, 0.016); p.update(sample, 0.016); } catch (e) {
    check(`panel ${def.key} updates`, false, e.message);
    continue;
  }
  check(`panel ${def.key} created + updates`, true);
}

check('all eight panels built', created.length === 8, `${created.length}`);

// ---- tools panel (DOM prototype) content ----
const toolsEntry = created.find((c) => c.key === 'tools');
if (toolsEntry) {
  const tb = toolsEntry.body;
  const cmd = tb.querySelector('.cmd');
  const tx = tb.querySelector('.tx');
  const pct = tb.querySelector('.dn-pct');
  const bar = tb.querySelector('.st-bar');
  const trows = tb.querySelector('.trows');
  check('tools: command row rendered', !!cmd && !!tx, 'cmd/tx missing');
  check('tools: command text from feed', tx && tx.textContent.indexOf('read_file') >= 0, tx ? tx.textContent : '');
  check('tools: donut percentage rendered', !!pct && /%/.test(pct.textContent || ''), pct ? pct.textContent : '');
  check('tools: stacked bar has segments', !!bar && /<i/.test(bar.innerHTML || ''), 'no segments');
  check('tools: tool rows rendered', !!trows && /read_file/.test(trows.innerHTML || ''), 'no rows');
} else {
  check('tools panel present', false);
}

// ---- context-pressure panel (DOM) content ----
const ctxEntry = created.find((c) => c.key === 'ctx');
if (ctxEntry) {
  const cb = ctxEntry.body;
  const p = ctxEntry.p;
  const big = cb.querySelector('.ctx-pct');
  const fill = cb.querySelector('.ctx-fill');
  const rem = cb.querySelector('.ctx-rem');
  const lim = cb.querySelector('.ctx-lim');

  // sample link: 24000 / 65536 = 36.6%
  check('ctx: percentage rendered', !!big && big.textContent === '36.6%', big ? big.textContent : '');
  check('ctx: water bar width matches occupancy', !!fill && fill.style.width === '36.6%', fill ? fill.style.width : '');
  check('ctx: remaining is formatted', !!rem && rem.textContent === '剩余 41.5K', rem ? rem.textContent : '');
  check('ctx: compaction headroom is formatted', !!lim && lim.textContent === '距压缩 35K', lim ? lim.textContent : '');

  // a rising level must move the readout, the bar and the sparkline
  const heavier = { ...sample, link: { ...sample.link, contextTokens: 58983 } }; // 90.0% → past the 90% compaction mark
  p.update(heavier, 0.016);
  check('ctx: high occupancy flips the readout', big.textContent === '90.0%', big.textContent);
  check('ctx: bar width follows the new level', fill.style.width === '90.0%', fill.style.width);
  check('ctx: compaction threshold hit', lim.textContent === '已达压缩阈值', lim.textContent);
  const line = cb.querySelector('.ctx-line');
  check('ctx: sparkline samples the trend', !!line && (line.getAttribute('points') || '').split(' ').length >= 2,
    line ? line.getAttribute('points') : '');
} else {
  check('ctx panel present', false);
}

// ---- context-speed panel (DOM) content ----
const spdEntry = created.find((c) => c.key === 'spd');
if (spdEntry) {
  const sb = spdEntry.body;
  const sp = spdEntry.p;
  const rate = sb.querySelector('.spd-rate');
  const eta = sb.querySelector('.spd-eta');
  const stepEl = sb.querySelector('.spd-step');

  // the seeded loop ran twice on a constant snapshot → no growth
  check('spd: idle rate is zero', rate.textContent === '0', rate.textContent);
  check('spd: idle eta is a dash', eta.textContent === '—', eta.textContent);

  // a filling window (4 × 2000 tokens over 4 × 0.25s) → 8000 tok/s
  for (let i = 1; i <= 4; i++) {
    sp.update({ ...sample, link: { ...sample.link, contextTokens: 24000 + i * 2000, step: 7 + i } }, 0.25);
  }
  check('spd: growth rate is computed', rate.textContent === '8K', rate.textContent);
  check('spd: eta projects the fill', eta.textContent === '预计 +5s', eta.textContent);
  check('spd: step counter shown', stepEl.textContent === '步 11', stepEl.textContent);
  const slope = sb.querySelector('.spd-line');
  check('spd: slope line sampled', !!slope && (slope.getAttribute('points') || '').split(' ').length >= 2,
    slope ? slope.getAttribute('points') : '');
} else {
  check('spd panel present', false);
}

for (const { p, def } of created) {
  try { if (p.resize) p.resize(); p.dispose(); } catch (e) {
    check(`panel ${def.key} dispose`, false, e.message);
  }
}
check('panels dispose cleanly', true);

// ---- shell ----
const canvas = new FakeEl('canvas');
const engine = {
  getState: () => ({ link: sample.link, slots: 40, ringFocus: 3, activity: { mode: 'run', level: 1 } }),
  stop() {}, start() {}, resize() {}
};

let shell;
try {
  shell = createShell({ canvas, engine });
} catch (e) {
  check('shell created', false, e.message);
  process.exit(1);
}
check('shell created', !!shell);
check('shell has panel row', !!shell.panelsEl);
check('shell starts visible', shell.visible === true);

shell.toggle();
check('toggle hides panels', shell.visible === false);
shell.toggle();
check('toggle shows panels again', shell.visible === true);

try { shell.update(); } catch (e) { check('shell.update()', false, e.message); }
check('shell.update() runs', true);

check('panels rendered Chinese titles', shell.panelsEl.innerHTML.includes('调查流') || texts.some((t) => CJK.test(t)),
  `texts=${JSON.stringify(texts.slice(0, 4))}`);

shell.dispose();
check('shell.dispose() is safe', (() => { shell.dispose(); return true; })());

// ---- shell with a real engine + simulated source ----
const realCanvas = new FakeEl('canvas');
realCanvas.getBoundingClientRect = () => ({ width: 1280, height: 668, left: 0, top: 0 });
const halo = createHaloflux(realCanvas, { seed: 3, autoStart: false, source: createSimulatedSource({ intervalMs: 20 }) });
const s2 = createShell({ canvas: realCanvas, engine: halo });
await new Promise((r) => setTimeout(r, 250));
try { s2.update(); } catch (e) { check('shell with live engine updates', false, e.message); }
check('shell with live engine updates', true);
s2.dispose();
halo.destroy();

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
process.exit(failures === 0 ? 0 : 1);
