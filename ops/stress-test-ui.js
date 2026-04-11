#!/usr/bin/env node
/**
 * Raspi Chat — Stress Test UI
 * Avvia un server locale e apre una dashboard nel browser.
 *
 * Uso:
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
  if (testRunning) return { error: 'Test già in corso' };
  const { users, ratePerMin, duration, roomId, ramp, adminUser, adminPass, testPass } = cfg;

  // check ws module
  try { require.resolve('ws'); } catch(_) {
    return { error: 'Modulo "ws" non installato. Esegui: npm install ws' };
  }

  testRunning = true;
  testWorkers = [];
  testStats   = { sent: 0, received: 0, errors: 0, latencies: [], startedAt: Date.now(), series: [], cfg };
  pushEvent('log', { level: 'info', text: `▶ Avvio test — ${users} utenti, ${ratePerMin} msg/min, ${duration}s` });

  // Login utenti
  const startUsers = ramp ? Math.max(1, Math.floor(users / 4)) : users;
  for (let i = 0; i < startUsers; i++) {
    await spawnWorker(i, { adminUser, adminPass, testPass, roomId, ratePerMin });
  }

  // Ramp: aggiungi utenti gradualmente
  if (ramp && users > startUsers) {
    let added = startUsers;
    const step = Math.max(1, Math.floor(users / 4));
    rampInterval = setInterval(async () => {
      if (!testRunning || added >= users) { clearInterval(rampInterval); return; }
      const toAdd = Math.min(step, users - added);
      pushEvent('log', { level: 'info', text: `↑ Ramp: aggiungo ${toAdd} utenti (tot ${added+toAdd})` });
      for (let i = added; i < added + toAdd; i++) {
        await spawnWorker(i, { adminUser, adminPass, testPass, roomId, ratePerMin });
      }
      added += toAdd;
    }, 20000);
  }

  // Monitor stats ogni secondo
  monitorInterval = setInterval(async () => {
    const now = Date.now();
    const elapsed = Math.round((now - testStats.startedAt) / 1000);
    const recentLat = testStats.latencies.splice(0);
    const avgLat = recentLat.length ? Math.round(recentLat.reduce((a,b) => a+b, 0) / recentLat.length) : 0;
    const p95 = recentLat.length ? recentLat.sort((a,b)=>a-b)[Math.floor(recentLat.length * 0.95)] : 0;
    const piStats = await fetchPiStats();
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

    if (elapsed >= duration) stopTest('timeout');
  }, 1000);

  return { ok: true };
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
    pushEvent('log', { level: 'warn', text: `Login fallito per ${username}: ${e.message}` });
    testStats.errors++;
    return;
  }

  const intervalMs = Math.round(60000 / Math.max(1, ratePerMin));
  const worker = { username: adminUser || username, token, ws: null, sent: 0, errors: 0, timer: null };

  worker.ws = openWs(worker.username, token, roomId || 'cabras-giovanni', msg => {
    if (msg.type === 'message') {
      testStats.received++;
    }
  });

  // Start sending after WS is open
  worker.ws.on('open', () => {
    pushEvent('log', { level: 'info', text: `✓ Worker ${idx} connesso` });
    worker.timer = setInterval(() => {
      if (!testRunning || worker.ws.readyState !== 1) { clearInterval(worker.timer); return; }
      const t0 = Date.now();
      const text = `[stress-${idx}] msg #${worker.sent+1} @ ${new Date().toISOString()}`;
      worker.ws.send(JSON.stringify({ type: 'message', text }));
      worker.sent++;
      testStats.sent++;
      // approximate latency via next received message delta
      const unsub = () => { testStats.latencies.push(Date.now() - t0); };
      broker.once('received_' + idx, unsub);
      setTimeout(() => broker.removeListener('received_' + idx, unsub), 5000);
    }, intervalMs);
  });

  testWorkers.push(worker);
}

function stopTest(reason) {
  if (!testRunning) return;
  testRunning = false;
  adminToken = null;
  adminUsername = null;
  clearInterval(monitorInterval);
  clearInterval(rampInterval);

  for (const w of testWorkers) {
    clearInterval(w.timer);
    try { if (w.ws) w.ws.terminate(); } catch(_) {}
  }

  const dur = Math.round((Date.now() - testStats.startedAt) / 1000);
  const series = testStats.series;
  const maxThroughput = series.length ? Math.max(...series.map(p => p.sent - (series[series.indexOf(p)-1]?.sent ?? 0))) : 0;
  const maxCpu = series.length ? Math.max(...series.map(p => p.cpu ?? 0)) : null;
  const maxLat = series.length ? Math.max(...series.map(p => p.p95 ?? 0)) : null;
  const drop = testStats.sent > 0 ? ((testStats.sent - testStats.received) / testStats.sent * 100).toFixed(1) : '0.0';

  const report = {
    reason,
    duration: dur,
    users: testWorkers.length,
    sent: testStats.sent,
    received: testStats.received,
    drop: drop + '%',
    maxThroughputPerSec: maxThroughput,
    maxCpu: maxCpu ? maxCpu + '%' : 'N/A',
    maxLatP95: maxLat ? maxLat + 'ms' : 'N/A',
    series,
  };

  pushEvent('report', report);
  pushEvent('log', { level: 'info', text: `■ Test terminato (${reason}) — inviati ${testStats.sent}, ricevuti ${testStats.received}, drop ${drop}%` });
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
<html lang="it">
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
        <h2>Configurazione</h2>
        <div class="field">
          <div class="field-row"><label>Utenti connessi</label><b id="lbl-users">10</b></div>
          <input type="range" id="cfg-users" min="1" max="100" value="10" oninput="document.getElementById('lbl-users').textContent=this.value" />
        </div>
        <div class="field">
          <div class="field-row"><label>Messaggi / minuto per utente</label><b id="lbl-rate">10</b></div>
          <input type="range" id="cfg-rate" min="1" max="120" value="10" oninput="document.getElementById('lbl-rate').textContent=this.value" />
        </div>
        <div class="field">
          <div class="field-row"><label>Durata (secondi)</label><b id="lbl-dur">60</b></div>
          <input type="range" id="cfg-duration" min="10" max="300" value="60" step="10" oninput="document.getElementById('lbl-dur').textContent=this.value" />
        </div>
        <div class="field">
          <label>Room ID (default: cabras-giovanni)</label>
          <input type="text" id="cfg-room" value="cabras-giovanni" />
        </div>
        <div class="field">
          <label>Username admin (per login)</label>
          <input type="text" id="cfg-user" value="giovanni" />
        </div>
        <div class="field">
          <label>Password admin</label>
          <input type="password" id="cfg-pass" placeholder="••••••••" />
        </div>
        <div class="field">
          <label class="toggle">
            <input type="checkbox" id="cfg-ramp" />
            Modalità ramp (aumenta gradualmente)
          </label>
        </div>
        <div class="actions">
          <button class="btn btn-primary" id="btn-start" onclick="startTest()">▶ Avvia test</button>
          <button class="btn btn-danger" id="btn-stop" onclick="stopTest()" disabled>■ Stop</button>
        </div>
      </div>

      <div class="card" style="margin-top:12px">
        <h2>Note</h2>
        <div style="font-size:.76rem;color:var(--muted);line-height:1.8">
          • Fare backup DB prima di avviare<br>
          • Il test usa le credenziali admin per simulare N sessioni simultanee<br>
          • <b style="color:var(--warn)">Ramp</b>: parte con ¼ degli utenti, ne aggiunge ogni 20s<br>
          • Il monitor Pi legge <code>/chat/console/data</code> ogni secondo<br>
          • Se la Pi si blocca, ripristinare il backup dall'admin panel
        </div>
      </div>
    </div>

    <!-- Dashboard -->
    <div>
      <div class="card">
        <h2>Metriche live</h2>
        <div class="stat-grid">
          <div class="stat" id="stat-sent"><div class="val" id="v-sent">0</div><div class="lbl">Messaggi inviati</div></div>
          <div class="stat" id="stat-recv"><div class="val" id="v-recv">0</div><div class="lbl">Ricevuti</div></div>
          <div class="stat" id="stat-lat"><div class="val" id="v-lat">—</div><div class="lbl">Latenza p95</div></div>
          <div class="stat" id="stat-cpu"><div class="val" id="v-cpu">—</div><div class="lbl">CPU Pi</div></div>
          <div class="stat"><div class="val" id="v-workers">0</div><div class="lbl">Workers attivi</div></div>
          <div class="stat"><div class="val" id="v-drop">0%</div><div class="lbl">Drop rate</div></div>
          <div class="stat"><div class="val" id="v-ram">—</div><div class="lbl">RAM Pi</div></div>
          <div class="stat"><div class="val" id="v-load">—</div><div class="lbl">Load avg</div></div>
        </div>
        <canvas id="chart" height="160"></canvas>
        <div class="log-box" id="log-box"></div>
        <div class="report-box" id="report-box">
          <h3>📊 Report finale</h3>
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
  const drop = d.sent > 0 ? ((d.sent - d.received) / d.sent * 100).toFixed(1) + '%' : '0%';
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
  document.getElementById('status-badge').textContent = 'Completato';

  const box = document.getElementById('report-box');
  const rows = document.getElementById('report-rows');
  box.style.display = 'block';
  const data = [
    ['Durata', r.duration + 's'],
    ['Utenti', r.users],
    ['Messaggi inviati', r.sent],
    ['Messaggi ricevuti', r.received],
    ['Drop rate', r.drop],
    ['Throughput max /s', r.maxThroughputPerSec],
    ['CPU Pi max', r.maxCpu],
    ['Latenza p95 max', r.maxLatP95],
  ];
  rows.innerHTML = data.map(([k,v]) => \`<div class="report-row"><span class="k">\${k}</span><span class="v">\${v}</span></div>\`).join('');
  appendLog({ level: 'info', text: \`Report: sent=\${r.sent} recv=\${r.received} drop=\${r.drop} cpu=\${r.maxCpu} p95=\${r.maxLatP95}\` });
}

function startTest() {
  const cfg = {
    users:      parseInt(document.getElementById('cfg-users').value),
    ratePerMin: parseInt(document.getElementById('cfg-rate').value),
    duration:   parseInt(document.getElementById('cfg-duration').value),
    roomId:     document.getElementById('cfg-room').value || 'cabras-giovanni',
    adminUser:  document.getElementById('cfg-user').value,
    adminPass:  document.getElementById('cfg-pass').value,
    ramp:       document.getElementById('cfg-ramp').checked,
  };
  if (!cfg.adminPass) { alert('Inserisci la password admin'); return; }
  document.getElementById('btn-start').disabled = true;
  document.getElementById('btn-stop').disabled  = false;
  document.getElementById('status-badge').className = 'badge badge-running';
  document.getElementById('status-badge').textContent = 'Running';
  document.getElementById('report-box').style.display = 'none';
  document.getElementById('log-box').innerHTML = '';
  Object.assign(series, { throughput: [], cpu: [], lat: [], labels: [], _lastSent: 0 });
  fetch('/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) })
    .then(r => r.json())
    .then(d => { if (d.error) { alert(d.error); document.getElementById('btn-start').disabled = false; document.getElementById('status-badge').className = 'badge badge-idle'; document.getElementById('status-badge').textContent = 'Idle'; } });
}

function stopTest() {
  fetch('/stop', { method: 'POST' });
  document.getElementById('btn-start').disabled = false;
  document.getElementById('btn-stop').disabled  = true;
}
</script>
</body>
</html>`;
