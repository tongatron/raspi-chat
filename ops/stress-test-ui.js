#!/usr/bin/env node
/**
 * Raspi Chat — Stress Test UI
 * Starts a local server and opens a dashboard in the browser.
 *
 * Usage:
 *   node ops/stress-test-ui.js
 *   node ops/stress-test-ui.js --port 4000
 *   node ops/stress-test-ui.js --target http://raspberrypi.local:3000
 */

const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(name); return i !== -1 && args[i+1] ? args[i+1] : def; };
const PORT   = parseInt(getArg('--port', '4242'));
const TARGET = getArg('--target', 'https://chat.tongatron.org');

// ── SSE broker ─────────────────────────────────────────────────────────────
const broker = new EventEmitter();
broker.setMaxListeners(50);
const sseClients = new Set();
function pushEvent(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) { try { res.write(payload); } catch(_) {} }
  broker.emit(type, data);
}

// ── Test state ──────────────────────────────────────────────────────────────
let testRunning = false;
let testWorkers = [];   // { username, token, ws, sent, errors, latencies }
let testStats   = { sent: 0, received: 0, errors: 0, latencies: [], startedAt: null, series: [] };
let monitorInterval = null;
let rampInterval    = null;
let adminToken    = null;   // saved after first login, used for fetchPiStats
let adminUsername = null;
let monitorOnlyInterval = null;  // polling when no test is running
let rampState = null;

