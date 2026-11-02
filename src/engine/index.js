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
import { createChannelMap } from '../data/channels.js';
import { createLink } from '../data/link.js';

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
 * @property {object|null} [source]    data source (DataSource) for the link layer
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

  // Data link (optional). The link calls back into the engine; a small facade
  // avoids the construction-time circular reference.
  let channels = null;
  let link = null;
  let lastLinkTs = 0;
  const engineApi = {
    pushImpulse: (i) => pushImpulse(i),
    pushTick: (t) => pushTick(t),
    setMode: (m) => setMode(m)
  };

  let Q = resolveQuality(opt.quality);
  let W = 0, H = 0, cx = 0, cy = 0, R = 0, RO = 0, thV = 0, thS = 0, RMAX = 0, dpr = 1;
  let running = false, destroyed = false, rafId = 0, last = 0, T = 0;
  let frames = 0, fps = 0, fpsMark = 0;
  const impulses = [];
  let lastTick = null;
  let ro = null;

  /**
   * Optional clip rectangle (CSS px) that the shell uses to keep a panel band
   * from eating the ring. Drawing inside it is skipped — the panels overlay it,
   * so nothing is lost and the ring reads as wrapping around them.
   */
  let overlay = null;

  /**
   * Traffic per ring panel, in "data volume" units. The rotation rule reads
   * this to decide which panel to aim at the horizontal axis.
   */
  let traffic = [];
  let lastDetect = -1e9;

  function syncTraffic() {
    const n = ring.slotCount;
    if (traffic.length !== n) traffic = new Array(n).fill(0);
  }

  /** Create the data link (once) and keep channels in sync with the ring. */
  function syncChannels() {
    const n = ring.slotCount;
    if (!channels) {
      if (!opt.source) return;
      channels = createChannelMap(n, { now: () => T * 1000 });
      link = createLink(opt.source, engineApi, { channels });
      if (C.rotateToData && !C.dataDriven) C.dataDriven = 1;
    } else if (channels.length !== n) {
      channels.resize(n);
    }
  }

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
    syncTraffic();
    syncChannels();
    outer.build({ W, H, cx, cy, R, RO, RMAX, thS, DPR: dpr, FS: Q.farDown });
  }

  /** Slice 1 placeholder: background + pulsing core + ring skeleton + HUD. */
  function draw(dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#08090b';
    ctx.fillRect(0, 0, W, H);

    // keep the panel band out of the canvas: the panels sit on top of it, so
    // the ring has to wrap around them rather than render underneath
    const clip = overlay && overlay.height > 0 && overlay.width > 0 ? overlay : null;
    if (clip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(clip.left, clip.top, clip.width, clip.height);
      ctx.clip();
    }

    const e = beat.env;
    web.draw(ctx, { cx, cy, R, env: e });

    outer.draw(ctx, { W, H, cx, cy, R, RO, RMAX, thS, DPR: dpr, FS: Q.farDown });

    ring.draw(ctx, { cx, cy, R, RO, thV, W, H, dt });

    if (clip) ctx.restore();

    if (opt.hud) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(8,9,11,0.72)';
      ctx.fillRect(10, 10, 470, 38);
      ctx.font = '11px ui-monospace, Consolas, monospace';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(207,210,216,0.85)';
      ctx.fillText(
        `阶段 0 · 切片 5   节拍 #${beat.beatN}   包络 ${beat.env.toFixed(2)}   ` +
        `${W}×${H} @${dpr.toFixed(2)}   ${Q.name}   ${fps} 帧/秒   ${activity.mode === 'run' ? '运行' : activity.mode === 'idle' ? '空闲' : '无会话'}`,
        18, 16
      );
      ctx.fillStyle = 'rgba(107,111,120,0.9)';
      const focusTxt = ring.focus >= 0 ? `表盘 #${ring.focus}（已对准）` : '未对准';
      const labels = {
        lifecycle: '生命周期', sizing: '尺寸', quality: '画质', beat: '节拍', background: '背景',
        'inner-web': '内层网线', runners: '亮线', 'ring-band': '环带',
        'outer-beams': '外层光束', haze: '雾气', flares: '闪光', flyers: '流线', state: '状态机'
      };
      ctx.fillText(
        `已移植: ${PORTED.map((p) => labels[p] || p).join(' · ')}   ${focusTxt}`,
        18, 34
      );
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

    // Traffic decays so a panel that stops producing stops winning.
    if (traffic.length) {
      for (let i = 0; i < traffic.length; i++) traffic[i] *= Math.exp(-dt * 0.6);
      if (C.rotateToData && now - lastDetect >= C.detectGap * 1000) detectTraffic(now);
    }

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
    if (link) {
      try { link.dispose(); } catch { /* ignore */ }
      link = null;
    }
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
   * Rotation rule.
   *
   * Every `detectGap` seconds (default ≥ 0.5s) the engine reads each panel's
   * accumulated traffic and, if one is producing significantly more than the
   * rest, rotates the band so that panel sits on the horizontal axis (screen
   * angle 0). The winner is damped afterwards, so a channel that has gone quiet
   * stops holding the aim — the ring keeps tracking whatever is actually busy.
   */
  function detectTraffic(now) {
    if (!C.rotateToData || !traffic.length) return null;
    let best = -1;
    let bestV = 0;
    for (let i = 0; i < traffic.length; i++) {
      if (traffic[i] > bestV) { bestV = traffic[i]; best = i; }
    }
    lastDetect = now == null ? T : now;
    if (best < 0 || bestV < 1) return null;
    ring.rotateToSlot(best, 0);
    ring.focusSlot(best);
    traffic[best] *= 0.35;
    return { slot: best, value: bestV };
  }

  /**
   * Set/clear the panel band the canvas should not draw into.
   * @param {{left:number,top:number,width:number,height:number}|null} rect
   */
  function setOverlay(rect) {
    overlay = rect && rect.height > 0 && rect.width > 0 ? rect : null;
  }

  /**
   * Discrete event from the data link (tool_call / tool_result / compaction…).
   *
   * When `slot` is given, the event is anchored to that ring panel: the beam
   * fires from the panel's current screen angle and the panel flashes. Once any
   * real event flows in, the ambient random beams stop (`dataDriven`).
   */
  function pushImpulse(impulse) {
    if (!impulse) return;
    impulses.push(impulse);
    if (impulses.length > 512) impulses.splice(0, impulses.length - 512);

    const power = Math.max(0, Math.min(1, Number(impulse.power) || 0.7));
    const tint = impulse.kind === 'tool_result' ? 1 : 0;

    if (Number.isFinite(impulse.slot)) {
      const angle = ring.slotAngle(impulse.slot);
      ring.flashSlotAt(angle);
      outer.impulse(angle, power, tint);
      // accumulate the data volume that this panel just produced
      if (traffic.length) {
        const i = Math.max(0, Math.floor(impulse.slot)) % traffic.length;
        traffic[i] += (Number(impulse.bytes) || Number(impulse.tokens) || 0) + power * 1000;
      }
    } else {
      const angle = (random.rnd() * 2 - 1) * thS;
      outer.impulse(angle, power, tint);
    }
    // real data takes over: ambient decoration stops
    if (C.dataDriven !== 1) C.dataDriven = 1;
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
      slots: ring.slotCount,
      ringFocus: ring.focus,
      dataDriven: C.dataDriven,
      link: link ? {
        running: link.lastRunning,
        activity: link.lastActivity,
        tps: link.lastTps,
        contextTokens: link.lastContextTokens,
        contextLimit: link.lastContextLimit,
        turn: link.lastTurn,
        step: link.lastStep,
        tools: link.lastTools.length,
        feed: link.lastFeed.length,
        recentText: link.lastRecentText
      } : null,
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
    // Observe the canvas itself, not its parent: the shell may move the canvas
    // into a stage after creation, and the parent at that moment is not the
    // element that will resize.
    ro.observe(canvas);
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
    setOverlay,
    detectTraffic,
    get traffic() { return traffic.slice(); },
    get link() { return link; },
    attachLink(source) {
      if (link) link.dispose();
      link = null;
      channels = null;
      if (source) {
        opt.source = source;
        syncChannels();
      }
      return link;
    },
    detachLink() {
      if (link) { link.dispose(); link = null; }
      opt.source = null;
      channels = null;
    },
    getState,
    resize
  };
}
