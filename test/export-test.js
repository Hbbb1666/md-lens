const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('/root/mdlens/assets/viewer.html', 'utf8');
const mdPath = '/sdcard/运动世界-逆向分析报告.md';
const md = fs.readFileSync(mdPath, 'utf8');
const b64 = Buffer.from(md, 'utf8').toString('base64');

let captured = null;
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(window) {
    window.TextDecoder = TextDecoder; window.TextEncoder = TextEncoder;
    window.scrollTo = () => {};
    class FakeBlob { constructor(parts, opts){ this.parts = parts; this.type = opts && opts.type; } }
    window.Blob = FakeBlob;
    window.URL.createObjectURL = (b) => { captured = (b.parts || []).join(''); return 'blob:x'; };
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = function(){};
    if (!window.matchMedia) window.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
  }
});
const w = dom.window;
w.addEventListener('load', () => setTimeout(() => {
  w.MDLens.show('运动世界-逆向分析报告.md', b64);
  w.document.getElementById('btnExport').click();
  w.document.getElementById('exHtml').click();
  const ok = {
    blobHtml: captured ? captured.length : 0,
    hasTitle: captured ? captured.indexOf('运动世界-逆向分析报告') >= 0 : false,
    hasBody: captured ? captured.indexOf('<table') >= 0 : false,
    escapedScripts: captured ? captured.split('</script>').length <= 3 : false,
    darkCssLeaked: captured ? captured.indexOf('color-scheme:dark') >= 0 : true,
  };
  console.log('导出 HTML 字节:', ok.blobHtml);
  console.log('含文档标题:', ok.hasTitle);
  console.log('含表格:', ok.hasBody);
  console.log('没有裸 </script> 截断:', ok.escapedScripts);
  console.log('没漏进暗色 CSS:', !ok.darkCssLeaked);
  process.exit(0);
}, 400));
