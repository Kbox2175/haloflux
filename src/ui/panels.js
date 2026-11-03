/**
 * The eight panels — real session data, not decoration.
 *
 * Each panel is a small renderer: `createX(host)` returns `{ update(state),
 * resize(), dispose() }`. `state` is the engine's link snapshot
 * (`engine.getState().link` plus the tick), so panels read the same numbers the
 * ring is reacting to.
 *
 * @module ui/panels
 */

/** Canvas helper: size a canvas to its CSS box and return a scaled 2d ctx. */
function canvasFor(host) {
  const cv = host.querySelector('canvas');
  if (!cv) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = cv.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  if (cv.width !== w * dpr || cv.height !== h * dpr) {
    cv.width = w * dpr;
    cv.height = h * dpr;
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, cv };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------- 1. 调查流 ---------------- */

export function createFeedPanel(host) {
  const box = host.querySelector('.feed');
  const MAX = 14;
  const seed = ['读取上下文', '检索参考场景', '校验数值稳定性', '检查质量守恒', '记录边界条件',
    '附加来源链接', '对比参考输出', '保留缺失细节', '打包干净检出', '复现图 3', '扫描时间步敏感性'];
  let n = 100;

  function push(kind, text) {
    const d = document.createElement('div');
    d.innerHTML = `<span class="n">${String(++n).padStart(3, '0')}</span>` +
      `<span class="vb ${kind}">${kind === 'error' ? '错误' : kind === 'turn' ? '轮次' : kind === 'tool' ? '工具' : kind === 'user' ? '输入' : kind === 'assistant' ? '回答' : kind === 'compaction' ? '压缩' : '状态'}</span>${text}`;
    box.appendChild(d);
    while (box.children.length > MAX) box.removeChild(box.firstChild);
  }

  for (let i = 0; i < 8; i++) push('tool', seed[i % seed.length]);

  return {
    update(s) {
      if (!s || !s.link) return;
      const feed = s.link.feed || [];
      if (!feed.length) return;
      const last = feed[feed.length - 1];
      if (last && last._shown) return;
      push(last.kind || 'status', last.text || '');
      if (last) last._shown = true;
      for (const f of feed.slice(-6)) if (f && !f._shown) { push(f.kind || 'status', f.text || ''); f._shown = true; }
    },
    dispose() {}
  };
}

/* ---------------- 2. 上下文·速度 ----------------
 * The third v0.4 telemetry panel (§4.2 #3). A DOM slope meter for how fast the
 * context window is filling: a big tokens/second readout, a projected time to
 * full, and a short slope line of the recent growth rate (its steepness *is*
 * the rate). Replaces the old tps-driven flow canvas — the speed placeholder.
 * Reads contextTokens / contextLimit / step from the link snapshot.
 */

const SPD_WINDOW = 2.0; // seconds; rolling window for the rate

/** Rate formatter: 8000 → "8K", 2400 → "2.4K", 80 → "80". */
function fmtRate(n) {
  const v = Math.max(0, n || 0);
  if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(v));
}

