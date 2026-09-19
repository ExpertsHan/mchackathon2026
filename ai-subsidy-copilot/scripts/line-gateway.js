// 本機反向代理：免費 ngrok 只有一個網域，所以用單一入口依路徑分流。
//   /webhook → LINE bot :3100   /api/*、/health → FastAPI :8000   其餘 → Next.js :3000
const http = require('http');
const net = require('net');

const PORT = Number(process.env.GATEWAY_PORT || 8080);
const target = (url) => {
  if (url.startsWith('/webhook')) return 3100;
  if (url.startsWith('/api/') || url === '/health') return 8000;
  return 3000;
};

const server = http.createServer((req, res) => {
  const up = http.request(
    { host: '127.0.0.1', port: target(req.url), method: req.method, path: req.url, headers: req.headers },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }
  );
  up.on('error', (e) => { res.writeHead(502); res.end(`upstream error: ${e.message}`); });
  req.pipe(up);
});

// Next dev 的 HMR websocket
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(target(req.url), '127.0.0.1', () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` +
      Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
    up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(PORT, () => console.log(`gateway on :${PORT}`));
