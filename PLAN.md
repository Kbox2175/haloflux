# HALOFLUX × Agent 遥测 — 改造计划 v0.3

> 2026-11-02 · 基线：`lab.html` 1710 行 / `mobile.html` / `wallpaper/index.html`，纯 Canvas 2D、零依赖、零网络。

---

## 0. 决策记录

| # | 决策 | 结论 | 对计划的影响 |
|---|---|---|---|
| 1 | 接入形态 | **强适配 DSH web 插件** | 引擎必须模块化，不能再是内联 `<script>` + 全局变量 |
| 2 | "开机"定义 | 用户输密码进入桌面那一刻（Win+L 锁屏界面） | 已纠偏：普通应用无法绘制锁屏，改为"静态帧 + 解锁续播"，见 §6 |
| 3 | 多 agent | 每 agent 独立展示页；静默只显主 agent；可切换；迷你控制台放阶段二 | 新增"视图系统"，阶段二 +1.5 周 |
| 4 | 商用 | 无 | 许可证红线解除，但第三方依赖仍需注意 |
| 5 | 精度 | 先 1080p，渲染精度解耦为可调项 | 新增"质量档位"设计，见 §7 |
| 6 | 锁屏方案 | **已确认**：静态帧 + 解锁续播 | 静态帧改为**阶段二随视觉定稿一并录制**；帧 0 必须可独立成图 |
| 7 | 子 agent 展示 | **已确认**：改造现有 AGENTS 面板，2×3 滚动视口，共 12 张卡 | 替换"2px 小方块"方案，见 §4.3.1 |
| 8 | 桌面壳 | **已确认 Tauri** | 包体 ~5MB、复用同一份 web 引擎、Rust 直接调 Win32 会话通知 |
| 9 | 面板监测范围 | 待定稿：§4.2 的 8 监测 + 工具·健康头部「当前正在执行的命令」行 | 记录在 §4.2，全部讨论定稿后统一开工，暂不动代码 |

**两条必须提前说明的现实约束**（详见 §6）：

