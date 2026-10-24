/**
 * 本地测试：起一个静态服务器扮演 CDN，然后在 Node 里模拟浏览器跑加载器
 *
 *   node scripts/serve.mjs          起服务（默认 8787）
 *   node scripts/test.mjs           跑一遍加载流程（会自己起服务）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};

export function serve(port = 8787) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/' || p === '') p = '/manifest.json';
    const abs = path.join(ROOT, p.replace(/^\/+/, ''));
    if (!abs.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(abs, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + p); return; }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(abs)] || 'application/octet-stream',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      res.end(buf);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 8787;
  serve(port).then(() => {
    console.log('静态服务器 http://127.0.0.1:' + port + '/');
    console.log('  manifest: http://127.0.0.1:' + port + '/manifest.json');
    console.log('  Ctrl+C 停止');
  });
}