// ── Helpers ─────────────────────────────────────────────────────────────────
function httpReq(url, opts, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { ...opts, rejectUnauthorized: false }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function login(username, password) {
  const r = await httpReq(`${TARGET}/chat/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { username, password });
  if (r.status !== 200) throw new Error(`Login failed for ${username}: ${r.status}`);
  return r.body.token;
}

function openWs(username, token, roomId, onMsg) {
  const WebSocket = require('ws');
  const wsUrl = TARGET.replace(/^http/, 'ws') + '/chat/ws';
  const ws = new WebSocket(wsUrl, { rejectUnauthorized: false });
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'join', roomId, username, token }));
  });
  ws.on('message', raw => {
    try { onMsg(JSON.parse(raw)); } catch(_) {}
  });
  ws.on('error', err => pushEvent('log', { level: 'warn', text: `WS error: ${err.message}` }));
  return ws;
}

async function fetchPiStats() {
  if (!adminToken || !adminUsername) return null;
  try {
    const r = await httpReq(`${TARGET}/chat/console/data`, {
      method: 'GET',
      headers: {
        'x-chat-username': adminUsername,
        'x-chat-token':    adminToken,
      }
    });
    if (r.status === 200) {
      const d = r.body;
      const mem = d?.raspberry?.memory;
      const cpuCount = d?.raspberry?.cpuCount || 1;
      const load1 = d?.raspberry?.loadAvg?.[0] ?? null;
      return {
        cpu:     load1 !== null ? Math.min(100, Math.round(load1 / cpuCount * 100)) : null,
        ramUsed: mem ? Math.round(mem.used / mem.total * 100) : null,
        loadAvg: load1 !== null ? load1.toFixed(2) : null,
        ramMB:   mem ? Math.round(mem.used / 1024 / 1024) : null,
        ramTotalMB: mem ? Math.round(mem.total / 1024 / 1024) : null,
      };
    }
  } catch(_) {}
  return null;
}

// ── Start test ───────────────────────────────────────────────────────────────
async function startTest(cfg) {
  if (testRunning) return { error: 'A test is already running' };
  const { users, ratePerMin, duration, roomId, ramp, adminUser, adminPass, testPass } = cfg;

  // check ws module
  try { require.resolve('ws'); } catch(_) {
    return { error: 'The "ws" module is not installed. Run: npm install ws' };
  }

  testRunning = true;
  testWorkers = [];
  testStats   = { sent: 0, received: 0, errors: 0, latencies: [], startedAt: Date.now(), series: [], cfg: { ...cfg } };
  pushEvent('log', { level: 'info', text: `▶ Starting test — ${users} users, ${ratePerMin} msg/min, ${duration}s` });

  // User login
  const startUsers = ramp ? Math.max(1, Math.floor(users / 4)) : users;
  for (let i = 0; i < startUsers; i++) {
    await spawnWorker(i, { adminUser, adminPass, testPass, roomId, ratePerMin });
  }

  // Ramp: add users gradually
  if (ramp && users > startUsers) {
    rampState = { added: startUsers, targetUsers: users };
    const step = Math.max(1, Math.floor(users / 4));
    rampInterval = setInterval(async () => {
      if (!testRunning || !rampState || rampState.added >= rampState.targetUsers) { clearInterval(rampInterval); return; }
      const toAdd = Math.min(step, rampState.targetUsers - rampState.added);
      pushEvent('log', { level: 'info', text: `↑ Ramp: adding ${toAdd} users (total ${rampState.added + toAdd})` });
      for (let i = rampState.added; i < rampState.added + toAdd; i++) {
        await spawnWorker(i, { adminUser, adminPass, testPass, roomId, ratePerMin });
      }
      rampState.added += toAdd;
    }, 20000);
  } else {
    rampState = null;
  }

  let serverDownCount = 0;
  // Monitor stats every second
  monitorInterval = setInterval(async () => {
    const now = Date.now();
    const elapsed = Math.round((now - testStats.startedAt) / 1000);
    const recentLat = testStats.latencies.splice(0);
    const avgLat = recentLat.length ? Math.round(recentLat.reduce((a,b) => a+b, 0) / recentLat.length) : 0;
    const p95 = recentLat.length ? recentLat.sort((a,b)=>a-b)[Math.floor(recentLat.length * 0.95)] : 0;
    const piStats = await fetchPiStats();
    if (!piStats) { serverDownCount++; if (serverDownCount >= 3) { pushEvent('log', { level: 'warn', text: '⚠ Server unreachable — test stopped automatically' }); stopTest('server-down'); return; } } else { serverDownCount = 0; }
    const point = {
      t: elapsed,
      sent: testStats.sent,
      received: testStats.received,
      errors: testStats.errors,
      workers: testWorkers.length,
      avgLat, p95,
      cpu: piStats?.cpu ?? null,
      ram: piStats?.ramUsed ?? null,
      load: piStats?.loadAvg ?? null,
    };
    testStats.series.push(point);
    pushEvent('stats', point);

    if (duration > 0 && elapsed >= duration) stopTest('timeout');
  }, 1000);

  return { ok: true };
}

function scheduleWorker(worker, ratePerMin) {
  clearInterval(worker.timer);
  const intervalMs = Math.round(60000 / Math.max(1, ratePerMin));
  worker.ratePerMin = ratePerMin;
  worker.timer = setInterval(() => {
    if (!testRunning || worker.ws.readyState !== 1) { clearInterval(worker.timer); return; }
    const seq = worker.sent + 1;
    const messageId = `${worker.sessionId}:${seq}`;
    const text = `[stress:${messageId}] msg #${seq} @ ${new Date().toISOString()}`;
    const startedAt = Date.now();
    worker.ws.send(JSON.stringify({ type: 'message', text }));
    worker.sent++;
    testStats.sent++;
    worker.pendingAcks.set(messageId, startedAt);
    setTimeout(() => worker.pendingAcks.delete(messageId), 5000);
  }, intervalMs);
}

