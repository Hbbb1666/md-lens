const XLSX = require('/root/mdlens/assets/libs/xlsx.full.min.js');
const fs = require('fs');
const cfb = XLSX.CFB.read(fs.readFileSync('/sdcard/Download/红色经典配音活动方案.doc'), { type: 'buffer' });
let wdIdx=-1,t1=-1,t0=-1;
cfb.FullPaths.forEach((p,i)=>{ if(/WordDocument$/.test(p))wdIdx=i; else if(/\/1Table$/.test(p))t1=i; else if(/\/0Table$/.test(p))t0=i; });
const wd = Buffer.from(cfb.FileIndex[wdIdx].content);
const flags = wd.readUInt16LE(0x0A);
const tbl = Buffer.from(cfb.FileIndex[(flags & 0x0200) ? t1 : t0].content);
const rd32=(b,o)=>b.readUInt32LE(o);
const fcMin=rd32(wd,0x18), fcMac=rd32(wd,0x1C);
const text = new TextDecoder('utf-16le').decode(wd.subarray(fcMin,fcMac));
const fcChpx=rd32(wd,0xFA), lcbChpx=rd32(wd,0xFE), n=Math.floor((lcbChpx-4)/8);
// 按字节模式找格式指令（little-endian sprm）
function findProp(grp, lo, hi){
  for (let i = 0; i + 2 < grp.length; i++){
    if (grp[i] === lo && grp[i+1] === hi) return grp[i+2] !== 0;
  }
  return null;
}
function findColor(grp){
  for (let i = 0; i + 5 < grp.length; i++){
    if (grp[i] === 0x42 && grp[i+1] === 0x2a){   // sprmCIco 0x2A42
      const b = grp[i+2], g = grp[i+3], r = grp[i+4];
      if (r || g || b) return '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
    }
  }
  return null;
}
const marks = [];
for (let i = 0; i < n; i++){
  const pn = rd32(tbl, fcChpx + (n+1)*4 + i*4);
  const off = pn*512;
  if (off+512 > wd.length) continue;
  const crun = wd[off+511];
  if (!crun || crun > 100) continue;
  for (let j = 0; j < crun; j++){
    const fcs = rd32(wd, off+j*4), fce = rd32(wd, off+(j+1)*4);
    const b = wd[off+(crun+1)*4+j];
    const cb = wd[off+b];
    if (!cb) continue;
    const grp = wd.subarray(off+b+1, off+b+1+cb);
    const props = {};
    const bold = findProp(grp, 0x35, 0x08);
    if (bold !== null) props.bold = bold;
    const ital = findProp(grp, 0x36, 0x08);
    if (ital !== null) props.italic = ital;
    const ul = findProp(grp, 0x3e, 0x2a);
    if (ul !== null) props.underline = ul;
    const col = findColor(grp);
    if (col) props.color = col;
    if (Object.keys(props).length) marks.push({ s: Math.floor((fcs-fcMin)/2), e: Math.floor((fce-fcMin)/2), props });
  }
}
marks.sort((a,b)=>a.s-b.s);
console.log('带格式 run:', marks.length);
let shown = 0;
for (const m of marks){
  if (m.s < 0 || m.e > text.length || m.e <= m.s) continue;
  const seg = text.slice(m.s, m.e).replace(/[\r\u0007]/g,' ').trim();
  if (!seg) continue;
  console.log(`  [${m.s}] ${JSON.stringify(m.props)} ${JSON.stringify(seg.slice(0,26))}`);
  if (++shown >= 14) break;
}
