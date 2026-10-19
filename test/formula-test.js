const { JSDOM } = require('jsdom');
const wait = ms => new Promise(r => setTimeout(r, ms));
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
  const md = "# 公式测试\n\n行内公式 $E=mc^2$ 应该被渲染。\n\n$$\\sum_{i=1}^{n} x_i = \\frac{n(n+1)}{2}$$\n\n| 项 | 值 |\n| --- | --- |\n| a | 1 |\n";
  w.MDLens.show('formula.md', Buffer.from(md).toString('base64'));
  await wait(3000);
  const c = d.getElementById('content');
  console.log('KaTeX 已加载:', typeof w.katex);
  console.log('公式渲染节点 .katex:', c.querySelectorAll('.katex').length);
  console.log('display 公式:', c.querySelectorAll('.katex-display').length);
  console.log('表格:', c.querySelectorAll('table').length);
  // 大纲纯文本解析（一、二、三 风格）
  d.getElementById('wOutline').click(); await wait(200);
  d.getElementById('opText').value = '一、项目背景\n现状说明文字\n（一）子项\n- 要点A\n1. 编号项';
  d.getElementById('opPreview').click();
  await wait(1200);
  const hhs = d.getElementById('content').querySelectorAll('h1,h2,h3');
  console.log('纯文本大纲识别标题数:', hhs.length, '| 文本:', Array.from(hhs).map(h=>h.tagName+':'+h.textContent).join(' '));
  process.exit(0);
}).catch(e => { console.error('失败:', e.message); process.exit(1); });
