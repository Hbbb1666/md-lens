// 极简静态服务器：把仓库根目录挂到 http，供真实浏览器验证 assets/ 与 test/fixtures/
// 用法：node server.mjs [端口]（默认 8899）
//
// 另外提供 POST /__save?name=xxx：浏览器里「导出」产生的字节直接回写到
// test/out/，这样导出产物能被 python-docx / openpyxl / python-pptx 真正校验。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 8899);
const OUT = path.join(ROOT, 'test', 'out');
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pfb': 'application/octet-stream',
  '.bcmap': 'application/octet-stream',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf': 'application/pdf',
  '.rtf': 'application/rtf',
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);

  if (req.method === 'POST' && rel === '/__save') {
    const q = new URL(req.url, 'http://x');
    const name = path.basename(q.searchParams.get('name') || 'upload.bin');
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const data = Buffer.concat(chunks);
      try {
        // 每次写之前都确保目录在：测试目录常被清掉重跑，进程却还活着
        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(path.join(OUT, name), data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ saved: name, size: data.length }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e && e.message || e) }));
      }
    });
    return;
  }

  if (rel === '/') rel = '/assets/viewer.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}/`);
});
