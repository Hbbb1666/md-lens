const { JSDOM } = require('jsdom');
const wait = ms => new Promise(r => setTimeout(r, ms));
JSDOM.fromURL('http://127.0.0.1:8888/viewer.html', {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  beforeParse(w){
    w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder; w.scrollTo = () => {};
    w.__errs = [];
    w.addEventListener('error', e => w.__errs.push('ERR: ' + (e.message||'?')));
    if (!w.matchMedia) w.matchMedia = () => ({matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}});
    class FakeBlob { constructor(parts, opts){ this.parts = parts; this.type = opts && opts.type; } }
    w.Blob = FakeBlob;
    w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function(){};
  }
}).then(async dom => {
  const w = dom.window, d = w.document;
  await new Promise(r => w.addEventListener('load', r, {once:true}));
  await wait(1200);
  console.log('opDocx 有绑定:', typeof d.getElementById('opDocx').onclick);
  console.log('opText 存在:', !!d.getElementById('opText'));
  d.getElementById('wOutline').click();
  await wait(200);
  console.log('面板打开:', d.getElementById('outlinePanel').classList.contains('open'));
  d.getElementById('opText').value = '# 标题\n- 一\n- 二';
  console.log('textarea 值长度:', d.getElementById('opText').value.length);
  d.getElementById('opDocx').click();
  for (let i = 0; i < 8; i++) {
    await wait(700);
    const busyShown = d.getElementById('busy').classList.contains('show');
    const toastTxt = d.getElementById('toast').textContent;
    console.log(`[${i}] busy=${busyShown} toast="${toastTxt}" JSZip=${typeof w.JSZip}`);
    if (!busyShown && i > 1) break;
  }
  console.log('错误:', w.__errs.join(' | ') || 'none');
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
