# HALOFLUX

> RYDER CODE / Ms MAIKEBAIs CAT

**English** | [中文](#中文说明)

A full-screen, beat-driven sci-fi data visualization — a woven light-field core, a rotating ring of micro data panels, and layered beams bursting outward. Pure native Canvas, single HTML file, zero dependencies.

> **Noncommercial use only. Any commercial use is strictly prohibited.** Free for personal study, hobby projects and private entertainment. See [License](#license).

![preview](preview.png)

## Development status

> The single-file demo is being refactored into a reusable engine that reads live
> agent-context telemetry. This section tracks progress only; the roadmap lives
> in [PLAN.md](PLAN.md).

- [x] Repo trimmed to the files this refactor needs (demo images kept)
- [x] Engine module: lifecycle, sizing, 4 quality tiers, seeded RNG, uneven beat clock
- [x] Inner woven web + runner trails
- [x] Ring band: 12 pre-rendered panel types, rulers, glowing rims, beat-driven rotation (panels are static per slot and only rotate with the band)
- [x] Rotation rule: every ≥0.5s the busiest ring panel (largest accumulated traffic) is rotated to the horizontal axis; ambient spins stop once one is aimed, and the winner is damped so a quiet channel stops holding the aim
- [x] Outer beam strata (5 layers), haze bands, root flares, fly-out streaks — random by default; `dataDriven=1` (or any `pushImpulse({slot})`) makes beams respond to that ring panel instead
- [x] Activity state machine (void / idle / run) with attack / release envelope
- [x] Canvas pool for ring panels
- [x] Data link: session event adapter (`src/data/live.js`) + link layer (`src/data/link.js`) + channel map (`src/data/channels.js`), ported from the upstream `dsh-haloflux` live adapter
- [x] Ring panels, HUD and dev hint localised to Chinese (panel fonts bumped so CJK is legible at the micro-panel scale)
- [x] Live adapter invariants verified: display tokens counted only from transient `text-delta`, no double-count on settlement, `prepend` ignored, `replace` rescanned quietly, projections read defensively
- [x] `createHaloflux({ source })` attaches a data source; `?data=none` disables it; a simulated source (`src/data/simulate.js`) drives the harness standalone
- [x] Page shell (`src/ui/shell.js`): header KPIs (轮次 / 步 / 生成速率 / 上下文占用 / 工具) + the eight panels, all driven by the same link snapshot the ring reads
- [x] Eight panels use real data: 调查流 (feed), 平流/粒子求解器 (tps-driven flow), 方法工作区 (turn/step), 共享场景/差分场 (context), 来源/提取路由 (tools), 校验/采样缓冲 (sparklines), 智能体/调度 (agents), 方法/参考索引 (matrix)
- [x] `P` key toggles the panel row; `F` toggles fullscreen
- [x] Panels overlay the stage instead of taking grid rows — the canvas is always full-viewport, so the ring keeps the same geometry whether the panels are open or closed. The panels are opaque DOM overlays above the canvas, so the ring simply renders underneath their band (no canvas clipping — an earlier clip(panel-band) was reversed and erased the ring centre)
- [x] ResizeObserver now watches the canvas itself (it used to watch the parent captured at creation, which missed the move into the stage and caused the stretched ring)
- [x] `resize()` short-circuits when width/height/dpr are unchanged, so full-screen transitions and ResizeObserver storms no longer rebuild the web (2600 curves), the ring panels and the outer strands on every tick
- [x] Full-screen geometry freeze (preview): entering full-screen locks the ring's reference size to the last window size, so the canvas stretches and the beams extend (`RMAX` follows the live viewport) without re-running the web/ring builds — the ring keeps its exact on-screen size. `ring.build` now skips when R/RO are unchanged. The wallpaper build keeps ref == live (it never leaves full-screen)
- [ ] Next planned panels (discussed, not started): §4.2 of `PLAN.md` lists 8 telemetry panels (agent health, context pressure/speed, compaction timeline, cost, cache hit rate, token composition, tool health); the tool-health panel will add a single live "currently executing command" row at its head, scoped to the **main agent** only. Recorded in `PLAN.md`, awaiting the full panel discussion before building
- [x] Tool-health panel built as a **DOM POC** (replaces the old validation panel): a live command row (`⏳ bash(npm run build) · 0s`, main agent only), an SVG donut for cache hit rate, a percentage stacked bar + legend for token composition, and horizontal tool-health rows. Pure DOM + CSS + SVG, zero charting library — borrows dsh-context's structural techniques (div percentages, stroke-dasharray donut) but uses HALOFLUX's own palette. `getState().link` now exposes `input`/`output`/`cacheReadTokens`/`tools`/`feed` so panels read real fields (the old `tools`/`feed` were exposed as lengths only, which broke array-based panels — fixed). POC drives on the simulated source; the field mapping is ready for a live DSH session. The other 7 telemetry panels are still to be built
- [ ] Comets (grouped light bundles) and the remaining event mappings
- [ ] Per-agent views and the mini console
- [ ] Tauri unlock overlay and opening animation

Dev harness: `npm run serve` → http://127.0.0.1:5173/

## Files

| File | Description |
|---|---|
| `lab.html` | Original single-file console edition (reference build during the refactor) |
| `src/engine/` | The refactored engine module (`createHaloflux`) |
| `dev/index.html` | Development harness for the engine |
| `audio/sw421k.mp3` | Background music (see Credits) |
| `tools/` | Dev helpers: static server, headless capture, luminance comparison |

Showcase video: https://b23.tv/mBUoC3r

Steam Workshop (Wallpaper Engine): search *HALOFLUX* — listing coming soon.

## Usage

- Just open the HTML file in Edge / Chrome / Safari.
- **Double-click** or press **F** — toggle full screen.
- Click **CONSOLE** (top-right) or press **C** — open the live tuning panel (56 parameters: beat tempo, ring speed, beam layers, glow, depth...).
- **Export / Import** settings as JSON. **Save as default** stores your tweak in the local browser.
- URL `?preset=a` / `?preset=b` switches to the built-in A (dark) / B (bright) presets.
- **Background music** is on by default. Browsers block sound until the first interaction, so the BGM button shows *CLICK / TAP TO PLAY* — any click, tap or key starts it. Toggle with the **BGM** button or **M**, set the volume with its slider (remembered per browser). On iPhone, music plays even with the silent switch on (iOS 17+).

Everyone who opens the page gets the baked-in default look ("我的默认").

## Highlights

- Uneven beat clock drives everything — nothing moves at constant speed.
- Ring rotates with stutter-stops, sprints and drifts; 12 kinds of pre-rendered micro data blocks.
- 5 stacked outer beam layers (far / mid / main / near / bounce wave), roots always attached to the ring.
- Auto camera with push-ins across 7 shots.

## Desktop wallpaper

The Wallpaper Engine edition was removed from this branch during the engine
refactor; it remains available on the upstream branch.

## Community

Projects built on HALOFLUX by the community, maintained by their own authors (noncommercial, under the same license):

- **[dsh-haloflux](https://github.com/Ke-wood/dsh-haloflux)** by [@Ke-wood](https://github.com/Ke-wood): a DeepSeek Harness (DSH) plugin that turns HALOFLUX into a live background driven by the current agent session, with a settings page.

## Credits

Music: **"Synthwave 421k"** by The Cynic Project (cynicmusic), from the *Pixelsphere* soundtrack — released under **CC0** on [OpenGameArt](https://opengameart.org/users/cynicmusic).

## License

**Copyright (c) 2026 Ryder191 (RYDER CODE / Ms MAIKEBAIs CAT). All rights reserved.**

HALOFLUX — its source code and its audiovisual design (composition, motion design, beat-driven timing, layered beam system, ring and panel graphics, color treatment, layout and overall look and feel) — is an original work protected by copyright.

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE):

- ✅ **Free for noncommercial use**: personal study, hobby projects, private entertainment, research and teaching. You may use, modify and share it.
- ❌ **Commercial use is strictly prohibited**, including use inside or on behalf of a company, integration into commercial products or services, client / paid work, selling the software or its outputs and derivatives (paid wallpapers, templates, assets, videos), and commercial advertising. No commercial licenses are offered.
- When sharing or remixing, keep the copyright notice and credit **"HALOFLUX by Ryder191 (RYDER CODE / Ms MAIKEBAIs CAT)"** with a link to this repository.

Versions published before 2026-10-26 were released under MIT; from 2026-10-26 on, this project is licensed only under the terms above. The bundled music (`audio/sw421k.mp3`) is CC0 by its author and is not covered by this license.

---

## 中文说明

一个全屏、节拍驱动的科幻数据可视化：中心是编织状的光场核心，外面是一圈由微型数据面板组成的旋转圆环，环外有多层向外迸发的光束。纯原生 Canvas，单个 HTML 文件，零依赖。

> **仅限非商业用途，严格禁止任何商业用途。** 个人学习、兴趣项目、个人娱乐可免费使用。详见[许可证](#许可证)。

### 文件

| 文件 | 说明 |
|---|---|
| `lab.html` | 桌面控制台版（16:9 全屏效果最佳） |
| `mobile.html` | 移动端兼容版（横竖屏自适应，粒子负载更轻） |
| `index.html` | 入口页：触屏设备自动打开 `mobile.html`，其他设备打开 `lab.html` |
| `audio/sw421k.mp3` | 背景音乐（见「致谢」） |
| `wallpaper/` | 动态壁纸版（Wallpaper Engine / Lively Wallpaper，见下文） |

演示视频：https://b23.tv/mBUoC3r

Steam 创意工坊（Wallpaper Engine 壁纸）：搜索 *HALOFLUX*，即将上架。

### 使用方法

- 用 Edge / Chrome / Safari 直接打开 HTML 文件即可。
- **双击**画面或按 **F** 键：切换全屏。
- 点击右上角 **CONSOLE** 或按 **C** 键：打开实时调参面板（56 个参数：节拍速度、圆环转速、光束层、辉光、景深……）。
- 设置可**导出 / 导入**为 JSON；点击**保存为默认**，会把当前调整保存在本机浏览器中。
- 在网址后加 `?preset=a` / `?preset=b`，可切换到内置的 A（暗底）/ B（亮线）预设。
- **背景音乐**默认开启。浏览器在用户首次交互前会禁止播放声音，所以 BGM 按钮会显示 *CLICK / TAP TO PLAY*，任意点击、轻触或按键即可开始播放。点击 **BGM** 按钮或按 **M** 键开关音乐，用旁边的滑块调节音量（每个浏览器会记住各自的设置）。在 iPhone 上，即使打开了静音开关也能播放音乐（iOS 17 及以上）。

所有打开页面的人看到的都是内置的默认外观（「我的默认」）。

### 亮点

- 不均匀的节拍时钟驱动一切，没有任何东西是匀速运动的。
- 圆环转动带有卡顿急停、快速冲刺和缓慢漂移；内含 12 种预渲染的微型数据块。
- 环外光束共 5 层叠加（远景 / 中景 / 主层 / 近景 / 回弹波浪），光束根部始终连着圆环。
- 自动运镜，7 个镜头间带推近效果。

### 桌面动态壁纸

`wallpaper/` 目录就是一个可以直接使用的 **Wallpaper Engine** 网页壁纸（`project.json` + `index.html`）：没有鼠标界面、离线可用，被全屏程序遮挡时画面和音乐都会自动暂停。

- **Wallpaper Engine**：在 Steam 创意工坊搜索 *HALOFLUX*（即将上架）；也可以打开壁纸编辑器 → 创建壁纸 → 把 `wallpaper/index.html` 拖进去。
- **Lively Wallpaper**（免费）：添加壁纸 → 输入网址 `https://ryder191.github.io/haloflux/wallpaper/`。
- 可调设置：视觉预设、节拍速度、圆环转速（两者默认都是舒缓的 0.6）、自动运镜开关和运镜幅度、柔光、光束辉光、扫描线、界面面板开关（关闭后只留光环）、背景音乐开关和音量。

### 致谢

音乐：The Cynic Project（cynicmusic）的 **"Synthwave 421k"**，出自 *Pixelsphere* 原声，以 **CC0** 协议发布于 [OpenGameArt](https://opengameart.org/users/cynicmusic)。

### 许可证

**Copyright (c) 2026 Ryder191（RYDER CODE / Ms MAIKEBAIs CAT），保留所有权利。**

HALOFLUX 的源代码及其视听设计（画面构图、动态设计、节拍驱动的动画节奏、多层光束系统、圆环与数据面板图形、配色处理、界面布局及整体视觉风格）均为原创作品，受著作权法保护。

按 [PolyForm Noncommercial License 1.0.0](LICENSE) 授权：

- ✅ **非商业用途免费**：个人学习、兴趣项目、个人娱乐、研究与教学，可以使用、修改和分享。
- ❌ **严格禁止任何商业用途**，包括但不限于：在公司内部或代表公司使用、集成到商业产品或服务、接单或有偿项目、出售本软件及其生成内容和衍生作品（付费壁纸、模板、素材、视频），以及商业广告推广。不提供商业授权。
- 转载或二次创作时，必须保留版权声明，并注明 **「HALOFLUX by Ryder191（RYDER CODE / Ms MAIKEBAIs CAT）」** 及本仓库链接。

2026-10-26 之前发布的版本曾以 MIT 协议发布；自 2026-10-26 起，本项目仅按上述条款授权。附带的音乐（`audio/sw421k.mp3`）由原作者以 CC0 发布，不受本协议约束。
