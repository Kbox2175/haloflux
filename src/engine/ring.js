/**
 * The rotating ring band: a near-black annulus carrying pre-rendered
 * "micro data panels", plus rulers and glowing rims.
 * Ported from lab.html (buildCards / renderSlot / rimW / drawRing / ringMove).
 *
 * @module engine/ring
 */
import { TAU, clamp, easeIO, normA, hash, acquireCanvas, releaseCanvas } from './util.js';

/** Supersampling factor of each slot canvas (quality-tunable later). */
let RING_SC = 2.4;

const TINTS = [
  [232, 234, 240], [232, 234, 240], [232, 234, 240], [232, 234, 240], [232, 234, 240],
  [232, 234, 240], [196, 184, 246], [196, 184, 246], [168, 222, 214], [206, 212, 150]
];

const HEAD = ['求解器/02', '提取', '参考场景 07', '方法 M04', '校验', '残差', '论文 37',
  '智能体 09', '缓冲区 A', '差分场', '步 1284', '网格 64×64', '投影', '平流', '边界 / 壁面',
  '格点法 D2Q9', '队列', '追踪', '式(4)', '图 3', '验证', '场景 12'];

const KEYS = ['步长', '柯朗', '粘度', '雷诺', '容差', '迭代', 'L2', '质量', '散度', '速度', '密度', '误差', '网格', '种子'];

const CODE_T = ['载入()', '步进(u)', '投影(p)', '边界.应用', '求解()', '梯度 p', '散度 u', '断言',
  '均衡', '流场', '碰撞', '通过', '合格', '引用#12', '差分', 'L2<容差', 'u*', '→', '==', 'dt/2',
  '发射', '推送', '读取', '图3', '式4'];

const rgba = (t, a) => `rgba(${t[0]},${t[1]},${t[2]},${a})`;

const BLOCK_W = [['code', 16], ['kv', 11], ['spark', 9], ['bars', 8], ['prog', 7], ['grid', 7],
  ['gauge', 3], ['wave', 4], ['para', 12], ['cols', 7], ['barcode', 6], ['matrix', 8]];
const NEEDS_H = { code: 18, spark: 18, bars: 20, wave: 18, gauge: 16 };

/**
 * @param {{random: ReturnType<import('./util.js').createRandom>, params: Record<string, number>}} deps
 */
