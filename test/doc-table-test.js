const { JSDOM } = require('jsdom');
const fs = require('fs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const doc = fs.readFileSync('/sdcard/Download/红色经典配音活动方案.doc');
JSDOM.fromURL('http://127.0.0.1:8888/viewer.html', {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  beforeParse(w){ w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder; w.scrollTo = () => {}; }
}).then(async dom => {
  const w = dom.window, d = w.document;
  await new Promise(r => w.addEventListener('load', r, {once:true}));
  await wait(1500);
  w.MDLens.show('测试.doc', doc.toString('base64'));
  await wait(7000);
  const c = d.getElementById('content');
  const tables = c.querySelectorAll('table');
  tables.forEach((t, i) => {
    console.log(`\n=== 表格 ${i+1} (${t.querySelectorAll('tr').length} 行) ===`);
    Array.from(t.querySelectorAll('tr')).slice(0, 4).forEach(tr => {
      console.log('  | ' + Array.from(tr.children).map(td => td.textContent.trim()).join(' | '));
    });
  });
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
