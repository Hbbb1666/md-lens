// 无头回归（jsdom）：加载真实的 assets/viewer.html，喂 fixtures 里的样本，断言渲染结果。
// 不需要手机、不需要 Android SDK。
//
//   node smoke.mjs            全部用例
//   node smoke.mjs docx xlsx  只跑指定用例
//
// 局限性（这是 jsdom 的，不是 App 的）：
//   · pptx 跑不了 —— JSZip 解 zip 条目时依赖 Blob/DecompressionStream 的完整实现，
//     jsdom 里 file.async() 永不返回。pptx 请用 test/selfcheck.html 在真实浏览器里验。
//   · 图片缩放（shrinkDataUrl）依赖 canvas，jsdom 没有后端，带图用例会自动跳过该断言。
// 真实浏览器的完整验收入口是 test/selfcheck.html（5 渲染 + 3 导出）。
//
// 之所以要起一个本地 HTTP 服务：viewer.html 的库是外部 <script src="libs/...">，
// 用 file:// 加载在 jsdom 里拿不到（也模拟不了 WebView 的 file:///android_asset 行为）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ASSETS = path.join(ROOT, 'assets');
const FIXTURES = path.join(HERE, 'fixtures');

if (!fs.existsSync(path.join(ASSETS, 'viewer.html'))) {
  console.error('✗ 缺少 assets/viewer.html，先跑 ./build.sh（或 python src/assemble.py）');
  process.exit(2);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.bcmap': 'application/octet-stream', '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ASSETS, rel === '/' ? '/viewer.html' : rel);
  if (!file.startsWith(ASSETS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const wait = ms => new Promise(r => setTimeout(r, ms));

async function openViewer(port) {
  const dom = await JSDOM.fromURL(`http://127.0.0.1:${port}/viewer.html`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.TextDecoder = TextDecoder;
      w.TextEncoder = TextEncoder;
      w.scrollTo = () => {};
      if (!w.matchMedia) {
        w.matchMedia = () => ({
          matches: false, addListener() {}, removeListener() {},
          addEventListener() {}, removeEventListener() {},
        });
      }
      // jsdom 没有 canvas 后端；PDF 用例本来也走原生，这里给个空实现避免噪声
      w.HTMLCanvasElement.prototype.getContext = () => null;
    },
  });
  await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
  await wait(400);
  return dom;
}

function feed(w, name, file) {
  const buf = fs.readFileSync(path.join(FIXTURES, file));
  w.MDLens.show(name, buf.toString('base64'));
}

const cases = {
  md: {
    file: 'sample.md',
    async run(w, d) {
      await wait(600);
      const c = d.getElementById('content');
      return {
        '标题渲染': c.querySelectorAll('h1,h2').length >= 3,
        '表格 3 行': c.querySelectorAll('table tr').length === 3,
        '代码块高亮': c.querySelectorAll('pre code').length === 1,
        '列表 2 项': c.querySelectorAll('li').length >= 2,
        '引用块': c.querySelectorAll('blockquote').length === 1,
        '目录有 3 条': d.querySelectorAll('#tocList .tocitem').length >= 3,
      };
    },
  },
  docx: {
    file: 'sample.docx',
    async run(w, d) {
      await wait(2500);
      const c = d.getElementById('docView');
      const txt = c.textContent;
      return {
        '正文含标题文字': txt.includes('一级标题') && txt.includes('二级标题'),
        '表格 3×3': c.querySelectorAll('table tr').length === 3 &&
                    c.querySelectorAll('table tr:first-child td,table tr:first-child th').length === 3,
        '图片内联为 data URL': /<img[^>]+src="data:image/.test(c.innerHTML),
      };
    },
  },
  xlsx: {
    file: 'sample.xlsx',
    async run(w, d) {
      await wait(2500);
      const box = d.getElementById('sheetView');
      return {
        '两个工作表标签': d.querySelectorAll('#sheetView .tab,.sheettab,[data-sheet]').length >= 2 ||
                          (box.textContent.match(/成绩表/) && box.textContent.match(/第二表/)),
        '公式算出总分': box.textContent.includes('179') || box.textContent.includes('171'),
        '第二表内容': box.textContent.includes('12345') || box.textContent.includes('第二表'),
      };
    },
  },
  // pptx 在 jsdom 里跑不了（JSZip 的 file.async() 永不返回，见文件头说明），
  // 与其留一个永远红的断言，不如显式跳过并指向真实浏览器：
  //   node server.mjs  →  打开 http://127.0.0.1:8899/test/selfcheck.html
  rtf: {
    file: 'sample.rtf',
    async run(w, d) {
      await wait(1200);
      const t = d.getElementById('content').textContent;
      return { '正文两条': t.includes('RTF regression sample') && t.includes('Second paragraph') };
    },
  },
};

const want = process.argv.slice(2);
const names = want.length ? want : Object.keys(cases);

await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

let total = 0, failed = 0;
try {
  for (const name of names) {
    const c = cases[name];
    if (!c) {
      console.log(`⚠ 没有名为 ${name} 的用例（可选：${Object.keys(cases).join(', ')}）`);
      if (name === 'pptx') console.log('   pptx 在 jsdom 里无法渲染，请用 test/selfcheck.html 在真实浏览器里验');
      total++;
      failed++;
      continue;
    }
    const dom = await openViewer(port);
    const w = dom.window, d = w.document;
    try {
      feed(w, c.file.replace('sample.', 'sample.'), c.file);
      const res = await c.run(w, d);
      const bad = Object.entries(res).filter(([, ok]) => !ok).map(([k]) => k);
      total += Object.keys(res).length;
      failed += bad.length;
      console.log(`${bad.length ? '✗' : '✓'} ${name}  (${Object.keys(res).length - bad.length}/${Object.keys(res).length})`);
      for (const [k, ok] of Object.entries(res)) console.log(`    ${ok ? '·' : '✗'} ${k}`);
    } catch (e) {
      failed++; total++;
      console.log(`✗ ${name} 抛异常: ${e.message}`);
    } finally {
      dom.window.close();
    }
  }
} finally {
  server.close();
}

console.log(`\n断言 ${total} 条，失败 ${failed} 条`);
process.exit(failed ? 1 : 0);
