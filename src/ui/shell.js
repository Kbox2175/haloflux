/**
 * The page shell: header + stage + the eight panels.
 *
 * The engine renders the canvas; the shell owns the DOM around it and drives
 * the panels from the same link snapshot the ring reads.
 *
 * Keyboard
 *   Ctrl+`  or  P  toggle the panel row
 *   F                fullscreen
 *
 * @module ui/shell
 */
import { PANELS } from './panels.js';

const STYLE = `
.halo-shell{position:relative;height:100%;background:#08090b;color:#cfd2d8;
  font-family:ui-monospace,"Cascadia Mono","SF Mono",Consolas,monospace;overflow:hidden}

/* The canvas owns the whole viewport. The header and the panel row are
   overlays on top, so toggling panels never changes the stage size — the ring
   keeps exactly the same geometry whether the panels are open or closed. */
.halo-stage{position:absolute;inset:0;overflow:hidden}
.halo-stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.halo-stage::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:repeating-linear-gradient(0deg,rgba(0,0,0,.18) 0 1px,transparent 1px 3px),
             radial-gradient(ellipse at 40% 50%,transparent 55%,rgba(0,0,0,.55) 100%)}

.halo-header{position:absolute;top:0;left:0;right:0;z-index:3;
  display:grid;grid-template-columns:minmax(240px,1.7fr) repeat(5,minmax(0,1fr));
  align-items:end;border-bottom:1px solid #25282e;padding:10px 18px 0;background:#0a0b0d}
.halo-brand h1{white-space:nowrap;margin:0;font-size:18px;font-weight:800;letter-spacing:1.5px;color:#f4f5f7}
.halo-brand p{margin:3px 0 9px;font-size:9px;color:#6b6f78;letter-spacing:1.2px}
.halo-kpi{padding:0 10px 9px;position:relative;min-width:0}
.halo-kpi .k{font-size:9px;color:#6b6f78;letter-spacing:1.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.halo-kpi .v{font-size:14px;font-weight:800;color:#f4f5f7;font-variant-numeric:tabular-nums}
.halo-kpi .v.pink{color:#f0a6c6}
.halo-kpi .v.teal{color:#98e0cf}
.halo-kpi .seg{position:absolute;left:10px;right:0;bottom:-1px;height:2px;background:#25282e}
.halo-kpi .seg i{display:block;height:100%;background:#cfd2d8;width:0;transition:width 1.2s ease}

.halo-panels{position:absolute;bottom:0;left:0;right:0;z-index:3;
  display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:8px 12px 12px;
  border-top:1px solid #25282e;background:#0a0b0d}
.halo-panels.compact{grid-template-columns:repeat(2,minmax(0,1fr))}
.p{border:1px solid #25282e;background:#0e0f12;padding:7px 10px 6px;height:clamp(118px,17vh,168px);
  display:flex;flex-direction:column;overflow:hidden;min-width:0}
.p h3{margin:0 0 5px;font-size:9px;font-weight:800;letter-spacing:1.3px;color:#f4f5f7;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.p .cap{margin-top:auto;font-size:8px;color:#6b6f78;padding-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p canvas{width:100%;flex:1;min-height:0;display:block}

.feed{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:flex-end;font-size:9px;line-height:1.4;overflow:hidden}
.feed div{white-space:nowrap;color:#6b6f78}
.feed div:last-child{color:#f4f5f7;font-weight:600}
.n{color:#3f434a;margin-right:8px}
.vb{display:inline-block;width:38px;font-weight:800}
.vb.错误{color:#f0a6c6} .vb.工具{color:#cfd2d8} .vb.回答{color:#98e0cf} .vb.输入{color:#f4f5f7}
.vb.轮次{color:#cfd2d8} .vb.压缩{color:#f0a6c6} .vb.状态{color:#6b6f78}

.btns{display:flex;gap:4px;margin-top:4px}
.btns span{flex:1;font-size:8px;border:1px solid #3a3e46;padding:1px 5px;color:#6b6f78;transition:all .3s}
.btns span.on{background:#cfd2d8;color:#000;border-color:#cfd2d8}

/* ---- 3. 压缩·时间线 (DOM, v0.4) ---- */
.tl{flex:1;min-height:0;display:flex;flex-direction:column;gap:3px;font-size:8px;color:#cfd2d8;overflow:hidden}
.tl-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.tl-big{display:flex;align-items:baseline;gap:3px}
.tl-count{font-size:17px;font-weight:800;color:#f4f5f7;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
.tl-unit{font-size:8px;color:#6b6f78}
.tl-side{display:flex;flex-direction:column;align-items:flex-end;gap:1px;font-size:7px;color:#6b6f78;font-variant-numeric:tabular-nums;white-space:nowrap}
.tl-chart{width:100%;height:30px;flex:none;display:block;opacity:.9}
.tl-line{fill:none;stroke:#98e0cf;stroke-width:1.4;vector-effect:non-scaling-stroke}
.tl-area{stroke:none;fill:rgba(152,224,207,.14)}
.tl-marks line{stroke:#f0a6c6;stroke-width:1.2;vector-effect:non-scaling-stroke}
.tl-marks circle{fill:#f0a6c6}
.tl-cap{font-size:6.5px;color:#6b6f78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.routes{display:grid;grid-template-columns:1.2fr repeat(3,1fr);gap:3px 6px;font-size:8px;align-content:start}
.routes .h{color:#6b6f78;font-weight:800;letter-spacing:1px}
.routes .nm{color:#cfd2d8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip{display:inline-block;padding:0 4px;border:1px solid #3a3e46;border-radius:2px;color:#3f434a;line-height:11px}
.chip.on{background:#d6d8dd;color:#000;border-color:#d6d8dd}
.chip.done{background:#2b2e34;color:#cfd2d8;border-color:#2b2e34}

.agents{display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;font-size:8px;align-content:start;overflow:hidden}
.ag{display:flex;align-items:center;gap:5px;white-space:nowrap}
.ag .id{color:#3f434a} .ag .rl{width:32px;color:#cfd2d8;font-weight:600}
.ag .cells{display:flex;gap:1px}
.ag .cells i{width:7px;height:7px;background:#1d1f24}
.ag .st{color:#6b6f78;overflow:hidden}
.ag .st.w{color:#f4f5f7}

/* ---- 6. 工具·健康 (DOM prototype, v0.4) ---- */
.tools{flex:1;min-height:0;display:flex;flex-direction:column;gap:4px;font-size:8px;color:#cfd2d8;overflow:hidden}
.tools .th{display:flex;flex-direction:column;gap:4px;height:100%}
.tools .cmd{display:flex;align-items:center;gap:6px;font-size:8.5px;color:#f4f5f7;white-space:nowrap;overflow:hidden}
.tools .cmd .g{width:12px;text-align:center;color:#6b6f78;flex:none}
.tools .cmd .g.run{color:#f4f5f7}
.tools .cmd .g.ok{color:#98e0cf}
.tools .cmd .tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.tools .cmd .du{color:#6b6f78;font-variant-numeric:tabular-nums;flex:none}
.tools .mid{display:flex;align-items:center;gap:10px}
.tools .dn{position:relative;width:42px;height:42px;flex:none}
.tools .dn-svg{width:42px;height:42px;transform:rotate(-90deg)}
.tools .dn-t{fill:none;stroke:#1d1f24;stroke-width:4}
.tools .dn-s{fill:none;stroke:#98e0cf;stroke-width:4;transition:stroke-dasharray .6s ease}
.tools .dn-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}
.tools .dn-c b{font-size:11px;color:#f4f5f7}
.tools .dn-c span{font-size:7px;color:#6b6f78;margin-top:1px}
.tools .st{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.tools .st-bar{display:flex;height:8px;border-radius:1px;overflow:hidden;background:#1d1f24}
.tools .st-bar i{display:block;height:100%}
.tools .st-leg{display:flex;gap:8px;font-size:7px;color:#6b6f78;white-space:nowrap;overflow:hidden}
.tools .st-leg span{display:inline-flex;align-items:center;gap:3px}
.tools .st-leg i{width:6px;height:6px;display:inline-block;border-radius:1px}
.tools .trows{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:2px}
.tools .trow{display:flex;align-items:center;gap:5px;white-space:nowrap}
.tools .tn{width:62px;color:#cfd2d8;overflow:hidden;text-overflow:ellipsis;font-size:7.5px;flex:none}
.tools .tb{flex:1;height:5px;background:#1d1f24;border-radius:1px;overflow:hidden;min-width:0}
.tools .tb i{display:block;height:100%}
.tools .tg{width:9px;text-align:center;font-size:7px;flex:none}
.tools .tg.ok{color:#98e0cf}
.tools .tg.err{color:#f0a6c6}
.tools .tc{color:#6b6f78;font-size:7px;font-variant-numeric:tabular-nums;flex:none}

/* ---- 4. 上下文·压力 (DOM, v0.4) ---- */
.ctx{flex:1;min-height:0;display:flex;flex-direction:column;gap:3px;font-size:8px;color:#cfd2d8;overflow:hidden}
.ctx-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.ctx-big b{font-size:17px;font-weight:800;color:#f4f5f7;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
.ctx-side{display:flex;flex-direction:column;align-items:flex-end;gap:1px;font-size:7px;color:#6b6f78;font-variant-numeric:tabular-nums;white-space:nowrap}
.ctx-bar{position:relative;height:9px;border-radius:1px;background:#1d1f24;flex:none}
.ctx-fill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:1px;transition:width .5s ease,background .4s ease}
.ctx-tick{position:absolute;top:-2px;width:1px;height:13px;background:#3a3e46}
.ctx-scale{position:relative;height:8px;flex:none}
.ctx-scale span{position:absolute;top:0;transform:translateX(-50%);font-size:6.5px;color:#6b6f78;font-variant-numeric:tabular-nums}
.ctx-spark{width:100%;height:28px;flex:none;display:block;opacity:.9}
.ctx-line{fill:none;stroke:#98e0cf;stroke-width:1.4;vector-effect:non-scaling-stroke}
.ctx-area{stroke:none}

/* ---- 2. 上下文·速度 (DOM, v0.4) ---- */
.spd{flex:1;min-height:0;display:flex;flex-direction:column;gap:3px;font-size:8px;color:#cfd2d8;overflow:hidden}
.spd-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.spd-big{display:flex;align-items:baseline;gap:3px}
.spd-rate{font-size:17px;font-weight:800;color:#f4f5f7;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
.spd-unit{font-size:8px;color:#6b6f78}
.spd-side{display:flex;flex-direction:column;align-items:flex-end;gap:1px;font-size:7px;color:#6b6f78;font-variant-numeric:tabular-nums;white-space:nowrap}
.spd-slope{width:100%;height:28px;flex:none;display:block;opacity:.9}
.spd-line{fill:none;stroke:#98e0cf;stroke-width:1.4;vector-effect:non-scaling-stroke}
.spd-area{stroke:none}
.spd-cap{font-size:6.5px;color:#6b6f78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

@media (max-width:1000px){
  html,body{overflow:auto} .halo-shell{height:auto}
  .halo-stage{height:62vh}
  .halo-header{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px 0}
  .halo-brand{grid-column:1/-1}
  .halo-panels{grid-template-columns:repeat(2,minmax(0,1fr))}
  .p{height:150px}
}
@media (max-width:520px){
  .halo-header{padding:10px 16px 0}
  .halo-panels{grid-template-columns:minmax(0,1fr);padding:8px 16px 16px}
}
`;

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {object} opts.engine  createHaloflux() result
 * @param {object} [opts.mount]  where to put the shell (default document.body)
 * @param {boolean} [opts.panels]  start with the panel row visible
 * @param {(visible: boolean) => void} [opts.onToggle]
 */
