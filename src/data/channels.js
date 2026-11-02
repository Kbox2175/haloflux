/**
 * Ring slots ↔ data channels.
 *
 * Every ring panel is a "channel" that owns a slice of the data flow. The
 * rotation rule reads each channel's accumulated traffic to decide which
 * panel to aim at. A channel can be bound to a stable key (a tool name, a
 * context source, an agent id…) so the same key always lands on the same panel
 * — that is what makes the ring readable instead of decorative.
 *
 * @module data/channels
 */

/**
 * Deterministic 0..n slot picker. Must be stable for a given key so a tool
 * always shows up on the same panel.
 */
export function slotFor(key, n) {
  if (!n || n < 1) return 0;
  const s = String(key == null ? '' : key);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % n) | 0;
}

/**
 * @param {number} nSlots
 * @param {{now: () => number}} clock
 */
export function createChannelMap(nSlots, clock) {
  let traffic = new Array(Math.max(1, nSlots)).fill(0);
  let decayHalf = 1.7;   // seconds; exponential decay of a stalled channel
  let capacity = 1;

  function resize(n) {
    n = Math.max(1, n | 0);
    if (n === traffic.length) return;
    const next = new Array(n).fill(0);
    for (let i = 0; i < Math.min(n, traffic.length); i++) next[i] = traffic[i];
    traffic = next;
  }

  /** Credit `bytes` of data to slot `i` (or to the slot bound to `key`). */
  function bump(i, bytes) {
    const idx = Number.isFinite(i) ? ((i % traffic.length) + traffic.length) % traffic.length : 0;
    const v = Number.isFinite(bytes) && bytes > 0 ? bytes : 1;
    traffic[idx] += v;
    if (traffic[idx] > capacity) traffic[idx] = capacity;
  }

  /** Credit a named channel. */
  function bumpKey(key, bytes) {
    bump(slotFor(key, traffic.length), bytes);
  }

  /** Decay every channel by `dt` seconds. */
  function decay(dt) {
    const k = Math.exp(-dt / Math.max(0.05, decayHalf));
    for (let i = 0; i < traffic.length; i++) traffic[i] *= k;
  }

  function slotOf(key) {
    return slotFor(key, traffic.length);
  }

  function value(i) {
    return traffic[((i % traffic.length) + traffic.length) % traffic.length];
  }

  /** Index of the busiest channel, or -1 when nothing has produced anything. */
  function busiest() {
    let best = -1;
    let bestV = 0;
    for (let i = 0; i < traffic.length; i++) {
      if (traffic[i] > bestV) { bestV = traffic[i]; best = i; }
    }
    return best < 0 || bestV < 1 ? -1 : best;
  }

  function total() {
    let s = 0;
    for (let i = 0; i < traffic.length; i++) s += traffic[i];
    return s;
  }

  function damp(i, factor) {
    const idx = ((i % traffic.length) + traffic.length) % traffic.length;
    traffic[idx] *= factor;
  }

  function clear() {
    traffic.fill(0);
  }

  return {
    resize,
    bump,
    bumpKey,
    decay,
    slotOf,
    value,
    busiest,
    total,
    damp,
    clear,
    get length() { return traffic.length; },
    set decayHalf(v) { decayHalf = Math.max(0.1, v); },
    set capacity(v) { capacity = Math.max(1, v); }
  };
}
