/**
 * Host session adapter — the DSH data link.
 *
 * Ported and re-shaped from the upstream `dsh-haloflux` live adapter
 * (github.com/Ke-wood/dsh-haloflux, src/live.js) so the engine can read a real
 * agent session. Same contract, same invariants:
 *
 *   - read-only against host data; every host call is wrapped in try/catch
 *   - display tokens come ONLY from transient `assistant/live-chunk` text-delta
 *     frames (durable assistant/message text is the settlement of the same
 *     attempt and is never tokenised — anti double-count)
 *   - `prepend` (older history) is ignored; `replace` rescans replay in quiet
 *     mode so nothing is counted twice
 *   - projections are read through `session.projections.faceOf(key)` and never
 *     throw (absent projection => undefined, which we fall back from)
 *
 * Unlike the upstream file (a plain script fragment), this is ESM and publishes
 * a normalised event stream on top of the host events, so the link layer can
 * react without knowing the host's event shapes.
 *
 * @module data/live
 */

/**
 * @typedef {Object} LiveOptions
 * @property {() => string|undefined} [getSessionId]
 * @property {(id: string) => any} [bindingOf]  returns { sessionId, session, eventSource, ctx }
 * @property {(fn: Function) => Function} [onEvent]  subscribe to normalised events
 * @property {number} [tickMs]
 */

/**
 * @param {LiveOptions} [options]
 * @returns {object} the live source
 */
