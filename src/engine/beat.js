/**
 * The uneven beat clock that drives every animated layer.
 * Ported verbatim: the pattern and the exponential envelope are unchanged,
 * so the refactored engine keeps the original rhythm.
 * @module engine/beat
 */

/** Uneven bar: ten intervals summing to 4.5 beats. */
export const PATTERN = [0.5, 0.25, 0.25, 0.5, 0.5, 0.75, 0.25, 0.25, 0.25, 1.0];

export function createBeat() {
  let beatT = 0.4;
  let beatI = 0;
  let sinceBeat = 9;
  let beatN = 0;
  let env = 0;

  return {
    get env() { return env; },
    get beatN() { return beatN; },
    get sinceBeat() { return sinceBeat; },

    /**
     * @param {number} dt seconds
     * @param {number} tempo multiplier (0.4..2.5)
     * @param {(n:number)=>void} [onBeat] fired on every beat boundary
     */
    update(dt, tempo, onBeat) {
      beatT -= dt;
      sinceBeat += dt;
      if (beatT <= 0) {
        beatT += (PATTERN[beatI++ % PATTERN.length] * 0.92) / Math.max(0.01, tempo);
        sinceBeat = 0;
        beatN++;
        if (onBeat) onBeat(beatN);
      }
      env = Math.exp(-sinceBeat * 4.5);
    }
  };
}
