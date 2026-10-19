const XLSX = require('/root/mdlens/assets/libs/xlsx.full.min.js');
const fs = require('fs');
const path = process.argv[2];
const cfb = XLSX.CFB.read(fs.readFileSync(path), { type: 'buffer' });
let wdIdx=-1,t1=-1,t0=-1;
cfb.FullPaths.forEach((x,i)=>{ if(/WordDocument$/.test(x))wdIdx=i; else if(/\/1Table$/.test(x))t1=i; else if(/\/0Table$/.test(x))t0=i; });
const wd = Buffer.from(cfb.FileIndex[wdIdx].content);
const flags = wd.readUInt16LE(0x0A);
const tbl = Buffer.from(cfb.FileIndex[(flags & 0x0200) ? t1 : t0].content);
const rd32=(b,o)=>b.readUInt32LE(o);
const rd16=(b,o)=>b.readUInt16LE(o);
const SPRA=[1,1,2,4,2,2,-1,3];
function parseSprms(buf, off, len){
  const o = {}; let p = off; const end = off + len; let g=0;
  while (p + 2 <= end && g++ < 200){
    const sprm = buf[p] | (buf[p+1] << 8);
    const spra = (sprm >> 13) & 7, sz = SPRA[spra];
    if (sz < 0 || p + 2 + sz > end) break;
    const v = buf.subarray(p+2, p+2+sz);
    if (sprm === 0x0835) o.bold = v[0] !== 0;
    else if (sprm === 0x0836) o.italic = v[0] !== 0;
    else if (sprm === 0x2A3E) o.underline = v[0] !== 0;
    else if (sprm === 0x6877 && sz === 4 && (v[0]||v[1]||v[2]))
      o.color = '#' + [v[2],v[1],v[0]].map(x=>(x||0).toString(16).padStart(2,'0')).join('');
    p += 2 + sz;
  }
  return o;
}
const fcStshf = rd32(wd, 0xA2), lcbStshf = rd32(wd, 0xA6);
console.log(`${path.split('/').pop()}: fcStshf=${fcStshf} lcb=${lcbStshf}`);
if (!fcStshf || fcStshf + lcbStshf > tbl.length){ console.log('!! 无样式表'); process.exit(0); }
const cbStshi = rd16(tbl, fcStshf);
const cstd = rd16(tbl, fcStshf + 2);
const cbSTDBase = rd16(tbl, fcStshf + 4);
console.log(`cbStshi=${cbStshi} cstd=${cstd} cbSTDBase=${cbSTDBase}`);
let q = fcStshf + 2 + cbStshi;
for (let i = 0; i < cstd; i++){
  if (q + 2 > tbl.length) break;
  const cbStd = rd16(tbl, q);
  if (cbStd === 0){ q += 2; continue; }
  const std = q + 2;
  if (std + cbStd > tbl.length) break;
  try {
    const sti = rd16(tbl, std + 2);
    // MS-DOC 2.9.272: std+4 是 stk(低4位) + istdBase(高12位)，cupx 在 std+6
    const w4 = rd16(tbl, std + 4);
    const stk = w4 & 0x0F;
    const istdBase = (w4 >> 4) & 0x0FFF;
    const cupx = rd16(tbl, std + 6);
    const istdNext = rd16(tbl, std + 8);
    const nameOff = std + cbSTDBase;
    const cch = rd16(tbl, nameOff);
    let name = '';
    for (let k = 0; k < cch && nameOff + 4 + k*2 < tbl.length; k++){
      name += String.fromCharCode(rd16(tbl, nameOff + 2 + k*2));
    }
    // UPX
    let upxOff = nameOff + 2 + cch * 2;
    let props = {};
    for (let u = 0; u < cupx && upxOff + 2 <= tbl.length; u++){
      const cbUpx = rd16(tbl, upxOff);
      if (upxOff + 2 + cbUpx > tbl.length) break;
      Object.assign(props, parseSprms(tbl, upxOff + 2, cbUpx));
      upxOff += 2 + cbUpx;
    }
    console.log(`  #${i} stk=${stk} sti=${sti} istdBase=${istdBase} cupx=${cupx} name="${name}" props=${JSON.stringify(props)}`);
  } catch(e){ console.log(`  #${i} 解析异常: ${e.message}`); }
  q += 2 + cbStd;
}