export function createLiveSource(options = {}) {
  const opts = options || {};
  const getSessionId = typeof opts.getSessionId === 'function' ? opts.getSessionId : () => undefined;
  const bindingOf = typeof opts.bindingOf === 'function' ? opts.bindingOf : () => undefined;

  const TICK_MS = opts.tickMs || 100;
  const BIND_EVERY = 2;
  const META_EVERY = 5;
  const RISE_MS = 120;
  const FALL_MS = 1200;
  const ACTIVE_TAIL_MS = 1500;
  const TPS_WINDOW_MS = 2000;
  const QUEUE_MAX = 512;
  const FEED_MAX = 60;
  const TOOLS_MAX = 24;
  const SCAN_MAX = 400;
  const FEED_SEED = 8;
  const NOTIFY_MS = 200;
  const ATTEMPT_MEMORY = 64;
  const RECENT_MAX = 64;
  const RECENT_TEXT_MAX = 160;
  const FEED_TEXT_MAX = 80;
  const TOOL_TEXT_MAX = 60;

  const subscribers = new Set();
  const attemptWatermark = new Map();
  let attemptDone = Infinity;
  let notifyTimer = null;
  let notifyPending = false;
  let timer = null;
  let disposed = false;
  let revision = -1;
  let binding = null;
  let eventSource = null;
  let session = null;
  let runningSet = false;
  let activityValue = 0;
  let lastAdvanceMs = now();
  let lastTokenAt = 0;
  let tokenStamps = [];
  let tokenQueue = [];
  let recentTokens = [];
  let recentParts = [];
  let recentText = '';

  const live = {
    running: false,
    get activity() { return activityValue; },
    set activity(v) {
      const n = num(v);
      if (n === undefined) return;
      activityValue = Math.max(0, Math.min(1, n));
      lastAdvanceMs = now();
    },
    tps: 0,
    usageTotal: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    contextTokens: 0,
    contextLimit: 0,
    turn: 0,
    step: 0,
    model: '',
    sessionTitle: '',
    tools: [],
    feed: [],
    tokenQueue,
    recentTokens,
    get recentText() { return recentText; },
    pullTokens: pullTokens,
    subscribe: subscribe,
    setSession: setSession,
    setRunning: setRunning,
    attach: attach,
    detach: detach,
    dispose: dispose
  };

  /* ---------------- helpers ---------------- */

  function now() { return Date.now(); }

  function num(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
    return undefined;
  }

  function arr(v) { return Array.isArray(v) ? v : []; }

  function oneLine(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  }

  function clip(v, max) {
    const s = oneLine(v);
    return s.length > max ? s.slice(0, max) : s;
  }

  function isSpace(ch) {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
  }

  function splitTokens(text) {
    const out = [];
    let start = -1;
    for (let i = 0; i < text.length; i++) {
      if (isSpace(text[i])) {
        if (start >= 0) { out.push(text.slice(start, i)); start = -1; }
      } else if (start < 0) {
        start = i;
      }
    }
    if (start >= 0) out.push(text.slice(start));
    return out;
  }

  function messageText(message) {
    if (!message) return '';
    const blocks = arr(message.content);
    if (!blocks.length) return oneLine(message.text);
    return blocks.map((b) => {
      if (typeof b === 'string') return b;
      if (b && typeof b === 'object') {
        if (typeof b.text === 'string') return b.text;
        if (b.type === 'tool_result' && typeof b.content === 'string') return b.content;
        if (typeof b.content === 'string') return b.content;
      }
      return '';
    }).join(' ');
  }

  function firstLine(text) {
    const s = oneLine(text);
    const i = s.indexOf('\n');
    return i >= 0 ? s.slice(0, i) : s;
  }

  function reasonKind(reason) {
    if (!reason) return 'completed';
    if (typeof reason === 'string') return reason;
    const k = reason.kind || reason.type || reason.name;
    return typeof k === 'string' ? k : 'completed';
  }

  function summarizeArgs(raw) {
    let s;
    try { s = typeof raw === 'string' ? raw : JSON.stringify(raw); } catch { s = ''; }
    s = oneLine(s);
    if (s.length > TOOL_TEXT_MAX) s = s.slice(0, TOOL_TEXT_MAX) + '…';
    return s || '{}';
  }

  function readActivity() { return activityValue; }

  function advanceActivity(t) {
    const target = live.running ? 1 : 0;
    if (target === activityValue) return;
    const tau = target > activityValue ? RISE_MS : FALL_MS;
    const k = 1 - Math.exp(-Math.max(0, t - lastAdvanceMs) / Math.max(1, tau));
    activityValue = Math.max(0, Math.min(1, activityValue + (target - activityValue) * k));
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  function notifySoon() {
    if (notifyPending || disposed) return;
    notifyPending = true;
    notifyTimer = setTimeout(flushNotify, NOTIFY_MS);
  }

  function flushNotify() {
    notifyPending = false;
    notifyTimer = null;
    if (disposed) return;
    for (const fn of Array.from(subscribers)) {
      try { fn(live); } catch { /* a broken subscriber must not stop the link */ }
    }
  }

  function emitNormalized(kind, payload) {
    if (typeof opts.onEvent === 'function') {
      try { opts.onEvent({ kind, at: now(), payload }); } catch { /* ignore */ }
    }
  }

  function pushFeed(kind, text) {
    const body = clip(text, FEED_TEXT_MAX);
    if (!body) return;
    live.feed.push({ kind, text: body, t: now() });
    if (live.feed.length > FEED_MAX) live.feed.splice(0, live.feed.length - FEED_MAX);
  }

  function trimStamps(at) {
    while (tokenStamps.length && tokenStamps[0] < at - TPS_WINDOW_MS) tokenStamps.shift();
  }

  function computeTps(at) {
    if (tokenStamps.length < 2) return 0;
    const oldest = tokenStamps[0];
    const span = Math.max(1, at - oldest);
    return ((tokenStamps.length - 1) * 1000) / span;
  }

  function buildRecentText() {
    return clip(recentParts.map((p) => p.t).join(' '), RECENT_TEXT_MAX);
  }

  function pushRecent(parts) {
    for (let i = 0; i < parts.length; i++) {
      const t = parts[i].t;
      if (t) {
        recentTokens.push(t);
        recentParts.push({ t });
      }
    }
    const drop = recentTokens.length - RECENT_MAX;
    if (drop > 0) {
      recentTokens.splice(0, drop);
      recentParts.splice(0, drop);
    }
    recentText = buildRecentText();
  }

  function emitText(text) {
    const words = splitTokens(text);
    if (!words.length) return;
    const parts = [];
    for (let i = 0; i < words.length; i++) {
      if (words[i].length > 8) words[i] = words[i].slice(0, 8) + '…';
      parts.push({ t: words[i] });
    }
    pushRecent(parts);
    const t = now();
    for (const p of parts) {
      tokenStamps.push(t);
      tokenQueue.push(p.t);
    }
    const overflow = tokenQueue.length - QUEUE_MAX;
    if (overflow > 0) tokenQueue.splice(0, overflow);
    trimStamps(t);
    live.tps = computeTps(t);
    live.activity = 1;
    lastTokenAt = t;
    live.totalTokens += parts.length;
    emitNormalized('tokens', { words: parts.length, text });
  }

  function pullTokens(max) {
    const take = max === undefined ? tokenQueue.length : Math.max(0, Math.floor(max));
    return tokenQueue.splice(0, take);
  }

  function applyUsage(usage) {
    if (!usage || typeof usage !== 'object') return;
    const input = num(usage.inputTokens);
    const output = num(usage.outputTokens);
    const total = num(usage.totalTokens);
    const cached = num(usage.cacheReadTokens);
    if (total !== undefined) live.usageTotal = Math.max(0, total);
    if (input !== undefined) live.inputTokens = Math.max(0, input);
    if (output !== undefined) live.outputTokens = Math.max(0, output);
    if (cached !== undefined) live.cacheReadTokens = Math.max(0, cached);
    if (total !== undefined && output !== undefined) live.contextTokens = Math.max(0, total - output);
    else if (input !== undefined) live.contextTokens = input;
    if (live.contextTokens !== undefined) emitNormalized('usage', { tokens: live.contextTokens });
  }

  function findTool(key) {
    const k = String(key || '');
    for (let i = live.tools.length - 1; i >= 0; i--) if (live.tools[i].id === k) return live.tools[i];
    return undefined;
  }

  function upsertTool(id, name, state) {
    if (id === undefined || id === null) return;
    const key = String(id);
    const existing = findTool(key);
    if (existing) {
      existing.state = state || existing.state;
      if (name) existing.name = name;
      return;
    }
    live.tools.push({ id: key, name: name || key, state: state || 'running' });
    if (live.tools.length > TOOLS_MAX) live.tools.splice(0, live.tools.length - TOOLS_MAX);
  }

  function applyDurable(event, quiet) {
    const type = event && event.type;
    const data = (event && event.data) || {};
    switch (type) {
      case 'turn/start': {
        const turn = num(data.turn);
        if (turn !== undefined) live.turn = turn;
        break;
      }
      case 'turn/end': {
        const turn = num(data.turn);
        if (turn !== undefined) live.turn = turn;
        if (!quiet) {
          const kind = reasonKind(data.reason);
          pushFeed(kind === 'error' ? 'error' : 'turn', 'turn ' + live.turn + ' ' + kind);
        }
        break;
      }
      case 'step/start':
      case 'step/end': {
        const turn = num(data.turn);
        const step = num(data.step);
        if (turn !== undefined) live.turn = turn;
        if (step !== undefined) live.step = step;
        break;
      }
      case 'user/message': {
        const payload = (data && typeof data === 'object' && data.message && data.message.content) ? data.message : data;
        if (!quiet) pushFeed('user', messageText(payload));
        emitNormalized('user', { text: oneLine(messageText(payload)) });
        break;
      }
      case 'assistant/message': {
        const turn = num(data.turn);
        const step = num(data.step);
        if (turn !== undefined) live.turn = turn;
        if (step !== undefined) live.step = step;
        // text here is the settlement of an attempt already streamed as
        // transient text-delta frames -> never tokenised
        applyUsage(data.usage);
        if (!quiet) pushFeed('assistant', firstLine(messageText(data.message)));
        emitNormalized('assistant', { text: firstLine(messageText(data.message)) });
        break;
      }
      case 'tool/call': {
        const name = typeof data.name === 'string' ? data.name : '';
        upsertTool(data.callId, name, 'running');
        if (!quiet) pushFeed('tool', name + '(' + summarizeArgs(data.arguments) + ')');
        emitNormalized('tool_call', { callId: data.callId, name });
        break;
      }
      case 'tool/result': {
        const message = (data.message && typeof data.message === 'object') ? data.message : {};
        const source = (message.source && typeof message.source === 'object') ? message.source : {};
        const callId = message.toolCallId !== undefined ? message.toolCallId
          : (source.callId !== undefined ? source.callId : data.callId);
        const failed = data.error !== undefined || message.isError === true;
        const previous = findTool(callId === undefined || callId === null ? '' : String(callId));
        const name = (typeof source.name === 'string' && source.name)
          || (previous && previous.name)
          || (callId === undefined ? 'tool' : String(callId));
        upsertTool(callId, name, failed ? 'error' : 'ok');
        if (!quiet) {
          const detail = failed
            ? ((data.error && (data.error.code || data.error.name)) || 'error')
            : 'ok';
          pushFeed(failed ? 'error' : 'tool', name + ' ' + detail);
        }
        emitNormalized('tool_result', { callId, name, failed, text: messageText(message) });
        break;
      }
      case 'session/title': {
        if (typeof data.text === 'string') live.sessionTitle = data.text;
        break;
      }
      default:
        break;
    }
  }

  function pruneAttempts() {
    while (attemptWatermark.size > ATTEMPT_MEMORY) {
      const first = attemptWatermark.keys().next();
      if (first.done) break;
      attemptWatermark.delete(first.value);
    }
  }

  function handleChunk(chunk, data) {
    switch (chunk.type) {
      case 'text-delta':
        emitText(chunk.text);
        break;
      case 'tool-call-delta':
        upsertTool(chunk.id, typeof chunk.name === 'string' ? chunk.name : undefined, 'running');
        break;
      case 'usage':
        applyUsage(chunk.usage);
        break;
      default:
        break; // reasoning-delta / block-start / block-end / finish
    }
    const turn = num(data.turn);
    const step = num(data.step);
    if (turn !== undefined) live.turn = turn;
    if (step !== undefined) live.step = step;
  }

  function applyTransient(entry, quiet) {
    const event = (entry && entry.event) || entry;
    if (!event || typeof event !== 'object') return;
    const data = (event.data && typeof event.data === 'object') ? event.data : {};
    const chunk = data.chunk;
    if (!chunk || typeof chunk !== 'object') return;

    const attemptId = (data.attemptId === undefined || data.attemptId === null) ? '' : String(data.attemptId);
    const seq = num(event.seq);
    if (attemptId) {
      const mark = attemptWatermark.get(attemptId);
      if (mark === attemptDone) return;
      if (mark !== undefined && seq !== undefined && seq <= mark) return;
      if (seq !== undefined) attemptWatermark.set(attemptId, seq);
      else if (mark === undefined) attemptWatermark.set(attemptId, -Infinity);
      pruneAttempts();
    }
    if (quiet) return; // replay of an already-counted suffix

    handleChunk(chunk, data);
  }

  function isTransientEntry(entry) {
    return !!(entry && entry.type === 'transient');
  }

  function applyEntry(entry, quiet) {
    if (isTransientEntry(entry)) applyTransient(entry, quiet);
    else applyDurable(entry.event || entry, quiet);
  }

  function rescan(snapshot, seedFeed) {
    attemptWatermark.clear();
    attemptWatermark.set('__watermark__', -Infinity);
    if (!snapshot) return;
    const entries = arr(snapshot.entries);
    let start = entries.length - SCAN_MAX;
    if (start < 0) start = 0;
    for (let i = start; i < entries.length; i++) applyEntry(entries[i], true);
    if (seedFeed) {
      const take = Math.min(FEED_SEED, live.feed.length || FEED_SEED);
      for (let i = 0; i < take; i++) {
        const e = live.feed[live.feed.length - 1 - i];
        if (e) live.feed.push({ kind: e.kind, text: e.text, t: now() });
      }
    }
  }

  function initialScan(seedFeed) { rescan(snapshotOf(), seedFeed); }

  function onSourceChanged(change) {
    if (!eventSource) return;
    const c = change || (snapshotOf() && snapshotOf().change) || {};
    const kind = c && c.kind;

    if (kind === 'append') {
      const entries = arr(c.entries);
      for (let i = 0; i < entries.length; i++) applyEntry(entries[i], false);
    } else if (kind === 'replace') {
      // the window was replaced wholesale: rescan quietly so already-counted
      // transients are not counted a second time
      const snap = snapshotOf();
      if (snap) rescan(snap, true);
    } else if (kind === 'prepend') {
      // older history arriving late — ignored entirely
    } else if (kind === 'settle-assistant') {
      applyDurable({ type: 'assistant/message', data: { message: {}, usage: undefined } }, false);
    } else {
      // no change object: fall back to a full rescan of the current window
      const snap = snapshotOf();
      if (snap) rescan(snap, true);
    }
    notifySoon();
  }

  function faceValue(projections, key) {
    if (!projections || typeof projections.faceOf !== 'function') return undefined;
    try {
      const face = projections.faceOf(key);
      if (!face || typeof face.getSnapshot !== 'function') return undefined;
      return face.getSnapshot();
    } catch { return undefined; }
  }

  function refreshMeta() {
    const chosen = faceValue(session && session.projections, 'modelSelection');
    if (chosen && typeof chosen.lastUsed === 'string') live.model = chosen.lastUsed;
    const title = faceValue(session && session.projections, 'title');
    if (typeof title === 'string' && title) live.sessionTitle = title;

    const pressure = faceValue(session && session.projections, 'contextPressure');
    if (pressure && typeof pressure === 'object') {
      const projected = num(pressure.projectedTokens);
      const used = num(pressure.pressureTokens);
      const window = num(pressure.contextWindow);
      if (projected !== undefined) live.contextTokens = projected;
      else if (used !== undefined) live.contextTokens = used;
      if (window !== undefined) live.contextLimit = window;
      emitNormalized('context', { tokens: live.contextTokens, limit: live.contextLimit });
    }

    const usage = faceValue(session && session.projections, 'tokenUsage');
    if (usage && typeof usage === 'object') {
      const input = num(usage.uncachedInputTokens);
      const output = num(usage.outputTokens);
      if (input !== undefined) live.inputTokens = Math.max(0, input);
      if (output !== undefined) live.outputTokens = Math.max(0, output);
      // context occupancy stays sourced from contextPressure; tokenUsage only
      // backfills it when the pressure projection is absent
      if (live.contextTokens === 0 && input !== undefined) live.contextTokens = Math.max(0, input);
    }
  }

  function resetSessionState() {
    live.contextTokens = 0;
    live.contextLimit = 0;
    live.turn = 0;
    live.step = 0;
    live.model = '';
    live.sessionTitle = '';
    live.tps = 0;
    live.usageTotal = 0;
    live.totalTokens = 0;
    live.inputTokens = 0;
    live.outputTokens = 0;
    live.cacheReadTokens = 0;
    live.tools.length = 0;
    live.feed.length = 0;
    live.tokenQueue.length = 0;
    live.recentTokens.length = 0;
    recentParts = [];
    tokenStamps = [];
    recentText = '';
    attemptWatermark.clear();
  }

  function releaseBinding() {
    eventSource = null;
    session = null;
    binding = null;
  }

  function rebind(force) {
    const id = getSessionId();
    if (!id) return;
    if (binding && binding.sessionId === id && !force) return;
    releaseBinding();
    try {
      binding = bindingOf(id);
    } catch {
      binding = null;
      return;
    }
    if (!binding) return;
    eventSource = binding.eventSource;
    session = binding.session;
    revision = -1;
    attemptWatermark.clear();
    resetSessionState();
    if (eventSource && typeof eventSource.subscribe === 'function') {
      try { eventSource.subscribe(onSourceChanged); } catch { /* ignore */ }
    }
    if (typeof eventSource.getSnapshot === 'function') {
      try { initialScan(true); } catch { /* ignore */ }
    }
    refreshMeta();
    notifySoon();
  }

  function ensureBinding() {
    if (timer !== null) return;
    timer = setInterval(() => {
      if (disposed) return;
      if (now() - lastAdvanceMs > ACTIVE_TAIL_MS && activityValue > 0) live.activity = 0;
      advanceActivity(now());
      rebind(false);
      refreshMeta();
      notifySoon();
    }, TICK_MS);
  }

  function setSession(id) {
    if (id === undefined) return;
    if (binding && binding.sessionId === id) return;
    live.running = false;
    rebind(true);
  }

  function setRunning(value) {
    runningSet = !!value;
    live.running = runningSet;
    if (!runningSet) live.activity = 0;
  }

  function tick() {
    const t = now();
    if (now() - lastAdvanceMs > ACTIVE_TAIL_MS && activityValue > 0) live.activity = 0;
    advanceActivity(t);
    notifySoon();
  }

  function attach() {
    if (timer !== null) return;
    rebind(false);        // bind synchronously so events are not missed
    ensureBinding();
    if (!live.running) live.running = false;
  }

  function detach() {
    if (timer !== null) { try { clearInterval(timer); } catch { /* ignore */ } timer = null; }
    releaseBinding();
    revision = -1;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    detach();
    if (notifyTimer !== null) { try { clearTimeout(notifyTimer); } catch { /* ignore */ } notifyTimer = null; }
    notifyPending = false;
    subscribers.clear();
    activityValue = 0;
    live.running = false;
    live.tps = 0;
    live.usageTotal = 0;
    live.totalTokens = 0;
    live.inputTokens = 0;
    live.outputTokens = 0;
    live.cacheReadTokens = 0;
    live.contextTokens = 0;
    live.contextLimit = 0;
    live.tools.length = 0;
    live.feed.length = 0;
    live.tokenQueue.length = 0;
    live.recentTokens.length = 0;
    recentParts = [];
    tokenStamps = [];
  }

  function snapshotOf() {
    if (!eventSource || typeof eventSource.getSnapshot !== 'function') return null;
    try { return eventSource.getSnapshot(); } catch { return null; }
  }

  // Start immediately: the host mounts and consumes before attach() is called.
  attach();

  return live;
}
