/* 家账本 · 本地静态服务器（零依赖）
 * 用法：node server.mjs [端口]
 * 默认端口 8080，手机与电脑连同一 Wi-Fi 后访问打印出的局域网地址。
 */
import http from 'node:http';
import { createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (err) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relative);

  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let stat = null;
  try {
    stat = await fsp.stat(filePath);
  } catch (err) {
    stat = null;
  }

  if (!stat || !stat.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache'
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用，请换一个端口，例如：node server.mjs 8081');
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const addresses = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    });
  });

  console.log('');
  console.log('  家账本已启动');
  console.log('  ----------------------------------------');
  console.log('  电脑访问   http://localhost:' + PORT);
  addresses.forEach((ip) => {
    console.log('  手机访问   http://' + ip + ':' + PORT + '   （同一 Wi-Fi）');
  });
  console.log('  ----------------------------------------');
  console.log('  按 Ctrl+C 停止服务');
  console.log('');
});
