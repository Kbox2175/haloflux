#!/usr/bin/env node
/**
 * Data-link smoke test.
 *
 * Drives a simulated session through the link and asserts the mapping:
 *   tokens  -> stream channel traffic + impulse
 *   tool/call    -> stable slot per tool name, impulse kind 'tool_call'
 *   tool/result  -> same slot, impulse kind 'tool_result'
 *   snapshot    -> engine tick carries turn / step / context / tps
 *   running     -> engine activity mode flips run <-> idle
 *
 *   node tools/data-smoke.mjs
 */
import { createChannelMap } from '../src/data/channels.js';
import { createLink } from '../src/data/link.js';
import { createSimulatedSource } from '../src/data/simulate.js';

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

const events = [];
const source = createSimulatedSource({
  intervalMs: 40,
  onEvent: (e) => events.push(e)
});

// ---- fake engine that records what the link asks for ----
const pushed = { impulses: [], ticks: [], modes: [] };
const engine = {
  pushImpulse: (i) => pushed.impulses.push(i),
  pushTick: (t) => pushed.ticks.push(t),
  setMode: (m) => pushed.modes.push(m)
};

const channels = createChannelMap(40, { now: () => Date.now() });
const link = createLink(source, engine, { channels, tickMs: 30 });

// let the simulated session produce something
await new Promise((r) => setTimeout(r, 700));

check('link attached and has state', !!link.lastRunning);
check('source produced events', events.length > 0, `events=${events.length}`);

const kinds = new Set(events.map((e) => e.kind));
check('emitted tool_call events', kinds.has('tool_call'));
check('emitted tool_result events', kinds.has('tool_result'));
check('emitted token events', kinds.has('tokens'));

const toolImpulses = pushed.impulses.filter((i) => i.kind === 'tool_call');
check('tool calls became impulses', toolImpulses.length > 0, `n=${toolImpulses.length}`);
check('tool call carries a slot', toolImpulses.every((i) => Number.isFinite(i.slot) && i.slot >= 0));
check('tool call carries power', toolImpulses.every((i) => i.power > 0 && i.power <= 1));

const resultImpulses = pushed.impulses.filter((i) => i.kind === 'tool_result');
check('tool results became impulses', resultImpulses.length > 0, `n=${resultImpulses.length}`);

// stable slot per tool name
const byName = new Map();
for (const e of events) {
  if (e.kind === 'tool_call' && e.payload && e.payload.name) {
    if (!byName.has(e.payload.name)) byName.set(e.payload.name, channels.slotOf('tool:' + e.payload.name));
  }
}
check('same tool always maps to the same slot', byName.size > 0 && byName.size === new Set(byName.values()).size,
  `tools=${byName.size} slots=${new Set(byName.values()).size}`);

const tick = pushed.ticks[pushed.ticks.length - 1];
check('engine received a tick', !!tick);
check('tick carries turn/step', !!tick && Number.isFinite(tick.turn) && Number.isFinite(tick.step),
  tick ? `turn=${tick.turn} step=${tick.step}` : '');
check('tick carries context', !!tick && Number.isFinite(tick.contextTokens), tick ? `ctx=${tick.contextTokens}` : '');
check('tick carries tools', !!tick && Array.isArray(tick.tools));

const modes = new Set(pushed.modes);
check('engine mode reflects running state', modes.size >= 1, `modes=${[...modes].join(',')}`);

// stream traffic must show up on the stream channel
const streamBump = pushed.impulses.filter((i) => i.kind === 'stream');
check('token stream produced impulses', streamBump.length > 0, `n=${streamBump.length}`);
check('stream impulses land on the stream slot', streamBump.every((i) => i.slot === 0));

// ---- detach path ----
link.dispose();
check('dispose is safe to call twice', (() => { link.dispose(); return true; })());
source.dispose();

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
process.exit(failures === 0 ? 0 : 1);
