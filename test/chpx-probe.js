const XLSX = require('/root/mdlens/assets/libs/xlsx.full.min.js');
const fs = require('fs');
const path = process.argv[2] || '/sdcard/Download/红色经典配音活动方案.doc';
const buf = fs.readFileSync(path);
const cfb = XLSX.CFB.read(buf, { type: 'buffer' });
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
console.log(`WordDocument ${wd.length}B, Table ${tbl.length}B, 文本区 ${fcMin}..${fcMac}`);

// FibRgFcLcb97 第 12 项 = fcPlcfbteChpx：fc @ 0xFA, lcb @ 0xFE
const fcChpx = rd32(wd, 0xFA), lcbChpx = rd32(wd, 0xFE);
console.log(`fcPlcfbteChpx=${fcChpx} lcb=${lcbChpx}`);
if (fcChpx <= 0 || lcbChpx <= 0 || fcChpx + lcbChpx > tbl.length) { console.log('!! 偏移不可用'); process.exit(0); }
const n = Math.floor((lcbChpx - 4) / 8);
console.log(`FKP 页数: ${n}`);

function sprmSize(sprm){
  const spra = (sprm >> 13) & 7;
  return [1,1,2,4,2,2,-1,3][spra] ?? -1;
}
function parseSprms(fkp, off, len){
  const props = {};
  let p = off, end = off + len;
  while (p + 2 <= end){
    const sprm = fkp[p] | (fkp[p+1] << 8);
    p += 2;
    const size = sprmSize(sprm);
    if (size < 0 || p + size > end) break;
    if (sprm === 0x0835) props.bold = fkp[p] !== 0;
    else if (sprm === 0x0836) props.italic = fkp[p] !== 0;
    else if (sprm === 0x2A3E) props.underline = fkp[p] !== 0;
    else if (sprm === 0x6877) props.color = '#' + [fkp[p+2], fkp[p+1], fkp[p]].map(x => x.toString(16).padStart(2,'0')).join('');
    p += size;
  }
  return props;
}
const runs = [];
for (let i = 0; i < n; i++){
  const pn = rd32(tbl, fcChpx + (n + 1) * 4 + i * 4);
  const fkpOff = pn * 512;
  if (fkpOff + 512 > wd.length) continue;
  const crun = wd[fkpOff + 511];
  if (crun === 0 || crun > 100) continue;
  for (let j = 0; j < crun; j++){
    const fcStart = rd32(wd, fkpOff + j * 4);
    const fcEnd = rd32(wd, fkpOff + (j + 1) * 4);
    const bOff = wd[fkpOff + (crun + 1) * 4 + j];
    const chpxOff = fkpOff + bOff;
    const cb = wd[chpxOff];
    const props = cb > 0 ? parseSprms(wd, chpxOff + 1, cb) : {};
    if (Object.keys(props).length) runs.push({ fcStart, fcEnd, props });
  }
}
console.log(`带格式的 run 数: ${runs.length}`);
console.log('前 8 个:');
runs.slice(0, 8).forEach(r => {
  const cStart = Math.floor((r.fcStart - fcMin) / 2);
  const text = new TextDecoder('utf-16le').decode(wd.subarray(r.fcStart, Math.min(r.fcEnd, r.fcStart + 60)));
  console.log(`  char[${cStart}] ${JSON.stringify(text.slice(0,24))} -> ${JSON.stringify(r.props)}`);
});