- **Windows 锁屏无法被普通应用替换**。Wallpaper Engine 官方文档明确：登录界面"不是设计给用户修改的"，改它等于"以不安全、不稳定的方式黑进 Windows"，一旦崩溃会**无法登录**；因此它至今只支持"把锁屏图覆盖成当前壁纸的静态快照"（[官方 FAQ](https://help.wallpaperengine.io/en/general/lockscreen.html)）。
- **DSH web 插件运行在浏览器里，画不到锁屏，也画不到桌面**。所以"开屏动画"与"插件"是两个宿主，必须拆开。

---

## 1. 目标架构：两个宿主，一个引擎

```
                    ┌─────────────────────────────┐
   DSH session log  │  dsh-haloflux (host plugin)  │
   ────────────────►│  · 折叠 projection → impulse │
                    │  · /api/haloflux/stream (SSE)│
                    └──────────┬──────────────────┘
                               │  localhost only
              ┌────────────────┼─────────────────┐
              ▼                                  ▼
   ┌────────────────────┐            ┌────────────────────────┐
   │ haloflux-web       │            │ haloflux-shell (Tauri) │
   │ DSH 客户端插件      │            │ · 桌面/闲置壁纸模式      │
   │ · 交互控制台        │            │ · 解锁叠加层（开屏）     │
   │ · 多 agent 视图     │            │ · 锁屏静态帧同步         │
   │ · 迷你控制台        │            │ · 质量档位自动/手动      │
   └─────────┬──────────┘            └───────────┬────────────┘
             │                                   │
             └──────────► 同一个引擎模块 ◄────────┘
                  createHaloflux(canvas, opts)
```

**关键结论**：因为"锁屏/解锁"必须在 OS 层，原来被我判为"可选"的**形态 B（host 插件 + SSE）重新变成必需**——不是为了投屏，而是为了让桌面壳能拿到同一份数据。

---

## 2. 阶段零（新增）：引擎模块化

**目标**：把 1710 行的内联脚本拆成可被 React 插件和 Tauri webview 同时消费的模块。

| 任务 | 产出 |
|---|---|
| 0.1 抽离引擎 | `src/engine/`：`createHaloflux(canvas, opts)` → `{ setParams, pushImpulse, pushTick, setQuality, destroy }` |
| 0.2 去全局化 | `C` 参数对象、`T` 时钟、`rnd` 全部收进闭包 |
| 0.3 帧循环外置 | 引擎不自带 rAF 的启停策略，由宿主注入 `raf`/`now`（便于测试与暂停） |
| 0.4 构建链 | `tsdown`（与 `dsh-context` 同款）+ 两份产物：`client.js`（插件）、`engine.js`（壳） |
| 0.5 回归基线 | 用当前 `lab.html` 截 10 张基准帧，改造后逐帧比对，防止"重构改坏了画面" |

**验收**：`engine.js` 在空白页里 30 行代码就能跑出与 `lab.html` 一致的静态帧；帧比对 SSIM > 0.98。

工期：1 周。**这是后面所有工作的前提，不能跳。**

---

## 3. 阶段一：数据链路（W2–W4）

**目标**：真实数据以 `impulse` + `tick` 稳定到达两个宿主，视觉不变。

### 3.1 任务

| 编号 | 任务 | 产出 |
|---|---|---|
| 1.1 | 事件契约 | `impulse`/`tick` TS 类型 + zod + `schemaVersion` |
| 1.2 | 归约适配器 | 三源 projection → 按 `seq` 差量 → 脉冲；`detailRev` 游标 |
| 1.3 | 字段白名单 | 剔除 `nodes[].text`、`argsRaw`、`lastUser`、command 原文 |
| 1.4 | host 插件 | Cordis 插件注册 `/api/haloflux/stream`（SSE + `Last-Event-ID`），仅监听 `127.0.0.1` |
| 1.5 | 客户端订阅 | `EventSource` + 断线重连 + 时钟 offset（最小 RTT/2） |
| 1.6 | 引擎接入 | `ImpulseSource`：`local` / `stream` / `replay` 三实现 |
| 1.7 | 降级 | 断流 >1s 回落本地节拍；恢复只补最后 1s |
| 1.8 | 录制/回放 | JSONL + 倍速/暂停；**阶段二的前置条件** |
| 1.9 | 自观测 | lag 直方图、丢弃计数、队列长度 HUD |

### 3.2 数据源分层

| 层 | 来源 | 提供什么 | 稳定性 |
|---|---|---|---|
| 官方骨架 | `dsh-token-meter` | `contextPressure` / `contextBreakdown` / `tokenUsage` | 🟢 |
| 血肉 | `dsh-context@0.78.0` | 8 类构成、事件、fileOps、commands、timing | 🟡 锁版本 |
| 节奏 | `dsh-client-ui-trajectory` | 逐 step 的 TTFT/解码/工具切片 | 🟢 |

### 3.3 验收

- [ ] 占用率与 `dsh-context` 误差 ≤ 1%
- [ ] 事件上屏 p95 < 300ms（本机应 < 50ms）
- [ ] 断流 1s 内降级，画面不静止
- [ ] 同一 JSONL 两次回放帧序一致
- [ ] 抓包确认零文本字段

---

## 4. 阶段二：视觉 + 多 agent 视图（W4–W8）

### 4.1 圆环语义化

| 元素 | 绑定 | 复用 |
|---|---|---|
| slot 角宽 | `SurfaceNode.tokens / contextWindow` | `buildCards().hpx` |
| slot 色调 | `cat` 六类 | `TINTS` |
| slot 块型 | 按 `cat` 选 12 种渲染器 | `pickBlock()` |
| 内缘弧长 | `pressureTokens / contextWindow` | `rimW()` |
| 外缘双线 | 压缩预留 + `maxOutputTokens` | `tick()` |
| 环旋转 | turn/step；compaction 反向急停 | `ringMove()` |

### 4.2 八面板换真数据（v0.4 提案，待全部讨论定稿后开工）

| # | 面板 | 监测内容 | 可视化 | 数据源 / 可得性 |
|---|---|---|---|---|
| 1 | 智能体·健康 | 当前 agent / 父 / 子 agent 状态 | 彩色网格（绿/琥珀/红/灰） | Task 工具近似（⚠️ 非真 Fleet） |
| 2 | 上下文·压力 | 占用 %、剩余、距自动压缩 | 水位条 + 阈值刻度 | `contextPressure` 投影，现成 |
| 3 | 上下文·速度 | 最近 N 步 tokens 增长速率、预计满载时间 | 斜率折线 | 事件流累加，可算 |
| 4 | 压缩·时间线 | 压缩 / 截断事件，上下文随步演进 | 锯齿面积图 + 事件标记 | 可算 |
| 5 | 成本·估算 | 累计成本、每步成本 | 累积面积 + 数字 | 模型单价表，可算 |
| 6 | 缓存·命中率 | cacheRead / (cacheRead + uncached) | 仪表 / 环形 | `tokenUsage` 投影，现成 |
| 7 | Token·构成 | 输入 / 输出 / 缓存读 / 缓存写 / 推理 占比 | 堆叠条 | `tokenUsage` 投影，现成 |
| 8 | 工具·健康 | 按调用数排序的工具、成功率、平均耗时 | 横条 + 红绿 | 事件流累加，可算 |

**#1 限制**：适配器只看到**主会话事件流**，子 agent 在其中表现为一次 `tool/call` + `tool/result`。宏观健康可做（有没有子 agent 在跑、有没有失败），**做不到 `dsh-context` 那种每个子 agent 独立实时卡**。要真 Fleet 需读 DSH 的 agent 投影（待验证是否有可读投影键）。

**已实现（DOM POC，2026-11-03）**：

- **工具·健康面板**已用纯 DOM 建成（替换旧的「校验/采样缓冲」栏），验证了 dsh-context 的三种可视化技巧在我们风格下的适配：
  - 命令行（`⏳ bash(npm run build) · 0s`）— 头部一行，实时刷新，只跟主 agent
  - SVG 环形图（`strokeDasharray`，缓存命中率）
  - 百分比堆叠条 + 图例（Token 构成：缓存读 / 未缓存 / 输出）
  - 横条 + 红绿（工具健康：调用次数 + ✓/✕）
- 风格完全沿用现有调色板（`#0e0f12` 底、`#25282e` 边、`#f0a6c6` 粉 / `#98e0cf` 青 / `#cfd2d8` 字），**零图表库**，纯 DOM + CSS + SVG
- 数据绑定已打通：`getState().link` 现在暴露 `input` / `output` / `cacheReadTokens` / `tools`（数组）/ `feed`（数组），面板直接读
- 顺手修了一个真 bug：`link.tools` / `link.feed` 之前只暴露长度（数字），面板当数组用会出错——改成暴露数组，KPI 改用 `.length`
- POC 阶段用模拟源（`simulate.js`）假数据验证渲染；接真实会话时字段映射已就绪

**已实现（2026-11-03）· 第 2 块：上下文·压力（§4.2 #2）**：

- 已用纯 DOM 建成，替换旧的「共享场景 / 差分场」Canvas 栏（同为上下文主题，原地换装）
- 结构：大号占用率读数（`36.6%`）+ 右侧「剩余 / 距压缩」两行 + 水位条（`50 / 75 / 90 / 95` 刻度）+ 占用率短折线
- 阈值：90% 为自动压缩线，过线后「距压缩 X」翻为「已达压缩阈值」；刻度 50/75/90/95 固定
- 色阶沿用调色板：低占用青 `#98e0cf` → 中粉 `#f0a6c6` → 高白 `#f4f5f7`
- 数据绑定：读 `getState().link.contextTokens` / `contextLimit`，与圆环内缘弧长同源
- 零图表库，纯 DOM + CSS + SVG；折线用 `vector-effect: non-scaling-stroke`，窄栏也清晰
- 折线按"占用率发生可见变化"采样（Δ>0.3%），避免 60Hz 同值重绘

**已确认 · 待实现（其余 6 栏）**：

1. **工具·健康面板的命令行**已随 POC 落地（上面第 1 条需求已实现）
2. 剩余 6 个监测面板（智能体·健康 / 上下文·速度 / 压缩·时间线 / 成本·估算 / 缓存·命中率 / Token·构成）待按上表逐一建成 DOM 面板
3. **8 监测面板范围待用户确认**：上表的 8 个监测 + 命令行，用户确认后才统一重建

> 说明：HALOFLUX 定位是常驻、可一眼扫视的迷你视图，不复刻 `dsh-context` 的多页完整仪表板（细节交给它）。数据先全部从事件流 + 投影自算，不耦合 dsh-context 内部缓存。

> 上一版八面板的英文占位名映射（供对照，将被上表替换）：INVESTIGATION FEED / ADVECTION / PARTICLE SOLVER / METHOD WORKSPACE / SHARED SCENE / DIFF FIELD / SOURCE / ROUTES / VALIDATION / SAMPLE BUFFER / 12 AGENTS / DISPATCH / METHOD / REFERENCE INDEX。

### 4.3 多 agent 视图（新增）

**视图状态**：`{ activeAgentId, mode: 'silent' | 'interactive' }`

| 模式 | 行为 |
|---|---|
| `silent`（壁纸/闲置） | 只渲染主 agent；不响应鼠标；事件降到 1/3 预算 |
| `interactive` | 可切换 active agent；切换 = 换数据源 + 换扇区映射，**不重建画布** |

**两条设计约束**：

1. **单画布，不并行渲染 N 份**。切 agent 只是换 `ImpulseSource` 的过滤条件与环带数据；否则 12 个 agent 会把显存直接打满（单张网线画布 1080p 下就 ~15MB）。
2. **切换入口有两个**：迷你控制台（主入口），以及 §4.3.1 的 agent 卡片（点一下即切）。

### 4.3.1 子 agent 面板：复用 AGENTS 模块

现有 `lab.html` 的 `12 AGENTS / DISPATCH` 面板（`.p` → `.agents`，2 列网格 + `.ag` 行）直接用，改成**固定视口的滚动列表**：

```
┌ 12 AGENTS / DISPATCH ──────────────┐
│ ┌──────────────┐ ┌──────────────┐ │  ← 2 列
│ │ 01 build ▮▮▮▯▯▯ working │ │ 02 read  ▮▮▯▯▯▯ idle   │ │
│ └──────────────┘ └──────────────┘ │
│ ┌──────────────┐ ┌──────────────┐ │  ← 3 行可见
│ │ 03 qa    ▮▮▮▮▮▯ dispatch│ │ 04 build ▮▯▯▯▯▯ working│ │
│ └──────────────┘ └──────────────┘ │
│ ┌──────────────┐ ┌──────────────┐ │
│ │ 05 read  ▮▮▮▮▯▯ working │ │ 06 qa    ▮▯▯▯▯▯ error  │ │
│ └──────────────┘ └──────────────┘ │
│         ▲ 滚动查看其余 6 个         │
└────────────────────────────────────┘
```

| 规格 | 值 |
|---|---|
| 总数 | 12（与 Fleet 的 `AGENTS` 数量一致） |
| 视口 | 2 列 × 3 行 = 6 张可见 |
| 滚动 | `overflow-y:auto` + `scroll-snap-type:y mandatory`；每次滚一行；无自动滚动 |
| 单卡内容 | `id`（01–12）、`role` 色标、6 格进度、状态文字（idle / working / dispatch / error） |
| 状态色 | idle `#1d1f24`、working 角色色、dispatch `#5a5e66`、error 粉色 |
| 交互 | 点击卡片 → 切换 active agent（仅 `interactive` 模式） |
| 静默态 | 整体降到 40% 不透明度、`pointer-events:none`，不抢注意力 |
| 表头 | 动态 `SUB-AGENTS · 3/12 ACTIVE`，不再写死"12 AGENTS" |

**为什么不做成 12 个 2px 小方块**：2×3 的卡片视口能同时给出"谁、在干什么、进度多少"，信息密度更合适；而且直接复用现有 `.ag` 的 DOM 结构与样式，改造成本接近于零。

**实现要点**：

- 复用 `agentsTick(dt)` 的推进逻辑（`a.p` 累加 → 6 格填充 → 状态文字），只把"12 行平铺"换成"12 张卡 + 滚动容器"；
- 滚动容器固定高度 = 3 行，`grid-auto-rows` 用 `calc((100% - 2*gap)/3)`，保证永远正好 3 行；
- 卡片状态与主视图的 `activeAgentId` 双向绑定：主视图切 agent 时，列表自动 `scrollIntoView` 到对应卡片；
- 在 `silent` 模式下不更新滚动位置，避免壁纸上出现"自己动"的列表。

**迷你控制台（阶段二交付）**：

- 呼出：`Ctrl + \``（与 DSH 现有快捷键不冲突），或右上角一个小圆点；
- 内容：agent 列表（含状态/上下文占用/步骤数）、视图模式切换、质量档位、跳转到该 agent 的 DSH 会话；
- 形态：从底部滑出的 40% 高度面板，失焦自动收起；
- 实现：React 组件 + 现有 `dsh-client-ui-primitives`，不新造轮子。

### 4.4 光流事件映射

| 事件 | 视觉 | 复用/新增 |
|---|---|---|
| step/start | 环微转 | `ringMove()` |
| 首 token | 网线闪、runners 窜 | `layerEnv` / `surge` |
| 解码中 | runner 速度 ∝ `speedTokens/speedMs` | `runnerSpeed` |
| tool_call | 扇区弹跳 + 根部闪光 | `wedge.kick` / `spawnFlare()` |
| tool_result | 光束打到环上 + slot 闪 | `spawnComet()` / `flashSlotAt()` |
| inject | 反向 comet（外→内） | `cpt()` 反用 |
| compaction | 环反向 + 内圈坍缩 | `ringMove(d<0)` |
| fileOps | runners 分色 | `newRunner()` |
| comms | 跨扇区弧线 | **新增 30–50 行** |

### 4.5 时延驱动节拍

`spans[]` 的 `ttft / reasoning / text / toolarg / tools / other` 六段 → `tempo` 与 `ringPause`。TTFT 长则光"憋住"，解码快则光流加速，工具段则环停转。

### 4.6 视觉预算

每 100ms 8–15 个脉冲；单 agent 每 200ms 最多 1 个锚点；>12 agent 自动降级为环形热力。

### 4.7 验收

- [ ] 连续 3 次观看能复述"刚才发生了什么"
- [ ] 灰度下 6 类构成可区分
- [ ] 12 agent 并发丢弃率 < 40%
- [ ] 切换 agent < 200ms，无白屏
- [ ] 迷你控制台键盘可达
- [ ] 子 agent 面板固定 2×3 视口，12 张卡可滚动，滚动无卡顿
- [ ] 静态帧导出：帧 0 可单独成图，且与动画首帧逐像素一致

---

## 5. 阶段三：解锁检测（W8–W9）

### 5.1 为什么必须由桌面壳做

浏览器拿不到 OS 会话事件。`visibilitychange` 只能告诉你"页面可见了"，无法区分"解锁"和"切标签页"。真正可靠的是 **WTS 会话通知**。

### 5.2 三层信号

| 层 | 信号 | 用途 |
|---|---|---|
| OS（Tauri/C#） | `WTSRegisterSessionNotification` → `WTS_SESSION_LOCK` / `WTS_SESSION_UNLOCK` / `WTS_SESSION_LOGON` | 权威的"解锁时刻" |
| 兜底 | 任务计划程序触发器 `On workstation unlock` | 壳未常驻时的启动方式 |
| Web（插件） | `pageshow` + `visibilitychange` + `performance.timeOrigin` | 插件内的"恢复"判断，非 OS 级 |

### 5.3 状态机

```
locked ──unlock──► reveal ──► idle ◄──► active
                    │
                    └─ 播放开屏（2–4s）→ 交接稳态
```

### 5.4 验收

- [ ] 解锁到开屏首帧 < 150ms（常驻进程预创建窗口）
- [ ] 连续 10 次 Win+L / 解锁，无一次漏播或卡死
- [ ] 多显示器：只在主屏播放，其余屏保持
- [ ] 壳崩溃不影响登录

---

## 6. 阶段四：开屏过渡（W9–W11）—— 含锁屏纠偏

### 6.1 技术现实

| 方案 | 可行性 | 代价 | 判断 |
|---|---|---|---|
| **L1 普通应用画锁屏** | ❌ | — | 登录界面在 Winlogon 安全桌面，普通进程无绘制权限 |
| **L2 锁屏设为静态图** | ✅ | 需管理员写注册表/CSP，或借 Wallpaper Engine 的 Override | 可做，但只有静帧 |
| **L3 自定义 Credential Provider** | ⚠️ 技术可行 | 签名 DLL + 管理员注册 + HVCI/Secure Boot 约束；崩溃会导致**无法登录** | 个人项目不建议 |
| **L4 解锁后叠加层** | ✅ | 需要常驻桌面进程 | **推荐** |

参考：Wallpaper Engine 官方明确表示锁屏"不应被修改"，只提供静态快照覆盖（[FAQ](https://help.wallpaperengine.io/en/general/lockscreen.html)）；社区确有基于 LogonUI 适配器的概念验证（[shittim-logon](https://github.com/helloyork/shittim-logon)），但仓库自述"缺资源、不可构建"，属实验性质。

### 6.2 推荐方案：跨安全桌面的"连续性错觉"

```
① 锁屏期       ② 解锁瞬间           ③ 稳态
┌─────────┐   ┌──────────────┐   ┌──────────┐
│ 静态帧 0 │ → │ 叠加层从帧 0 续播 │ → │ 淡出交接 │
│ (锁屏图) │   │ 2–4s 动画      │   │ 桌面/插件│
└─────────┘   └──────────────┘   └──────────┘
```

- **①** 把锁屏背景图设为动画第 0 帧（Wallpaper Engine 的 "Override lock screen image"，或 `PersonalizationCSP\LockScreenImageUrl`）。**帧 0 不单独制作，随阶段二的视觉定稿一起导出**，保证与动画首帧同源；
- **②** 常驻壳收到 `WTS_SESSION_UNLOCK` 立即显示预创建的全屏无边框窗口，从帧 0 接着播；
- **③** 2–4s 后淡出，交给桌面壁纸或 DSH 页面。

用户感知是"锁屏壁纸动起来了"，实际是"静帧 + 解锁后续播"。**这是唯一既安全又能达到 90% 观感的路子。**

### 6.3 空窗问题与对策

解锁到 explorer 绘制完成有 200–800ms。对策：

- 壳随登录自启并常驻托盘，**提前创建**窗口（`visible:false`, `alwaysOnTop`, `skipTaskbar`）；
- 收到 unlock 直接 `show()`，实测可压到 <150ms；
- 若仍晚到，动画从"当前时刻"起播而非从 0，避免"跳帧感"。

### 6.4 分镜

| 时间 | 画面 | 复用 |
|---|---|---|
| 0.0–0.6s | 中心光点呼吸 | `glowC` |
| 0.6–1.6s | 网线按半径生长 | `webBase` 扇形裁剪 |
| 1.6–2.4s | 圆环逐 slot 点亮 | `renderSlot` 错峰 |
| 2.4–3.0s | 首条事件触发爆发 | `spawnComet()` |
| 3.0s+ | 交接稳态 | `frame()` |

约束：≤4s、任意点击跳过、`prefers-reduced-motion` 直接稳态、数据未就绪也能演完。

### 6.5 验收

- [ ] 录屏对比分镜误差 < 0.3s
- [ ] 跳过响应 < 100ms
- [ ] 锁屏静帧与动画首帧肉眼无差（同源渲染）
- [ ] 连续 20 次锁屏/解锁无异常

---

## 7. 渲染精度解耦

现有代码里精度是**硬编码常量**：`DPR = min(devicePixelRatio, 2)`、`GS = 3`（泛光降采样）、`FS = 0.5`（景深远景）、`RING_SC = 2.4`（数据块超采样）、`d = min(DPR, 1.5)`（离屏画布）。要改成可调档位：

| 档位 | `renderScale` | DPR 上限 | 泛光降采样 | 景深降采样 | 环带超采样 | 粒子倍率 | 模糊 |
|---|---|---|---|---|---|---|---|
| 低 | 0.75 | 1.0 | 4 | 0.35 | 1.5 | 0.5× | 关 |
| 中 | 1.0 | 1.5 | 3 | 0.5 | 2.0 | 1.0× | 开 |
| 高 | 1.0 | 2.0 | 3 | 0.5 | 2.4 | 1.0× | 开 |
| 极高 | 1.25 | 2.0 | 2 | 0.6 | 3.0 | 1.2× | 开 |

**新增参数**：`quality`（四档）、`renderScale`（覆盖档位）、`autoQuality`（默认开）。

**自动策略**：启动后采样 2s 帧时，`p95 > 20ms` 降一档；稳定 10s 且 `p95 < 12ms` 且用户允许时升一档。手动设定后不再自动调整。

**落点**：`PARAMS` 增加 `质量` 组；迷你控制台给一个四档选择器；`localStorage` 记忆；URL `?quality=high` 可覆盖（方便录屏）。

---

## 8. 资源与排期

### 8.1 人力

| 角色 | 投入 | 阶段 |
|---|---|---|
| 前端/图形（Canvas、动效、React 插件） | 1 全职 | 0、2、4 |
| 后端/Node（Cordis 插件、SSE） | 0.5–1 | 1 |
| 桌面端（Tauri/Rust 或 C#） | 1 | 3、4 |
| 视觉设计 | 0.5 | 2、4 |
| QA/数据 | 0.5 | 全程 |

### 8.2 排期（11 周）

| 周 | 阶段 |
|---|---|
| W1 | 0 引擎模块化 |
| W2–W4 | 1 数据链路 |
| W4–W8 | 2 视觉 + 多 agent + 迷你控制台 + 质量档位 + 静态帧录制 |
| W8–W9 | 3 解锁检测（可与 2 并行） |
| W9–W11 | 4 开屏 + 桌面壳 |

### 8.3 数据与环境

- ≥10 份真实 session 录制（含 compaction、多 agent）；
- DSH `web` profile（`dsh-context@0.78.0`、`cc-safety-net@2.7.0` 已装）；
- Win11 测试机（含 HVCI 开启 + 关闭两种状态）、4K 屏；
- OBS（分镜比对）。

---

## 9. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 锁屏方案被误解为"能改锁屏" | 期望落空 | 明确 L1/L3 不可行，按 §6.2 交付 |
| 解锁空窗 | 观感断裂 | 常驻壳预创建窗口；晚到则从当前帧起播 |
| 桌面壳崩溃 | 用户无法登录 | **壳绝不碰 winlogon**；只用 session 通知，无钩子、无注入 |
| `dsh-context` 契约漂移 | 适配层崩 | 锁 0.78.0 + 字段兜底 + 契约测试 |
| 多 agent 显存 | 掉帧 | 单画布 + 视图切换，不并行 |
| 4K 离屏画布内存 | 崩溃 | 质量档位 + `renderScale` 上限 |
| 隐私 | 合规 | 白名单 + CI 断言 |

---

## 10. 已确认事项与下一步

| 事项 | 结论 |
|---|---|
| 锁屏方案 | 静态帧 + 解锁续播（帧 0 在阶段二导出） |
| 子 agent 面板 | 复用 AGENTS 模块，2×3 滚动视口，12 张卡 |
| 桌面壳 | Tauri |

**下一步：开工阶段零**——把 1710 行内联脚本抽成 `createHaloflux()` 模块，用 10 张基准帧做 SSIM 回归。这一步不依赖任何后端，做完即可验证"引擎能不能被插件和桌面壳同时消费"。

> 许可证：无商用计划，PolyForm Noncommercial 的约束不触发；但若将来分发，视觉设计仍受版权保护，需保留署名。
