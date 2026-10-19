const { JSDOM } = require('jsdom');
const wait = ms => new Promise(r => setTimeout(r, ms));
JSDOM.fromURL('http://127.0.0.1:8888/viewer.html', {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  beforeParse(window) {
    window.TextDecoder = TextDecoder; window.TextEncoder = TextEncoder;
    window.scrollTo = () => {};
    window.__errs = [];
    window.addEventListener('error', e => window.__errs.push('ERR: ' + (e.message||'?') + ' @' + (e.lineno||0)));
    if (!window.matchMedia) window.matchMedia = () => ({matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}});
    class FakeBlob { constructor(parts, opts){ this.parts = parts; this.type = opts && opts.type; } }
    window.Blob = FakeBlob;
    window.URL.createObjectURL = () => 'blob:x';
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = function(){};
  }
}).then(async dom => {
  const w = dom.window, d = w.document;
  await new Promise(r => w.addEventListener('load', r, {once:true}));
  await wait(1500);
  console.log('JSZip:', typeof w.JSZip, '| PptxGenJS:', typeof w.PptxGenJS, '| XLSX:', typeof w.XLSX);
  d.getElementById('wOutline').click(); await wait(300);
  d.getElementById('opText').value = '# 标题\n- 一\n- 二';
  d.getElementById('opDocx').click();
  await wait(3000);
  console.log('docx toast:', d.getElementById('toast').textContent);
  console.log('页面错误:', w.__errs.join(' | ') || 'none');
  process.exit(0);
}).catch(e => { console.error('失败:', e.message); process.exit(1); });
