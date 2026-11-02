/**
 * Outside the ring: five stacked beam strata, haze bands, root flares and
 * fly-out streaks. Ported from lab.html (makeStrandLayer / updateOuter /
 * drawStrands / drawOuterFar / drawOuterNear / flyers).
 *
 * @module engine/outer
 */
import { TAU, clamp, normA, hash } from './util.js';

const EDGE_A = [0.28, 0.62, 1];
const FLY_A = [0.16, 0.36, 0.7];

export function createOuterLayer({ random, params }) {
  const { rnd, rr, pick, gauss } = random;

  let T = 0;
  let strandLayers = [];
  let pulses = [];
  let hazes = [];
  let flares = [];
  let flyers = [];
  let flyBands = [];
  let wedges = [];
  let eventBeams = [];
  let laneC = null;
  let farC = null;
  let GR = {};
  let view = { W: 0, H: 0, cx: 0, cy: 0, R: 0, RO: 0, RMAX: 0, thS: 0, DPR: 1, FS: 0.5 };
  let gradCtx = null;

  const span = () => view.RMAX - view.RO - 20;
  const r0 = () => view.RO + 3;

  /* ---------------- strand model ---------------- */

  function makeProfile(n) {
    const prof = [];
    let v = rr(0.45, 1);
    let run = 0;
    for (let k = 0; k < n; k++) {
      if (run-- <= 0) {
        v = clamp(v + gauss() * 0.4, 0.22, 1);
        run = 2 + ((rnd() * 5) | 0);
      }
      prof.push(clamp(v + gauss() * 0.07, 0.18, 1));
    }
    return prof;
  }

  function makeStrandLayer(stepDeg, rotK, lumK, lw, lenK, solidK, cover, nMin, nMax, brightP, dyn = 'soft') {
    const step = (stepDeg * Math.PI) / 180;
    const nb = Math.floor(TAU / step);
    const ws = [];
    const count = Math.round((nb * cover) / ((nMin + nMax) / 2));
    for (let j = 0; j < count; j++) {
      const n = nMin + ((rnd() * (nMax - nMin)) | 0);
      const bright = rnd() < brightP;
      ws.push({
        i0: (rnd() * nb) | 0, n, base: rr(0.35, 1), len: rr(0.1, 0.5), kick: 0,
        ph: rnd() * TAU, ph2: rnd() * TAU, f1: rr(0.22, 0.6), f2: rr(0.8, 1.7),
        lum: bright ? rr(0.75, 1) : rr(0.16, 0.55), tint: rnd() < 0.5 ? 1 : 0,
        lwK: rnd() < 0.2 ? rr(1.35, 2.1) : rr(0.6, 1.15), lenS: rr(0.6, 1.25),
        prof: makeProfile(n),
        pf: Array.from({ length: n }, () => rr(1, 4)),
        pp: Array.from({ length: n }, () => rnd() * TAU),
        ds: Array.from({ length: n }, () => rnd()),
        dsp: rr(0.7, 1.8), flow: 0, vis: false
      });
    }
    return { step, rotK, lumK, lw, lenK, solidK, wedges: ws, off: rnd() * TAU, dyn };
  }

  function build(v) {
    view = { ...view, ...v };
    strandLayers = [
      makeStrandLayer(0.22, 0.45, 0.3, 0.55, 1.15, 0.9, 1.1, 20, 90, 0.2),
      makeStrandLayer(0.16, 0.75, 0.58, 0.8, 1.05, 0.7, 0.9, 14, 70, 0.28),
      makeStrandLayer(0.12, 1.0, 1.0, 1.0, 1.0, 0.5, 0.75, 12, 60, 0.32),
      makeStrandLayer(0.45, 1.0, 0.5, 1.8, 0.8, 0.6, 0.35, 4, 16, 0.3),
      makeStrandLayer(0.12, 1.0, 0.85, 1.0, 1.0, 0.5, 0.55, 14, 70, 0.32, 'bounce')
    ];
    wedges = strandLayers[2].wedges.concat(strandLayers[4].wedges);
    hazes = [];
    flares = [];
    pulses = [];
    flyBands = Array.from({ length: 7 }, newFlyBand);
    flyers = Array.from({ length: Math.round(Math.min(750, 320 + view.W * 0.25) * params.flyerCount) }, () => newFlyer(true));
    GR = {};
    buildLanes();
    farC = document.createElement('canvas');
    farC.width = Math.ceil(view.W * view.FS);
    farC.height = Math.ceil(view.H * view.FS);
    farC.x = farC.getContext('2d');
    for (let i = 0; i < 14; i++) spawnHaze(true);
  }

  function buildLanes() {
    laneC = document.createElement('canvas');
    laneC.width = Math.max(1, Math.round(view.W * view.DPR));
    laneC.height = Math.max(1, Math.round(view.H * view.DPR));
    const x = laneC.getContext('2d');
    x.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    for (let i = 0; i < 700; i++) {
      const a = rr(-view.thS, view.thS);
      x.strokeStyle = `rgba(210,205,235,${rr(0.01, 0.035)})`;
      x.lineWidth = rr(0.5, 1);
      const r1 = rr(view.RO + 60, view.RMAX * 0.8);
      x.beginPath();
      x.moveTo(view.cx + Math.cos(a) * (view.RO + 4), view.cy + Math.sin(a) * (view.RO + 4));
      x.lineTo(view.cx + Math.cos(a) * r1, view.cy + Math.sin(a) * r1);
      x.stroke();
    }
  }

  function gradients(ctx) {
    if (gradCtx && GR.s0) return GR;
    gradCtx = ctx;
    const mkG = (stops, r1) => {
      const g = ctx.createRadialGradient(view.cx, view.cy, view.RO, view.cx, view.cy, r1);
      stops.forEach((s) => g.addColorStop(s[0], s[1]));
      return g;
    };
    const RMAX = view.RMAX;
    GR.s0 = mkG([[0, 'rgba(248,248,255,1)'], [0.35, 'rgba(228,226,242,.8)'], [1, 'rgba(190,190,214,.3)']], RMAX * 0.95);
    GR.s2 = mkG([[0, 'rgba(225,245,242,1)'], [0.3, 'rgba(176,214,210,.8)'], [1, 'rgba(140,180,186,.3)']], RMAX * 0.95);
    GR.s1 = mkG([[0, 'rgba(240,236,255,1)'], [0.3, 'rgba(196,182,244,.82)'], [1, 'rgba(160,140,228,.3)']], RMAX * 0.95);
    GR.h0 = mkG([[0, 'rgba(205,190,255,.95)'], [0.25, 'rgba(180,165,240,.7)'], [0.7, 'rgba(150,135,215,.25)'], [1, 'rgba(120,110,190,0)']], RMAX);
    GR.h1 = mkG([[0, 'rgba(250,250,255,1)'], [0.2, 'rgba(225,225,240,.65)'], [0.65, 'rgba(200,200,225,.2)'], [1, 'rgba(180,180,210,0)']], RMAX);
    GR.h2 = mkG([[0, 'rgba(200,230,228,.9)'], [0.25, 'rgba(170,205,210,.6)'], [0.7, 'rgba(140,170,185,.2)'], [1, 'rgba(120,150,170,0)']], RMAX);
    return GR;
  }

  /* ---------------- haze / flares ---------------- */

  function spawnHaze(init) {
    const k = rnd();
    hazes.push({
      a: rr(-view.thS, view.thS) - ringRotRef(),
      w: rnd() < 0.7 ? rr(0.015, 0.07) : rr(0.08, 0.18),
      len: rr(0.35, 1), cur: init ? rr(0.2, 0.8) : 0, age: init ? rr(0, 0.5) : 0,
      life: rr(0.35, 1.6), alpha: rr(0.12, 0.42),
      tint: k < 0.55 ? 0 : k < 0.85 ? 1 : 2, drift: rr(-0.04, 0.04)
    });
  }

  function spawnFlare(a) {
    flares.push({
      a: a == null ? rr(-view.thS, view.thS) * 0.95 - ringRotRef() : a,
      w: rr(0.006, 0.04), len: rr(18, 110), age: 0, life: rr(0.2, 0.55), alpha: rr(0.6, 1)
    });
  }

  /**
   * A data-driven beam: fired from the exact angle of the ring panel that
   * produced the event. Its root stays on the ring; length follows `power`.
   * Once any impulse arrives the ambient random kicks stop (params.dataDriven),
   * so what you see is the data, not decoration.
   */
  function impulse(angle, power = 1, tint = 0) {
    const p = Math.max(0, Math.min(1, power));
    eventBeams.push({
      a: angle - ringRot, power: p, age: 0,
      life: rr(0.9, 1.5), tint, seed: rnd() * 1000
    });
    if (eventBeams.length > 32) eventBeams.shift();

    // a short packet of streaks leaves with the beam
    const n = 6 + Math.round(p * 16);
    for (let i = 0; i < n; i++) {
      flyers.push({
        a: angle - ringRot + gauss() * 0.012,
        len: rr(40, 170) * (0.5 + p),
        r: view.RO + rr(0, 6),
        sp: rr(500, 950),
        lw: rnd() < 0.2 ? 1.3 : rr(0.6, 1),
        lv: p > 0.7 ? 2 : 1, tint, burst: true
      });
    }
    spawnFlare(angle - ringRot);
  }

  function hazeEnv(h) {
    const a = Math.min(1, h.age / 0.12);
    const o = h.age > h.life ? Math.max(0, 1 - (h.age - h.life) / 0.6) : 1;
    return a * o * (0.85 + 0.15 * Math.sin(h.age * 30));
  }

  /* ---------------- flyers ---------------- */

  function newFlyBand() { return { a: rr(-view.thS, view.thS), w: rr(0.01, 0.05), life: rr(2, 6) }; }

  function newFlyer(init) {
    let a;
    if (rnd() < 0.5) { const b = pick(flyBands) || newFlyBand(); a = b.a + gauss() * b.w; }
    else a = rr(-view.thS, view.thS);
    return {
      a: a - ringRotRef(), len: 20 + Math.pow(rnd(), 2) * 320,
      r: init ? rr(view.RO, view.RMAX) : view.RO + rr(0, 25),
      sp: rr(260, 900), lw: rnd() < 0.08 ? rr(1.2, 1.7) : rr(0.5, 1),
      lv: rnd() < 0.12 ? 1 : 0, tint: rnd() < 0.22 ? 1 : 0, burst: false
    };
  }

  function spawnFlyBurst() {
    const a = rr(-view.thS, view.thS) * 0.95;
    const n = Math.max(1, Math.round((14 + ((rnd() * 30) | 0)) * params.burstSize));
    const spread = rr(0.01, 0.045);
    const sp = rr(450, 1150);
    const len = rr(70, 320);
    const r0v = view.RO + rr(0, 8);
    const tint = rnd() < 0.3 ? 1 : 0;
    const lv = rnd() < 0.45 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      flyers.push({
        a: a + (i / n - 0.5) * spread + gauss() * 0.0015 - ringRotRef(),
        len: len * rr(0.7, 1.15), r: r0v - rr(0, len * 0.35),
        sp: sp * rr(0.92, 1.08), lw: rnd() < 0.2 ? 1.3 : rr(0.6, 1),
        lv, tint, burst: true
      });
    }
  }

  function updateFlyers(dt, env) {
    for (const b of flyBands) { b.life -= dt; if (b.life <= 0) Object.assign(b, newFlyBand()); }
    const k = (0.7 + 0.9 * env) * params.flyerSpeed;
    for (let i = flyers.length - 1; i >= 0; i--) {
      const f = flyers[i];
      f.r += f.sp * dt * k;
      if (f.r - f.len > view.RMAX) {
        if (f.burst) flyers.splice(i, 1);
        else flyers[i] = newFlyer(false);
      }
    }
  }

  function onBeatFlyers() {
    const n = Math.round((beatN % 4 === 0 ? 3 + ((rnd() * 2) | 0) : 1 + ((rnd() * 2) | 0)) * params.burstRate);
    for (let i = 0; i < n; i++) setTimeout(spawnFlyBurst, i * rr(20, 120));
  }

  /* ---------------- update ---------------- */

  let ringRot = 0;
  let beatN = 0;
  const ringRotRef = () => ringRot;

  function update(dt, env, rot, beat) {
    T += dt;
    ringRot = rot;
    beatN = beat;

    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.c += p.v * dt;
      p.life -= dt;
      if (p.life <= 0) pulses.splice(i, 1);
    }

    for (let i = eventBeams.length - 1; i >= 0; i--) {
      eventBeams[i].age += dt;
      if (eventBeams[i].age > eventBeams[i].life) eventBeams.splice(i, 1);
    }

    for (const Lr of strandLayers) {
      const rot2 = ringRot * Lr.rotK + Lr.off;
      for (const w of Lr.wedges) {
        const am = normA((w.i0 + w.n / 2) * Lr.step + rot2);
        w.vis = Math.abs(am) < view.thS + 0.2;
        w.flow += dt * w.dsp * (0.45 + 2.2 * env);
        if (!w.vis) { w.len *= 0.98; continue; }
        let p = 0;
        for (const pl of pulses) {
          const f = Math.min(1, pl.life / 0.5) * Math.min(1, (pl.L - pl.life) / 0.15 + 0.3);
          p += pl.amp * f * Math.exp(-(((am - pl.c) / pl.w) ** 2));
        }
        if (Lr.dyn === 'bounce') {
          const idle = w.base * (0.36 + 0.14 * Math.sin(T * 0.9 + w.ph));
          const tgt = Math.min(1, idle + p * 0.75 + w.kick * 0.6);
          w.kick *= Math.exp(-dt * 2.4);
          w.len += (tgt - w.len) * Math.min(1, (tgt > w.len ? 15 : 2.2) * dt);
        } else {
          const n1 = 0.5 + 0.5 * Math.sin(T * w.f1 + w.ph);
          const n2 = 0.5 + 0.5 * Math.sin(T * w.f2 + w.ph2);
          const idle = w.base * (0.4 + 0.34 * n1 + 0.14 * n2);
          const tgt = Math.min(1.05, (idle + p * 0.7 + w.kick * 0.55) * w.lenS);
          w.kick *= Math.exp(-dt * 1.8);
          w.len += (tgt - w.len) * Math.min(1, (tgt > w.len ? 5 : 1.3) * dt);
        }
      }
    }

    for (let i = hazes.length - 1; i >= 0; i--) {
      const h = hazes[i];
      h.age += dt;
      h.cur += (h.len - h.cur) * Math.min(1, 9 * dt);
      if (h.age > h.life + 0.6) hazes.splice(i, 1);
    }
    if (hazes.length < params.hazeCount && rnd() < 0.25) spawnHaze(false);

    for (let i = flares.length - 1; i >= 0; i--) {
      flares[i].age += dt;
      if (flares[i].age > flares[i].life) flares.splice(i, 1);
    }
    if (rnd() < 0.06 * params.flareRate) spawnFlare();

    updateFlyers(dt, env);
  }

  function onBeat(n) {
    beatN = n;

    // Ambient decoration. Once real data arrives (params.dataDriven) these stop,
    // so everything you see on the ring is a response, not decoration.
    if (!params.dataDriven) {
      onBeatFlyers();
      for (let i = 0; i < 2 + ((rnd() * 5) | 0); i++) {
        const w = pick(wedges);
        if (!w) break;
        w.kick = rr(0.4, 1);
        if (rnd() < 0.5) w.prof = makeProfile(w.n);
      }
      for (let i = 0; i < 2; i++) {
        const w = pick(wedges);
        if (w) w.lum = rnd() < 0.4 ? rr(0.8, 1) : rr(0.25, 0.6);
      }
      const nf = Math.round((1 + ((rnd() * 4) | 0)) * params.flareRate);
      for (let i = 0; i < nf; i++) spawnFlare(hazes.length && rnd() < 0.6 ? pick(hazes).a : null);
    }

    // Haze is atmosphere — it stays regardless of the data source.
    const nh = n % 4 === 0 ? 5 + ((rnd() * 4) | 0) : 1 + ((rnd() * 3) | 0);
    for (let i = 0; i < Math.round((nh * params.hazeCount) / 8); i++) spawnHaze(false);

    // The travelling wave is the visual beat: it still shapes strand lengths.
    const dir = rnd() < 0.5 ? 1 : -1;
    const big = n % 8 === 0;
    pulses.push({
      c: dir > 0 ? -view.thS - 0.15 : view.thS + 0.15,
      v: dir * rr(0.7, 1.6) * (big ? 0.7 : 1),
      w: big ? rr(0.25, 0.4) : rr(0.05, 0.16),
      amp: big ? 1 : rr(0.45, 0.9),
      life: rr(1.2, 2.0), L: 0
    });
    pulses.forEach((p) => p.L || (p.L = p.life));
  }

  /* ---------------- drawing ---------------- */

  function radialLines(ctx, a0, a1, st, rStart, L, seed, lo) {
    ctx.beginPath();
    let k = 0;
    for (let a = a0; a < a1; a += st, k++) {
      const l = L * (lo + (1 - lo) * hash(k + seed));
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      ctx.moveTo(view.cx + ca * rStart, view.cy + sa * rStart);
      ctx.lineTo(view.cx + ca * (rStart + l), view.cy + sa * (rStart + l));
    }
  }

  function drawStrands(ctx, Lr, collect) {
    const sp = span();
    const rStart = r0();
    const rot2 = ringRot * Lr.rotK + Lr.off;
    ctx.lineCap = 'butt';
    for (const w of Lr.wedges) {
      if (!w.vis) continue;
      const L = w.len * sp * Lr.lenK * params.beamLen;
      if (L < 3) continue;
      const a0 = normA(w.i0 * Lr.step + rot2);
      const a1 = a0 + w.n * Lr.step;
      if (a1 < -view.thS - 0.03 || a0 > view.thS + 0.03) continue;
      const alpha = Math.min(1, w.lum * Lr.lumK * (0.3 + 0.7 * Math.min(1, w.len * 1.8)) * params.beamBright * (Lr.dyn === 'bounce' ? params.beamBounce : 1));
      if (alpha < 0.005) continue;
      const lwW = Lr.lw * w.lwK * params.beamWidth;
      const paths = [new Path2D(), new Path2D(), new Path2D()];
      for (let k = 0; k < w.n; k++) {
        const a = a0 + (k + 0.5) * Lr.step;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const edge = Math.sin((Math.PI * (k + 0.5)) / w.n);
        const b = edge < 0.38 ? 0 : edge < 0.72 ? 1 : 2;
        const pr = w.prof[k];
        const l = L * pr * (0.5 + 0.5 * Math.sqrt(edge)) * (0.92 + 0.08 * Math.sin(T * w.pf[k] + w.pp[k]));
        const solid = l * (Lr.solidK + 0.3 * pr * (1 - Lr.solidK));
        paths[b].moveTo(view.cx + ca * rStart, view.cy + sa * rStart);
        paths[b].lineTo(view.cx + ca * (rStart + solid), view.cy + sa * (rStart + solid));
        if (!collect) continue;
        const tail = l - solid;
        const da = alpha * EDGE_A[b];
        if (tail > 6) {
          for (let d = 0; d < 2; d++) {
            const ph = (w.flow + w.ds[k] + d * 0.5) % 1;
            const s0 = solid + tail * ph;
            const s1 = Math.min(l, s0 + 3 + tail * 0.22 * (1 - ph * 0.5));
            if (s1 > s0) collect.dash.push(ca, sa, s0, s1, da);
          }
        }
        if ((k + ((T * 12) | 0)) % 4 === 0) collect.tip.push(ca, sa, l, da);
      }
      ctx.strokeStyle = GR['s' + w.tint];
      ctx.lineWidth = lwW;
      for (let b = 0; b < 3; b++) {
        ctx.globalAlpha = alpha * EDGE_A[b];
        ctx.stroke(paths[b]);
      }
      if (w.lum > 0.85 && params.beamGlow > 0) {
        ctx.globalAlpha = Math.min(1, alpha * 0.06 * params.beamGlow);
        ctx.lineWidth = lwW * 2.5;
        ctx.stroke(paths[2]);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawFlyers(ctx, bursts) {
    const buckets = {};
    for (const f of flyers) {
      if (f.burst !== bursts) continue;
      const a = normA(f.a + ringRot);
      if (a < -view.thS - 0.05 || a > view.thS + 0.05) continue;
      const key = f.tint * 10 + f.lv + (f.lw > 1.15 ? 100 : 0) + (f.burst ? 1000 : 0);
      (buckets[key] || (buckets[key] = [])).push(f, a);
    }
    for (const key in buckets) {
      const arr = buckets[key];
      const f0 = arr[0];
      ctx.strokeStyle = f0.tint ? GR.s1 : GR.s0;
      ctx.globalAlpha = Math.min(1, FLY_A[f0.lv] * (f0.burst ? params.burstBright : params.flyerBright));
      ctx.lineWidth = ((key % 1000) >= 100 ? 1.5 : 0.8) * params.flyerWidth;
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 2) {
        const f = arr[i];
        const a = arr[i + 1];
        const ra = Math.max(view.RO + 3, f.r - f.len);
        const rb = f.r;
        if (rb <= ra) continue;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        ctx.moveTo(view.cx + ca * ra, view.cy + sa * ra);
        ctx.lineTo(view.cx + ca * rb, view.cy + sa * rb);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawFar(ctx) {
    gradients(ctx);
    for (const h of hazes) {
      const e = hazeEnv(h);
      if (e <= 0.01) continue;
      if (h.seed === undefined) h.seed = rnd() * 1000;
      const L = h.cur * span();
      radialLines(ctx, h.a + ringRot - h.w / 2, h.a + ringRot + h.w / 2, 0.0038 * 0.55, r0(), L, h.seed, 0.45);
      ctx.strokeStyle = GR['s' + (h.tint === 1 ? 0 : h.tint === 2 ? 2 : 1)];
      ctx.globalAlpha = Math.min(1, h.alpha * e * 0.05 * params.hazeBright);
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.globalAlpha = Math.min(1, h.alpha * e * 0.6 * params.hazeBright);
      ctx.lineWidth = 0.55;
      ctx.stroke();
    }
    drawStrands(ctx, strandLayers[0], null);
    drawStrands(ctx, strandLayers[1], null);
    drawFlyers(ctx, false);
    ctx.globalAlpha = 1;
  }

  function drawNear(ctx) {
    gradients(ctx);
    const rStart = r0();
    const col = { dash: [], tip: [] };
    drawStrands(ctx, strandLayers[2], col);
    drawStrands(ctx, strandLayers[4], col);
    drawStrands(ctx, strandLayers[3], null);

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.05;
    for (const lv of [0.35, 0.65, 1]) {
      ctx.globalAlpha = Math.min(1, lv * params.dashBright);
      ctx.beginPath();
      const dp = col.dash;
      for (let i = 0; i < dp.length; i += 5) {
        const a = dp[i + 4];
        if (a > lv || a <= lv - 0.35) continue;
        ctx.moveTo(view.cx + dp[i] * (rStart + dp[i + 2]), view.cy + dp[i + 1] * (rStart + dp[i + 2]));
        ctx.lineTo(view.cx + dp[i] * (rStart + dp[i + 3]), view.cy + dp[i + 1] * (rStart + dp[i + 3]));
      }
      ctx.stroke();
    }

    ctx.fillStyle = '#fff';
    for (let i = 0; i < col.tip.length; i += 4) {
      ctx.globalAlpha = Math.min(1, col.tip[i + 3] * 1.2);
      const r = rStart + col.tip[i + 2];
      ctx.fillRect(view.cx + col.tip[i] * r - 0.8, view.cy + col.tip[i + 1] * r - 0.8, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;

    // data-driven beams: one per impulse, roots pinned to the ring
    for (const b of eventBeams) {
      const t = b.age / b.life;
      const grow = t < 0.22 ? t / 0.22 : 1;
      const fade = t > 0.55 ? Math.max(0, 1 - (t - 0.55) / 0.45) : 1;
      const L = span() * (0.12 + 0.8 * b.power) * grow;
      const w = 0.01 + 0.028 * b.power;
      ctx.strokeStyle = b.tint ? GR.s1 : GR.s0;
      radialLines(ctx, b.a + ringRot - w / 2, b.a + ringRot + w / 2, 0.0038 * 0.5, rStart, L, b.seed, 0.55);
      ctx.globalAlpha = Math.min(1, fade * (0.3 + 0.55 * b.power));
      ctx.lineWidth = 1.7;
      ctx.stroke();
      ctx.globalAlpha = Math.min(1, fade * 0.16);
      ctx.lineWidth = 5.5;
      ctx.stroke();
      const ca = Math.cos(b.a + ringRot);
      const sa = Math.sin(b.a + ringRot);
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#fff';
      ctx.fillRect(view.cx + ca * (rStart + L) - 1, view.cy + sa * (rStart + L) - 1, 2, 2);
    }
    ctx.globalAlpha = 1;

    drawFlyers(ctx, true);

    ctx.strokeStyle = GR.s0;
    for (const f of flares) {
      if (f.seed === undefined) f.seed = rnd() * 1000;
      const t = f.age / f.life;
      const e = (t < 0.15 ? t / 0.15 : Math.pow(1 - (t - 0.15) / 0.85, 2)) * f.alpha;
      const L = f.len * (0.6 + 0.4 * (1 - Math.pow(1 - Math.min(1, t * 3), 3)));
      radialLines(ctx, f.a + ringRot - f.w / 2, f.a + ringRot + f.w / 2, 0.0038 * 0.45, rStart, L, f.seed, 0.4);
      ctx.globalAlpha = Math.min(1, e * 0.06 * params.flareBright);
      ctx.lineWidth = 2.6;
      ctx.stroke();
      ctx.globalAlpha = Math.min(1, e * params.flareBright);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Composite: lanes → far buffer (blurred) → atmosphere → near layers. */
  function draw(ctx, v) {
    view = { ...view, ...v };
    gradients(ctx);

    ctx.globalCompositeOperation = 'lighter';
    if (laneC) ctx.drawImage(laneC, 0, 0, view.W, view.H);

    if (farC) {
      const F = farC.x;
      F.setTransform(1, 0, 0, 1, 0, 0);
      F.globalAlpha = 1;
      F.globalCompositeOperation = 'source-over';
      F.clearRect(0, 0, farC.width, farC.height);
      F.setTransform(view.FS, 0, 0, view.FS, 0, 0);
      F.globalCompositeOperation = 'lighter';
      drawFar(F);

      ctx.save();
      ctx.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      if ('filter' in ctx && params.depthBlur > 0) ctx.filter = `blur(${params.depthBlur}px)`;
      ctx.globalAlpha = Math.min(1, params.depthDim);
      ctx.drawImage(farC, 0, 0, view.W, view.H);
      ctx.restore();
    }

    if (params.atmos > 0) {
      const ag = ctx.createRadialGradient(view.cx, view.cy, view.RO, view.cx, view.cy, view.RO + (view.RMAX - view.RO) * 0.7);
      ag.addColorStop(0, `rgba(190,180,240,${Math.min(1, 0.07 * params.atmos)})`);
      ag.addColorStop(0.4, `rgba(150,145,210,${Math.min(1, 0.028 * params.atmos)})`);
      ag.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = ag;
      ctx.beginPath();
      ctx.arc(view.cx, view.cy, view.RMAX, 0, TAU);
      ctx.arc(view.cx, view.cy, view.RO, 0, TAU, true);
      ctx.fill('evenodd');
    }

    ctx.globalCompositeOperation = 'lighter';
    drawNear(ctx);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  return {
    build,
    update,
    onBeat,
    impulse,
    draw,
    get farCanvas() { return farC; },
    get layerCount() { return strandLayers.length; },
    get flyerCount() { return flyers.length; }
  };
}