export function createContextSpeedPanel(host) {
  const box = host.querySelector('.spd');
  const MAX_SAMPLES = 120;
  const samples = []; // { t, tokens }
  let clock = 0;       // panel-local seconds (accumulated dt)

  function build() {
    box.innerHTML =
      '<div class="spd-top">' +
      '<div class="spd-big"><b class="spd-rate">0</b><span class="spd-unit">tok/s</span></div>' +
      '<div class="spd-side"><span class="spd-eta">预计 —</span><span class="spd-step">步 0</span></div>' +
      '</div>' +
      '<svg class="spd-slope" viewBox="0 0 100 28" preserveAspectRatio="none">' +
      '<path class="spd-area" d=""></path>' +
      '<polyline class="spd-line" points=""></polyline>' +
      '</svg>' +
      '<div class="spd-cap">最近 2s · 增长速率</div>';
  }

  function renderSlope(color, rates) {
    const line = box.querySelector('.spd-line');
    const area = box.querySelector('.spd-area');
    const n = rates.length;
    if (n < 2) { line.setAttribute('points', ''); area.setAttribute('d', ''); return; }
    let min = Math.min(...rates), max = Math.max(...rates);
    if (max - min < 1) { min -= 1; max += 1; }
    const pts = rates.map((v, i) =>
      `${((i / (n - 1)) * 100).toFixed(2)},${(26 - ((v - min) / (max - min)) * 24).toFixed(2)}`);
    line.setAttribute('points', pts.join(' '));
    line.style.stroke = color;
    area.setAttribute('d', 'M0,28 L' + pts.join(' L') + ' L100,28 Z');
    area.style.fill = color;
  }

  build();

  return {
    update(s, dt) {
      if (!box) return;
      const link = s && s.link;
      const d = Number.isFinite(dt) && dt > 0 ? dt : 0.016;
      clock += d;

      const tokens = link ? (link.contextTokens || 0) : 0;
      const limit = link ? (link.contextLimit || 0) : 0;
      const step = link ? (link.step || 0) : 0;
      const running = link ? !!link.running : false;

      samples.push({ t: clock, tokens });
      while (samples.length > MAX_SAMPLES) samples.shift();
      while (samples.length > 2 && clock - samples[0].t > SPD_WINDOW) samples.shift();

      // rolling growth rate (tokens/sec) at each sample, lookback k
      const n = samples.length;
      const k = Math.max(2, Math.floor(n / 10));
      const rates = [];
      for (let i = k; i < n; i++) {
        const span = samples[i].t - samples[i - k].t;
        if (span > 0.05) rates.push((samples[i].tokens - samples[i - k].tokens) / span);
      }
      const rate = rates.length ? rates[rates.length - 1] : 0;
      const rateK = Math.max(0, rate);

      const big = box.querySelector('.spd-rate');
      const color = rateK >= 1000 ? '#f0a6c6' : (running ? '#98e0cf' : '#6b6f78');
      big.textContent = fmtRate(rateK);
      big.style.color = color;

      box.querySelector('.spd-eta').textContent = rateK > 1
        ? (tokens >= limit ? '已满' : '预计 +' + Math.ceil((limit - tokens) / rateK) + 's')
        : '—';
      box.querySelector('.spd-step').textContent = '步 ' + step;

      renderSlope(color, rates);
    },
    resize() {},
    dispose() {}
  };
}

/* ---------------- 3. 压缩·时间线 ----------------
 * The fourth v0.4 telemetry panel (§4.2 #4). A DOM sawtooth meter for
 * compaction / truncation: a rolling context-level area chart whose drops are
 * the events, each marked with a pink tick, plus a compaction count and the
 * last event's step. The link snapshot carries no explicit compaction flag, so
 * the panel computes it from a contextTokens drop (>2% of the window) — which
 * is how a live session reports it. Replaces the old method-workspace canvas.
 */

const TL_WINDOW = 20;  // seconds of history kept
const TL_MAX = 120;    // sample cap
const TL_DROP = 0.02;  // a drop beyond 2% of the window is a compaction
const TL_MAX_EVENTS = 40;