export function createRingLayer({ random, params }) {
  const { rnd, rr, pick } = random;

  /** @type {{a:number,da:number,hpx:number,c:HTMLCanvasElement|null,flash:number}[]} */
  let slots = [];
  let band = 0;
  let rot = { from: 0, to: 0, t: 1, dur: 1, hold: 0, ease: easeIO };
  let ringRot = 0;
  /** Slot currently aimed at the aim point, or -1. */
  let focus = -1;

  const fmtNum = () => {
    const k = rnd();
    return k < 0.3 ? rr(0, 1).toFixed(3)
      : k < 0.55 ? rr(1, 9).toFixed(1) + 'e-' + (2 + ((rnd() * 5) | 0))
      : k < 0.8 ? String((rnd() * 9999) | 0)
      : rr(0, 100).toFixed(1);
  };

  /** Ragged vertical "text" made of short dashes (radial = x, tangential = y). */
  function glyphStrips(x, x1, y0, y1, pitch, opt, ctx) {
    const tint = opt.tint;
    for (let lx = x; lx < x1 - 1; lx += pitch) {
      if (opt.colGap && rnd() < 0.18) { lx += pitch * 0.8; continue; }
      const len = (y1 - y0) * (opt.ragged ? rr(0.35, 1) : rr(0.85, 1));
      const start = opt.ragged && rnd() < 0.3 ? y0 + rr(0, (y1 - y0) * 0.3) : y0;
      let y = start;
      const lb = rr(0.55, 1);
      while (y < Math.min(y1, start + len)) {
        const cl = opt.solid ? rr(2, 6) : rr(0.9, 2.2);
        if (rnd() < 0.9) {
          ctx.fillStyle = rgba(tint, lb * rr(0.6, 1));
          ctx.fillRect(lx, y, opt.th, Math.min(cl, y1 - y));
        }
        y += cl + (rnd() < 0.12 ? rr(1.5, 3) : rr(0.5, 0.9));
      }
    }
  }

  // ---- block renderers: (ctx, x0, x1, y0, y1, tint) — x is radial, y is tangential ----
  function header(c, x0, x1, y, t) {
    c.font = `700 5.2px ui-monospace, Consolas, monospace`;
    c.fillStyle = rgba(t, 0.95);
    c.fillText(pick(HEAD), x0, y);
    c.fillStyle = rgba(t, 0.55);
    c.fillText(String((rnd() * 99) | 0).padStart(2, '0'), x1 - 6, y);
    c.fillStyle = rgba(t, 0.3);
    c.fillRect(x0, y + 5.6, x1 - x0, 0.45);
    return y + 7.5;
  }

  const BLOCKS = {
    code(c, x0, x1, y0, y1, t) {
      let y = header(c, x0, x1, y0, t);
      c.font = `500 4.4px ui-monospace, Consolas, monospace`;
      let n = 1 + ((rnd() * 40) | 0);
      while (y < y1 - 3.5) {
        c.fillStyle = rgba(t, 0.3);
        c.fillText(String(n++).padStart(3, '0'), x0, y);
        let xx = x0 + 9;
        const words = 1 + ((rnd() * 4) | 0);
        for (let i = 0; i < words && xx < x1 - 4; i++) {
          const w = pick(CODE_T);
          c.fillStyle = rgba(t, rnd() < 0.25 ? 1 : rr(0.5, 0.8));
          c.fillText(w, xx, y);
          xx += w.length * 2.15 + 2;
        }
        y += 4.6;
      }
    },
    kv(c, x0, x1, y0, y1, t) {
      let y = y1 - y0 > 18 ? header(c, x0, x1, y0, t) : y0 + 1;
      c.font = `500 4.5px ui-monospace, Consolas, monospace`;
      while (y < y1 - 4) {
        c.fillStyle = rgba(t, 0.5);
        c.fillText(pick(KEYS), x0, y);
        const v = fmtNum();
        c.fillStyle = rgba(t, 0.95);
        c.textAlign = 'right';
        c.fillText(v, x1, y);
        c.textAlign = 'left';
        const bx = x0 + 14;
        const bw = Math.max(0, x1 - x0 - 14 - v.length * 2.2 - 4);
        c.fillStyle = rgba(t, 0.15);
        c.fillRect(bx, y + 1.2, bw, 1.2);
        c.fillStyle = rgba(t, 0.7);
        c.fillRect(bx, y + 1.2, bw * rnd(), 1.2);
        y += 5.2;
      }
    },
    spark(c, x0, x1, y0, y1, t) {
      const y = header(c, x0, x1, y0, t);
      const top = y + 1;
      const bot = y1 - 2;
      const n = 40;
      c.fillStyle = rgba(t, 0.18);
      c.fillRect(x0, bot, x1 - x0, 0.4);
      c.fillRect(x0, (top + bot) / 2, x1 - x0, 0.25);
      c.strokeStyle = rgba(t, 0.95);
      c.lineWidth = 0.55;
      c.beginPath();
      let v = rnd();
      let lx = 0;
      let ly = 0;
      for (let i = 0; i <= n; i++) {
        v = clamp(v + ((rnd() + rnd() + rnd() - 1.5) / 1.5) * 0.22, 0, 1);
        lx = x0 + ((x1 - x0) * i) / n;
        ly = bot - v * (bot - top);
        i ? c.lineTo(lx, ly) : c.moveTo(lx, ly);
      }
      c.stroke();
      c.fillStyle = '#fff';
      c.fillRect(lx - 0.9, ly - 0.9, 1.8, 1.8);
    },
    bars(c, x0, x1, y0, y1, t) {
      const y = header(c, x0, x1, y0, t);
      const n = 6 + ((rnd() * 10) | 0);
      const bh = (y1 - y - 1) / n;
      c.font = `500 3.8px ui-monospace, Consolas, monospace`;
      for (let i = 0; i < n; i++) {
        const v = rr(0.1, 1);
        const yy = y + i * bh;
        c.fillStyle = rgba(t, 0.35);
        c.fillText(String(i).padStart(2, '0'), x0, yy);
        c.fillStyle = rgba(t, v > 0.85 ? 1 : 0.65);
        c.fillRect(x0 + 7, yy + 0.4, (x1 - x0 - 7) * v, Math.max(0.8, bh - 1.2));
      }
    },
    prog(c, x0, x1, y0, y1, t) {
      let y = y1 - y0 > 18 ? header(c, x0, x1, y0, t) : y0 + 1;
      c.font = `500 4.3px ui-monospace, Consolas, monospace`;
      while (y < y1 - 5) {
        const p = rnd();
        c.fillStyle = rgba(t, 0.55);
        c.fillText(pick(['读取', '构建', '审阅', '质检', '同步', '差分']), x0, y);
        c.fillStyle = rgba(t, 0.9);
        c.textAlign = 'right';
        c.fillText(((p * 100) | 0) + '%', x1, y);
        c.textAlign = 'left';
        const bx = x0 + 15;
        const bw = x1 - x0 - 26;
        const segs = 12;
        for (let i = 0; i < segs; i++) {
          c.fillStyle = rgba(t, i / segs < p ? 0.85 : 0.14);
          c.fillRect(bx + (i * bw) / segs, y + 0.6, bw / segs - 0.6, 2);
        }
        y += 5.4;
      }
    },
    grid(c, x0, x1, y0, y1, t) {
      const y = y1 - y0 > 20 ? header(c, x0, x1, y0, t) : y0 + 1;
      const p = rr(2.4, 3.2);
      for (let yy = y; yy < y1 - p + 0.5; yy += p) {
        for (let xx = x0; xx < x1 - p + 0.5; xx += p) {
          const v = rnd();
          c.fillStyle = v > 0.93 ? 'rgba(240,166,198,.95)' : rgba(t, 0.08 + v * v * 0.8);
          c.fillRect(xx, yy, p - 0.6, p - 0.6);
        }
      }
    },
    gauge(c, x0, x1, y0, y1, t) {
      const r = Math.min((y1 - y0) / 2 - 1.5, 9);
      const gx = x0 + r + 1;
      const gy = (y0 + y1) / 2;
      const v = rnd();
      c.lineWidth = 1.2;
      c.strokeStyle = rgba(t, 0.15);
      c.beginPath();
      c.arc(gx, gy, r, 0, TAU);
      c.stroke();
      c.strokeStyle = rgba(t, 0.95);
      c.beginPath();
      c.arc(gx, gy, r, -Math.PI / 2, -Math.PI / 2 + TAU * v);
      c.stroke();
      c.font = `700 ${Math.max(3.2, r * 0.55)}px ui-monospace, Consolas, monospace`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = rgba(t, 1);
      c.fillText(((v * 100) | 0) + '', gx, gy);
      c.textAlign = 'left';
      c.textBaseline = 'top';
      if (x1 - (gx + r) > 20) BLOCKS.kv(c, gx + r + 4, x1, y0, y1, t);
    },
    wave(c, x0, x1, y0, y1, t) {
      const y = header(c, x0, x1, y0, t);
      const mid = (y + y1) / 2;
      const amp = (y1 - y) * 0.38;
      const f1 = rr(0.15, 0.4);
      const f2 = rr(0.5, 1.2);
      const ph = rnd() * 6;
      [[0.95, 1], [0.4, -0.6]].forEach(([a, k]) => {
        c.strokeStyle = rgba(t, a);
        c.lineWidth = 0.5;
        c.beginPath();
        for (let xx = x0; xx <= x1; xx += 0.8) {
          const yy = mid + amp * k * (Math.sin(xx * f1 + ph) * 0.7 + Math.sin(xx * f2) * 0.3);
          xx === x0 ? c.moveTo(xx, yy) : c.lineTo(xx, yy);
        }
        c.stroke();
      });
    },
    para(c, x0, x1, y0, y1, t) { glyphStrips(x0, x1, y0, y1, rr(2.6, 3.4), { tint: t, ragged: true, th: 1.3 }, c); },
    cols(c, x0, x1, y0, y1, t) { glyphStrips(x0, x1, y0, y1, rr(3.6, 4.6), { tint: t, colGap: true, th: 1.5 }, c); },
    barcode(c, x0, x1, y0, y1, t) { glyphStrips(x0, x1, y0, y1, rr(3.2, 4.2), { tint: t, solid: true, th: 1.8 }, c); },
    matrix(c, x0, x1, y0, y1, t) {
      const p = rr(2.1, 2.6);
      const dens = rr(0.35, 0.65);
      for (let yy = y0; yy < y1 - 1; yy += p) {
        for (let xx = x0; xx < x1; xx += p) {
          if (rnd() < dens) {
            c.fillStyle = rgba(t, rr(0.5, 1));
            c.fillRect(xx, yy, 1.4, 1.4);
          }
        }
      }
    }
  };

  function pickBlock(h) {
    for (let tries = 0; tries < 8; tries++) {
      let r = rnd() * 100;
      let name = 'para';
      for (const [n, w] of BLOCK_W) {
        r -= w;
        if (r <= 0) { name = n; break; }
      }
      if (!NEEDS_H[name] || h >= NEEDS_H[name]) return name;
    }
    return pick(['para', 'kv', 'matrix', 'barcode']);
  }

  /** The rim hairline band width. */
  function rimW() {
    return Math.max(3, (band || 1) * 0.065 * params.rimWidth);
  }

  function renderSlot(s) {
    const h = s.hpx;
    const c = acquireCanvas(band * RING_SC, (h + 2) * RING_SC);
    const x = c.getContext('2d');
    x.setTransform(RING_SC, 0, 0, RING_SC, 0, 0);
    x.textBaseline = 'top';

    const RB = rimW();
    const dz0 = RB + 6;
    const dz1 = band * 0.72;
    const oz0 = band * 0.78;
    const oz1 = band - RB - 5;

    const split = rnd() < 0.45 && dz1 - dz0 > 60;
    const blocks = [];
    if (split) {
      const m = dz0 + (dz1 - dz0) * rr(0.42, 0.6);
      blocks.push([dz0, m], [m + rr(4, 8), dz1]);
    } else {
      blocks.push([dz0, dz1 - rr(0, 18)]);
    }

    for (const [b0, b1] of blocks) {
      const tint = pick(TINTS);
      const y0 = 1 + rr(0, 2);
      const y1 = h + 1 - rr(0, 2);
      x.save();
      x.beginPath();
      x.rect(b0, y0 - 0.5, b1 - b0, y1 - y0 + 1);
      x.clip();
      BLOCKS[pickBlock(y1 - y0)](x, b0, b1, y0, y1, tint);
      x.restore();
    }

    // outer index column: tiny ids + tick groups
    const pitch = rr(8, 12);
    x.font = `600 4px ui-monospace, Consolas, monospace`;
    for (let yy = rr(1, pitch); yy < h - 2; yy += pitch) {
      if (rnd() < 0.15) continue;
      let xx = oz0 + rr(0, 3);
      if (rnd() < 0.45) {
        x.fillStyle = `rgba(225,228,236,${rr(0.55, 0.95)})`;
        x.fillText(String((rnd() * 999) | 0).padStart(3, '0'), xx, yy - 1);
        xx += 9;
      }
      const n = 1 + ((rnd() * 3) | 0);
      for (let i = 0; i < n && xx < oz1; i++) {
        x.fillStyle = `rgba(225,228,236,${rr(0.5, 0.95)})`;
        x.fillRect(xx, yy, rr(1.2, 2.4), 1.2);
        xx += rr(2.4, 3.6);
      }
    }

    if (rnd() < 0.45) {
      x.fillStyle = 'rgba(220,224,232,.7)';
      for (let xx = dz0; xx < oz1; xx += rr(2.4, 4.5)) if (rnd() < 0.8) x.fillRect(xx, h + 0.4, 1.1, 1.1);
    }

    s.c = c;
  }

  /** Lay out slots around the band; called whenever R/RO change. */
  function build(R, RO) {
    band = RO - R;
    if (slots.length) for (const s of slots) if (s.c) releaseCanvas(s.c);
    slots = [];
    const mid = R + band * 0.42;
    let a = 0;
    while (a < TAU - 0.03) {
      const hpx = rr(16, 62);
      const da = hpx / mid;
      const gap = rr(3, 9) / mid;
      slots.push({ a: a + da / 2, da, hpx, c: null, flash: 0 });
      a += da + gap;
    }
    rot = { from: 0, to: 0, t: 1, dur: 1, hold: 0, ease: easeIO };
    ringRot = 0;
    focus = -1;
  }

  /**
   * Apply a smooth rotation of `delta` radians. `dur` defaults to a calm
   * 1.1–1.8s so the band never feels whiplashed.
   */
  function rotateTo(delta, dur, hold) {
    const d = delta * params.ringSpeed;
    rot = {
      from: ringRot,
      to: ringRot + d,
      t: 0,
      dur: dur || rr(1.1, 1.8),
      ease: easeIO,
      hold: hold == null ? rr(0.25, 0.6) * params.ringPause : hold
    };
  }

  /**
   * Rotate the band so that slot `i` lands on screen angle `atAngle`.
   * `atAngle` 0 = horizontal (right of centre) — the aim point.
   * Takes the shortest signed path and returns it.
   */
  function rotateToSlot(i, atAngle) {
    if (!slots.length) return 0;
    const n = slots.length;
    const s = slots[((i % n) + n) % n];
    const want = (atAngle == null ? 0 : atAngle) - s.a;
    let d = (((want - ringRot) % TAU) + TAU) % TAU;
    if (d > Math.PI) d -= TAU;
    if (Math.abs(d) < 0.02) {
      rot = { from: ringRot, to: ringRot, t: 0, dur: 0.25, ease: easeIO, hold: 0.5 * params.ringPause };
    } else {
      rotateTo(d);
    }
    return d;
  }

  function focusSlot(i) {
    focus = ((i % slots.length) + slots.length) % slots.length;
  }

  /** Ambient spin — deliberately slow, and it never fights a data target. */
  function ringMove() {
    const r = rnd();
    let d, dur;
    if (r < 0.12) { d = rr(0.9, 1.5); dur = rr(1.2, 1.8); }
    else if (r < 0.45) { d = rr(0.1, 0.35); dur = rr(0.5, 0.9); }
    else { d = rr(0.03, 0.12); dur = rr(0.5, 0.9); }
    if (rnd() < 0.08) d = -d * 0.5;
    rot = {
      from: ringRot, to: ringRot + d, t: 0, dur,
      ease: easeIO, hold: rr(0.4, 0.9) * params.ringPause
    };
  }

  /** Flash the slot closest to a given screen angle (a comet hitting the ring). */
  function flashSlotAt(ang) {
    let best = null;
    let bd = 9;
    for (const s of slots) {
      const d = Math.abs(normA(s.a + ringRot - ang));
      if (d < bd) { bd = d; best = s; }
    }
    if (best && bd < 0.08) best.flash = Math.max(best.flash, 0.8);
  }

  function update(dt) {
    if (rot.t < rot.dur) {
      rot.t += dt;
      ringRot = rot.from + (rot.to - rot.from) * rot.ease(Math.min(1, rot.t / rot.dur));
    } else {
      rot.hold -= dt;
      ringRot += 0.02 * dt;
    }
  }

  /**
   * Beat hook: rotate, and flash a couple of panels.
   * Panel CONTENT is intentionally static — a slot is rendered once and then
   * only rotates with the band, so the ring reads as a fixed instrument rather
   * than a screen full of noise.
   */
  function onBeat() {
    // A data-driven target keeps the aim: never spin away from it.
    if (rot.t >= rot.dur && rot.hold <= 0) {
      if (params.rotateToData && focus >= 0) return;
      ringMove();
    }
    if (!slots.length) return;
    for (let i = 0; i < Math.round(2 * params.dataFlicker); i++) pick(slots).flash = rr(0.35, 0.7);
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {{cx:number,cy:number,R:number,RO:number,thV:number,W:number,H:number,dt:number}} view
   */
  function draw(ctx, view) {
    const { cx, cy, R, RO, thV, W, H, dt } = view;
    const mid = R + band * 0.42;

    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate(cx, cy);

    // near-black band
    ctx.beginPath();
    ctx.arc(0, 0, RO, 0, TAU);
    ctx.arc(0, 0, R, 0, TAU, true);
    ctx.fillStyle = '#040506';
    ctx.fill('evenodd');

    // data panels: rendered once per slot, then they simply rotate with the band
    for (let si = 0; si < slots.length; si++) {
      const s = slots[si];
      const A = s.a + ringRot;
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2.2);
      const sx = cx + Math.cos(A) * mid;
      const sy = cy + Math.sin(A) * mid;
      if (sx < -140 || sx > W + 140 || sy < -140 || sy > H + 140) continue;
      if (!s.c) renderSlot(s);
      ctx.save();
      ctx.rotate(A);
      const hh = s.hpx + 2;
      ctx.drawImage(s.c, R, -hh / 2, band, hh);
      if (s.flash > 0.02) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = s.flash;
        ctx.drawImage(s.c, R, -hh / 2, band, hh);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      // the focused panel keeps a steady glow, so you can see which one the
      // rotation rule is aiming at
      if (si === focus) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.24;
        ctx.drawImage(s.c, R, -hh / 2, band, hh);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        // a bright marker on the outer rim at the aim point
        const ra = RO + 5;
        ctx.beginPath();
        ctx.arc(ra, 0, 1.6, 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.fill();
      }
      ctx.restore();
    }

    // rulers & rims
    const tick = (step, fn) => {
      const n0 = Math.floor((-thV - 0.05 - ringRot) / step);
      const n1 = Math.ceil((thV + 0.05 - ringRot) / step);
      for (let n = n0; n <= n1; n++) {
        const a = n * step + ringRot;
        fn(Math.cos(a), Math.sin(a), n);
      }
    };
    const RB = rimW();

    ctx.beginPath();
    tick((0.14 / params.rimDensity * Math.PI) / 180, (ca, sa, n) => {
      const m = ((n % 6) + 6) % 6;
      const li = m === 0 ? RB : RB * (0.5 + 0.35 * hash(n));
      const lo = m === 0 ? RB : RB * (0.5 + 0.35 * hash(n + 77));
      ctx.moveTo(ca * (R + 1.5), sa * (R + 1.5));
      ctx.lineTo(ca * (R + 1.5 + li), sa * (R + 1.5 + li));
      ctx.moveTo(ca * (RO - 1.5), sa * (RO - 1.5));
      ctx.lineTo(ca * (RO - 1.5 - lo), sa * (RO - 1.5 - lo));
    });
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(232,235,242,${Math.min(1, 0.035 * params.rimBright * params.rimBright)})`;
    ctx.lineWidth = 1.2 + 2.4 * params.rimBright;
    ctx.stroke();
    ctx.strokeStyle = `rgba(232,235,242,${Math.min(1, 0.08 * params.rimBright)})`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = `rgba(240,242,248,${Math.min(1, 0.88 * params.rimBright)})`;
    ctx.lineWidth = 0.55;
    ctx.stroke();

    const arc = (r, lw, a) => {
      ctx.strokeStyle = `rgba(232,235,242,${a})`;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(0, 0, r, -thV, thV);
      ctx.stroke();
    };
    arc(R, 1.5, 1);
    arc(R + RB + 3, 0.6, 0.6);
    arc(RO - RB - 3, 0.6, 0.55);
    ctx.globalCompositeOperation = 'lighter';
    arc(RO, 3.5, 0.1);
    ctx.globalCompositeOperation = 'source-over';
    arc(RO, 1.3, 0.95);

    // aim point: the horizontal axis the rotation rule aligns the busiest
    // panel to. Visible even when nothing is focused.
    ctx.beginPath();
    ctx.arc(RO + 9, 0, 2.2, 0, TAU);
    ctx.fillStyle = 'rgba(152,224,207,.55)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(R + 6, 0);
    ctx.lineTo(R + 16, 0);
    ctx.strokeStyle = 'rgba(152,224,207,.3)';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    ctx.beginPath();
    tick((1 * Math.PI) / 180, (ca, sa) => {
      ctx.moveTo(ca * (R - 2), sa * (R - 2));
      ctx.lineTo(ca * (R - 5), sa * (R - 5));
    });
    tick((0.25 * Math.PI) / 180, (ca, sa, n) => {
      const m = ((n % 20) + 20) % 20;
      const L = m === 0 ? 9 : m % 5 === 0 ? 5 : 2.5;
      ctx.moveTo(ca * (RO + 2), sa * (RO + 2));
      ctx.lineTo(ca * (RO + 2 + L), sa * (RO + 2 + L));
    });
    ctx.strokeStyle = 'rgba(230,233,240,.5)';
    ctx.lineWidth = 0.6;
    ctx.stroke();

    ctx.restore();
  }

  /** Screen angle of slot i, including the band's current rotation. */
  function slotAngle(i) {
    if (!slots.length) return 0;
    const n = slots.length;
    const s = slots[((i % n) + n) % n];
    return s.a + ringRot;
  }

  return {
    build,
    slotAngle,
    rotateToSlot,
    focusSlot,
    onBeat,
    update,
    draw,
    flashSlotAt,
    get rotation() { return ringRot; },
    get slotCount() { return slots.length; },
    get focus() { return focus; },
    set supersample(v) { RING_SC = v; }
  };
}
