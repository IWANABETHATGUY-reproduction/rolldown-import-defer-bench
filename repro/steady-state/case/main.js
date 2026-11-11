// Cost of a deferred namespace read after the module is evaluated, against an eager read.
import defer * as m from './m.js';
import * as e from './e.js';
// Two copies of the same loop, so that the inline cache of `ns.value` sees one object shape only.
function sumDeferred(ns, n) { let s = 0; for (let i = 0; i < n; i++) s += ns.value; return s; }
function sumEager(ns, n) { let s = 0; for (let i = 0; i < n; i++) s += ns.value; return s; }
export function runStatic(n) { let s = 0; for (let i = 0; i < n; i++) s += m.value; return s; }
export function runEager(n) { let s = 0; for (let i = 0; i < n; i++) s += e.value; return s; }
export function runEscaped(n) { return sumDeferred(m, n); }
export function runEagerEscaped(n) { return sumEager(e, n); }
export function bumpAll() { m.bump(); e.bump(); }