export function createCompactionTimelinePanel(host) {
  const box = host.querySelector('.tl');
  const samples = []; // { t, tokens, step }
  const events = [];  // { t, step, from, to }
  let clock = 0;
  let lastTokens = null;

  function build() {
    box.innerHTML =
      '<div class="tl-top">' +
      '<div class="tl-big"><b class="tl-count">0</b><span class="tl-unit">次压缩</span></div>' +
      '<div class="tl-side"><span class="tl-step">步 0</span><span class="tl-last">最近 —</span></div>' +
      '</div>' +
      '<svg class="tl-chart" viewBox="0 0 100 30" preserveAspectRatio="none">' +
      '<path class="tl-area" d=""></path>' +
      '<polyline class="tl-line" points=""></polyline>' +
      '<g class="tl-marks"></g>' +
      '</svg>' +
      '<div class="tl-cap">上下文随步演进 · 跌落即压缩</div>';
  }

  function renderChart() {
    const line = box.querySelector('.tl-line');
    const area = box.querySelector('.tl-area');
    const marks = box.querySelector('.tl-marks');
    const n = samples.length;
    if (n < 2) {
      line.setAttribute('points', '');
      area.setAttribute('d', '');
      marks.innerHTML = '';
      return;
    }
    const vals = samples.map((s) => s.tokens);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (max - min < 1) { min -= 1; max += 1; }
    const pts = [], ys = [];
    for (let i = 0; i < n; i++) {
      const y = 26 - ((samples[i].tokens - min) / (max - min)) * 24;
      pts.push(`${((i / (n - 1)) * 100).toFixed(2)},${y.toFixed(2)}`);
      ys.push(y);
    }
    line.setAttribute('points', pts.join(' '));
    area.setAttribute('d', 'M0,30 L' + pts.join(' L') + ' L100,30 Z');

    // event markers: a pink tick at each drop, placed on the curve
    const t0 = samples[0].t, t1 = samples[n - 1].t;
    const span = Math.max(0.001, t1 - t0);
    marks.innerHTML = events.map((e) => {
      const x = Math.max(0, Math.min(100, ((e.t - t0) / span) * 100));
      let y = 26;
      for (let i = 0; i < n; i++) { if (samples[i].t >= e.t - 1e-9) { y = ys[i]; break; } }
      return `<line x1="${x.toFixed(2)}" y1="${(y - 3).toFixed(2)}" x2="${x.toFixed(2)}" y2="${(y + 3).toFixed(2)}" />` +
        `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.1" />`;
    }).join('');
  }

  build();

  return {
    update(s, dt) {
      if (!box) return;
      const link = s && s.link;
      const d = Number.isFinite(dt) && dt > 0 ? dt : 0.016;
      clock += d;

      const tokens = link ? (link.contextTokens || 0) : 0;
      const limit = link ? (link.contextLimit || 0) : 0;
      const step = link ? (link.step || 0) : 0;

      // sample only when the level moves (the link ticks ~4×/s, not 60)
      if (lastTokens === null || tokens !== lastTokens) {
        const prev = samples.length ? samples[samples.length - 1] : null;
        if (prev && tokens < prev.tokens - Math.max(1, limit * TL_DROP)) {
          events.push({ t: clock, step, from: prev.tokens, to: tokens });
          if (events.length > TL_MAX_EVENTS) events.shift();
        }
        samples.push({ t: clock, tokens, step });
        lastTokens = tokens;
        while (samples.length > TL_MAX) samples.shift();
        while (samples.length > 2 && clock - samples[0].t > TL_WINDOW) samples.shift();
      }

      box.querySelector('.tl-count').textContent = String(events.length);
      box.querySelector('.tl-step').textContent = '步 ' + step;
      const last = events.length ? events[events.length - 1] : null;
      box.querySelector('.tl-last').textContent = last ? '最近 步 ' + last.step : '最近 —';

      renderChart();
    },
    resize() {},
    dispose() {}
  };
}

/* ---------------- 4. 上下文·压力 ----------------
 * The second v0.4 telemetry panel. A DOM water-level meter for context
 * occupancy: a big percentage, the headroom left before the window fills,
 * threshold ticks at the compaction marks, and a short occupancy sparkline so
 * "rising" and "falling" are visible at a glance. Reads the same link snapshot
 * the ring's rim arc uses (contextTokens / contextLimit).
 */

const CTX_THRESHOLDS = [0.5, 0.75, 0.9, 0.95];
const CTX_LABELS = ['50', '75', '90', '95'];
const CTX_COMPACT = 0.9; // assume auto-compaction fires at 90% of the window

/** Compact token formatter: 37200 → "37.2K", 800 → "800". */
function fmtK(n) {
  const v = Math.max(0, Math.round(n || 0));
  if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(v);
}

/** Occupancy → status colour: calm teal, busy pink, critical white. */
function ctxLevelColor(level) {
  if (level >= 0.85) return '#f4f5f7';
  if (level >= 0.6) return '#f0a6c6';
  return '#98e0cf';
}

