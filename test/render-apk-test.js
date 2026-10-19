const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('/tmp/apk-viewer.html', 'utf8');
const mdPath = process.argv[2] || '/sdcard/运动世界-逆向分析报告.md';
const md = fs.readFileSync(mdPath, 'utf8');
const b64 = Buffer.from(md, 'utf8').toString('base64');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.TextDecoder = TextDecoder;
    window.TextEncoder = TextEncoder;
    window.scrollTo = () => {};
    if (!window.matchMedia) window.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
  }
});
const w = dom.window;

w.addEventListener('load', () => setTimeout(() => {
  const t0 = Date.now();
  try {
    w.MDLens.show(mdPath.split('/').pop(), b64);
  } catch (e) {
    console.log('❌ MDLens.show 抛异常:', e.message);
    process.exit(1);
  }
  const d = w.document;
  const content = d.getElementById('content');
  const hs = content.querySelectorAll('h1,h2,h3,h4,h5,h6');
  const tables = content.querySelectorAll('table');
  const codes = content.querySelectorAll('pre code');
  const toc = d.getElementById('tocList').querySelectorAll('.tocitem');
  const welcomeShown = d.getElementById('welcome').classList.contains('show');
  const srcHidden = !d.getElementById('content').classList.contains('hide');
  console.log('渲染耗时:', Date.now()-t0, 'ms');
  console.log('标题数:', hs.length);
  console.log('表格数:', tables.length);
  console.log('代码块数:', codes.length);
  console.log('目录项数:', toc.length);
  console.log('欢迎页仍显示:', welcomeShown, '(应为 false)');
  console.log('正文可见:', srcHidden, '(应为 true)');
  console.log('顶栏:', d.getElementById('title').textContent.replace(/\s+/g,' ').slice(0,70));
  console.log('首个标题:', hs[0] ? JSON.stringify(hs[0].textContent.slice(0,40)) : '(无)');
  console.log('首标题 id:', hs[0] ? hs[0].id : '');
  console.log('所有标题带 id:', [...hs].every(h=>h.id));
  // 源码视图
  w.document.getElementById('btnSource').click();
  console.log('源码视图文字长度:', d.getElementById('sourceView').textContent.length);
  process.exit(0);
}, 400));
