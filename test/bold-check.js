const XLSX = require('/root/mdlens/assets/libs/xlsx.full.min.js');
const fs = require('fs');
const p = process.argv[2];
const cfb = XLSX.CFB.read(fs.readFileSync(p), { type: 'buffer' });
let wdIdx=-1,t1=-1,t0=-1;
cfb.FullPaths.forEach((x,i)=>{ if(/WordDocument$/.test(x))wdIdx=i; else if(/\/1Table$/.test(x))t1=i; else if(/\/0Table$/.test(x))t0=i; });
const wd = Buffer.from(cfb.FileIndex[wdIdx].content);
const flags = wd.readUInt16LE(0x0A);
const tbl = Buffer.from(cfb.FileIndex[(flags & 0x0200) ? t1 : t0].content);
const rd32=(b,o)=>b.readUInt32LE(o);
const fcMin=rd32(wd,0x18), fcMac=rd32(wd,0x1C);
const text = new TextDecoder('utf-16le').decode(wd.subarray(fcMin,fcMac));
const fcChpx=rd32(wd,0xFA), lcbChpx=rd32(wd,0xFE), n=Math.floor((lcbChpx-4)/8);
const SPRA=[1,1,2,4,2,2,-1,3];
function props(grp){
  const o={}; let p2=0,g=0;
  while(p2+2<=grp.length && g++<200){
    const sprm=grp[p2]|(grp[p2+1]<<8), spra=(sprm>>13)&7, sz=SPRA[spra];
    if(sz<0||p2+2+sz>grp.length) break;
    const v=grp.subarray(p2+2,p2+2+sz);
    if(sprm===0x0835) o.bold=v[0]!==0;
    else if(sprm===0x0836) o.italic=v[0]!==0;
    else if(sprm===0x2A3E) o.underline=v[0]!==0;
    p2+=2+sz;
  }
  return o;
}
const runs=[];
for(let i=0;i<n;i++){
  const pn=rd32(tbl,fcChpx+(n+1)*4+i*4), off=pn*512;
  if(off+512>wd.length) continue;
  const crun=wd[off+511]; if(!crun||crun>100) continue;
  for(let j=0;j<crun;j++){
    const fcs=rd32(wd,off+j*4), fce=rd32(wd,off+(j+1)*4);
    const b=wd[off+(crun+1)*4+j], cb=wd[off+b];
    if(!cb) continue;
    const pr=props(wd.subarray(off+b+1,off+b+1+cb));
    if(!Object.keys(pr).length) continue;
    runs.push({s:Math.floor((fcs-fcMin)/2),e:Math.floor((fce-fcMin)/2),pr,
      t:text.slice(Math.max(0,Math.floor((fcs-fcMin)/2)), Math.floor((fce-fcMin)/2)).replace(/[\r\u0007]/g,' ').trim()});
  }
}
runs.sort((a,b)=>a.s-b.s);
console.log(`\n=== ${p.split('/').pop()} ===`);
console.log(`带格式 run ${runs.length} | bold ${runs.filter(r=>r.pr.bold).length} | 全文 ${text.length} 字`);
runs.slice(0, 10).forEach(r => console.log(`  [${r.s}] ${JSON.stringify(r.pr)} "${r.t.slice(0,26)}"`));
