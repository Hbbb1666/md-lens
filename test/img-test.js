const { JSDOM } = require('jsdom');
const fs = require('fs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const doc = fs.readFileSync('/sdcard/Download/QuarkDownloads/玩家保密协议9.22最终版.docx');
JSDOM.fromURL('http://127.0.0.1:8888/viewer.html', {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  beforeParse(w){ w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder; w.scrollTo = () => {}; }
}).then(async dom => {
  const w = dom.window, d = w.document;
  await new Promise(r => w.addEventListener('load', r, {once:true}));
  await wait(1500);
  w.MDLens.show('玩家保密协议.docx', doc.toString('base64'));
  await wait(7000);
  const dv = d.getElementById('docView');
  const imgs = dv.querySelectorAll('img');
  console.log('docView 显示:', dv.classList.contains('show'));
  console.log('图片数量:', imgs.length);
  imgs.forEach((im, i) => {
    const src = im.getAttribute('src') || '';
    console.log(`  #${i+1} src 前缀: ${src.slice(0, 40)} | 长度: ${src.length}`);
  });
  console.log('正文长度:', dv.textContent.length);
  process.exit(0);
}).catch(e => { console.error('失败:', e.message); process.exit(1); });
