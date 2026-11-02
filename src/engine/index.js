/**
 * HALOFLUX engine — public entry point.
 *
 * Phase 0 / slice 1: lifecycle, sizing, quality tiers, beat clock and the
 * render loop are in place. The visual layers are ported one by one; each
 * slice must keep the baseline frames in `baselines/` looking the same.
 *
 * @module engine
 */
import { createRandom } from './util.js';
import { BASE, PRESETS, resolveQuality } from './params.js';
import { createBeat } from './beat.js';
import { createWebLayer } from './web.js';
import { createRingLayer } from './ring.js';
import { createOuterLayer } from './outer.js';
import { createStateMachine } from './state.js';

/**
 * @typedef {Object} HalofluxOptions
 * @property {number} [seed]            deterministic RNG seed
 * @property {string} [quality]         low | medium | high | ultra
 * @property {number} [dpr]             device pixel ratio override
 * @property {Record<string, number>} [params] initial parameter overrides
 * @property {() => number} [now]       clock injection (tests)
 * @property {(cb: FrameRequestCallback) => number} [raf]  scheduler injection (tests)
 * @property {boolean} [autoStart]
 * @property {boolean} [hud]            draw the debug HUD
 */

/** Layers ported so far — used by the HUD and by the parity checklist. */
export const PORTED = ['lifecycle', 'sizing', 'quality', 'beat', 'background', 'inner-web', 'runners', 'ring-band', 'outer-beams', 'haze', 'flares', 'flyers', 'state'];

/**
 * @param {HTMLCanvasElement} canvas
 * @param {HalofluxOptions} [options]
 */
export function createHaloflux(canvas, options = {}) {
  const opt = {
    seed: 1,
    quality: 'high',
    dpr: (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
    params: null,
    now: () => performance.now(),
    raf: (cb) => requestAnimationFrame(cb),
    autoStart: true,
    hud: false,
    ...options
  };

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('haloflux: 2d context unavailable');

  const random = createRandom(opt.seed);
  const C = { ...BASE, ...(PRESETS.MINE || {}), ...(opt.params || {}) };
  const beat = createBeat();
  const web = createWebLayer({ random, params: C });
  const ring = createRingLayer({ random, params: C });
  const outer = createOuterLayer({ random, params: C });
  const activity = createStateMachine({ mode: 'run' });

  let Q = resolveQuality(opt.quality);
  let W = 0, H = 0, cx = 0, cy = 0, R = 0, RO = 0, thV = 0, thS = 0, RMAX = 0, dpr = 1;
  let running = false, destroyed = false, rafId = 0, last = 0, T = 0;
  let frames = 0, fps = 0, fpsMark = 0;
  const impulses = [];
  let lastTick = null;
  let ro = null;

  function resize() {
    // Measure the canvas itself (not its parent), so a caller can pin an exact
    // stage size for screenshot comparison.
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    dpr = Math.min(opt.dpr, Q.dprCap) * Q.renderScale;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    cx = W * 0.07;
    cy = H * 0.5;
    R = Math.max(H * 0.78, W * 0.3);
    RO = R + Math.max(90, Math.min(240, H * 0.3, W * 0.13)) * C.ringWidth;
    thV = Math.asin(Math.min(1, (H / 2 + 60) / R));
    thS = Math.asin(Math.min(1, (H / 2 + 40) / RO));
    RMAX = Math.hypot(W - cx, H / 2) + 60;
    web.build(W, H, R, dpr);
    ring.build(R, RO);
    outer.build({ W, H, cx, cy, R, RO, RMAX, thS, DPR: dpr, FS: Q.farDown });
  }

  /** Slice 1 placeholder: background + pulsing core + ring skeleton + HUD. */
  function draw(dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#08090b';
    ctx.fillRect(0, 0, W, H);

    const e = beat.env;
    web.draw(ctx, { cx, cy, R, env: e });

    outer.draw(ctx, { W, H, cx, cy, R, RO, RMAX, thS, DPR: dpr, FS: Q.farDown });

    ring.draw(ctx, { cx, cy, R, RO, thV, W, H, dt });

    if (opt.hud) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(8,9,11,0.72)';
      ctx.fillRect(10, 10, 470, 38);
      ctx.font = '11px ui-monospace, Consolas, monospace';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(207,210,216,0.85)';
      ctx.fillText(
        `PHASE 0 · SLICE 4   beat #${beat.beatN}   env ${beat.env.toFixed(2)}   ` +
        `${W}×${H} @${dpr.toFixed(2)}   ${Q.name}   ${fps} fps   ${activity.mode}`,
        18, 16
      );
      ctx.fillStyle = 'rgba(107,111,120,0.9)';
      ctx.fillText(`ported: ${PORTED.join(' · ')}`, 18, 34);
    }
  }

  function frame(now) {
    if (!running || destroyed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    T += dt;

    beat.update(dt, C.tempo, (n) => {
      web.onBeat(n);
      ring.onBeat();
      outer.onBeat(n);
    });

    const level = activity.update(dt);
    web.update(dt, beat.env * (0.6 + 0.4 * level));
    ring.update(dt);
    outer.update(dt, beat.env * level, ring.rotation, beat.beatN);

    draw(dt);

    frames++;
    if (now - fpsMark >= 500) {
      fps = Math.round((frames * 1000) / (now - fpsMark));
      frames = 0;
      fpsMark = now;
    }
    rafId = opt.raf(frame);
  }

  function start() {
    if (running || destroyed) return;
    running = true;
    last = opt.now();
    fpsMark = last;
    rafId = opt.raf(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function destroy() {
    stop();
    destroyed = true;
    if (ro) ro.disconnect();
    ro = null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /** Merge parameter overrides; `ringWidth` re-derives the geometry. */
  function setParams(patch) {
    if (!patch) return;
    const needsResize = Object.prototype.hasOwnProperty.call(patch, 'ringWidth');
    Object.assign(C, patch);
    if (needsResize) resize();
  }

  function setQuality(name) {
    Q = resolveQuality(name);
    resize();
    draw(0);
  }

  /**
   * Discrete event from the data link (tool_call / tool_result / compaction…).
   * Slice 1 only records it; later slices map it onto comets, kicks and flashes.
   */
  function pushImpulse(impulse) {
    if (!impulse) return;
    impulses.push(impulse);
    if (impulses.length > 512) impulses.splice(0, impulses.length - 512);
  }

  /** Continuous state snapshot (context pressure / agent roster). */
  function pushTick(tick) {
    lastTick = tick;
  }

  /** void | idle | run — drives the scene's attack/release envelope. */
  function setMode(mode) {
    activity.setMode(mode);
  }

  function getState() {
    return {
      W, H, cx, cy, R, RO, dpr,
      env: beat.env, beatN: beat.beatN,
      tempo: C.tempo, fps,
      quality: Q.name,
      ported: PORTED.slice(),
      activity: { mode: activity.mode, level: activity.level },
      impulses: impulses.length,
      tick: lastTick
    };
  }

  resize();
  if (typeof ResizeObserver !== 'undefined') {
    let rzT = 0;
    ro = new ResizeObserver(() => {
      clearTimeout(rzT);
      rzT = setTimeout(() => resize(), 120);
    });
    ro.observe(canvas.parentElement || canvas);
  }
  if (opt.autoStart) start();

  return {
    canvas,
    params: C,
    start,
    stop,
    destroy,
    setParams,
    setQuality,
    pushImpulse,
    pushTick,
    setMode,
    getState,
    resize
  };
}