async function spawnWorker(idx, { adminUser, adminPass, testPass, roomId, ratePerMin }) {
  const username = `stress_${idx}`;
  const password = testPass || 'stress-test-pw';
  let token;
  try {
    // Try login directly first
    token = await login(adminUser || username, adminPass || password);
    if (!adminToken) { adminToken = token; adminUsername = adminUser || username; } // save for fetchPiStats
  } catch(e) {
    pushEvent('log', { level: 'warn', text: `Login failed for ${username}: ${e.message}` });
    testStats.errors++;
    return;
  }

  const worker = {
    username: adminUser || username,
    token,
    ws: null,
    sent: 0,
    errors: 0,
    timer: null,
    pendingAcks: new Map(),
    sessionId: `w${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ratePerMin,
  };

  worker.ws = openWs(worker.username, token, roomId || 'cabras-giovanni', msg => {
    if (msg.type === 'message' && typeof msg.text === 'string') {
      const match = msg.text.match(/^\[stress:([^\]]+)\]/);
      if (!match) return;
      const messageId = match[1];
      if (!worker.pendingAcks.has(messageId)) return;
      testStats.received++;
      testStats.latencies.push(Date.now() - worker.pendingAcks.get(messageId));
      worker.pendingAcks.delete(messageId);
    }
  });

  // Start sending after WS is open
  worker.ws.on('open', () => {
    pushEvent('log', { level: 'info', text: `✓ Worker ${idx} connected` });
    scheduleWorker(worker, ratePerMin);
  });

  testWorkers.push(worker);
}

async function updateTestConfig(nextCfg) {
  if (!testRunning) return { error: 'No test is running' };
  if (rampState) return { error: 'Live updates are not available during ramp mode' };

  const currentUsers = testWorkers.length;
  if (nextCfg.users < currentUsers) {
    return { error: 'Reducing users during a running test is not supported' };
  }

  if (nextCfg.users > currentUsers) {
    pushEvent('log', { level: 'info', text: `↑ Live update: adding ${nextCfg.users - currentUsers} users` });
    for (let i = currentUsers; i < nextCfg.users; i++) {
      await spawnWorker(i, testStats.cfg);
    }
  }

  if (nextCfg.ratePerMin !== testStats.cfg.ratePerMin) {
    pushEvent('log', { level: 'info', text: `↺ Live update: ${nextCfg.ratePerMin} msg/min per user` });
    for (const worker of testWorkers) scheduleWorker(worker, nextCfg.ratePerMin);
  }

  testStats.cfg = { ...testStats.cfg, ...nextCfg, users: Math.max(nextCfg.users, currentUsers) };
  return { ok: true, users: testWorkers.length, ratePerMin: testStats.cfg.ratePerMin };
}

function stopTest(reason) {
  if (!testRunning) return;
  testRunning = false;
  adminToken = null;
  adminUsername = null;
  clearInterval(monitorInterval);
  clearInterval(rampInterval);
  rampState = null;

  for (const w of testWorkers) {
    clearInterval(w.timer);
    try { if (w.ws) w.ws.terminate(); } catch(_) {}
  }

  const dur = Math.round((Date.now() - testStats.startedAt) / 1000);
  const series = testStats.series;
  const maxThroughput = series.length ? Math.max(...series.map(p => p.sent - (series[series.indexOf(p)-1]?.sent ?? 0))) : 0;
  const maxCpu = series.length ? Math.max(...series.map(p => p.cpu ?? 0)) : null;
  const maxLat = series.length ? Math.max(...series.map(p => p.p95 ?? 0)) : null;
  const missing = Math.max(0, testStats.sent - testStats.received);
  const drop = testStats.sent > 0 ? (missing / testStats.sent * 100).toFixed(1) : '0.0';

  const report = {
    reason,
    duration: dur,
    users: testWorkers.length,
    sent: testStats.sent,
    received: testStats.received,
    missing,
    drop: drop + '%',
    maxThroughputPerSec: maxThroughput,
    maxCpu: maxCpu ? maxCpu + '%' : 'N/A',
    maxLatP95: maxLat ? maxLat + 'ms' : 'N/A',
    series,
  };

  pushEvent('report', report);
  pushEvent('log', { level: 'info', text: `■ Test finished (${reason}) — sent ${testStats.sent}, acknowledged ${testStats.received}, missing ${missing}, drop ${drop}%` });
  testWorkers = [];
}

// ── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write(':\n\n'); // keep-alive comment
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (req.method === 'POST' && req.url === '/start') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      const cfg = JSON.parse(body);
      const r = await startTest(cfg);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/stop') {
    stopTest('manual');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === 'POST' && req.url === '/update') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      const cfg = JSON.parse(body);
      const r = await updateTestConfig(cfg);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/monitor/start') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      const cfg = JSON.parse(body);
      // Login server-side (no CORS issues)
      try {
        const r = await login(cfg.username, cfg.password);
        adminToken = r; adminUsername = cfg.username;
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Login failed: ' + e.message }));
        return;
      }
      if (monitorOnlyInterval) clearInterval(monitorOnlyInterval);
      monitorOnlyInterval = setInterval(async () => {
        if (testRunning) { clearInterval(monitorOnlyInterval); monitorOnlyInterval = null; return; }
        const pi = await fetchPiStats();
        if (pi) pushEvent('stats', { sent: 0, received: 0, workers: 0, p95: null, cpu: pi.cpu, ram: pi.ramUsed, load: pi.loadAvg, t: 0, monitorOnly: true });
      }, 1000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/monitor/stop') {
    if (monitorOnlyInterval) { clearInterval(monitorOnlyInterval); monitorOnlyInterval = null; }
    adminToken = null; adminUsername = null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  🍓 Raspi Chat Stress Test UI\n`);
  console.log(`  Target: ${TARGET}`);
  console.log(`  Dashboard: ${url}\n`);
  execFile('open', [url]);
});

