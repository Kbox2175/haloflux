/**
 * The link: a data source in, engine impulses / ticks out.
 *
 * Maps session activity onto the ring:
 *
 *   token stream   -> the "stream" channel (slot 0), traffic = bytes produced
 *   tool/call      -> that tool's own panel (stable slot per tool name)
 *   tool/result    -> same panel, brighter pulse (kind: 'tool_result')
 *   usage/context  -> engine tick (context pressure, turn, step, tps)
 *   running        -> engine activity envelope (idle / run)
 *
 * The rotation rule then aims the busiest panel at the horizontal axis, and
 * the beams answer from that same panel.
 *
 * @module data/link
 */
import { createLiveSource } from './live.js';

/**
 * @typedef {Object} DataSource
 * @property {() => void} start
 * @property {() => void} stop
 * @property {() => void} dispose
 * @property {() => object} getSnapshot
 * @property {(max: number) => string[]} pullTokens
 * @property {(fn: Function) => Function} subscribe
 */

/**
 * @param {DataSource} source
 * @param {object} engine  createHaloflux() result
 * @param {{channels: object, streamSlot?: number, tickMs?: number}} [config]
 * @returns {object} the link
 */
export function createLink(source, engine, config = {}) {
  const channels = config.channels;
  const streamSlot = config.streamSlot === undefined ? 0 : config.streamSlot;
  const tickMs = config.tickMs || 250;
  const tokensPerByte = config.tokensPerByte || 4;

  const link = {
    lastRunning: false,
    lastActivity: 0,
    lastTps: 0,
    lastContextTokens: 0,
    lastContextLimit: 0,
    lastTurn: 0,
    lastStep: 0,
    lastInput: 0,
    lastOutput: 0,
    lastCacheRead: 0,
    lastTools: [],
    lastFeed: [],
    lastRecentText: ''
  };

  let timer = null;
  let disposed = false;
  let lastTick = 0;
  const toolSlots = new Map();

  /** Resolve a tool name to a stable ring panel. */
  function slotForTool(name) {
    if (channels) return channels.slotOf('tool:' + (name || 'unknown'));
    return 0;
  }

  function handleEvent(evt) {
    if (!evt || disposed) return;
    const { kind, payload } = evt;
    switch (kind) {
      case 'tokens': {
        const words = (payload && payload.words) || 0;
        const bytes = Math.max(1, words * tokensPerByte);
        if (channels) channels.bump(streamSlot, bytes);
        engine.pushImpulse({ slot: streamSlot, power: Math.min(1, words / 24), bytes, kind: 'stream' });
        break;
      }
      case 'tool_call': {
        const name = (payload && payload.name) || 'unknown';
        const slot = slotForTool(name);
        toolSlots.set(name, slot);
        engine.pushImpulse({ slot, power: 0.7, kind: 'tool_call' });
        break;
      }
      case 'tool_result': {
        const name = (payload && payload.name) || 'unknown';
        const slot = toolSlots.get(name) || slotForTool(name);
        engine.pushImpulse({ slot, power: 1, kind: 'tool_result' });
        if (payload && payload.failed) {
          engine.pushImpulse({ slot: streamSlot, power: 0.4, bytes: 800, kind: 'error' });
        }
        break;
      }
      case 'user':
      case 'assistant': {
        const slot = channels ? channels.slotOf('msg') : streamSlot;
        engine.pushImpulse({ slot, power: 0.5, bytes: 500, kind });
        break;
      }
      case 'usage':
      case 'context':
        // handled by the tick below
        break;
      default:
        break;
    }
  }

  function pushTick(snap) {
    if (!snap) return;
    link.lastRunning = !!snap.running;
    link.lastActivity = snap.activity;
    link.lastTps = snap.tps;
    link.lastContextTokens = snap.contextTokens || 0;
    link.lastContextLimit = snap.contextLimit || 0;
    link.lastTurn = snap.turn || 0;
    link.lastStep = snap.step || 0;
    link.lastInput = snap.inputTokens || 0;
    link.lastOutput = snap.outputTokens || 0;
    link.lastCacheRead = snap.cacheReadTokens || 0;
    link.lastTools = snap.tools || [];
    link.lastFeed = snap.feed || [];
    link.lastRecentText = snap.recentText || '';

    engine.pushTick({
      at: Date.now(),
      running: snap.running,
      activity: snap.activity,
      tps: snap.tps,
      tokens: snap.totalTokens || 0,
      input: snap.inputTokens || 0,
      output: snap.outputTokens || 0,
      cacheReadTokens: snap.cacheReadTokens || 0,
      contextTokens: snap.contextTokens || 0,
      contextLimit: snap.contextLimit || 0,
      turn: snap.turn || 0,
      step: snap.step || 0,
      model: snap.model || '',
      sessionTitle: snap.sessionTitle || '',
      tools: (snap.tools || []).map((t) => ({ name: t.name, state: t.state })),
      feed: (snap.feed || []).slice(-10),
      recentText: snap.recentText || ''
    });
  }

  function pumpTokens(snap) {
    if (!snap) return;
    const words = source.pullTokens(12);
    if (!words || !words.length) return;
    const bytes = Math.max(1, words.length * tokensPerByte);
    if (channels) channels.bump(streamSlot, bytes);
    engine.pushImpulse({ slot: streamSlot, power: Math.min(1, words.length / 24), bytes, kind: 'stream' });
  }

  function tick() {
    if (disposed) return;
    const now = Date.now();
    if (channels) channels.decay((now - lastTick) / 1000);
    lastTick = now;

    const snap = source.getSnapshot();
    if (snap) {
      pumpTokens(snap);
      pushTick(snap);
      const mode = snap.running ? 'run' : 'idle';
      if (engine.setMode) engine.setMode(mode);
    }
  }

  const unsubscribe = source.subscribe(handleEvent);
  if (typeof source.start === 'function') {
    try { source.start(); } catch { /* ignore */ }
  }
  timer = setInterval(tick, tickMs);
  tick();

  link.start = () => {
    if (timer === null && !disposed) { timer = setInterval(tick, tickMs); tick(); }
  };
  link.stop = () => {
    if (timer !== null) { clearInterval(timer); timer = null; }
  };
  link.dispose = () => {
    if (disposed) return;
    disposed = true;
    if (timer !== null) { clearInterval(timer); timer = null; }
    try { unsubscribe(); } catch { /* ignore */ }
    try { source.dispose(); } catch { /* ignore */ }
  };
  link.tick = tick;
  link.handleEvent = handleEvent;
  Object.defineProperty(link, 'slots', { get: () => toolSlots, enumerable: true });

  return link;
}

