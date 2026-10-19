const { JSDOM } = require('jsdom');
const wait = ms => new Promise(r => setTimeout(r, ms));
JSDOM.fromURL('http://127.0.0.1:8888/viewer.html', {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  beforeParse(w){ w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder; w.scrollTo = () => {}; }
}).then(async dom => {
  const w = dom.window, d = w.document;
  await new Promise(r => w.addEventListener('load', r, {once:true}));
  await wait(1000);
  console.log('初始 XLSX:', typeof w.XLSX);
  const s = d.createElement('script');
  s.src = 'http://127.0.0.1:8888/libs/jszip.min.js';
  s.onload = () => console.log('动态 script onload 触发');
  s.onerror = () => console.log('动态 script onerror');
  d.head.appendChild(s);
  await wait(2500);
  console.log('动态加载后 JSZip:', typeof w.JSZip);
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
