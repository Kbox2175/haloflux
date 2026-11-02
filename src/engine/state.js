/**
 * Activity state machine: void → idle → run.
 *
 * A session can be absent, present but quiet, or actively working. The engine
 * smooths between those targets with independent attack / release times so the
 * scene ramps up and winds down instead of snapping.
 *
 * @module engine/state
 */

/** Target intensity per mode. */
export const MODE_TARGET = { void: 0, idle: 0.18, run: 1 };

export function createStateMachine(options = {}) {
  const opt = {
    mode: 'run',
    attack: 0.8,   // seconds to rise
    release: 2.6,  // seconds to fall
    ...options
  };

  let mode = opt.mode;
  let target = MODE_TARGET[mode] ?? 1;
  let level = target;

  /** Switch mode; returns true when the effective target changed. */
  function setMode(next) {
    if (!(next in MODE_TARGET) || next === mode) return false;
    mode = next;
    target = MODE_TARGET[next];
    return true;
  }

  function setTiming(attack, release) {
    if (Number.isFinite(attack) && attack > 0) opt.attack = attack;
    if (Number.isFinite(release) && release > 0) opt.release = release;
  }

  /** Exponential approach with a mode-dependent time constant. */
  function update(dt) {
    const tau = target > level ? opt.attack : opt.release;
    const k = 1 - Math.exp(-dt / Math.max(0.001, tau));
    level += (target - level) * k;
    if (Math.abs(target - level) < 1e-3) level = target;
    return level;
  }

  return {
    get mode() { return mode; },
    get level() { return level; },
    get target() { return target; },
    setMode,
    setTiming,
    update,
    /** Force the envelope to a value (used by presets/tests). */
    snap(v) { level = Math.max(0, Math.min(1, v)); }
  };
}
