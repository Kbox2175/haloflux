#!/usr/bin/env node
/**
 * Live adapter self-test with a fake host binding.
 *
 * Covers the invariants that matter most:
 *   - display tokens counted ONLY from transient text-delta frames
 *   - a durable assistant/message that settles the same attempt is NOT
 *     double-counted
 *   - `prepend` (older history) is ignored
 *   - `replace` rescan does not re-count
 *   - a failing tool is reported as error
 *   - projections are read defensively (absent face => no throw)
 *
 *   node tools/live-selftest.mjs
 */
import { createLiveSource } from '../src/data/live.js';

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

const events = [];
let seq = 0;
const nextSeq = () => ++seq;

function evt(type, data) {
  return { seq: nextSeq(), type, data };
}

const state = {
  revision: 0,
  entries: [],
  handlers: new Set(),
  change: null,
  getSnapshot() { return { entries: this.entries.slice(), hasMore: false, revision: this.revision, change: this.change }; },
  subscribe(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
};

const projections = {
  faceOf(key) {
    if (key === 'contextPressure') {
      return { getSnapshot: () => ({ projectedTokens: 48210, pressureTokens: 47000, contextWindow: 65536 }) };
    }
    if (key === 'tokenUsage') {
      return { getSnapshot: () => ({ uncachedInputTokens: 47000, outputTokens: 1200 }) };
    }
    if (key === 'modelSelection') {
      return { getSnapshot: () => ({ lastUsed: 'deepseek-chat' }) };
    }
    return undefined; // a face the host does not have
  }
};

const session = { projections, title: 'test-session' };

let binding = {
  sessionId: 'sess-1',
  session,
  eventSource: state,
  ctx: {}
};

const live = createLiveSource({
  getSessionId: () => 'sess-1',
  bindingOf: (id) => (id === 'sess-1' ? binding : undefined),
  onEvent: (e) => events.push(e),
  tickMs: 5
});

function push(entry) {
  state.entries.push(entry);
  state.revision++;
  state.change = { kind: 'append', entries: [entry] };
  for (const fn of state.handlers) fn({ kind: 'append', entries: [entry] });
}

function append(event) {
  push({ type: 'event', event });
}
function transient(chunk, extra) {
  push({ type: 'transient', event: { type: 'assistant/live-chunk', data: { attemptId: 'a1', turn: 1, step: 1, chunk, ...extra } } });
}

// ---- 1. transient text-delta is the only token source ----
transient({ type: 'text-delta', text: 'hello world again' });
await new Promise((r) => setTimeout(r, 30));
check('transient text-delta produced tokens', events.some((e) => e.kind === 'tokens'));
check('token count is words-per-frame', (() => {
  const n = events.filter((e) => e.kind === 'tokens').reduce((s, e) => s + e.payload.words, 0);
  return n === 3;
})(), `words=${events.filter((e) => e.kind === 'tokens').reduce((s, e) => s + e.payload.words, 0)}`);

const tokensAfterFirst = live.totalTokens;

// ---- 2. the settling durable assistant/message must NOT add tokens ----
append(evt('assistant/message', {
  turn: 1, step: 1,
  message: { content: 'hello world again' },
  usage: { inputTokens: 47000, outputTokens: 3, totalTokens: 47003 }
}));
await new Promise((r) => setTimeout(r, 30));
check('durable assistant/message did not double-count tokens',
  live.totalTokens === tokensAfterFirst, `before=${tokensAfterFirst} after=${live.totalTokens}`);
await new Promise((r) => setTimeout(r, 30));
check('usage applied to contextTokens', typeof live.contextTokens === 'number' && live.contextTokens > 0, `ctx=${live.contextTokens}`);

// ---- 3. prepend is ignored ----
const beforePrepend = live.totalTokens;
state.change = { kind: 'prepend', entries: [{ type: 'transient', event: { type: 'assistant/live-chunk', data: { attemptId: 'old', chunk: { type: 'text-delta', text: 'ancient history' } } } }] };
state.revision++;
for (const fn of state.handlers) fn({ kind: 'prepend', entries: state.change.entries });
await new Promise((r) => setTimeout(r, 30));
check('prepend ignored', live.totalTokens === beforePrepend, `${beforePrepend} -> ${live.totalTokens}`);

// ---- 4. replace rescan does not re-count ----
const beforeReplace = live.totalTokens;
state.change = { kind: 'replace', entries: state.entries.slice() };
state.revision++;
for (const fn of state.handlers) fn({ kind: 'replace', entries: state.change.entries });
await new Promise((r) => setTimeout(r, 30));
check('replace rescan did not re-count', live.totalTokens === beforeReplace, `${beforeReplace} -> ${live.totalTokens}`);

// ---- 5. tools ----
append(evt('tool/call', { turn: 1, step: 2, callId: 'c1', name: 'read_file', arguments: { path: '/tmp/x' } }));
await new Promise((r) => setTimeout(r, 20));
check('tool call tracked as running', live.tools.some((t) => t.id === 'c1' && t.name === 'read_file' && t.state === 'running'));

append(evt('tool/result', {
  turn: 1, step: 2,
  message: { role: 'tool', content: 'ok', source: { callId: 'c1', name: 'read_file' } }
}));
await new Promise((r) => setTimeout(r, 20));
check('tool result marked ok', live.tools.some((t) => t.id === 'c1' && t.state === 'ok'));
check('tool events emitted', events.some((e) => e.kind === 'tool_call') && events.some((e) => e.kind === 'tool_result'));

// ---- 6. a failing tool ----
append(evt('tool/call', { turn: 1, step: 3, callId: 'c2', name: 'bash', arguments: {} }));
append(evt('tool/result', { turn: 1, step: 3, error: { code: 'EPERM' }, message: { role: 'tool', content: '', source: { callId: 'c2', name: 'bash' } } }));
await new Promise((r) => setTimeout(r, 20));
check('failed tool marked error', live.tools.some((t) => t.id === 'c2' && t.state === 'error'));

// ---- 7. projections ----
await new Promise((r) => setTimeout(r, 60));
check('model read from projection', live.model === 'deepseek-chat', live.model);
check('context window read from projection', live.contextLimit === 65536, `${live.contextLimit}`);
check('context tokens from pressure projection', live.contextTokens === 48210, `${live.contextTokens}`);

// ---- 8. rebind / dispose ----
binding = { sessionId: 'sess-1', session, eventSource: state, ctx: {} };
live.dispose();
check('dispose clears tokens', live.totalTokens === 0 && live.tokenQueue.length === 0);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
process.exit(failures === 0 ? 0 : 1);
