const { JSDOM } = require('jsdom');
const fs = require('fs');
const wait = ms => new Promise(r => setTimeout(r, ms));
JSDOM.fromURL('http://127.0.0.1:8888/viewer.html', {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  beforeParse(window) {
    window.TextDecoder = TextDecoder; window.TextEncoder = TextEncoder;
    window.scrollTo = () => {};
    if (!window.matchMedia) window.matchMedia = () => ({matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}});
  }
}).then(async dom => {
  const w = dom.window, d = w.document;
  await new Promise(r => w.addEventListener('load', r, {once:true}));
  await wait(1500);

  // ---- Word ----
  const docx = fs.readFileSync('/sdcard/Documents/技术转型行动方案.docx');
  w.MDLens.show('技术转型行动方案.docx', docx.toString('base64'));
  await wait(4500);
  const dv = d.getElementById('docView');
  console.log('[docx] 视图:', dv.classList.contains('show'), '| HTML:', dv.innerHTML.length,
              '| 标题:', dv.querySelectorAll('h1,h2,h3,h4,h5,h6').length);
  console.log('[docx] 开头:', dv.textContent.replace(/\s+/g,' ').slice(0,70));

  // ---- Excel ----
  const xlsx = fs.readFileSync('/tmp/test.xlsx');
  w.MDLens.show('test.xlsx', xlsx.toString('base64'));
  await wait(3000);
  const sv = d.getElementById('sheetView');
  console.log('[xlsx] 视图:', sv.classList.contains('show'), '| 表格:', sv.querySelectorAll('table').length,
              '| 单元格:', sv.querySelectorAll('td').length);
  console.log('[xlsx] 内容:', sv.textContent.replace(/\s+/g,' ').slice(0,60));
  process.exit(0);
}).catch(e => { console.error('失败:', e.message); process.exit(1); });
