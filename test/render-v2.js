const { JSDOM } = require('jsdom');
const fs = require('fs');
const md = fs.readFileSync('/sdcard/运动世界-逆向分析报告.md');
const b64 = md.toString('base64');
const wait = ms => new Promise(r => setTimeout(r, ms));

JSDOM.fromURL('http://127.0.0.1:8888/viewer.html', {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  beforeParse(window) {
    window.TextDecoder = TextDecoder; window.TextEncoder = TextEncoder;
    window.scrollTo = () => {};
    if (!window.matchMedia) window.matchMedia = () => ({matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}});
  }
}).then(async dom => {
  const w = dom.window;
  await new Promise(r => w.addEventListener('load', r, {once:true}));
  await wait(1800);
  console.log('库加载: marked=' + typeof w.marked + ' DOMPurify=' + typeof w.DOMPurify +
              ' hljs=' + typeof w.hljs + ' MDLens=' + typeof w.MDLens);
  w.MDLens.show('运动世界-逆向分析报告.md', b64);
  await wait(1500);
  const d = w.document;
  const content = d.getElementById('content');
  const hs = content.querySelectorAll('h1,h2,h3,h4,h5,h6');
  console.log('视图 content.show:', content.classList.contains('show'));
  console.log('标题:', hs.length, '| 表格:', content.querySelectorAll('table').length,
              '| 代码块:', content.querySelectorAll('pre code').length,
              '| 目录项:', d.getElementById('tocList').querySelectorAll('.tocitem').length);
  console.log('顶栏:', d.getElementById('title').textContent.replace(/\s+/g,' ').slice(0,64));

  // 搜索
  d.getElementById('btnSearch').click();
  d.getElementById('searchInput').value = '广告';
  d.getElementById('searchInput').dispatchEvent(new w.Event('input'));
  await wait(700);
  const hits = content.querySelectorAll('mark.hl-hit');
  console.log('搜索「广告」命中:', hits.length, '| 计数显示:', d.getElementById('searchCount').textContent);

  // 源码视图
  d.getElementById('btnSource').click();
  console.log('源码视图可见:', d.getElementById('sourceView').classList.contains('show'),
              '| 长度:', d.getElementById('sourceView').textContent.length);
  process.exit(0);
}).catch(e => { console.error('失败:', e); process.exit(1); });