// ── HTML dashboard ───────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Raspi Chat — Stress Test</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: rgba(255,255,255,.1);
    --ink: #e6edf3; --muted: #8b949e; --primary: #58a6ff;
    --success: #3fb950; --warn: #d29922; --danger: #f85149;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "SF Mono", "Fira Code", monospace; background: var(--bg); color: var(--ink); min-height: 100vh; }
  .shell { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
  h1 { font-size: 1.2rem; font-weight: 700; margin-bottom: 4px; }
  .subtitle { color: var(--muted); font-size: .82rem; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: 340px 1fr; gap: 16px; }
  @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .card h2 { font-size: .82rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 14px; }
  .field { margin-bottom: 12px; }
  .field label { display: block; font-size: .76rem; color: var(--muted); margin-bottom: 4px; }
  .field input[type=text], .field input[type=number], .field input[type=password] {
    width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 4px;
    color: var(--ink); padding: 7px 10px; font: inherit; font-size: .86rem;
  }
  .field input[type=range] { width: 100%; accent-color: var(--primary); }
  .field-row { display: flex; align-items: center; justify-content: space-between; }
  .toggle { display: flex; align-items: center; gap: 8px; font-size: .84rem; cursor: pointer; }
  input[type=checkbox] { accent-color: var(--primary); width: 16px; height: 16px; }
  .btn { border: none; border-radius: 6px; padding: 10px 20px; font: inherit; font-size: .88rem; font-weight: 700; cursor: pointer; transition: opacity .15s; }
  .btn:disabled { opacity: .4; cursor: default; }
  .btn-primary { background: var(--primary); color: #000; }
  .btn-danger  { background: var(--danger); color: #fff; }
  .btn-ghost   { background: rgba(255,255,255,.06); color: var(--ink); border: 1px solid var(--border); }
  .btn-monitor { background: rgba(255,255,255,.07); color: var(--ink); border: 1px solid var(--border); width: 100%; }
  .btn-monitor.active { background: rgba(52,211,153,.15); color: #34d399; border-color: rgba(52,211,153,.4); }
  .actions { display: flex; gap: 10px; margin-top: 16px; }
  .stat-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 14px; }
  @media (max-width: 600px) { .stat-grid { grid-template-columns: repeat(2,1fr); } }
  .stat { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; }
  .stat .val { font-size: 1.5rem; font-weight: 800; color: var(--ink); line-height: 1.1; }
  .stat .lbl { font-size: .7rem; color: var(--muted); margin-top: 2px; }
  .stat.ok .val { color: var(--success); }
  .stat.warn .val { color: var(--warn); }
  .stat.bad .val { color: var(--danger); }
  canvas { width: 100% !important; display: block; border-radius: 4px; }
  .log-box { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; height: 180px; overflow-y: auto; padding: 10px; font-size: .76rem; line-height: 1.7; margin-top: 14px; }
  .log-box .info { color: var(--primary); }
  .log-box .warn { color: var(--warn); }
  .log-box .err  { color: var(--danger); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: .7rem; font-weight: 700; }
  .badge-idle    { background: rgba(139,148,158,.15); color: var(--muted); }
  .badge-running { background: rgba(63,185,80,.15); color: var(--success); animation: pulse 1.4s ease infinite; }
  .badge-done    { background: rgba(88,166,255,.15); color: var(--primary); }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
  .report-box { background: var(--bg); border: 1px solid var(--success); border-radius: 6px; padding: 14px; margin-top: 14px; font-size: .82rem; display: none; }
  .report-box h3 { color: var(--success); margin-bottom: 10px; font-size: .86rem; }
  .report-row { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid var(--border); }
  .report-row:last-child { border: none; }
  .report-row .k { color: var(--muted); }
  .report-row .v { color: var(--ink); font-weight: 700; }
</style>
</head>
<body>
<div class="shell">
  <h1>🍓 Raspi Chat — Stress Test</h1>
  <div class="subtitle">Target: <span id="target-url" style="color:var(--primary)"></span> &nbsp;·&nbsp; <span id="status-badge" class="badge badge-idle">Idle</span></div>

  <div class="grid">
    <!-- Config -->
    <div>
      <div class="card">
        <h2>Configuration</h2>
        <div class="field">
          <div class="field-row"><label>Connected users</label><b id="lbl-users">10</b></div>
          <input type="range" id="cfg-users" min="1" max="100" value="10" oninput="document.getElementById('lbl-users').textContent=this.value" />
        </div>
        <div class="field">
          <div class="field-row"><label>Messages / minute per user</label><b id="lbl-rate">10</b></div>
          <input type="range" id="cfg-rate" min="1" max="120" value="10" oninput="document.getElementById('lbl-rate').textContent=this.value" />
        </div>
        <div class="field">
          <div class="field-row"><label>Duration (seconds)</label><b id="lbl-dur">60</b></div>
          <input type="range" id="cfg-duration" min="10" max="300" value="60" step="10" oninput="document.getElementById('lbl-dur').textContent=this.value" id="cfg-duration-range" />
          <label class="toggle" style="margin-top:6px">
            <input type="checkbox" id="cfg-no-timeout" onchange="
              var r=document.getElementById('cfg-duration');
              var l=document.getElementById('lbl-dur');
              r.disabled=this.checked;
              l.textContent=this.checked?'∞':r.value;
            " />
            No timeout (manual stop)
          </label>
        </div>
        <div class="field">
          <label>Room ID</label>
          <input type="text" id="cfg-room" value="cabras-giovanni" />
        </div>
        <div class="field">
          <label>Admin username (for login)</label>
          <input type="text" id="cfg-user" value="giovanni" />
        </div>
        <div class="field">
          <label>Admin password</label>
          <input type="password" id="cfg-pass" placeholder="••••••••" />
        </div>
        <div class="field">
          <label class="toggle">
            <input type="checkbox" id="cfg-ramp" />
            Ramp mode (add users gradually)
          </label>
        </div>
        <div class="actions">
          <button class="btn btn-primary" id="btn-start" onclick="startTest()">▶ Start test</button>
          <button class="btn btn-danger" id="btn-stop" onclick="stopTest()" disabled>■ Stop</button>
        </div>
        <div class="actions" style="margin-top:8px">
          <button class="btn btn-monitor" id="btn-monitor" onclick="toggleMonitor()">📡 Start monitoring</button>
        </div>
      </div>

      <div class="card" style="margin-top:12px">
        <h2>Notes</h2>
        <div style="font-size:.76rem;color:var(--muted);line-height:1.8">
          • Back up the DB before starting<br>
          • <b style="color:#f87171">⚠ Stop the test BEFORE restoring a backup</b> — otherwise workers will keep writing to the freshly restored DB<br>
          • The test uses admin credentials to simulate N simultaneous sessions<br>
          • During the test you can increase users and rate; decreasing users is blocked<br>
          • <b style="color:var(--warn)">Ramp</b>: starts with 1/4 of the users, then adds more every 20s<br>
          • Pi monitoring reads <code>/chat/console/data</code> once per second<br>
          • If the Pi hangs, restore the backup from the admin panel
        </div>
      </div>
    </div>

    <!-- Dashboard -->
    <div>
      <div class="card">
        <h2>Live metrics</h2>
        <div class="stat-grid">
          <div class="stat" id="stat-sent"><div class="val" id="v-sent">0</div><div class="lbl">Messages sent</div></div>
          <div class="stat" id="stat-recv"><div class="val" id="v-recv">0</div><div class="lbl">Acknowledged</div></div>
          <div class="stat" id="stat-lat"><div class="val" id="v-lat">—</div><div class="lbl">p95 latency</div></div>
          <div class="stat" id="stat-cpu"><div class="val" id="v-cpu">—</div><div class="lbl">CPU Pi</div></div>
          <div class="stat"><div class="val" id="v-workers">0</div><div class="lbl">Active workers</div></div>
          <div class="stat"><div class="val" id="v-drop">0%</div><div class="lbl">Missing acknowledgements</div></div>
          <div class="stat"><div class="val" id="v-ram">—</div><div class="lbl">RAM Pi</div></div>
          <div class="stat"><div class="val" id="v-load">—</div><div class="lbl">Load avg</div></div>
        </div>
        <canvas id="chart" height="160"></canvas>
        <div class="log-box" id="log-box"></div>
        <div class="report-box" id="report-box">
          <h3>📊 Final report</h3>
          <div id="report-rows"></div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
document.getElementById('target-url').textContent = '${TARGET}';

// SSE
const evs = new EventSource('/events');
evs.addEventListener('stats',  e => updateStats(JSON.parse(e.data)));
evs.addEventListener('report', e => showReport(JSON.parse(e.data)));
evs.addEventListener('log',    e => appendLog(JSON.parse(e.data)));

let runningCfg = null;

// Chart
const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');
const series = { throughput: [], cpu: [], lat: [], labels: [] };

function updateStats(d) {
  document.getElementById('v-sent').textContent    = d.sent;
  document.getElementById('v-recv').textContent    = d.received;
  document.getElementById('v-workers').textContent = d.workers;
  document.getElementById('v-lat').textContent     = d.p95 ? d.p95 + 'ms' : '—';
  document.getElementById('v-cpu').textContent     = d.cpu != null ? d.cpu + '%' : '—';
  document.getElementById('v-ram').textContent     = d.ram != null ? d.ram + '%' : '—';
  document.getElementById('v-load').textContent    = d.load != null ? d.load : '—';
  const missing = Math.max(0, d.sent - d.received);
  const drop = d.sent > 0 ? (missing / d.sent * 100).toFixed(1) + '%' : '0%';
  document.getElementById('v-drop').textContent = drop;

  // colour CPU stat
  const cs = document.getElementById('stat-cpu');
  cs.className = 'stat' + (d.cpu > 85 ? ' bad' : d.cpu > 60 ? ' warn' : ' ok');

  // throughput delta
  const prev = series.throughput[series.throughput.length - 1] ?? 0;
  const prevSent = series._lastSent ?? 0;
  series._lastSent = d.sent;
  series.throughput.push(d.sent - prevSent);
  series.cpu.push(d.cpu ?? 0);
  series.lat.push(d.p95 ?? 0);
  series.labels.push(d.t + 's');
  if (series.throughput.length > 60) {
    series.throughput.shift(); series.cpu.shift(); series.lat.shift(); series.labels.shift();
  }
  drawChart();
}

function drawChart() {
  const W = canvas.offsetWidth * window.devicePixelRatio;
  const H = 160 * window.devicePixelRatio;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);
  const PAD = 30 * window.devicePixelRatio;
  const w = W - PAD * 1.5, h = H - PAD;

  function drawLine(data, color, maxVal) {
    if (!data.length) return;
    const max = maxVal || Math.max(...data, 1);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * window.devicePixelRatio;
    data.forEach((v, i) => {
      const x = PAD + (i / (data.length - 1 || 1)) * w;
      const y = PAD/2 + (1 - v / max) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  drawLine(series.throughput, '#58a6ff');   // throughput blue
  drawLine(series.cpu,        '#3fb950', 100); // cpu green
  drawLine(series.lat,        '#d29922');   // latency yellow

  // Legend
  ctx.font = (10 * window.devicePixelRatio) + 'px monospace';
  [[' msg/s','#58a6ff',0],[' CPU%','#3fb950',70],[' p95ms','#d29922',140]].forEach(([l, c, x]) => {
    ctx.fillStyle = c; ctx.fillRect(x * window.devicePixelRatio + PAD, (H - 14 * window.devicePixelRatio), 8 * window.devicePixelRatio, 8 * window.devicePixelRatio);
    ctx.fillStyle = '#8b949e'; ctx.fillText(l, (x + 10) * window.devicePixelRatio + PAD, H - 6 * window.devicePixelRatio);
  });
}

function appendLog(d) {
  const box = document.getElementById('log-box');
  const el = document.createElement('div');
  el.className = d.level;
  el.textContent = new Date().toLocaleTimeString() + '  ' + d.text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function showReport(r) {
  document.getElementById('btn-start').disabled = false;
  document.getElementById('btn-stop').disabled = true;
  document.getElementById('status-badge').className = 'badge badge-done';
  document.getElementById('status-badge').textContent = 'Completed';

  const box = document.getElementById('report-box');
  const rows = document.getElementById('report-rows');
  box.style.display = 'block';
  const data = [
    ['Duration', r.duration ? r.duration + 's' : '∞ (manual stop)'],
    ['Users', r.users],
    ['Messages sent', r.sent],
    ['Messages acknowledged', r.received],
    ['Missing acknowledgements', r.missing],
    ['Drop rate', r.drop],
    ['Throughput max /s', r.maxThroughputPerSec],
    ['Pi CPU max', r.maxCpu],
    ['Max p95 latency', r.maxLatP95],
  ];
  rows.innerHTML = data.map(([k,v]) => \`<div class="report-row"><span class="k">\${k}</span><span class="v">\${v}</span></div>\`).join('');
  appendLog({ level: 'info', text: \`Report: sent=\${r.sent} ack=\${r.received} missing=\${r.missing} drop=\${r.drop} cpu=\${r.maxCpu} p95=\${r.maxLatP95}\` });
  runningCfg = null;
}

function startTest() {
  const roomInput = document.getElementById('cfg-room');
  const cfg = {
    users:      parseInt(document.getElementById('cfg-users').value),
    ratePerMin: parseInt(document.getElementById('cfg-rate').value),
    duration:   document.getElementById('cfg-no-timeout').checked ? 0 : parseInt(document.getElementById('cfg-duration').value),
    roomId:     roomInput && roomInput.value ? roomInput.value : 'cabras-giovanni',
    adminUser:  document.getElementById('cfg-user').value,
    adminPass:  document.getElementById('cfg-pass').value,
    ramp:       document.getElementById('cfg-ramp').checked,
  };
  if (!cfg.adminPass) { alert('Enter the admin password'); return; }
  // stop standalone monitor if running
  if (_monitoring) {
    fetch('/monitor/stop', { method: 'POST' });
    _monitoring = false;
    const mb = document.getElementById('btn-monitor');
    mb.textContent = '📡 Start monitoring'; mb.classList.remove('active');
  }
  document.getElementById('btn-start').disabled = true;
  document.getElementById('btn-stop').disabled  = false;
  document.getElementById('status-badge').className = 'badge badge-running';
  document.getElementById('status-badge').textContent = 'Running';
  document.getElementById('report-box').style.display = 'none';
  document.getElementById('log-box').innerHTML = '';
  Object.assign(series, { throughput: [], cpu: [], lat: [], labels: [], _lastSent: 0 });
  fetch('/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) })
    .then(r => r.json())
    .then(d => {
      if (d.error) {
        alert(d.error);
        document.getElementById('btn-start').disabled = false;
        document.getElementById('status-badge').className = 'badge badge-idle';
        document.getElementById('status-badge').textContent = 'Idle';
        return;
      }
      runningCfg = { users: cfg.users, ratePerMin: cfg.ratePerMin };
    });
}

function stopTest() {
  fetch('/stop', { method: 'POST' });
  document.getElementById('btn-start').disabled = false;
  document.getElementById('btn-stop').disabled  = true;
  runningCfg = null;
}

function updateLiveTestConfig() {
  if (!runningCfg) return;
  const nextUsers = parseInt(document.getElementById('cfg-users').value, 10);
  const nextRate = parseInt(document.getElementById('cfg-rate').value, 10);

  if (Number.isNaN(nextUsers) || Number.isNaN(nextRate)) return;

  if (nextUsers < runningCfg.users) {
    document.getElementById('cfg-users').value = runningCfg.users;
    document.getElementById('lbl-users').textContent = runningCfg.users;
    appendLog({ level: 'warn', text: 'Reducing users during a running test is not supported.' });
    return;
  }

  if (nextUsers === runningCfg.users && nextRate === runningCfg.ratePerMin) return;

  fetch('/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ users: nextUsers, ratePerMin: nextRate })
  })
    .then(r => r.json())
    .then(d => {
      if (d.error) {
        alert(d.error);
        document.getElementById('cfg-users').value = runningCfg.users;
        document.getElementById('lbl-users').textContent = runningCfg.users;
        document.getElementById('cfg-rate').value = runningCfg.ratePerMin;
        document.getElementById('lbl-rate').textContent = runningCfg.ratePerMin;
        return;
      }
      runningCfg = { users: d.users, ratePerMin: d.ratePerMin };
      document.getElementById('cfg-users').value = d.users;
      document.getElementById('lbl-users').textContent = d.users;
      document.getElementById('cfg-rate').value = d.ratePerMin;
      document.getElementById('lbl-rate').textContent = d.ratePerMin;
    })
    .catch(() => {
      appendLog({ level: 'warn', text: 'Live update failed.' });
    });
}

let _monitoring = false;
function toggleMonitor() {
  const btn = document.getElementById('btn-monitor');
  const user = document.getElementById('cfg-user').value;
  const pass = document.getElementById('cfg-pass').value;
  if (!_monitoring) {
    if (!pass) { alert('Enter the admin password for monitoring'); return; }
    btn.disabled = true;
    btn.textContent = '…';
    fetch('/monitor/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    }).then(r => r.json()).then(d => {
      btn.disabled = false;
      if (d.error) { alert(d.error); btn.textContent = '📡 Start monitoring'; return; }
      _monitoring = true;
      btn.textContent = '⏹ Stop monitoring';
      btn.classList.add('active');
    }).catch(() => { btn.disabled = false; btn.textContent = '📡 Start monitoring'; alert('Connection error'); });
  } else {
    fetch('/monitor/stop', { method: 'POST' });
    _monitoring = false;
    btn.textContent = '📡 Start monitoring';
    btn.classList.remove('active');
  }
}

document.getElementById('cfg-users').addEventListener('change', updateLiveTestConfig);
document.getElementById('cfg-rate').addEventListener('change', updateLiveTestConfig);
</script>
</body>
</html>`;