/**
 * Build a DataSource from a DSH session binding.
 *
 * @param {{getSessionId: Function, bindingOf: Function}} host
 * @param {(evt: {kind: string, payload: object}) => void} onEvent
 * @param {{tickMs?: number}} [options]
 */
export function createLiveDataSource(host, onEvent, options = {}) {
  const live = createLiveSource({
    getSessionId: host.getSessionId,
    bindingOf: host.bindingOf,
    onEvent,
    tickMs: options.tickMs
  });
  const snapshot = () => ({
    running: !!live.running,
    activity: live.activity,
    tps: live.tps,
    totalTokens: live.totalTokens,
    inputTokens: live.inputTokens,
    outputTokens: live.outputTokens,
    cacheReadTokens: live.cacheReadTokens,
    contextTokens: live.contextTokens,
    contextLimit: live.contextLimit,
    turn: live.turn,
    step: live.step,
    model: live.model,
    sessionTitle: live.sessionTitle,
    tools: live.tools,
    feed: live.feed,
    recentText: live.recentText
  });
  return {
    start: () => { live.attach(); },
    stop: () => { live.detach(); },
    dispose: () => { live.dispose(); },
    getSnapshot: snapshot,
    pullTokens: (max) => live.pullTokens(max),
    subscribe: (fn) => live.subscribe(() => fn({})),
    live
  };
}
