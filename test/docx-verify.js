const JSZip = require('/root/mdlens/assets/libs/jszip.min.js');
const fs = require('fs');

function xmlEsc(s){ return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;"); }
function docxParagraph(text, styleId){
  var ppr = styleId ? '<w:pPr><w:pStyle w:val="'+styleId+'"/></w:pPr>' : "";
  var runs = String(text||"").split(/\n/).map(function(l,i){ return (i?"<w:br/>":"")+'<w:t xml:space="preserve">'+xmlEsc(l)+"</w:t>"; }).join("");
  return "<w:p>"+ppr+"<w:r>"+runs+"</w:r></w:p>";
}
function docxTable(rows){
  var body = rows.map(function(r){ return "<w:tr>"+r.map(function(c){ return '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">'+xmlEsc(c)+"</w:t></w:r></w:p></w:tc>"; }).join("")+"</w:tr>"; }).join("");
  return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>'+body+"</w:tbl>";
}
const blocks = [
  {type:"h", level:1, text:"项目计划"},
  {type:"h", level:2, text:"一、背景"},
  {type:"p", text:"这是正文段落，测试中文。"},
  {type:"li", text:"要点一"},
  {type:"table", rows:[["阶段","时间","负责人"],["立项","3月","张三"]]},
];
const body = blocks.map(function(b){
  if (b.type==="h") return docxParagraph(b.text, "Heading"+b.level);
  if (b.type==="li") return docxParagraph("• "+b.text);
  if (b.type==="table") return docxTable(b.rows);
  return docxParagraph(b.text);
}).join("");
const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';
const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>';
const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const drels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';

const zip = new JSZip();
zip.file("[Content_Types].xml", ct);
zip.file("_rels/.rels", rels);
zip.file("word/document.xml", doc);
zip.file("word/styles.xml", styles);
zip.file("word/_rels/document.xml.rels", drels);
zip.generateAsync({type:"nodebuffer", compression:"DEFLATE"}).then(buf => {
  fs.writeFileSync('/tmp/out.docx', buf);
  console.log('生成 out.docx:', buf.length, '字节');
});
