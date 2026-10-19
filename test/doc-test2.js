const { JSDOM } = require('jsdom');
const fs = require('fs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const path = process.argv[2] || '/sdcard/Download/WeiXin/关于利用“学习强国”平台开设公共选修课的通知.doc';
const doc = fs.readFileSync(path);
console.log('测试文件:', path.split('/').pop(), doc.length, '字节');
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
  w.MDLens.show('1d7e26f76d9d50d9979', doc.toString('base64'));   // 故意用哈希名
  await wait(7000);
  const c = d.getElementById('content');
  console.log('视图显示:', c.classList.contains('show'));
  console.log('段落:', c.querySelectorAll('p').length);
  console.log('表格:', c.querySelectorAll('table').length,
              '| 行:', c.querySelectorAll('tr').length,
              '| 单元格:', c.querySelectorAll('td,th').length);
  console.log('正文长度:', c.textContent.length);
  console.log('含「学习强国」:', c.textContent.includes('学习强国'));
  console.log('开头:', c.textContent.replace(/\s+/g,' ').slice(0, 80));
  process.exit(0);
}).catch(e => { console.error('失败:', e.message); process.exit(1); });
