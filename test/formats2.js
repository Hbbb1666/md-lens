const { JSDOM } = require('jsdom');
const fs = require('fs');
const wait = ms => new Promise(r => setTimeout(r, ms));
let captured = [];
JSDOM.fromURL('http://127.0.0.1:8888/viewer.html', {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  beforeParse(window) {
    window.TextDecoder = TextDecoder; window.TextEncoder = TextEncoder;
    window.scrollTo = () => {};
    if (!window.matchMedia) window.matchMedia = () => ({matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}});
    class FakeBlob { constructor(parts, opts){ this.parts = parts; this.type = opts && opts.type; } }
    window.Blob = FakeBlob;
    window.URL.createObjectURL = (b) => { captured.push({ parts: (b.parts||[]).map(p => p instanceof Uint8Array ? Array.from(p.slice(0,8)) : p), size: b.parts ? b.parts.reduce((n,p)=>n+(p.length||p.byteLength||0),0) : 0, type: b.type }); return 'blob:x'; };
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = function(){};
  }
}).then(async dom => {
  const w = dom.window, d = w.document;
  await new Promise(r => w.addEventListener('load', r, {once:true}));
  await wait(1500);

  // ---- Excel 预览 ----
  const xlsx = fs.readFileSync('/tmp/test.xlsx');
  w.MDLens.show('test.xlsx', xlsx.toString('base64'));
  await wait(3000);
  const sv = d.getElementById('sheetView');
  console.log('[xlsx] 视图:', sv.classList.contains('show'), '| 表格:', sv.querySelectorAll('table').length,
              '| 单元格:', sv.querySelectorAll('td').length);
  console.log('[xlsx] 内容:', sv.textContent.replace(/\s+/g,' ').slice(0,70));

  // ---- 大纲 → docx / xlsx / pptx ----
  const outline = `# 项目计划
## 一、背景
- 现状：手工整理
- 问题：效率低
## 二、方案
| 阶段 | 时间 | 负责人 |
| --- | --- | --- |
| 立项 | 3月 | 张三 |
| 开发 | 4月 | 李四 |
## 三、风险
1. 人员不足
2. 预算超支`;
  d.getElementById('wOutline').click();
  await wait(300);
  d.getElementById('opText').value = outline;
  captured = [];
  d.getElementById('opDocx').click();
  await wait(2500);
  console.log('[大纲→docx] 捕获:', captured.length, captured.map(c => c.type + ' ' + c.size + 'B').join(','));
  if (captured[0]) console.log('  zip 头:', JSON.stringify(captured[0].parts[0]), '(应为 80,75,3,4)');
  captured = [];
  d.getElementById('opXlsx').click();
  await wait(2500);
  console.log('[大纲→xlsx] 捕获:', captured.length, captured.map(c => c.type + ' ' + c.size + 'B').join(','));
  captured = [];
  d.getElementById('opPptx').click();
  await wait(3500);
  console.log('[大纲→pptx] 捕获:', captured.length, captured.map(c => c.type + ' ' + c.size + 'B').join(','));
  process.exit(0);
}).catch(e => { console.error('失败:', e.message, e.stack); process.exit(1); });
