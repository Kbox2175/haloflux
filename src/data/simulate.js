/**
 * Simulated session source — the same DataSource contract as the live one, but
 * no host binding. Used by the dev harness and the smoke test so the data link
 * can be exercised without a running DSH session.
 *
 * It replays a plausible session shape: tool calls with argument payloads, a
 * streamed answer, results (some failing), context pressure that drifts with
 * the turn count, and idle gaps between turns.
 *
 * @module data/simulate
 */

const TOOLS = ['read_file', 'write_file', 'search', 'bash', 'subagent', 'edit', 'web_fetch', 'plan'];

/**
 * @param {{seed?: number, intervalMs?: number, onEvent?: Function}} [options]
 * @returns {object} a DataSource
 */
export function createSimulatedSource(options = {}) {
  const opts = options || {};
  const interval = opts.intervalMs || 1000;
  const emit = typeof opts.onEvent === 'function' ? opts.onEvent : () => {};
  const subscribers = new Set();

  const state = {
    running: false,
    activity: 0,
    tps: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    contextTokens: 4200,
    contextLimit: 65536,
    turn: 0,
    step: 0,
    model: 'deepseek-chat',
    sessionTitle: '模拟会话',
    tools: [],
    feed: [],
    tokenQueue: [],
    recentTokens: [],
    recentText: ''
  };

  let timer = null;
  let disposed = false;
  let phase = 0;
  let activeTool = null;
  let streamWords = 0;
  let streamTimer = null;
  let idleUntil = 0;

  function pushFeed(kind, text) {
    state.feed.push({ kind, text: text.slice(0, 80), t: Date.now() });
    if (state.feed.length > 60) state.feed.splice(0, state.feed.length - 60);
  }

  function fire(kind, payload) {
    emit({ kind, at: Date.now(), payload });
    for (const fn of Array.from(subscribers)) {
      try { fn({ kind, payload }); } catch { /* ignore */ }
    }
  }

  function startStream(words) {
    streamWords = words;
    let sent = 0;
    streamTimer = setInterval(() => {
      if (disposed) return;
      const take = Math.min(4, streamWords - sent);
      if (take <= 0) { clearInterval(streamTimer); streamTimer = null; return; }
      sent += take;
      const chunk = Array.from({ length: take }, () => 'word' + (sent + Math.floor(Math.random() * 99))).join(' ');
      for (const w of chunk.split(' ')) {
        state.tokenQueue.push(w);
        state.recentTokens.push(w);
        state.totalTokens++;
      }
      if (state.recentTokens.length > 64) state.recentTokens.splice(0, state.recentTokens.length - 64);
      state.recentText = state.recentTokens.slice(-40).join(' ').slice(0, 160);
      state.activity = 1;
      state.tps = 6 + Math.random() * 12;
      fire('tokens', { words: take, text: chunk });
    }, 90);
  }

  function cycle() {
    if (disposed) return;
    const now = Date.now();

    if (!state.running) {
      state.activity = Math.max(0, state.activity - 0.12);
      if (now < idleUntil) { schedule(); return; }
      state.running = true;
      state.turn++;
      state.step = 0;
      state.contextTokens = Math.min(state.contextLimit - 4000, state.contextTokens + 900);
      fire('usage', { contextTokens: state.contextTokens });
      fire('context', { tokens: state.contextTokens, limit: state.contextLimit });
      pushFeed('turn', 'turn ' + state.turn + ' started');
      schedule();
      return;
    }

    state.activity = Math.max(0.15, state.activity);
    phase++;

    if (phase % 3 === 0) {
      // a tool call -> result cycle
      const name = TOOLS[Math.floor(Math.random() * TOOLS.length)];
      const failed = Math.random() < 0.14;
      activeTool = { name, callId: 'call_' + phase + '_' + Math.floor(Math.random() * 9999), failed };
      state.tools = state.tools.filter((t) => t.state !== 'running');
      state.tools.push({ id: activeTool.callId, name, state: 'running' });
      state.step++;
      fire('tool_call', { callId: activeTool.callId, name });
      pushFeed('tool', name + '(…)');
      schedule(900);
      return;
    }

    if (activeTool) {
      const t = activeTool;
      activeTool = null;
      state.tools = state.tools.map((x) => (x.id === t.callId ? { id: x.id, name: x.name, state: t.failed ? 'error' : 'ok' } : x));
      fire('tool_result', { callId: t.callId, name: t.name, failed: t.failed });
      pushFeed(t.failed ? 'error' : 'tool', t.name + ' ' + (t.failed ? 'error' : 'ok'));
      schedule(700);
      return;
    }

    if (phase % 4 === 0) {
      // stream an answer
      const words = 18 + Math.floor(Math.random() * 40);
      state.inputTokens = Math.min(state.contextLimit - 2000, state.inputTokens + words);
      fire('user', { text: '模拟用户输入' });
      startStream(words);
      schedule(2400);
      return;
    }

    if (phase % 6 === 0) {
      // turn ends -> idle gap
      state.running = false;
      state.activity = 0;
      idleUntil = Date.now() + 2500 + Math.random() * 4000;
      pushFeed('turn', 'turn ' + state.turn + ' completed');
      schedule(1200);
      return;
    }

    schedule(500);
  }

  function schedule() {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      cycle();
    }, interval);
  }

  const dataSource = {
    start() { if (timer !== null || disposed) return; schedule(); },
    stop() { if (timer !== null) { clearTimeout(timer); timer = null; } },
    dispose() {
      disposed = true;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (streamTimer !== null) { clearInterval(streamTimer); streamTimer = null; }
      subscribers.clear();
      state.running = false;
      state.activity = 0;
    },
    getSnapshot() { return state; },
    pullTokens(max) {
      const take = Math.max(0, Math.floor(max || state.tokenQueue.length));
      return state.tokenQueue.splice(0, take);
    },
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    }
  };

  return dataSource;
}
