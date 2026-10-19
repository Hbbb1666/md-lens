
  /* ==================== 结构提取（导出 Word / Excel / PPT 共用） ==================== */
  function fakeInput(src, asMd){
    var text = src != null ? src : state.text;
    if (asMd !== false){
      try { return marked.parse(text); } catch(e){ return "<pre>" + esc(text) + "</pre>"; }
    }
    return "<pre>" + esc(text) + "</pre>";
  }
  function blocksFromHtml(html){
    var box = document.createElement("div");
    box.innerHTML = html;
    return blocksFromRoot(box);
  }
  function blocksFromRoot(root){
    var out = [];
    function walk(el){
      var tag = (el.tagName || "").toLowerCase();
      if (/^h[1-6]$/.test(tag)){
        var t = (el.textContent || "").trim();
        if (t) out.push({ type: "h", level: Math.min(3, parseInt(tag[1], 10)), text: t });
      } else if (tag === "p"){
        var pt = (el.textContent || "").trim();
        if (pt) out.push({ type: "p", text: pt });
      } else if (tag === "ul" || tag === "ol"){
        Array.prototype.forEach.call(el.children, function(li){
          var lt = (li.textContent || "").trim();
          if (lt) out.push({ type: "li", text: lt });
        });
      } else if (tag === "table"){
        var rows = [];
        Array.prototype.forEach.call(el.querySelectorAll("tr"), function(tr){
          var cells = [];
          Array.prototype.forEach.call(tr.children, function(td){ cells.push((td.textContent || "").trim()); });
          if (cells.length) rows.push(cells);
        });
        if (rows.length) out.push({ type: "table", rows: rows });
      } else if (tag === "pre"){
        var ct = (el.textContent || "").replace(/\n+$/, "");
        if (ct) out.push({ type: "code", text: ct });
      } else if (tag === "blockquote"){
        var bt = (el.textContent || "").trim();
        if (bt) out.push({ type: "quote", text: bt });
      } else if (tag === "hr"){
        out.push({ type: "hr" });
      } else {
        Array.prototype.forEach.call(el.children, walk);
      }
    }
    Array.prototype.forEach.call(root.children, walk);
    return out;
  }
  function currentBlocks(){
    if (state.kind === "pptx" && state.current && state.current.slides){
      return state.current.slides.map(function(s){
        return { type: "h", level: 1, text: "第 " + s.num + " 页" };
      });
    }
    var root = state.kind === "docx" ? $("docView") : $("content");
    if (state.kind === "text" && !state.source) return blocksFromHtml($("content").innerHTML);
    return blocksFromRoot(root);
  }

  /* ==================== 生成 Word (.docx) ==================== */
  function xmlEsc(s){
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
  function docxParagraph(text, styleId, bold){
    var ppr = styleId ? '<w:pPr><w:pStyle w:val="' + styleId + '"/></w:pPr>' : "";
    var rpr = bold ? "<w:rPr><w:b/></w:rPr>" : "";
    var runs = String(text || "").split(/\n/).map(function(line, i){
      return (i ? "<w:br/>" : "") + '<w:t xml:space="preserve">' + xmlEsc(line) + "</w:t>";
    }).join("");
    return "<w:p>" + ppr + "<w:r>" + rpr + runs + "</w:r></w:p>";
  }
  function docxTable(rows){
    var body = rows.map(function(r){
      return "<w:tr>" + r.map(function(c){
        return '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>' +
          "<w:p><w:r><w:t xml:space=\"preserve\">" + xmlEsc(c) + "</w:t></w:r></w:p></w:tc>";
      }).join("") + "</w:tr>";
    }).join("");
    return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      body + "</w:tbl>";
  }
  function buildDocx(blocks){
    var body = blocks.map(function(b){
      if (b.type === "h") return docxParagraph(b.text, "Heading" + b.level, false);
      if (b.type === "li") return docxParagraph("• " + b.text, null, false);
      if (b.type === "quote") return docxParagraph(b.text, "Quote", false);
      if (b.type === "code") return docxParagraph(b.text, "Code", false);
      if (b.type === "table") return docxTable(b.rows);
      if (b.type === "hr") return docxParagraph("", null, false);
      return docxParagraph(b.text, null, false);
    }).join("");
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:body>" + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>' +
      "</w:body></w:document>";
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:docDefaults><w:rPrDefault><w:rPr>" +
      '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="180" w:after="90"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:outlineLvl w:val="2"/><w:spacing w:before="120" w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:rPr><w:color w:val="606870"/><w:i/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>' +
      '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr>' +
      '<w:tblBorders>' +
      '<w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' +
      '<w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' +
      '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' +
      '<w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' +
      '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' +
      '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' +
      "</w:tblBorders></w:tblPr></w:style>" +
      "</w:styles>";
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      "</Types>";
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>";
    var drels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>";
    return LIB.load("jszip.min.js").then(function(){
      var zip = new JSZip();
      zip.file("[Content_Types].xml", ct);
      zip.file("_rels/.rels", rels);
      zip.file("word/document.xml", doc);
      zip.file("word/styles.xml", styles);
      zip.file("word/_rels/document.xml.rels", drels);
      return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    });
  }

  /* ==================== 生成 Excel (.xlsx) ==================== */
  function buildXlsx(blocks){
    return LIB.load("xlsx.full.min.js").then(function(){
      var wb = XLSX.utils.book_new();
      var tables = blocks.filter(function(b){ return b.type === "table" && b.rows.length; });
      if (tables.length){
        tables.forEach(function(t, i){
          var ws = XLSX.utils.aoa_to_sheet(t.rows);
          XLSX.utils.book_append_sheet(wb, ws, "表" + (i + 1));
        });
      } else {
        var rows = [["序号", "类型", "内容"]];
        blocks.filter(function(b){ return b.text; }).forEach(function(b, i){
          var label = b.type === "h" ? ("标题" + b.level) : (b.type === "li" ? "要点" : "正文");
          rows.push([i + 1, label, b.text]);
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "内容");
      }
      var out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      return new Uint8Array(out);
    });
  }

  /* ==================== 生成 PPT (.pptx) ==================== */
  function paginateForPpt(blocks){
    var MAX_CHARS = 640, MAX_ITEMS = 8;
    var pages = [], cur = null;
    function newPage(title){ return { title: title || "", items: [], chars: 0 }; }
    blocks.forEach(function(b){
      if (b.type === "h" && b.level <= 2){
        if (cur && (cur.items.length || cur.title)) pages.push(cur);
        cur = newPage(b.text);
      } else if (b.type === "table"){
        if (!cur) cur = newPage("");
        b.rows.slice(0, 6).forEach(function(r){
          var line = r.join(" | ");
          if (cur.items.length >= MAX_ITEMS || cur.chars + line.length > MAX_CHARS){ pages.push(cur); cur = newPage(""); }
          cur.items.push(line); cur.chars += line.length;
        });
      } else if (b.text){
        if (!cur) cur = newPage("");
        if (cur.items.length >= MAX_ITEMS || cur.chars + b.text.length > MAX_CHARS){
          pages.push(cur); cur = newPage("");
        }
        cur.items.push(b.text); cur.chars += b.text.length;
      }
    });
    if (cur && (cur.items.length || cur.title)) pages.push(cur);
    if (!pages.length) pages.push(newPage("未命名"));
    return pages;
  }
  function buildPptx(blocks){
    return LIB.load("pptxgen.bundle.js").then(function(){
      var P = window.PptxGenJS;
      var pptx = new P();
      pptx.layout = "LAYOUT_16x9";
      var pages = paginateForPpt(blocks);
      pages.forEach(function(pg){
        var slide = pptx.addSlide();
        slide.background = { color: "FFFFFF" };
        if (pg.title){
          slide.addText(pg.title, {
            x: 0.5, y: 0.45, w: 9, h: 0.9,
            fontSize: pg.title.length > 24 ? 22 : 28, bold: true, color: "1F2328",
            valign: "middle"
          });
          slide.addShape(pptx.ShapeType.rect, { x: 0.55, y: 1.38, w: 1.2, h: 0.06, fill: { color: "0969DA" } });
        }
        if (pg.items.length){
          slide.addText(pg.items.map(function(t){
            return { text: t, options: { bullet: true, breakLine: true } };
          }), {
            x: 0.62, y: pg.title ? 1.62 : 0.7, w: 8.78, h: pg.title ? 3.85 : 4.6,
            fontSize: 16, color: "333333", valign: "top", lineSpacingMultiple: 1.2
          });
        }
      });
      return pptx.write({ outputType: "arraybuffer" }).then(function(buf){
        return new Uint8Array(buf);
      });
    });
  }

  /* ==================== 写文件 ==================== */
  function safeBase(){
    var n = state.current ? state.current.name : "document";
    n = n.replace(/\.[^.\/\\]+$/, "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "document";
    return n;
  }
  function saveBytes(name, mime, u8){
    if (!NATIVE){
      var blob = new Blob([u8], { type: mime });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      toast("已下载 " + name);
      return;
    }
    MDNative.beginWrite(name, mime);
    var b64 = u8ToB64(u8), CH = 60000;
    for (var i = 0; i < b64.length; i += CH) MDNative.writeChunk(b64.slice(i, i + CH));
    MDNative.endWrite();
  }
  function exportAs(kind, srcText, srcName){
    var blocks;
    if (srcText != null){
      blocks = parseOutline(srcText);
    } else {
      blocks = currentBlocks();
      srcName = state.current ? state.current.name : "document";
    }
    if (!blocks.length){ toast("没有可导出的内容"); return; }
    var base = srcName ? String(srcName).replace(/\.[^.\/\\]+$/, "").replace(/[\\/:*?"<>|]+/g, "_") : safeBase();
    busy(true, "正在生成…");
    var job;
    if (kind === "docx") job = buildDocx(blocks).then(function(u8){ saveBytes(base + ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", u8); });
    else if (kind === "xlsx") job = buildXlsx(blocks).then(function(u8){ saveBytes(base + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", u8); });
    else if (kind === "pptx") job = buildPptx(blocks).then(function(u8){ saveBytes(base + ".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", u8); });
    else job = Promise.reject(new Error("未知格式"));
    job.catch(function(e){ toast("生成失败：" + (e.message || e), 4200); })
       .then(function(){ busy(false); });
  }

  /* ==================== HTML / PDF / PNG 导出 ==================== */
  function buildStandaloneHtml(){
    var styles = ["css-github-light", "css-hl-light"].map(function(id){
      var el = $(id); return el ? el.textContent : "";
    }).join("\n");
    var inner = JSON.stringify($("content").innerHTML).replace(/<\//g, "<\\/");
    return '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>" + esc(state.current ? state.current.name : "文档") + "</title>\n<style>\n" + styles + "\n" +
      "body{margin:0;background:#fff;padding:0}" +
      ".markdown-body{max-width:900px;margin:0 auto;padding:32px 22px;font-size:16px;line-height:1.78}" +
      "img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #d1d9e0;padding:6px 10px}" +
      "</style></head><body><article class=\"markdown-body\" id=\"doc\"></article>" +
      '<script>document.getElementById("doc").innerHTML=' + inner + ";<\/script>" +
      "</body></html>";
  }
  function exportHtml(){
    if (!state.text && state.kind !== "text"){ toast("这个格式先转成 Markdown 再导出"); return; }
    var html = buildStandaloneHtml();
    saveBytes(safeBase() + ".html", "text/html", new TextEncoder().encode(html));
  }
  function exportCurrentPdf(){
    if (!NATIVE){ fallbackDownload(true); return; }
    if (state.kind === "pdf"){ toast("这已经是 PDF 了"); return; }
    MDNative.exportPdf(safeBase() + ".pdf");
  }
  function exportCurrentPng(){
    if (!NATIVE){ fallbackDownload(false); return; }
    MDNative.exportPng(safeBase() + ".png");
  }
  function fallbackDownload(isPdf){
    var html = buildStandaloneHtml();
    var blob = new Blob([html], { type: "text/html" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = safeBase() + ".html";
    a.click();
    toast("浏览器版只能下载 HTML，PDF 请用 App");
  }
