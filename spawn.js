'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// NET//ETHER — spawn.js (v7.2.0)
//
// Field lesson (2026-10-14): on a managed laptop every process launch is the
// expensive part. Defender + MDE + EPM + ASR inspect each one; on one bad box
// (orphaned filter drivers) `cmd /c ver` took ~2 s and a bare PowerShell ~4 s,
// and ETHER felt frozen after launch while CPU sat at 7 %. Three tools here:
//
//   1. Instrumentation. child_process.exec / execFile are wrapped once, before
//      any other module destructures them, so every launch in main.js, dhcp.js
//      and discover.js is timed. stats() feeds the diagnostics overlay.
//
//   2. Latency injector (dev). NET_ETHER_SPAWN_DELAY_MS=2000 (or the launch arg
//      --spawn-delay=2000) holds every callback-style launch for that long, so
//      the locked-down-laptop experience reproduces on a dev box or lab VM.
//      Streaming launches (tshark, tracert, Wireshark) are not delayed — their
//      callers use the returned child process.
//
//   3. Persistent PowerShell worker. One hidden powershell.exe reading jobs from
//      stdin, started once. psRun(script) sends a one-line job and reads the
//      output up to an end marker. Pay the PowerShell start-up cost once instead
//      of on every adapter refresh. No .NET calls and no dynamic script blocks in
//      the protocol, so it behaves the same under Constrained Language Mode. Any
//      failure (timeout, crash, multi-line script) falls back to the old one-shot
//      launch, and three worker deaths turn the worker off for the session.
//
// selfCheck() times `cmd /c ver` — the number that says "this laptop's process
// launches are slow" before anybody opens Task Manager.
// ─────────────────────────────────────────────────────────────────────────────

const cp = require('child_process');
const path = require('path');

const origExec     = cp.exec;
const origExecFile = cp.execFile;
const origSpawn    = cp.spawn;

function argDelay() {
  const a = process.argv.find(x => /^--spawn-delay=\d+$/.test(x));
  return a ? parseInt(a.split('=')[1], 10) : 0;
}
const DELAY_MS = Math.max(0, Math.min(10000, parseInt(process.env.NET_ETHER_SPAWN_DELAY_MS || '', 10) || argDelay() || 0));

const S = {
  total: 0, totalMs: 0, maxMs: 0, maxCmd: '',
  byExe: {},          // exe → { n, ms, max }
  recent: [],         // last 20: { exe, ms, ts }
  selfCheckMs: null, selfCheckTs: null, selfCheckErr: null,
  worker: { state: 'off', startedTs: null, firstReplyMs: null, jobs: 0, fallbacks: 0, deaths: 0, disabled: false },
};

function exeOf(cmdOrFile) {
  const s = String(cmdOrFile || '').trim();
  const first = s.startsWith('"') ? s.slice(1, s.indexOf('"', 1)) : s.split(/\s+/)[0];
  return path.basename(first).replace(/\.exe$/i, '').toLowerCase() || '?';
}
function record(exe, ms) {
  S.total++; S.totalMs += ms;
  if (ms > S.maxMs) { S.maxMs = ms; S.maxCmd = exe; }
  const b = (S.byExe[exe] ||= { n: 0, ms: 0, max: 0 });
  b.n++; b.ms += ms; if (ms > b.max) b.max = ms;
  S.recent.push({ exe, ms, ts: Date.now() });
  if (S.recent.length > 20) S.recent.shift();
}

// A stand-in for the ChildProcess while a delayed launch hasn't happened yet.
// Callback-style callers in this codebase never use the return value; kill() is
// honoured anyway so a cancelled job never launches.
function delayedStub(launch) {
  let real = null, killed = false;
  const t = setTimeout(() => { if (!killed) real = launch(); }, DELAY_MS);
  return {
    kill() { killed = true; clearTimeout(t); try { real && real.kill(); } catch {} },
    get pid() { return real ? real.pid : undefined; },
    on() { return this; }, once() { return this; }, unref() {},
    stdout: null, stderr: null, stdin: null,
  };
}

function wrapCallback(exe, cb) {
  const t0 = Date.now();
  return function (...args) { record(exe, Date.now() - t0); return cb.apply(this, args); };
}
function watchChild(exe, child) {
  const t0 = Date.now();
  try { child.once('exit', () => record(exe, Date.now() - t0)); } catch {}
  return child;
}

