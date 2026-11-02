/**
 * Inner web + runners (the "woven light field" inside the ring).
 * Ported from lab.html: buildWeb() / newRunner() / qpt() / the trail pass.
 *
 * The web is four pre-rendered off-screen canvases (a base + three pulse
 * layers) rotated as one image; the runners are short segments drawn into a
 * trail canvas that is faded with destination-out every frame.
 *
 * @module engine/web
 */
import { TAU, mkd } from './util.js';

/**
 * @param {ReturnType<import('./util.js').createRandom>} random
 * @param {Record<string, number>} params live parameter object (mutated by setParams)
 */
export function createWebLayer({ random, params }) {
  const { rnd, rr, pick } = random;

  let webBase = null;
  /** @type {HTMLCanvasElement[]} */
  let webLayers = [];
  /** @type {{p0:{x:number,y:number},c:{x:number,y:number},p1:{x:number,y:number}}[]} */
  let curves = [];
  let runners = [];
  let trailC = null;
  let layerEnv = [0, 0, 0];
  let webRot = 0;
  let meta = { W: 0, H: 0, R: 0, size: 0, d: 1 };

  /** Quadratic Bézier point. */
  const qpt = (cv, t) => {
    const u = 1 - t;
    return {
      x: u * u * cv.p0.x + 2 * u * t * cv.c.x + t * t * cv.p1.x,
      y: u * u * cv.p0.y + 2 * u * t * cv.c.y + t * t * cv.p1.y
    };
  };

  /**
   * A single moving light. `mode` 0 = steady, 1 = surges on the beat,
   * 2 = accelerates along its own path.
   */
  function newRunner(init) {
    const cv = pick(curves);
    const t = init ? rnd() : 0;
    const p = qpt(cv, t);
    const k = rnd();
    let mode, sp;
    if (rnd() > params.runnerVariety) {
      mode = 1; sp = rr(0.12, 0.38);
    } else if (k < 0.3) {
      mode = 0; sp = rr(0.15, 0.28);
    } else if (k < 0.65) {
      mode = 1; sp = rr(0.1, 0.3);
    } else if (k < 0.8) {
      mode = 0; sp = rr(0.04, 0.08);
    } else if (k < 0.92) {
      mode = 0; sp = rr(0.5, 0.85);
    } else {
      mode = 2; sp = rr(0.06, 0.12);
    }
    return { cv, t, sp, mode, px: p.x, py: p.y, b: rnd() < 0.1 };
  }

  /**
   * (Re)build every off-screen surface. Called on resize and whenever a
   * `rebuild: web` parameter changes.
   */
  function build(W, H, R, dpr) {
    const d = Math.min(dpr, 1.5);
    // Rebuilding 2600 curves on every ResizeObserver tick is wasteful; only
    // rebuild when the geometry actually changed.
    if (webBase && meta.W === W && meta.H === H && Math.abs(meta.R - R) < 0.5 && Math.abs(meta.d - d) < 0.01) return;

    const size = 2 * R + 4;
    meta = { W, H, R, size, d };

    webBase = mkd(size, size, d);
    webLayers = [0, 1, 2].map(() => mkd(size, size, d));
    const all = [webBase, ...webLayers];
    all.forEach((c) => c.x.translate(R + 2, R + 2));

    const b = webBase.x;
    b.beginPath();
    b.arc(0, 0, R, 0, TAU);
    const g = b.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
    g.addColorStop(0, '#111215');
    g.addColorStop(1, '#0c0d0f');
    b.fillStyle = g;
    b.fill();

    all.forEach((c) => {
      c.x.save();
      c.x.beginPath();
      c.x.arc(0, 0, R, 0, TAU);
      c.x.clip();
    });

    curves = [];
    const N = Math.min(2600, Math.round(1000 + (W * H) / 800));
    for (let i = 0; i < N; i++) {
      const a1 = rnd() * TAU;
      const a2 = a1 + rr(0.6, Math.PI * 1.4);
      const p0 = { x: Math.cos(a1) * R, y: Math.sin(a1) * R };
      const p1 = { x: Math.cos(a2) * R, y: Math.sin(a2) * R };
      const cr = Math.sqrt(rnd()) * R * 0.9;
      const ca = rnd() * TAU;
      const c = { x: Math.cos(ca) * cr, y: Math.sin(ca) * cr };
      curves.push({ p0, c, p1 });

      const layer = rnd() < 0.7 ? -1 : (rnd() * 3) | 0;
      const x = layer < 0 ? b : webLayers[layer].x;
      const al = Math.min(
        1,
        (layer < 0 ? 0.03 + Math.pow(rnd(), 3) * 0.28 : 0.08 + Math.pow(rnd(), 2) * 0.35) * params.webBright
      );
      const k = rnd();
      x.strokeStyle =
        k < 0.05 ? `rgba(240,166,198,${al})` : k < 0.1 ? `rgba(180,170,235,${al})` : `rgba(228,231,238,${al})`;
      x.lineWidth = rr(0.4, 1.1);
      x.beginPath();
      x.moveTo(p0.x, p0.y);
      x.quadraticCurveTo(c.x, c.y, p1.x, p1.y);
      x.stroke();
    }

    // node markers
    b.font = '6px ui-monospace, Consolas, monospace';
    b.textBaseline = 'middle';
    for (let i = 0; i < 70; i++) {
      const rad = Math.sqrt(rnd()) * R * 0.92;
      const a = rnd() * TAU;
      const px = Math.cos(a) * rad;
      const py = Math.sin(a) * rad;
      const s = rr(2, 4.5);
      b.strokeStyle = `rgba(235,238,244,${rr(0.35, 0.8)})`;
      b.lineWidth = 0.8;
      b.beginPath();
      b.arc(px, py, s, 0, TAU);
      b.stroke();
      if (rnd() < 0.4) {
        b.beginPath();
        b.arc(px + s * 2.2, py, s * 0.8, 0, TAU);
        b.stroke();
      }
      if (rnd() < 0.35) {
        b.fillStyle = 'rgba(200,204,212,.5)';
        b.fillText('n' + ((rnd() * 99) | 0), px + 7, py);
      }
    }

    // dotted chains of small rings
    for (let k = 0; k < 3; k++) {
      const rad = R * rr(0.45, 0.85);
      const a0 = rr(0, TAU);
      const cnt = 22 + ((rnd() * 14) | 0);
      b.strokeStyle = 'rgba(235,238,244,.55)';
      b.lineWidth = 0.8;
      for (let i = 0; i < cnt; i++) {
        const a = a0 + i * 0.022;
        b.beginPath();
        b.arc(Math.cos(a) * rad, Math.sin(a) * rad, 2.2, 0, TAU);
        b.stroke();
      }
    }

    all.forEach((c) => c.x.restore());

    // optional soft-focus pass
    const hasFilter = b.filter !== undefined;
    if (hasFilter && params.webBlur > 0) {
      all.forEach((c, i) => {
        const orig = document.createElement('canvas');
        orig.width = c.width;
        orig.height = c.height;
        orig.getContext('2d').drawImage(c, 0, 0);
        const x = c.x;
        x.save();
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.clearRect(0, 0, c.width, c.height);
        x.filter = `blur(${(i ? 0.5 : 1) * params.webBlur * d}px)`;
        x.drawImage(orig, 0, 0);
        x.filter = 'none';
        x.globalAlpha = Math.max(0.15, 1 - params.webBlur * 0.3);
        x.drawImage(orig, 0, 0);
        x.restore();
      });
    }

    trailC = mkd(size, size, Math.min(dpr, 1.5));
    runners = [];
    for (let i = 0; i < params.runnerCount; i++) runners.push(newRunner(true));
    layerEnv = [0, 0, 0];
    webRot = 0;
  }

  /** Beat hook: light up one pulse layer, refresh all three on every 4th beat. */
  function onBeat(beatN) {
    layerEnv[(rnd() * 3) | 0] = 1;
    if (beatN % 4 === 0) layerEnv = layerEnv.map(() => rr(0.6, 1));
  }

  /** Advance web rotation, pulse decay and every runner. */
  function update(dt, env) {
    webRot += dt * (0.03 + env * 0.12) * params.webSpin;
    for (let k = 0; k < 3; k++) layerEnv[k] *= Math.exp(-dt * 2.2);

    const count = Math.round(params.runnerCount);
    while (runners.length < count) runners.push(newRunner(true));
    if (runners.length > count) runners.length = Math.max(0, count);

    const tx = trailC.x;
    const ws = meta.size;
    const surge = 0.5 + 2.5 * env;

    tx.globalCompositeOperation = 'destination-out';
    tx.fillStyle = `rgba(0,0,0,${0.05 + env * 0.05})`;
    tx.fillRect(0, 0, ws, ws);
    tx.globalCompositeOperation = 'source-over';

    tx.save();
    tx.translate(meta.R + 2, meta.R + 2);
    tx.lineCap = 'round';
    for (let i = 0; i < runners.length; i++) {
      const r = runners[i];
      r.t += dt * params.runnerSpeed * (r.mode === 1 ? r.sp * surge : r.mode === 2 ? r.sp + 1.3 * r.t * r.t : r.sp);
      if (r.t >= 1) {
        runners[i] = newRunner(false);
        continue;
      }
      const p = qpt(r.cv, r.t);
      tx.strokeStyle = r.b
        ? `rgba(240,166,198,${Math.min(1, 0.9 * params.runnerBright)})`
        : `rgba(250,251,255,${Math.min(1, 0.75 * params.runnerBright)})`;
      tx.lineWidth = (r.b ? 1.3 : 0.9) * params.runnerWidth;
      tx.beginPath();
      tx.moveTo(r.px, r.py);
      tx.lineTo(p.x, p.y);
      tx.stroke();
      r.px = p.x;
      r.py = p.y;
    }
    tx.restore();
  }

  /** Composite the web disc, its pulse layers and the runner trail. */
  function draw(ctx, { cx, cy, R, env }) {
    if (!webBase) return;
    const ws = 2 * R + 4;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(webRot);

    ctx.drawImage(webBase, -R - 2, -R - 2, ws, ws);

    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < webLayers.length; k++) {
      ctx.globalAlpha = Math.min(1, params.webPulseBase + params.webPulseAmp * layerEnv[k]);
      ctx.drawImage(webLayers[k], -R - 2, -R - 2, ws, ws);
    }
    ctx.globalAlpha = 1;

    if (trailC) ctx.drawImage(trailC, -R - 2, -R - 2, ws, ws);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  return {
    build,
    onBeat,
    update,
    draw,
    get rotation() { return webRot; },
    get curves() { return curves; },
    get runnerCount() { return runners.length; }
  };
}
