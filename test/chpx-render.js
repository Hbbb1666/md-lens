const XLSX = require('/root/mdlens/assets/libs/xlsx.full.min.js');
const fs = require('fs');
const path = process.argv[2] || '/sdcard/Download/红色经典配音活动方案.doc';
const cfb = XLSX.CFB.read(fs.readFileSync(path), { type: 'buffer' });
let wdIdx = -1, tIdx = -1;
cfb.FullPaths.forEach((p, i) => {
  if (/WordDocument$/.test(p)) wdIdx = i;
  else if (/\/1Table$/.test(p)) tIdx = i;
  else if (/\/0Table$/.test(p) && tIdx < 0) tIdx = i;
});
const wd = Buffer.from(cfb.FileIndex[wdIdx].content);
const tbl = Buffer.from(cfb.FileIndex[tIdx].content);
const rd32 = (b, o) => b.readUInt32LE(o);
const fcMin = rd32(wd, 0x18), fcMac = rd32(wd, 0x1C);
const text = new TextDecoder('utf-16le').decode(wd.subarray(fcMin, fcMac));
const fcChpx = rd32(wd, 0xFA), lcbChpx = rd32(wd, 0xFE);
const n = Math.floor((lcbChpx - 4) / 8);
function sprmSize(s){ return [1,1,2,4,2,2,-1,3][(s>>13)&7] ?? -1; }
function parseSprms(fkp, off, len){
  const p = {}; let x = off; const end = off + len;
  while (x + 2 <= end){
    const sprm = fkp[x] | (fkp[x+1] << 8); x += 2;
    const sz = sprmSize(sprm);
    if (sz < 0 || x + sz > end) break;
    if (sprm === 0x0835) p.bold = fkp[x] !== 0;
    else if (sprm === 0x0836) p.italic = fkp[x] !== 0;
    else if (sprm === 0x2A3E) p.underline = fkp[x] !== 0;
    else if (sprm === 0x6877) p.color = '#' + [fkp[x+2],fkp[x+1],fkp[x]].map(v=>v.toString(16).padStart(2,'0')).join('');
    x += sz;
  }
  return p;
}
const marks = [];
for (let i = 0; i < n; i++){
  const pn = rd32(tbl, fcChpx + (n+1)*4 + i*4);
  const off = pn * 512;
  if (off + 512 > wd.length) continue;
  const crun = wd[off + 511];
  if (!crun || crun > 100) continue;
  for (let j = 0; j < crun; j++){
    const fcs = rd32(wd, off + j*4), fce = rd32(wd, off + (j+1)*4);
    const b = wd[off + (crun+1)*4 + j];
    const cb = wd[off + b];
    const props = cb > 0 ? parseSprms(wd, off + b + 1, cb) : {};
    if (Object.keys(props).length){
      marks.push({ s: Math.floor((fcs - fcMin)/2), e: Math.floor((fce - fcMin)/2), props });
    }
  }
}
marks.sort((a,b)=>a.s-b.s);
console.log('marks:', marks.length);
// 看前 600 字里哪些带格式
let shown = 0;
for (const m of marks){
  if (m.s < 0 || m.e > text.length || m.e <= m.s) continue;
  const seg = text.slice(m.s, m.e).replace(/[\r\u0007]/g,' ').trim();
  if (!seg) continue;
  console.log(`  [${m.s}-${m.e}] ${JSON.stringify(m.props)} ${JSON.stringify(seg.slice(0,30))}`);
  if (++shown >= 12) break;
}
// 生成一小段带格式的 HTML 看效果
function find(s){ let lo=0, hi=marks.length-1, r=null; while(lo<=hi){const m=(lo+hi)>>1; if(marks[m].e<=s)lo=m+1; else if(marks[m].s>s)hi=m-1; else {r=marks[m];break;}} return r; }
function fmt(from, len){
  let out='', i=0;
  while(i<len){
    const m = find(from+i);
    const end = m ? Math.min(m.e-from, len) : len;
    const seg = text.substr(from+i, Math.max(1, end-i));
    let h = seg.replace(/[\r\u0007]/g,' ');
    if (m){
      if (m.props.bold) h = '<b>'+h+'</b>';
      if (m.props.italic) h = '<i>'+h+'</i>';
      if (m.props.color) h = '<span style="color:'+m.props.color+'">'+h+'</span>';
    }
    out += h; i = Math.max(1, end-i);
  }
  return out;
}
console.log('\n渲染样例（前 400 字）:');
console.log(fmt(0, 400));
