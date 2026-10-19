const { JSDOM } = require('jsdom');
const fs = require('fs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const file = process.argv[2] || '/tmp/test-img.pptx';
const data = fs.readFileSync(file);
console.log('测试:', file.split('/').pop(), data.length, '字节');
JSDOM.fromURL('http://127.0.0.1:8888/viewer.html', {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  beforeParse(w){
    w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder; w.scrollTo = () => {};
    if (!w.matchMedia) w.matchMedia = () => ({matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}});
  }
}).then(async dom => {
  const w = dom.window, d = w.document;
  await new Promise(r => w.addEventListener('load', r, {once:true}));
  await wait(1500);
  w.MDLens.show('测试.pptx', data.toString('base64'));
  await wait(9000);
  const pv = d.getElementById('pptxView');
  console.log('视图显示:', pv.classList.contains('show'));
  console.log('幻灯片卡片:', pv.querySelectorAll('.slide').length);
  console.log('图片:', pv.querySelectorAll('img').length);
  pv.querySelectorAll('.slide').forEach((s, i) => {
    const t = s.querySelector('.slide-t');
    console.log(`  第${i+1}页: 标题=${JSON.stringify((t||{}).textContent||'')} 图=${s.querySelectorAll('img').length}`);
  });
  process.exit(0);
}).catch(e => { console.error('失败:', e.message); process.exit(1); });
