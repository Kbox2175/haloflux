/**
 * Shared math / randomness helpers.
 * Ported verbatim from lab.html so the refactor stays pixel-compatible.
 * @module engine/util
 */

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Wrap an angle into (-PI, PI]. */
export const normA = (a) => (((a + Math.PI) % TAU) + TAU) % TAU - Math.PI;

/** Deterministic 0..1 hash — used for stable tick/flare jitter. */
export const hash = (x) => {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

export const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeO = (t) => 1 - Math.pow(1 - t, 3);
export const easeOX = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Seeded PRNG (mulberry32). The original file used Math.random(), which made
 * frames impossible to reproduce; every random draw now comes from here.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The four random helpers the original code used everywhere. */
export function createRandom(seed = 1) {
  const rnd = mulberry32(seed);
  return {
    rnd,
    rr: (a, b) => a + rnd() * (b - a),
    pick: (arr) => arr[(rnd() * arr.length) | 0],
    gauss: () => (rnd() + rnd() + rnd() - 1.5) / 1.5
  };
}

/** Offscreen canvas with a device-pixel scale baked into its transform. */
export function mkd(w, h, d) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * d));
  c.height = Math.max(1, Math.ceil(h * d));
  c.x = c.getContext('2d');
  c.x.setTransform(d, 0, 0, d, 0, 0);
  return c;
}

/**
 * Small canvas pool. The ring rebuilds a canvas per data slot and drops it on
 * every resize; recycling keeps the GC quiet on long runs.
 */
const POOL = [];
const POOL_MAX = 24;

export function acquireCanvas(w, h) {
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  let idx = -1;
  for (let i = 0; i < POOL.length; i++) {
    if (POOL[i].width === cw && POOL[i].height === ch) { idx = i; break; }
  }
  const c = idx >= 0 ? POOL.splice(idx, 1)[0] : document.createElement('canvas');
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
  c.x = c.getContext('2d');
  c.x.setTransform(1, 0, 0, 1, 0, 0);
  c.x.clearRect(0, 0, cw, ch);
  return c;
}

export function releaseCanvas(c) {
  if (!c || POOL.length >= POOL_MAX) return;
  POOL.push(c);
}