// Node's exec() calls module.exports.execFile() internally — the flag keeps one exec from
// being timed (and delayed) twice, and lets it be recorded under its own command name.
let inExec = false;
function viaExec(fn) { inExec = true; try { return fn(); } finally { inExec = false; } }
cp.exec = function patchedExec(cmd, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  const exe = exeOf(cmd);
  if (typeof cb !== 'function') return watchChild(exe, viaExec(() => origExec.call(cp, cmd, opts)));
  const go = () => viaExec(() => origExec.call(cp, cmd, opts, wrapCallback(exe, cb)));
  return DELAY_MS ? delayedStub(go) : go();
};
cp.execFile = function patchedExecFile(file, args, opts, cb) {
  if (inExec) return origExecFile.apply(cp, arguments);
  if (typeof args === 'function') { cb = args; args = undefined; opts = undefined; }
  else if (typeof opts === 'function') { cb = opts; opts = undefined; }
  if (args && !Array.isArray(args) && typeof args === 'object') { opts = args; args = undefined; }
  // execFile gets a path, not a command line — "C:\\Program Files\\…\\tshark.exe" must not split at the space
  const exe = path.basename(String(file || '')).replace(/\.exe$/i, '').toLowerCase() || '?';
  if (typeof cb !== 'function') return watchChild(exe, origExecFile.call(cp, file, args, opts));
  const go = () => origExecFile.call(cp, file, args, opts, wrapCallback(exe, cb));
  return DELAY_MS ? delayedStub(go) : go();
};

// ── PowerShell worker ────────────────────────────────────────
const END = '<<<NETETHER-END-';
let ps = null, buf = '', queue = [], cur = null, seq = 0;

function countDeath() {
  S.worker.deaths++;
  if (S.worker.deaths >= 3) { S.worker.disabled = true; S.worker.state = 'disabled'; }
}
function workerKill(reason) {
  if (ps) { try { ps.kill(); } catch {} }
  ps = null; buf = '';
  if (cur) { const c = cur; cur = null; clearTimeout(c.timer); c.reject(new Error(reason || 'worker stopped')); }
  const pending = queue; queue = [];
  pending.forEach(j => j.reject(new Error(reason || 'worker stopped')));
  if (S.worker.state !== 'disabled') S.worker.state = 'off';
}
function workerStart() {
  if (ps || S.worker.disabled) return !!ps;
  try {
    ps = origSpawn.call(cp, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', '-'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { ps = null; countDeath(); return false; }
  const child = ps;                          // handlers act only on THIS worker — a late exit from a killed one must not touch its successor
  S.worker.state = 'starting'; S.worker.startedTs = Date.now();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', d => { if (ps === child) { buf += d; pump(); } });
  child.stderr.on('data', () => {});            // errors are redirected per job; stray host noise is ignored
  child.stdin.on('error', () => { if (ps === child) { countDeath(); workerKill('worker stdin closed'); } });   // EPIPE when it dies mid-write
  child.on('exit', () => { if (ps === child) { countDeath(); workerKill('worker exited'); } });
  child.on('error', () => { if (ps === child) { countDeath(); workerKill('worker failed to start'); } });   // AppLocker / WDAC block
  return true;
}
function pump() {
  if (!cur) return;
  const i = buf.indexOf(END + cur.id + '-');
  if (i < 0) return;
  const j = buf.indexOf('>>>', i);
  if (j < 0) return;
  const out = buf.slice(0, i);
  const ok  = /True/i.test(buf.slice(i + END.length, j));
  buf = buf.slice(j + 3).replace(/^\r?\n/, '');
  const c = cur; cur = null;
  clearTimeout(c.timer);
  if (S.worker.firstReplyMs === null) S.worker.firstReplyMs = Date.now() - S.worker.startedTs;
  S.worker.state = 'ready'; S.worker.jobs++;
  record('ps-worker', Date.now() - c.t0);
  c.resolve({ ok, stdout: out });
  next();
}
function next() {
  if (cur || !queue.length) return;
  if (!ps && !workerStart()) { const q = queue; queue = []; q.forEach(j => j.reject(new Error('worker unavailable'))); return; }
  cur = queue.shift();
  cur.t0 = Date.now();
  // First job also waits out PowerShell's own start-up (4 s on the bad box).
  const budget = cur.timeoutMs + (S.worker.firstReplyMs === null ? 20000 : 0);
  // v7.3.0: a slow job is not a dead worker — kill and restart it (the job falls back to
  // one-shot), but only crashes count toward switching the worker off; timeouts get a
  // separate, higher allowance so a box that is merely slow keeps its worker.
  cur.timer = setTimeout(() => { S.worker.timeouts = (S.worker.timeouts || 0) + 1; if (S.worker.timeouts >= 8) countDeath(); workerKill('worker timeout'); }, budget);
  const line = `$__r = & { ${cur.script} } 2>$null; $__ok = $?; ($__r | Out-String -Width 4096); '${END}${cur.id}-' + $__ok + '>>>'\n`;
  try { ps.stdin.write(line); } catch { workerKill('worker write failed'); }
}

function oneShot(script, timeoutMs) {
  return new Promise(resolve => {
    // v7.3.0: + PowerShell's own start-up (2–4 s on a managed laptop, more under load) —
    // the caller's budget was meant for the query, not for launching the shell
    cp.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: timeoutMs + 10000, windowsHide: true },
      (err, stdout) => resolve({ ok: !err, stdout: err ? '' : String(stdout || '') }));
  });
}

