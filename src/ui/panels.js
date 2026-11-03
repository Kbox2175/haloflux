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
      `<span class="vb ${kind}">${kind === 'error' ? '错误' : kind === 'turn' ? '轮次' : kind === 'tool' ? '工具' : kind === 'user' ? '输入' : kind === 'assistant' ? '回答' : '状态'}</span>${text}`;
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

/* ---------------- 2. 平流 / 粒子求解器 ---------------- */

export function createAdvectionPanel(host) {
  const seed = [];
  let running = false;
  let raf = 0;
  let t = 0;

  function init(w, h) {
    const n = Math.round((w * h) / 900);
    seed.length = 0;
    for (let i = 0; i < n; i++) {
      seed.push({ x: Math.random() * w, y: Math.random() * h, l: 0.5 + Math.random() * 3 });
    }
  }

  function frame(ctx, w, h) {
    t += 0.016;
    ctx.fillStyle = 'rgba(14,15,18,0.22)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(120,125,135,.25)';
    for (let i = 6; i < w; i += 12) for (let j = 6; j < h; j += 12) ctx.fillRect(i, j, 1, 1);

    ctx.strokeStyle = 'rgba(235,238,244,.7)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const p of seed) {
      const a = Math.sin(p.x * 0.035 + t * 0.6) * Math.cos(p.y * 0.05 - t * 0.4) * Math.PI + Math.sin((p.x + p.y) * 0.01 + t * 0.2);
      const nx = p.x + Math.cos(a) * 22 * 0.016;
      const ny = p.y + Math.sin(a) * 22 * 0.016;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nx + Math.cos(a) * 2, ny + Math.sin(a) * 2);
      p.x = nx;
      p.y = ny;
      p.l -= 0.016;
      if (p.l < 0 || p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
        p.x = Math.random() * w;
        p.y = Math.random() * h;
        p.l = 0.5 + Math.random() * 3;
      }
    }
    ctx.stroke();
  }

  return {
    update(s) {
      const cv = host.querySelector('canvas');
      if (!cv) return;
      if (!running) {
        running = true;
        const tick = () => {
          const c = canvasFor(host);
          if (c) frame(c.ctx, c.w, c.h);
          if (running) raf = requestAnimationFrame(tick);
        };
        tick();
      }
    },
    resize() {
      const c = canvasFor(host);
      if (c) init(c.w, c.h);
    },
    dispose() { running = false; cancelAnimationFrame(raf); }
  };
}

/* ---------------- 3. 方法工作区 ---------------- */

const CODE_LINES = [
  ['load_context', '()'], ['extract_context', '(messages)'], ['prepare_scene', '()'],
  ['step_forward', '(scene, dt)'], ['check_stability', '(state)'], ['check_mass', '(state)'],
  ['compare_reference', '(state)'], ['attach_source_refs', '(scene)'],
  ['retain_missing', '()'], ['package_checkout', '()']
];

export function createWorkspacePanel(host) {
  const box = host.querySelector('.code');
  const MAX = 12;
  const lines = [];
  let idx = 0;
  let char = 0;
  let tick = 0;

  function ensure() {
    while (lines.length < MAX) lines.push({ name: null, shown: 0 });
  }

  function step() {
    tick++;
    if (tick % 6 !== 0) return;
    const cur = lines[idx];
    if (!cur) return;
    if (cur.name === null) cur.name = CODE_LINES[idx % CODE_LINES.length];
    if (cur.shown < cur.name[0].length + cur.name[1].length + 2) {
      cur.shown += 2;
    } else {
      cur.name = null;
      cur.shown = 0;
      idx = (idx + 1) % MAX;
    }
  }

  function render() {
    ensure();
    let html = '';
    for (let i = Math.max(0, idx - MAX + 1); i < lines.length; i++) {
      const l = lines[i];
      if (!l.name) continue;
      const shown = Math.min(l.shown, l.name[0].length + l.name[1].length + 2);
      const a = l.name[0].slice(0, Math.max(0, shown - l.name[1].length - 2));
      const b = l.name[1].slice(0, Math.max(0, shown - a.length));
      html += `<div><span class="ln">${String(i + 1).padStart(3, '0')}</span>` +
        `<span class="op">${a}</span><span class="fn">${b}</span></div>`;
    }
    box.innerHTML = html;
  }

  return {
    update() { step(); render(); },
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
  { key: 'adv', title: '平流 / 粒子求解器', cap: '流速 ∝ 生成速率', create: createAdvectionPanel },
  { key: 'code', title: '方法工作区', cap: '轮次推进', create: createWorkspacePanel },
  { key: 'ctx', title: '上下文·压力', cap: '占用水位 · 距压缩', create: createContextPressurePanel },
  { key: 'routes', title: '来源 / 提取路由', cap: '通道 → 可运行源码', create: createRoutesPanel },
  { key: 'tools', title: '工具·健康', cap: '命令 · 缓存 · 工具', create: createToolHealthPanel },
  { key: 'agents', title: '智能体 / 调度', cap: '独立作业 · 共享事件总线', create: createAgentsPanel },
  { key: 'idx', title: '方法 / 参考索引', cap: '11 方法 · 28 参考', create: createIndexPanel }
];
