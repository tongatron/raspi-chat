const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000/chat/ws');

ws.on('open', () => {
  console.log('[OpenClaw] Connected to chat');
  // Login
  const loginData = JSON.stringify({username: 'OpenClaw', password: 'openclaw'});
  const loginReq = require('http').request({
    hostname: 'localhost',
    port: 3000,
    path: '/chat/login',
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'Content-Length': loginData.length}
  }, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
      const resp = JSON.parse(body);
      if (resp.token) {
        ws.send(JSON.stringify({ type: 'join', username: 'OpenClaw', token: resp.token }));
        console.log('[OpenClaw] Logged in, listening for messages...');
      }
    });
  });
  loginReq.write(loginData);
  loginReq.end();
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'message' && msg.username !== 'OpenClaw') {
    console.log('[OpenClaw] New message from', msg.username + ':', msg.text);
    // Here you could add OpenClaw AI response logic
  }
});

ws.on('error', (e) => console.error('[OpenClaw] Error:', e.message));
ws.on('close', () => {
  console.log('[OpenClaw] Disconnected, retrying in 5s...');
  setTimeout(() => require('child_process').exec('node /srv/apps/fastify-api/openclaw-listener.js'), 5000);
});

console.log('[OpenClaw] Starting listener...');
