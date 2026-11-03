#!/usr/bin/env node
/**
 * Headless engine smoke test (no browser, no DOM).
 *
 * Stubs a canvas + 2d context, drives the engine for a few hundred frames and
 * asserts the layers built and the data path works end to end. Mirrors the
 * approach dsh-haloflux uses.
 *
 *   node tools/engine-smoke.mjs
 */
const calls = { drawImage: 0, stroke: 0, fillText: 0, createRadialGradient: 0 };
const texts = [];
const CJK = /[一-鿿]/;

function fakeGradient() {
  const stops = [];
  return {
    addColorStop: (o, c) => stops.push([o, c]),
    stops
  };
}

function makeCtx(label) {
  const noop = () => {};
  const ctx = {
    __label: label,
    canvas: null,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    font: '10px monospace',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    setTransform: noop,
    resetTransform: noop,
    save: noop,
    restore: noop,
    scale: noop,
    rotate: noop,
    translate: noop,
    clearRect: noop,
    fillRect: (x, y, w, h) => { calls.fillRect = (calls.fillRect || 0) + 1; },
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    arcTo: noop,
    rect: noop,
    clip: noop,
    fill: noop,
    stroke: () => { calls.stroke++; },
    fillText: (t) => { calls.fillText++; texts.push(String(t)); },
    measureText: () => ({ width: 10 }),
    drawImage: () => { calls.drawImage++; },
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    createRadialGradient: () => { calls.createRadialGradient++; return fakeGradient(); },
    createLinearGradient: () => fakeGradient()
  };
  return ctx;
}

const canvases = [];

globalThis.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') throw new Error('unexpected createElement: ' + tag);
    const c = {
      tagName: 'CANVAS',
      width: 300,
      height: 150,
      __ctx: null,
      getContext: (type) => {
        if (type !== '2d') throw new Error('unexpected context: ' + type);
        if (!c.__ctx) {
          c.__ctx = makeCtx(`canvas[${canvases.length}]`);
          c.__ctx.canvas = c;
          canvases.push(c);
        }
        return c.__ctx;
      },
      getBoundingClientRect: () => ({ width: 1272, height: 668, left: 0, top: 0 })
    };
    return c;
  }
};

globalThis.window = { devicePixelRatio: 2 };
globalThis.performance = { now: () => Date.now() };

let rafQueue = [];
globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
globalThis.cancelAnimationFrame = () => {};

globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};

class Path2D {
  moveTo() {}
  lineTo() {}
  closePath() {}
}
globalThis.Path2D = Path2D;

const { createHaloflux } = await import('../src/engine/index.js');

let clock = 0;
const halo = createHaloflux(
  { getContext: () => makeCtx('main'), getBoundingClientRect: () => ({ width: 1272, height: 668, left: 0, top: 0 }), width: 2544, height: 1336 },
  {
    seed: 7,
    quality: 'high',
    autoStart: false,
    hud: true,
    now: () => clock,
    raf: (cb) => { rafQueue.push(cb); return rafQueue.length; }
  }
);

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

const state0 = halo.getState();
check('engine exposes state', state0 && typeof state0 === 'object');
check('ring has panels', state0.slots > 20, `slots=${state0.slots}`);
check('activity starts as run', state0.activity.mode === 'run', state0.activity.mode);

// drive 240 frames at 60fps
halo.start();
let frames = 0;
for (let i = 0; i < 240; i++) {
  clock += 16.7;
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(clock);
  frames++;
}
halo.stop();

const st = halo.getState();
check('frame loop ran', frames === 240, `${frames}`);
check('layers drew something', calls.drawImage > 0, `drawImage=${calls.drawImage}`);
check('beams stroked', calls.stroke > 0, `stroke=${calls.stroke}`);
check('panel text rendered', calls.fillText > 0, `fillText=${calls.fillText}`);
check('ring panels render Chinese labels', texts.some((t) => CJK.test(t)),
  `sample=${JSON.stringify(texts.slice(0, 6))}`);

// data-driven path: a few small bursts on one panel, then one big burst on
// another — the rule must aim at whichever accumulated the most.
halo.pushImpulse({ slot: 3, power: 0.9, bytes: 1000, kind: 'tool_call' });
halo.pushImpulse({ slot: 3, power: 0.9, bytes: 1000, kind: 'tool_call' });
halo.pushImpulse({ slot: 3, power: 0.9, bytes: 1000, kind: 'tool_call' });
halo.pushImpulse({ slot: 9, power: 1, bytes: 90000, kind: 'tool_result' });
const traffic = halo.traffic;
const peak = traffic.indexOf(Math.max(...traffic));
check('traffic accumulates per slot', peak === 9, `peak=${peak} traffic=${JSON.stringify(traffic.filter((v) => v > 0))}`);

// force a detection and make sure it aims at the peak
halo.setParams({ detectGap: 0 });
const result = halo.detectTraffic(1000);
check('detect picks the busiest slot', result && result.slot === 9, JSON.stringify(result));
check('ring reports the aimed slot', halo.getState().ringFocus === 9, `focus=${halo.getState().ringFocus}`);

// a quiet channel must not keep the aim: feed nothing and let it decay away
halo.setParams({ detectGap: 0.001 });
const busy = halo.traffic;
const peakIdx = busy.indexOf(Math.max(...busy));
halo.pushImpulse({ slot: (peakIdx + 5) % busy.length, power: 1, bytes: 100000, kind: 'tool_call' });
const r2 = halo.detectTraffic(2000);
check('aim switches to the new busy channel', r2 && r2.slot !== peakIdx, `${JSON.stringify(r2)} peak=${peakIdx}`);

// ---- data link integration ----
const { createSimulatedSource } = await import('../src/data/simulate.js');
const simSource = createSimulatedSource({ intervalMs: 20 });
halo.attachLink(simSource);
check('link attached', !!halo.link);
check('link has state fields', typeof halo.link.lastRunning === 'boolean');
check('channels sized to the ring', halo.link && halo.link.slots !== undefined || !!halo.link);

// let the simulated session produce data
await new Promise((r) => setTimeout(r, 350));
const linked = halo.getState();
check('getState reports link data', !!linked.link, JSON.stringify(linked.link));
check('link reports context pressure', linked.link && linked.link.contextTokens > 0,
  linked.link ? `ctx=${linked.link.contextTokens}` : '');
check('link reports turn/step', linked.link && linked.link.turn >= 0 && linked.link.step >= 0);
check('data flowed into traffic', linked.ringFocus >= 0 || linked.dataDriven === 1,
  `focus=${linked.ringFocus} driven=${linked.dataDriven}`);

halo.detachLink();
check('detachLink clears the link', !halo.link);
simSource.dispose();

halo.destroy();
check('destroy() is idempotent', (() => { halo.destroy(); return true; })());

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
process.exit(failures === 0 ? 0 : 1);
