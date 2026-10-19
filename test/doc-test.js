const { JSDOM } = require('jsdom');
const fs = require('fs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const path = '/sdcard/Download/WeiXin/关于利用“学习强国”平台开设公共选修课的通知.doc';
const doc = fs.readFileSync(path);
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
  // 故意给一个无扩展名的哈希名，模拟微信分享的情况
  w.MDLens.show('1d7e26f76d9d50d9979', doc.toString('base64'));
  await wait(6000);
  const c = d.getElementById('content');
  console.log('嗅探后视图:', c.classList.contains('show'));
  console.log('正文长度:', c.textContent.length);
  console.log('含「学习强国」:', c.textContent.includes('学习强国'));
  console.log('段落数:', c.querySelectorAll('p').length);
  console.log('开头:', c.textContent.replace(/\s+/g,' ').slice(0, 90));
  process.exit(0);
}).catch(e => { console.error('失败:', e.message); process.exit(1); });