export function createContextPressurePanel(host) {
  const box = host.querySelector('.ctx');
  const MAX_SAMPLES = 48;
  const samples = [];
  let lastSample = -1;

  function build() {
    const ticks = CTX_THRESHOLDS.map((t) =>
      `<span class="ctx-tick" style="left:${(t * 100).toFixed(1)}%"></span>`).join('');
    const labels = CTX_THRESHOLDS.map((t, i) =>
      `<span style="left:${(t * 100).toFixed(1)}%">${CTX_LABELS[i]}</span>`).join('');
    box.innerHTML =
      '<div class="ctx-top">' +
      '<div class="ctx-big"><b class="ctx-pct">0%</b></div>' +
      '<div class="ctx-side"><span class="ctx-rem">剩余 —</span><span class="ctx-lim">—</span></div>' +
      '</div>' +
      '<div class="ctx-bar"><i class="ctx-fill" style="width:0%;background:#98e0cf"></i>' + ticks + '</div>' +
      '<div class="ctx-scale">' + labels + '</div>' +
      '<svg class="ctx-spark" viewBox="0 0 100 28" preserveAspectRatio="none">' +
      '<path class="ctx-area" d=""></path>' +
      '<polyline class="ctx-line" points=""></polyline>' +
      '</svg>';
  }

  function renderSpark(color) {
    const line = box.querySelector('.ctx-line');
    const area = box.querySelector('.ctx-area');
    const n = samples.length;
    if (n < 2) { line.setAttribute('points', ''); area.setAttribute('d', ''); return; }
    const pts = samples.map((v, i) =>
      `${((i / (n - 1)) * 100).toFixed(2)},${(26 - v * 24).toFixed(2)}`);
    line.setAttribute('points', pts.join(' '));
    line.style.stroke = color;
    area.setAttribute('d', 'M0,28 L' + pts.join(' L') + ' L100,28 Z');
    area.style.fill = color;
  }

  build();

  return {
    update(s) {
      if (!box) return;
      const link = s && s.link;
      const tokens = link ? (link.contextTokens || 0) : 0;
      const limit = link ? (link.contextLimit || 0) : 0;
      const level = limit > 0 ? Math.max(0, Math.min(1, tokens / limit)) : 0;
      const color = ctxLevelColor(level);
      const pct = level * 100;

      const pctEl = box.querySelector('.ctx-pct');
      pctEl.textContent = pct.toFixed(1) + '%';
      pctEl.style.color = color;

      box.querySelector('.ctx-rem').textContent = '剩余 ' + (limit > 0 ? fmtK(limit - tokens) : '—');
      box.querySelector('.ctx-lim').textContent = limit > 0
        ? (level >= CTX_COMPACT ? '已达压缩阈值' : '距压缩 ' + fmtK(limit * CTX_COMPACT - tokens))
        : '—';

      const fill = box.querySelector('.ctx-fill');
      fill.style.width = (level * 100).toFixed(1) + '%';
      fill.style.background = color;

      // sample only when the level visibly moves, so the sparkline tracks the
      // data tick instead of being redrawn 60×/s with the same value
      if (lastSample < 0 || Math.abs(level - lastSample) > 0.003) {
        lastSample = level;
        samples.push(level);
        if (samples.length > MAX_SAMPLES) samples.shift();
      }
      renderSpark(color);
    },
    resize() {},
    dispose() {}
  };
}

/* ---------------- 5. 来源 / 提取路由 ---------------- */

export function createRoutesPanel(host) {
  const box = host.querySelector('.routes');
  const COLS = ['提取', '附加', '检视'];
  const ROUTES = ['上下文', '工具定义', '系统提示', '历史消息', '检索结果', '附件'];
  let state = ROUTES.map(() => Math.floor(Math.random() * 4));

  function render() {
    let h = '<span class="h">通道</span><span class="h">提取</span><span class="h">代码</span><span class="h">校验</span>';
    ROUTES.forEach((n, i) => {
      h += `<span class="nm">${n}</span>`;
      COLS.forEach((c, j) => {
        const st = state[i];
        const cls = j < st ? 'done' : j === st ? 'on' : '';
        h += `<span><span class="chip ${cls}">${c}</span></span>`;
      });
    });
    box.innerHTML = h;
  }

  return {
    update(s) {
      if (!s || !s.link) return;
      const tools = s.link.tools || [];
      if (tools.length) {
        // a tool landing moves its route forward
        const name = tools[tools.length - 1].name || '';
        const i = ROUTES.indexOf(name);
        if (i >= 0) state[i] = (state[i] + 1) % 4;
      }
      render();
    },
    dispose() {}
  };
}

