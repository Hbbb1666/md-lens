const { JSDOM } = require('jsdom');
const fs = require('fs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const vc = new (require('jsdom').VirtualConsole)();
vc.on('error', (...a) => console.log('[console.error]', ...a));
vc.on('warn', (...a) => console.log('[console.warn]', ...a));
vc.on('jsdomError', e => console.log('[jsdomError]', e.message));
const data = fs.readFileSync('/tmp/test-img.pptx');
JSDOM.fromURL('http://127.0.0.1:8888/viewer.html', {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w){ w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder; w.scrollTo = () => {}; }
}).then(async dom => {
  const w = dom.window, d = w.document;
  await new Promise(r => w.addEventListener('load', r, {once:true}));
  await wait(1500);
  console.log('JSZip 可用:', typeof w.JSZip);
  w.MDLens.show('测试.pptx', data.toString('base64'));
  await wait(8000);
  console.log('toast:', d.getElementById('toast').textContent);
  console.log('content:', d.getElementById('content').textContent.slice(0, 200).replace(/\s+/g,' '));
  console.log('pptxView innerHTML 长度:', d.getElementById('pptxView').innerHTML.length);
  console.log('pptxView 显示:', d.getElementById('pptxView').classList.contains('show'));
  // 手动验证 JSZip.loadAsync
  if (w.JSZip){
    try {
      const zip = await w.JSZip.loadAsync(new Uint8Array(data));
      const files = Object.keys(zip.files);
      console.log('手动 loadAsync 文件数:', files.length, files.slice(0, 6));
    } catch(e){ console.log('手动 loadAsync 失败:', e.message); }
  }
  process.exit(0);
}).catch(e => { console.error('失败:', e.message); process.exit(1); });