// Run a read-only PowerShell one-liner. Resolves { ok, stdout, via }; never rejects.
async function psRun(script, { timeoutMs = 8000 } = {}) {
  const s = String(script || '');
  // multi-line, or non-ASCII (stdin is read in the OEM codepage; the command line is UTF-16) → one-shot
  if (process.platform !== 'win32' || S.worker.disabled || /[\r\n]/.test(s) || /[^\x20-\x7e]/.test(s)) {
    if (/[\r\n]/.test(s) || /[^\x20-\x7e]/.test(s)) S.worker.fallbacks++;
    const r = await oneShot(s, timeoutMs); return { ...r, via: 'one-shot' };
  }
  // Only lean on the worker once it has proven itself (the warm-up job answered). Until
  // then — or after it died — run one-shot and (re)warm it in the background, so a worker
  // that never comes up costs nothing but the old one-shot launch.
  if (S.worker.state !== 'ready') {
    if (!ps && !warming) warmWorker();
    const r = await oneShot(s, timeoutMs); return { ...r, via: 'one-shot' };
  }
  try {
    const r = await new Promise((resolve, reject) => { queue.push({ id: ++seq, script: s, timeoutMs, resolve, reject }); next(); });
    return { ...r, via: 'worker' };
  } catch {
    S.worker.fallbacks++;
    const r = await oneShot(s, timeoutMs); return { ...r, via: 'one-shot' };
  }
}
let warming = false;
function warmWorker() {
  if (process.platform !== 'win32' || S.worker.disabled || warming || S.worker.state === 'ready') return;
  warming = true;
  new Promise((resolve, reject) => { queue.push({ id: ++seq, script: '1', timeoutMs: 8000, resolve, reject }); next(); })
    .catch(() => {}).finally(() => { warming = false; });
}
function stopWorker() { workerKill('app quit'); }

// ── Self-check ───────────────────────────────────────────────
function selfCheck() {
  return new Promise(resolve => {
    const t0 = Date.now();
    origExecFile.call(cp, 'cmd.exe', ['/c', 'ver'], { timeout: 15000, windowsHide: true }, err => {
      S.selfCheckMs = Date.now() - t0; S.selfCheckTs = Date.now(); S.selfCheckErr = err ? err.message : null;
      resolve(S.selfCheckMs);
    });
  });
}
// Healthy boxes: tens of ms. Managed laptops: a few hundred. Over a second: something is wrong.
function verdict(ms) {
  if (ms === null || ms === undefined) return 'not measured';
  if (ms < 150) return 'normal';
  if (ms < 600) return 'slow (normal for a managed laptop)';
  if (ms < 1500) return 'very slow — security software is costing a lot per launch';
  return 'SEVERE — every action that launches a process will lag; check endpoint agents / filter drivers';
}

function stats() {
  const byExe = Object.entries(S.byExe).map(([exe, b]) => ({ exe, n: b.n, avg: Math.round(b.ms / b.n), max: b.max }))
    .sort((a, b) => b.n * b.avg - a.n * a.avg).slice(0, 8);
  return {
    delayMs: DELAY_MS,
    selfCheckMs: S.selfCheckMs, selfCheckTs: S.selfCheckTs, selfCheckErr: S.selfCheckErr, verdict: verdict(S.selfCheckMs),
    total: S.total, avgMs: S.total ? Math.round(S.totalMs / S.total) : 0, maxMs: S.maxMs, maxCmd: S.maxCmd,
    byExe, worker: { ...S.worker },
  };
}

module.exports = { psRun, warmWorker, stopWorker, selfCheck, stats, DELAY_MS };