/* ---------------- 6. 工具·健康（DOM 原型） ----------------
 * A DOM-rendered panel, the first of the v0.4 telemetry set. It borrows the
 * structural techniques from dsh-context (SVG donut via stroke-dasharray, a
 * percentage stacked bar, horizontal tool rows) but uses HALOFLUX's own palette
 * and type scale. No charting library — plain DOM + CSS.
 *
 *   ⏳ bash(npm run build) · 12s     ← live command row (main agent only)
 *   ┌ donut ┐  ┌ stacked bar ┐      ← cache hit / token composition
 *   │ read  ████████ ✓              ← tool health rows
 */

const TH_COLORS = { cache: '#98e0cf', input: '#f0a6c6', output: '#cfd2d8' };
const TH_STATE = { ok: '#98e0cf', error: '#f0a6c6', running: '#f4f5f7' };

export function createToolHealthPanel(host) {
  const box = host.querySelector('.tools');
  const MAX_TOOLS = 4;

  // command row state
  let cmdText = '';
  let cmdState = null; // 'running' | 'done'
  let cmdStart = 0;
  let cmdDur = 0;

  // tool stats, tracked from the feed (main-session tool calls only)
  const toolStats = new Map(); // name -> { count, failed }

  function toolNameOf(text) {
    const i = text.indexOf('(');
    return i > 0 ? text.slice(0, i) : text;
  }

  function build() {
    box.innerHTML =
      '<div class="th">' +
      '<div class="cmd"><span class="g">⏳</span><span class="tx"></span><span class="du"></span></div>' +
      '<div class="mid">' +
      '<div class="dn"><svg viewBox="0 0 42 42" class="dn-svg">' +
      '<circle class="dn-t" cx="21" cy="21" r="15.9155"></circle>' +
      '<circle class="dn-s" cx="21" cy="21" r="15.9155"></circle></svg>' +
      '<div class="dn-c"><b class="dn-pct">0%</b><span>缓存</span></div></div>' +
      '<div class="st"><div class="st-bar"></div><div class="st-leg"></div></div>' +
      '</div>' +
      '<div class="trows"></div>' +
      '</div>';
  }

  function renderCmd(s) {
    const el = box.querySelector('.cmd');
    const g = el.querySelector('.g');
    const tx = el.querySelector('.tx');
    const du = el.querySelector('.du');
    // find the last tool_call feed line (has an argument list)
    const feed = (s && s.link && s.link.feed) || [];
    let found = '';
    for (let i = feed.length - 1; i >= 0; i--) {
      const f = feed[i];
      if (f && f.kind === 'tool' && f.text && f.text.indexOf('(') > 0) { found = f.text; break; }
    }
    const anyRunning = (s && s.link && s.link.tools || []).some((t) => t.state === 'running');
    const next = found || '';
    if (next !== cmdText) { cmdText = next; cmdStart = Date.now(); cmdDur = 0; }
    const state = anyRunning ? 'running' : (cmdText ? 'done' : null);
    cmdState = state;
    if (state === 'running') cmdDur = Math.max(0, Math.round((Date.now() - cmdStart) / 1000));
    g.textContent = state === 'running' ? '⏳' : (state === 'done' ? '✓' : '·');
    g.className = 'g' + (state === 'running' ? ' run' : (state === 'done' ? ' ok' : ''));
    tx.textContent = cmdText || '—';
    du.textContent = state ? cmdDur + 's' : '';
  }

  function renderDonut(s) {
    const link = s && s.link;
    const input = link ? (link.input || 0) : 0;
    const cache = link ? (link.cacheReadTokens || 0) : 0;
    const pct = input > 0 ? Math.min(100, Math.round(cache / input * 100)) : 0;
    const seg = box.querySelector('.dn-s');
    seg.setAttribute('stroke-dasharray', `${pct} ${100 - pct}`);
    seg.setAttribute('stroke-dashoffset', '25');
    seg.style.stroke = pct > 0 ? TH_COLORS.cache : 'transparent';
    const c = box.querySelector('.dn-pct');
    c.textContent = pct + '%';
  }

  function renderStack(s) {
    const link = s && s.link;
    const cache = link ? (link.cacheReadTokens || 0) : 0;
    const input = link ? (link.input || 0) : 0;
    const output = link ? (link.output || 0) : 0;
    const uncached = Math.max(0, input - cache);
    const parts = [
      { k: '缓存读', v: cache, c: TH_COLORS.cache },
      { k: '未缓存', v: uncached, c: TH_COLORS.input },
      { k: '输出', v: output, c: TH_COLORS.output }
    ];
    const total = parts.reduce((a, p) => a + p.v, 0) || 1;
    const bar = box.querySelector('.st-bar');
    const leg = box.querySelector('.st-leg');
    bar.innerHTML = parts.map((p) => p.v > 0
      ? `<i style="width:${(p.v / total * 100).toFixed(1)}%;background:${p.c}"></i>` : '').join('');
    leg.innerHTML = parts.map((p) => p.v > 0
      ? `<span><i style="background:${p.c}"></i>${p.k}</span>` : '').join('');
  }

  function renderTools() {
    const wrap = box.querySelector('.trows');
    const rows = [];
    const seen = new Set();
    for (const [name, st] of toolStats) {
      if (seen.has(name)) continue;
      seen.add(name);
      rows.push({ name, count: st.count, failed: st.failed });
    }
    rows.sort((a, b) => b.count - a.count);
    const top = rows.slice(0, MAX_TOOLS);
    const max = top.reduce((a, r) => Math.max(a, r.count), 1);
    wrap.innerHTML = top.map((r) => {
      const ok = r.failed === 0;
      const col = ok ? TH_STATE.ok : TH_STATE.error;
      const glyph = ok ? '✓' : '✕';
      return `<div class="trow"><span class="tn">${r.name}</span>` +
        `<span class="tb"><i style="width:${(r.count / max * 100).toFixed(0)}%;background:${col}"></i></span>` +
        `<span class="tg ${ok ? 'ok' : 'err'}">${glyph}</span><span class="tc">${r.count}</span></div>`;
    }).join('');
  }

  function trackTools(s) {
    const feed = (s && s.link && s.link.feed) || [];
    for (let i = 0; i < feed.length; i++) {
      const f = feed[i];
      if (!f || !f.text) continue;
      if (f.kind === 'tool' && f.text.indexOf('(') > 0) {
        const name = toolNameOf(f.text);
        const st = toolStats.get(name) || { count: 0, failed: 0 };
        st.count++;
        toolStats.set(name, st);
      } else if (f.kind === 'error' || (f.kind === 'tool' && /error|失败/.test(f.text))) {
        const name = toolNameOf(f.text);
        const st = toolStats.get(name);
        if (st) st.failed++;
      }
    }
  }

  build();

  return {
    update(s) {
      if (!s || !s.link) return;
      trackTools(s);
      renderCmd(s);
      renderDonut(s);
      renderStack(s);
      renderTools();
    },
    resize() {},
    dispose() {}
  };
}

