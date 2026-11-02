/**
 * Parameter table, presets and render-quality tiers.
 * The 56 tunables are ported verbatim from lab.html (PARAMS / BASE / PRESETS).
 * @module engine/params
 */

// [key, label, min, max, step, group, rebuild?]
export const PARAMS = [
  ['tempo', '整体节拍速度', 0.4, 2.5, 0.05, '全局'],
  ['camera', '自动运镜 (0关 1开)', 0, 1, 1, '全局'],
  ['camZoom', '运镜推近幅度', 0, 2, 0.05, '全局'],
  ['glow', '柔光层强度', 0, 1.5, 0.05, '全局'],
  ['scan', '扫描线 (0关 1开)', 0, 1, 1, '全局'],

  ['ringSpeed', '圆环转动幅度/速度', 0, 3, 0.05, '圆环'],
  ['ringPause', '圆环停顿时长', 0, 3, 0.05, '圆环'],
  ['ringWidth', '环带厚度', 0.6, 1.6, 0.02, '圆环', 'resize'],
  ['rimBright', '内外缘细线亮度', 0, 2, 0.05, '圆环'],
  ['rimWidth', '内外缘细线带宽度', 0.3, 2.5, 0.05, '圆环', 'slots'],
  ['dataFlicker', '数据块刷新/闪烁', 0, 4, 0.1, '圆环'],

  ['webBright', '底层网线亮度', 0.1, 3, 0.05, '圈内', 'web'],
  ['webPulseBase', '网线闪烁层基础亮度', 0, 1, 0.02, '圈内'],
  ['webPulseAmp', '网线闪烁层节拍亮度', 0, 1, 0.02, '圈内'],
  ['webSpin', '网线整体转速', 0, 5, 0.1, '圈内'],
  ['runnerCount', '单独亮线 数量', 0, 900, 1, '圈内'],
  ['runnerBright', '单独亮线 亮度', 0, 2, 0.05, '圈内'],
  ['runnerWidth', '单独亮线 粗细', 0.3, 3, 0.05, '圈内'],
  ['runnerSpeed', '单独亮线 速度', 0.1, 4, 0.05, '圈内'],
  ['runnerVariety', '单独亮线 速度差异', 0, 1, 0.05, '圈内'],
  ['cometPerBeat', '成组光束 每拍数量', 0, 6, 0.1, '圈内'],
  ['cometBurst', '成组光束 重拍爆发数', 0, 12, 0.5, '圈内'],
  ['cometTrickle', '成组光束 拍间零星(每秒)', 0, 6, 0.1, '圈内'],
  ['cometLines', '成组光束 每组线数', 0.3, 3, 0.05, '圈内'],
  ['cometWidth', '成组光束 宽度', 0.3, 3, 0.05, '圈内'],
  ['cometBright', '成组光束 亮度', 0.1, 2.5, 0.05, '圈内'],
  ['cometGlow', '成组光束 柔光', 0, 3, 0.05, '圈内'],
  ['cometSpeed', '成组光束 速度', 0.3, 3, 0.05, '圈内'],
  ['cometFollow', '成组光束 跟随圆环 (0/1)', 0, 1, 1, '圈内'],

  ['beamBright', '伸缩光束 亮度', 0, 2.5, 0.05, '环外'],
  ['beamLen', '伸缩光束 长度', 0.2, 1.8, 0.05, '环外'],
  ['beamWidth', '伸缩光束 线粗细', 0.3, 3, 0.05, '环外'],
  ['beamBounce', '回弹波浪层 强度', 0, 2, 0.05, '环外'],
  ['beamGlow', '伸缩光束 柔光', 0, 6, 0.1, '环外'],
  ['dashBright', '流动短线 亮度', 0, 2, 0.05, '环外'],
  ['hazeCount', '宽光带 数量', 0, 30, 1, '环外'],
  ['hazeBright', '宽光带 亮度', 0, 3, 0.05, '环外'],
  ['flyerCount', '飞出流线(单独) 数量', 0, 3, 0.05, '环外', 'flyers'],
  ['flyerBright', '飞出流线(单独) 亮度', 0, 3, 0.05, '环外'],
  ['flyerWidth', '飞出流线 粗细', 0.3, 3, 0.05, '环外'],
  ['flyerSpeed', '飞出流线 速度', 0.2, 3, 0.05, '环外'],
  ['burstRate', '飞出流线(成组) 频率', 0, 5, 0.1, '环外'],
  ['burstSize', '飞出流线(成组) 每组数量', 0.2, 3, 0.05, '环外'],
  ['burstBright', '飞出流线(成组) 亮度', 0, 2.5, 0.05, '环外'],
  ['flareRate', '根部闪光 频率', 0, 5, 0.1, '环外'],
  ['flareBright', '根部闪光 亮度', 0, 2, 0.05, '环外'],
  ['rimDensity', '内外缘细线 密度', 0.3, 3, 0.05, '圆环'],
  ['dataDriven', '光束数据驱动 (0=随机 1=响应)', 0, 1, 1, '圆环'],
  ['depthBlur', '远景虚化 (环外远层)', 0, 5, 0.1, '空间层次'],
  ['depthDim', '远景亮度', 0, 1.5, 0.05, '空间层次'],
  ['webBlur', '圈内底层虚化', 0, 4, 0.1, '空间层次', 'web'],
  ['parallax', '视差 (运镜时远近错位)', 0, 1.5, 0.05, '空间层次'],
  ['bokeh', '前景光斑 数量', 0, 80, 1, '空间层次'],
  ['bokehBright', '前景光斑 亮度', 0, 3, 0.05, '空间层次'],
  ['atmos', '空间雾气', 0, 3, 0.05, '空间层次'],
  ['ringShadow', '圆环遮挡阴影', 0, 2, 0.05, '空间层次'],
  ['vignette', '暗角', 0, 1.5, 0.05, '空间层次']
];

