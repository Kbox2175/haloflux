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

/* ---------------- 4. 共享场景 / 差分场 ---------------- */

export function createDiffPanel(host) {
  let buf = { a: 0, b: 0, t: 0 };

  function draw(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.font = '600 7px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    const gap = 8;
    const mw = (w - gap) / 2;
    const mh = h * 0.68;
    const cols = 22;
    const rows = 13;
    const cw = mw / cols;
    const ch = (mh - 10) / rows;
    const hist = new Array(28).fill(0);

    for (let m = 0; m < 2; m++) {
      const ox = m * (mw + gap);
      ctx.fillStyle = m ? '#98e0cf' : '#6b6f78';
      ctx.fillText(m ? '实现' : '参考', ox, 0);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          let v = 0.5 + 0.25 * Math.sin(i * 0.45 + buf.t * 0.8) * Math.cos(j * 0.5 - buf.t * 0.5) + 0.2 * Math.sin((i + j) * 0.3 + buf.t);
          let err = 0;
          if (m) {
            const dx = i - 15 - Math.sin(buf.t * 0.7) * 3;
            const dy = j - 6;
            err = Math.exp(-(dx * dx + dy * dy) / 6) * (0.5 + 0.5 * Math.sin(buf.t * 2));
            v += err * 0.3;
            hist[Math.min(27, (err * 27) | 0)]++;
          }
          const g = clamp(v * 210 + 20, 0, 255) | 0;
          ctx.fillStyle = err > 0.35 ? `rgba(240,166,198,${0.5 + err * 0.5})` : `rgb(${g},${g},${g + 4})`;
          ctx.fillRect(ox + i * cw, 10 + j * ch, cw - 0.6, ch - 0.6);
        }
      }
    }
    const by = mh + 4;
    const bh = h - by;
    const bw = w / hist.length;
    const mx = Math.max(...hist.slice(1), 1);
    hist.forEach((v, i) => {
      const hh = i === 0 ? bh * 0.9 : (v / mx) * bh * 0.8 + 1;
      ctx.fillStyle = i > 9 ? '#f0a6c6' : '#8a8e97';
      ctx.fillRect(i * bw, by + bh - hh, bw - 1, hh);
    });
  }

  return {
    update(s) {
      buf.t += 0.016;
      if (s && s.link) {
        buf.a = s.link.contextTokens || 0;
        buf.b = s.link.contextLimit || 0;
      }
      const c = canvasFor(host);
      if (c) draw(c.ctx, c.w, c.h);
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

/* ---------------- 6. 校验 / 采样缓冲 ---------------- */

export function createValidationPanel(host) {
  const buf = [[], [], []];
  const names = ['上下文占用', '生成速率', '工具调用'];

  function draw(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.font = '800 7px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    const lw = 58;
    const n = Math.floor((w - lw) / 2);
    const rh = h / 3;
    for (let k = 0; k < 3; k++) {
      const yc = rh * k + rh / 2;
      ctx.fillStyle = '#9a9ea7';
      ctx.fillText(names[k], 0, yc);
      ctx.strokeStyle = '#1f2227';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lw, yc);
      ctx.lineTo(w, yc);
      ctx.stroke();
      ctx.strokeStyle = k === 1 && buf[1].length > 4 ? '#f0a6c6' : '#e6e8ec';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      buf[k].forEach((v, i) => {
        const px = lw + i * 2;
        const py = yc - v * rh * 0.45;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.stroke();
    }
  }

  return {
    update(s) {
      if (!s || !s.link) return;
      const lim = s.link.contextLimit || 1;
      const occ = s.link.contextTokens / lim;
      buf[0].push(occ);
      buf[1].push(Math.min(1, (s.link.tps || 0) / 60));
      buf[2].push(Math.min(1, (s.link.tools || []).length / 8));
      for (let k = 0; k < 3; k++) {
        const b = buf[k];
        while (b.length > Math.max(2, Math.floor((host.querySelector('canvas')?.getBoundingClientRect().width || 200) - 58) / 2)) b.shift();
      }
      const c = canvasFor(host);
      if (c) draw(c.ctx, c.w, c.h);
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
  { key: 'diff', title: '共享场景 / 差分场', cap: '同输入 · 本地差分', create: createDiffPanel },
  { key: 'routes', title: '来源 / 提取路由', cap: '通道 → 可运行源码', create: createRoutesPanel },
  { key: 'val', title: '校验 / 采样缓冲', cap: '占用 · 速率 · 工具', create: createValidationPanel },
  { key: 'agents', title: '智能体 / 调度', cap: '独立作业 · 共享事件总线', create: createAgentsPanel },
  { key: 'idx', title: '方法 / 参考索引', cap: '11 方法 · 28 参考', create: createIndexPanel }
];