/* ---------------- 7. 智能体 / 调度 ---------------- */

const ROLES = ['读取', '构建', '审阅', '质检'];
const ROLE_COL = { 读取: '#98e0cf', 构建: '#f0a6c6', 审阅: '#d7dae0', 质检: '#f0a6c6' };

export function createAgentsPanel(host) {
  const box = host.querySelector('.agents');
  const rows = [];
  for (let i = 0; i < 12; i++) {
    rows.push({
      id: String(i + 1).padStart(2, '0'),
      role: ROLES[i % 4],
      p: Math.random() * 8,
      sp: 0.6 + Math.random() * 1.4,
      st: 'idle'
    });
  }

  function render() {
    box.innerHTML = rows.map((a) =>
      `<div class="ag"><span class="id">${a.id}</span><span class="rl">${a.role}</span>` +
      `<span class="cells">${'<i></i>'.repeat(6)}</span><span class="st"></span></div>`
    ).join('');
  }

  render();
  const rowEls = [...box.children];

  return {
    update(s, dt) {
      const d = dt || 0.016;
      for (let i = 0; i < rows.length; i++) {
        const a = rows[i];
        // tools from the session feed the "busy" agents; idle ones drift
        const tools = s && s.link ? s.link.tools || [] : [];
        const busy = tools.length > 0 && i < Math.min(rows.length, tools.length);
        a.p += a.sp * d * (busy ? 3 : 0.5);
        if (a.p > 9) { a.p = 0; a.sp = 0.6 + Math.random() * 1.4; }
        const done = Math.floor(a.p);
        const cells = rowEls[i].children[2].children;
        for (let k = 0; k < 6; k++) {
          cells[k].style.background = k < done ? ROLE_COL[a.role] : k === done ? '#5a5e66' : '#1d1f24';
        }
        const st = a.p < 0.6 ? '调度' : a.p > 6 ? '空闲' : '工作中';
        const se = rowEls[i].children[3];
        if (se.textContent !== st) {
          se.textContent = st;
          se.className = 'st' + (st === '工作中' ? ' w' : '');
        }
      }
    },
    dispose() {}
  };
}