export const BASE = {
  tempo: 1, camera: 1, camZoom: 1, glow: 1, scan: 1,
  ringSpeed: 1, ringPause: 1, ringWidth: 1, rimBright: 1, rimWidth: 1, dataFlicker: 1,
  webBright: 1, webPulseBase: 0.15, webPulseAmp: 0.85, webSpin: 1,
  runnerCount: 336, runnerBright: 1, runnerWidth: 1, runnerSpeed: 1, runnerVariety: 1,
  cometPerBeat: 1.1, cometBurst: 4, cometTrickle: 0, cometLines: 1, cometWidth: 1, cometBright: 1, cometGlow: 1.1, cometSpeed: 1, cometFollow: 0,
  beamBright: 1, beamBounce: 1, beamLen: 1, beamWidth: 1, beamGlow: 1, dashBright: 1, hazeCount: 8, hazeBright: 1,
  flyerCount: 1, flyerBright: 1, flyerWidth: 1, flyerSpeed: 1, burstRate: 1, burstSize: 1, burstBright: 1, flareRate: 1, flareBright: 1,
  rimDensity: 1, depthBlur: 1.4, depthDim: 0.9, webBlur: 0.7, parallax: 0.6, bokeh: 16, bokehBright: 1, atmos: 1, ringShadow: 1, vignette: 0.7, dataDriven: 0
};

/** The baked-in "my default" look from the original file. */
export const BAKED_MINE = {
  tempo: 2.5, camera: 1, camZoom: 1, glow: 1.1, scan: 1, ringSpeed: 3, ringPause: 1.2, ringWidth: 1.3,
  rimBright: 1.8, rimWidth: 1.3, dataFlicker: 1, webBright: 0.9, webPulseBase: 0.1, webPulseAmp: 0.8,
  webSpin: 1, runnerCount: 788, runnerBright: 0.5, runnerWidth: 1, runnerSpeed: 0.6, runnerVariety: 0.4,
  cometPerBeat: 2.3, cometBurst: 9, cometTrickle: 1.5, cometLines: 1, cometWidth: 1, cometBright: 1,
  cometGlow: 1.1, cometSpeed: 0.8, cometFollow: 1, beamBright: 1.8, beamLen: 1.8, beamWidth: 0.7,
  beamBounce: 2, beamGlow: 3.5, dashBright: 1.9, hazeCount: 22, hazeBright: 1.5, flyerCount: 3,
  flyerBright: 3, flyerWidth: 1.4, flyerSpeed: 2.2, burstRate: 3.5, burstSize: 3, burstBright: 2.5,
  flareRate: 3.5, flareBright: 2, rimDensity: 1.2, depthBlur: 0, depthDim: 0.1, webBlur: 0, parallax: 0,
  bokeh: 0, bokehBright: 0, atmos: 0, ringShadow: 0, vignette: 0
};

export const PRESETS = {
  A: {
    ...BASE, webBright: 1.25, webPulseBase: 0.3, webPulseAmp: 0.4, runnerCount: 45, runnerVariety: 0,
    cometPerBeat: 2.5, cometBurst: 5, cometTrickle: 1.6, cometFollow: 1, cometGlow: 0.85
  },
  B: { ...BASE },
  MINE: { ...BASE, ...BAKED_MINE }
};

/**
 * Render-precision tiers. Each entry maps the previously hard-coded constants
 * (DPR cap / GS / FS / RING_SC) onto a user-selectable level.
 */
export const QUALITY = {
  low: { name: 'low', renderScale: 0.75, dprCap: 1.0, glowDown: 4, farDown: 0.35, ringSuper: 1.5, particleScale: 0.5, blur: false },
  medium: { name: 'medium', renderScale: 1.0, dprCap: 1.5, glowDown: 3, farDown: 0.5, ringSuper: 2.0, particleScale: 1.0, blur: true },
  high: { name: 'high', renderScale: 1.0, dprCap: 2.0, glowDown: 3, farDown: 0.5, ringSuper: 2.4, particleScale: 1.0, blur: true },
  ultra: { name: 'ultra', renderScale: 1.25, dprCap: 2.0, glowDown: 2, farDown: 0.6, ringSuper: 3.0, particleScale: 1.2, blur: true }
};

export function resolveQuality(name) {
  return QUALITY[String(name || 'high').toLowerCase()] || QUALITY.high;
}

/** Grouped access for a future settings panel. */
export function groups() {
  return [...new Set(PARAMS.map((p) => p[5]))];
}
