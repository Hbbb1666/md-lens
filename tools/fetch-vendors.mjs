#!/usr/bin/env node
// 并发拉取 vendor/ + vendor2/（产物与 fetch-vendors.sh 完全相同）。
//
// 为什么还要一个 JS 版：fetch-vendors.sh 用 curl 单连接，从国内拉 jsdelivr
// 常常只有 ~150KB/s，整个 mermaid 3.4MB 能卡上几分钟甚至超时；
// 这里 8 路并发，并且带「0 字节文件必须重下」的校验 —— curl -o 失败时会
// 留下 0 字节文件，而 assemble.py 只看文件在不在，会静默通过。
//
//   node tools/fetch-vendors.mjs
//   node tools/fetch-vendors.mjs --force     强制全部重下
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CDN = 'https://cdn.jsdelivr.net/npm/';
const FORCE = process.argv.includes('--force');
const CONCURRENCY = 8;

const KATEX_FONTS = `KaTeX_Main-Regular KaTeX_Main-Bold KaTeX_Main-Italic KaTeX_Main-BoldItalic
KaTeX_Math-Italic KaTeX_Math-BoldItalic KaTeX_AMS-Regular KaTeX_Size1-Regular
KaTeX_Size2-Regular KaTeX_Size3-Regular KaTeX_Size4-Regular KaTeX_Caligraphic-Regular
KaTeX_Caligraphic-Bold KaTeX_Fraktur-Regular KaTeX_Fraktur-Bold KaTeX_SansSerif-Regular
KaTeX_SansSerif-Bold KaTeX_SansSerif-Italic KaTeX_Script-Regular KaTeX_Typewriter-Regular`.split(/\s+/);

// 注意 pdfjs-dist 的版本：仓库原来钉的 3.32.2 在 npm 上不存在（jsdelivr 直接 404），
// 会让新克隆在拉 pdf.js 这一步就断掉。3.11.174 是 3.x 的最后一个版本。
const PDFJS = 'pdfjs-dist@3.11.174';

const FILES = [
  ['vendor/marked.min.js', 'marked@12/marked.min.js'],
  ['vendor/purify.min.js', 'dompurify@3/dist/purify.min.js'],
  ['vendor/highlight.min.js', '@highlightjs/cdn-assets@11/highlight.min.js'],
  ['vendor/github-markdown.css', 'github-markdown-css@5/github-markdown.min.css'],
  ['vendor/github-markdown-light.css', 'github-markdown-css@5/github-markdown-light.min.css'],
  ['vendor/github-markdown-dark.css', 'github-markdown-css@5/github-markdown-dark.min.css'],
  ['vendor/hl-github.css', '@highlightjs/cdn-assets@11/styles/github.min.css'],
  ['vendor/hl-github-dark.css', '@highlightjs/cdn-assets@11/styles/github-dark.min.css'],
  ['vendor2/katex.min.js', 'katex@0.16/dist/katex.min.js'],
  ['vendor2/katex.min.css', 'katex@0.16/dist/katex.min.css'],
  ['vendor2/mermaid.min.js', 'mermaid@11/dist/mermaid.min.js'],
  ['vendor2/mammoth.js', 'mammoth/mammoth.browser.min.js'],
  ['vendor2/pdf.min.js', `${PDFJS}/legacy/build/pdf.min.js`],
  ['vendor2/pdf.worker.min.js', `${PDFJS}/legacy/build/pdf.worker.min.js`],
  ['vendor2/xlsx.full.min.js', 'xlsx/dist/xlsx.full.min.js'],
  ['vendor2/pptxgen.bundle.js', 'pptxgenjs/dist/pptxgen.bundle.js'],
  ['vendor2/jszip.min.js', 'jszip@3.10.2/dist/jszip.min.js'],
  ...KATEX_FONTS.map(f => [`vendor2/katexfonts/${f}.woff2`, `katex@0.16/dist/fonts/${f}.woff2`]),
];

/** pdf.js 的 cmaps / standard_fonts 由目录清单决定，写死列表迟早漏 */
async function pdfjsResources() {
  const url = `https://data.jsdelivr.com/v1/packages/npm/${PDFJS}?structure=flat`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`取 pdfjs 文件清单失败：HTTP ${res.status}`);
  const data = await res.json();
  const out = [];
  for (const f of data.files || []) {
    const n = f.name;
    if (!n.includes('/cmaps/') && !n.includes('/standard_fonts/')) continue;
    const sub = n.includes('/cmaps/') ? 'cmaps' : 'standard_fonts';
    out.push([`vendor2/pdfjs/${sub}/${path.basename(n)}`, `${PDFJS}${n}`]);
  }
  return out;
}

const needs = rel => {
  const p = path.join(ROOT, rel);
  if (FORCE) return true;
  return !fs.existsSync(p) || fs.statSync(p).size === 0;
};

async function download(rel, remote) {
  const dest = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(CDN + remote);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('收到 0 字节');
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function pool(items) {
  const queue = items.slice();
  const failed = [];
  let done = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const [rel, remote] = queue.shift();
      try {
        await download(rel, remote);
      } catch (e) {
        if (failed.length < 3 || !failed.some(f => f[0] === rel)) failed.push([rel, e.message]);
      }
      done++;
      if (done % 25 === 0 || done === items.length) process.stdout.write(`\r  已处理 ${done}/${items.length}`);
    }
  }));
  process.stdout.write('\n');
  return failed;
}

console.log('查询 pdf.js 资源清单…');
FILES.push(...await pdfjsResources());
console.log(`共 ${FILES.length} 个文件，需要下载 ${FILES.filter(([r]) => needs(r)).length} 个`);

let todo = FILES.filter(([rel]) => needs(rel));
if (todo.length) {
  let failed = await pool(todo);
  if (failed.length) {
    console.log(`重试 ${failed.length} 个（单线程）…`);
    failed = await pool(failed.map(([rel]) => FILES.find(([r]) => r === rel)));
  }
}

const missing = FILES.filter(([rel]) => needs(rel));
const totalBytes = FILES.reduce((a, [rel]) => {
  const p = path.join(ROOT, rel);
  return a + (fs.existsSync(p) ? fs.statSync(p).size : 0);
}, 0);
console.log(`合计 ${(totalBytes / 1048576).toFixed(2)} MB / ${FILES.length} 个文件`);
if (missing.length) {
  console.error(`✗ 仍缺 ${missing.length} 个：`);
  for (const [rel] of missing.slice(0, 20)) console.error('   ' + rel);
  process.exit(1);
}
console.log('✓ 依赖完整，可以 ./build.sh 了');