export function createShell(opts) {
  const o = opts || {};
  const engine = o.engine;
  const mount = o.mount || document.body;

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const shell = document.createElement('div');
  shell.className = 'halo-shell';

  const header = document.createElement('header');
  header.className = 'halo-header';

  const brand = document.createElement('div');
  brand.className = 'halo-brand';
  const h1 = document.createElement('h1');
  h1.textContent = 'HALOFLUX · 实时光环';
  const sub = document.createElement('p');
  sub.textContent = 'AGENT 会话 → 光环可视化';
  brand.appendChild(h1);
  brand.appendChild(sub);
  header.appendChild(brand);

  const KPI_DEFS = [
    { k: '轮次', key: 'turn', cls: '' },
    { k: '步', key: 'step', cls: 'pink' },
    { k: '生成速率', key: 'tps', cls: 'teal' },
    { k: '上下文占用', key: 'ctx', cls: '' },
    { k: '工具 / 状态', key: 'tools', cls: 'pink' }
  ];
  for (const def of KPI_DEFS) {
    const kpi = document.createElement('div');
    kpi.className = 'halo-kpi';
    const k = document.createElement('div');
    k.className = 'k';
    k.textContent = def.k;
    const v = document.createElement('div');
    v.className = 'v' + (def.cls ? ' ' + def.cls : '');
    v.dataset.k = def.key;
    const seg = document.createElement('div');
    seg.className = 'seg';
    const i = document.createElement('i');
    seg.appendChild(i);
    kpi.appendChild(k);
    kpi.appendChild(v);
    kpi.appendChild(seg);
    header.appendChild(kpi);
  }

  const stage = document.createElement('div');
  stage.className = 'halo-stage';
  stage.appendChild(o.canvas);

  const panelsEl = document.createElement('section');
  panelsEl.className = 'halo-panels';

  const creators = [];
  const panelEls = [];

  for (const def of PANELS) {
    const el = document.createElement('div');
    el.className = 'p';
    const h3 = document.createElement('h3');
    h3.textContent = def.title;
    const body = document.createElement('div');
    body.className = 'pbody';

    // canvas panels render into their own canvas; the rest need a container
    // with the class their renderer looks for.
    if (def.key === 'idx') {
      body.appendChild(document.createElement('canvas'));
    } else if (def.key === 'feed') {
      body.className = 'feed';
    } else if (def.key === 'tl') {
      body.className = 'tl';
    } else if (def.key === 'spd') {
      body.className = 'spd';
    } else if (def.key === 'ctx') {
      body.className = 'ctx';
    } else if (def.key === 'routes') {
      body.className = 'routes';
    } else if (def.key === 'agents') {
      body.className = 'agents';
    } else if (def.key === 'tools') {
      body.className = 'tools';
    }

    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = def.cap || '';
    el.appendChild(h3);
    el.appendChild(body);
    el.appendChild(cap);
    panelsEl.appendChild(el);
    panelEls.push(el);
    const created = def.create(el);
    creators.push({ def, el, created });
  }

  shell.appendChild(header);
  shell.appendChild(stage);
  shell.appendChild(panelsEl);
  mount.appendChild(shell);

  // The canvas has moved into the stage — re-measure so the engine does not
  // keep the dimensions it read while it was still in <body>.
  if (engine.resize) engine.resize();

  const kpis = [...header.querySelectorAll('.halo-kpi')];
  const segs = [...header.querySelectorAll('.seg i')];

  let last = performance.now();
  let visible = o.panels !== false;

  setVisible(visible);

  function setVisible(v) {
    visible = v;
    panelsEl.style.display = v ? '' : 'none';
    // the panel canvases need a real box before they can be measured; wait one
    // frame for the layout to settle, then resize them
    requestAnimationFrame(() => {
      if (v) {
        for (const { created } of creators) {
          try { created.resize && created.resize(); } catch { /* ignore */ }
        }
      }
    });
    if (o.onToggle) o.onToggle(v);
  }

  function update() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const st = engine.getState();
    const link = st.link;

    if (link) {
      const lim = link.contextLimit || 1;
      const occ = clamp01(link.contextTokens / lim);
      kpis[0].querySelector('.v').textContent = link.turn || 0;
      kpis[1].querySelector('.v').textContent = link.step || 0;
      kpis[2].querySelector('.v').textContent = `${(link.tps || 0).toFixed(1)} tok/s`;
      kpis[3].querySelector('.v').textContent = `${(occ * 100).toFixed(1)}%`;
      kpis[4].querySelector('.v').textContent = link.running ? `${link.tools.length} 运行` : `${link.tools.length} 空闲`;
      segs.forEach((s, i) => {
        const v = [link.turn || 0, link.step || 0, clamp01((link.tps || 0) / 80), occ, clamp01(link.tools.length / 12)][i];
        s.style.width = `${clamp01(v) * 100}%`;
      });
    }

    if (visible) {
      for (const { created } of creators) {
        try { created.update(st, dt); } catch { /* one broken panel must not stop the rest */ }
      }
    }
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // keyboard
  function onKey(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setVisible(!visible); }
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else shell.requestFullscreen().catch(() => {});
    }
  }
  // Full-screen geometry freeze (preview-only). When the viewport grows to fill
  // the screen we lock the ring's reference size to its last window size, so the
  // canvas stretches without re-running the expensive web/ring builds — the ring
  // keeps its exact on-screen size while the beams extend to fill the extra
  // space. Exiting restores the live reference.
  let winW = 0, winH = 0;
  function trackWindowSize() {
    if (document.fullscreenElement) return; // full-screen: keep the last window size
    const r = shell.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) { winW = Math.round(r.width); winH = Math.round(r.height); }
  }
  function onFullscreenChange() {
    if (!engine.setGeometryRef) return;
    if (document.fullscreenElement === shell) {
      // freeze at the last measured window size (the shell is already full-screen
      // by the time this fires, so the live rect is the screen, not the window)
      if (!winW) trackWindowSize();
      engine.setGeometryRef(true, winW, winH);
    } else {
      engine.setGeometryRef(false);
    }
  }
  document.addEventListener('fullscreenchange', onFullscreenChange);
  trackWindowSize();

  document.addEventListener('keydown', onKey);

  let raf = 0;
  function loop() {
    update();
    raf = requestAnimationFrame(loop);
  }
  loop();

  // resize handling for canvas panels
  let rzT = 0;
  const ro = new ResizeObserver(() => {
    clearTimeout(rzT);
    rzT = setTimeout(() => {
      trackWindowSize(); // refresh the window size used when freezing geometry
      for (const { created } of creators) {
        try { created.resize && created.resize(); } catch { /* ignore */ }
      }
    }, 120);
  });
  ro.observe(panelsEl);

  return {
    el: shell,
    panelsEl,
    setVisible,
    toggle() { setVisible(!visible); },
    get visible() { return visible; },
    update,
    dispose() {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      ro.disconnect();
      clearTimeout(rzT);
      for (const { created } of creators) {
        try { created.dispose && created.dispose(); } catch { /* ignore */ }
      }
      shell.remove();
      style.remove();
    }
  };
}