/* ---------------- 8. 方法 / 参考索引 ---------------- */

export function createIndexPanel(host) {
  const IDX = Array.from({ length: 11 }, () => Array.from({ length: 28 }, () => Math.random()));

  function draw(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.font = '600 6.5px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    const lx = 24;
    const rx = 34;
    const rows = 11;
    const cols = 28;
    const cw = (w - lx - rx) / cols;
    const ch = h / rows;
    const scan = Math.floor((Date.now() * 0.001 * 6) % cols);

    for (let j = 0; j < rows; j++) {
      ctx.fillStyle = '#6b6f78';
      ctx.fillText('M' + String(j + 1).padStart(2, '0'), 0, j * ch + ch / 2);
      let match = 0;
      for (let i = 0; i < cols; i++) {
        const v = IDX[j][i];
        ctx.fillStyle = v > 0.86 ? '#f0a6c6' : v > 0.7 ? 'rgba(240,166,198,.45)' : v > 0.4 ? '#4a4e56' : '#1c1e23';
        if (i === scan) ctx.fillStyle = v > 0.4 ? '#ffffff' : '#3a3e46';
        ctx.fillRect(lx + i * cw, j * ch + 1, cw - 1, ch - 2);
        if (v > 0.7) match++;
      }
      ctx.fillStyle = match > 7 ? '#f0a6c6' : '#9a9ea7';
      ctx.fillText(match > 7 ? '复核' : '匹配', w - rx + 4, j * ch + ch / 2);
    }
  }

  return {
    update(s) {
      if (Math.random() < 0.3) {
        const r = Math.floor(Math.random() * 11);
        const c = Math.floor(Math.random() * 28);
        IDX[r][c] = Math.random();
      }
      const c = canvasFor(host);
      if (c) draw(c.ctx, c.w, c.h);
    },
    resize() {},
    dispose() {}
  };
}

/** Panel registry: key → { title, cap, create }. */
export const PANELS = [
  { key: 'feed', title: '调查流', cap: '实时事件', create: createFeedPanel },
  { key: 'spd', title: '上下文·速度', cap: '增长速率 · 预计满载', create: createContextSpeedPanel },
  { key: 'tl', title: '压缩·时间线', cap: '上下文随步演进', create: createCompactionTimelinePanel },
  { key: 'ctx', title: '上下文·压力', cap: '占用水位 · 距压缩', create: createContextPressurePanel },
  { key: 'routes', title: '来源 / 提取路由', cap: '通道 → 可运行源码', create: createRoutesPanel },
  { key: 'tools', title: '工具·健康', cap: '命令 · 缓存 · 工具', create: createToolHealthPanel },
  { key: 'agents', title: '智能体 / 调度', cap: '独立作业 · 共享事件总线', create: createAgentsPanel },
  { key: 'idx', title: '方法 / 参考索引', cap: '11 方法 · 28 参考', create: createIndexPanel }
];
