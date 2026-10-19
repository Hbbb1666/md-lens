
  /* ==================== 多格式渲染 ==================== */

  function renderDocx(u8, name){
    busy(true, "解析 Word…");
    LIB.load("mammoth.js").then(function(){
      // 图片内联：超过 400KB 的 base64 自动缩到 1000px 宽（原始大图会撑爆内存/卡死）
      var imgConverter = (mammoth.images && mammoth.images.imgElement) ? mammoth.images.imgElement(function(image){
        return image.read("base64").then(function(b64){
          return new Promise(function(resolve){
            var raw = "data:" + (image.contentType || "image/png") + ";base64," + b64;
            if (b64.length < 400000) { resolve({ src: raw }); return; }
            try {
              var im = new Image();
              im.onload = function(){
                try {
                  var maxW = 1000;
                  var scale = Math.min(1, maxW / im.width);
                  if (scale >= 1) { resolve({ src: raw }); return; }
                  var cv = document.createElement("canvas");
                  cv.width = Math.max(1, Math.round(im.width * scale));
                  cv.height = Math.max(1, Math.round(im.height * scale));
                  cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
                  resolve({ src: cv.toDataURL("image/jpeg", 0.85) });
                } catch(e){ resolve({ src: raw }); }
              };
              im.onerror = function(){ resolve({ src: raw }); };
              im.src = raw;
            } catch(e){ resolve({ src: raw }); }
          });
        });
      }) : null;
      return mammoth.convertToHtml({ arrayBuffer: u8.buffer }, {
        styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Heading 1'] => h1:fresh",
                   "p[style-name='Heading 2'] => h2:fresh", "p[style-name='Heading 3'] => h3:fresh"],
        convertImage: imgConverter || undefined
      });
    }).then(function(r){
      var html = (r && r.value) || "";
      try { html = DOMPurify.sanitize(html, { ADD_ATTR: ["id","class","align","colspan","rowspan","width","height"] }); } catch(e){}
      $("docView").innerHTML = html || "<p>（这个 Word 里没有可显示的正文）</p>";
      state.text = $("docView").innerText || "";
      state.current = { name: name };
      state.kind = "docx";
      showView("docView");
      var heads = addHeadingIds($("docView"));
      buildToc(heads);
      fixImages($("docView"));
      resolveLocalImages($("docView"));
      setTitle(name, "Word");
      updateSourceButton();
      $("progress").style.opacity = "0";
    }).catch(function(e){
      toast("Word 解析失败：" + (e.message || e), 4200);
    }).then(function(){ busy(false); });
  }

  /* ---- Word 97-2003 (.doc)：OLE2 → FIB → Clx(piece table) → 全文 + 表格重建 ----
     fcMin..fcMac 只能拿到非 FastSave 的连续文本，且表格会塌成一行；
     完整做法是解析 Clx 里的 piece table（FastSave 文档的文本是碎片化的）。 */
  function docR32(u, o){ return (u[o] | (u[o+1] << 8) | (u[o+2] << 16) | (u[o+3] << 24)) >>> 0; }
  function docR16(u, o){ return (u[o] | (u[o+1] << 8)) >>> 0; }

  function parseDocPieces(wd, tbl){
    if (!tbl) return null;
    var fcClx = docR32(wd, 0x01A2);
    var lcbClx = docR32(wd, 0x01A6);
    if (fcClx <= 0 || lcbClx <= 0) return null;
    if (fcClx + lcbClx > tbl.length) return null;
    var end = fcClx + lcbClx, p = fcClx;
    // 跳过前置的 Prc 块（0x01 + 2字节长度 + 数据）
    while (p + 3 <= end && tbl[p] === 0x01){
      p += 3 + docR16(tbl, p + 1);
    }
    if (p + 5 > end || tbl[p] !== 0x02) return null;
    var lcb = docR32(tbl, p + 1);
    var plc = p + 5;
    if (lcb < 16 || plc + lcb > tbl.length) return null;
    var n = Math.floor((lcb - 4) / 12);
    if (n <= 0 || n > 2000000) return null;
    var pieces = [];
    for (var i = 0; i < n; i++){
      var cpStart = docR32(tbl, plc + i * 4);
      var cpEnd = docR32(tbl, plc + (i + 1) * 4);
      var off = plc + (n + 1) * 4 + i * 8;
      if (off + 8 > tbl.length) break;
      var fcRaw = docR32(tbl, off + 2);
      var compressed = (fcRaw & 0x40000000) !== 0;
      var fc = (fcRaw & 0x3FFFFFFF) >>> 0;
      if (compressed) fc = Math.floor(fc / 2);
      pieces.push({ cpStart: cpStart, cpEnd: cpEnd, fc: fc, compressed: compressed });
    }
    return pieces.length ? pieces : null;
  }

  function decodeDocPiece(wd, fc, len, compressed){
    if (compressed){
      var bytes = wd.subarray(fc, fc + len);
      try { return new TextDecoder("gbk").decode(bytes); }
      catch(e){
        var s = "";
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return s;
      }
    }
    return new TextDecoder("utf-16le").decode(wd.subarray(fc, fc + len * 2));
  }

  function docPrintableRatio(s){
    var ok = 0, total = 0;
    for (var i = 0; i < s.length; i++){
      var c = s.charCodeAt(i);
      total++;
      if (c === 9 || c === 10 || c === 13) { ok++; continue; }
      if (c < 0x20) continue;
      if (c === 0xFFFD || (c >= 0xE000 && c <= 0xF8FF)) continue;
      ok++;
    }
    return total ? ok / total : 0;
  }

  function extractDocText(wd, tbl){
    // 主路径：fcMin..fcMac 覆盖整个文本区（正文 + 页眉脚注 + 多 story），内容最全
    var byRange = "";
    var fcMin = docR32(wd, 0x18), fcMac = docR32(wd, 0x1C);
    if (fcMac > fcMin && fcMac <= wd.length){
      try { byRange = new TextDecoder("utf-16le").decode(wd.subarray(fcMin, fcMac)); } catch(e){}
    }
    // 备用：piece table（FastSave 文档的文本是按 piece 存放的，范围提取会乱序）
    var byPieces = "";
    var pieces = parseDocPieces(wd, tbl);
    if (pieces){
      for (var i = 0; i < pieces.length; i++){
        var p = pieces[i];
        var len = p.cpEnd - p.cpStart;
        if (len <= 0 || len > 50000000) continue;
        try { byPieces += decodeDocPiece(wd, p.fc, len, p.compressed); } catch(e){}
      }
    }
    var la = byRange.replace(/[\s\u0000]/g, "").length;
    var lb = byPieces.replace(/[\s\u0000]/g, "").length;
    var ra = docPrintableRatio(byRange);
    // 内容优先：范围提取字数不少于 piece table 就用它（可能含页眉脚注，但正文不会丢）；
    // 只有明显更少/大面积乱码时才退到 piece table（FastSave 场景）
    if (la > 2 && (la >= lb || ra >= 0.85)) return byRange;
    if (lb > 2) return byPieces;
    return byRange || byPieces;
  }

  /* 把 .doc 文本流转成 HTML。
     Word 的结构：0x07 = 单元格结束，0x07 0x07 = 行结束，0x0D = 段落符——
     但段落符也会出现在单元格内部（如 "内容切合度\r（30分）"），
     所以不能先按段落切分，必须直接按 0x07 0x07 切行。 */
  function docClean(s){
    return String(s || "")
      .replace(/[\u0000-\u0006\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/\r/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }
  /* 启发式标题判断：绕开 WPS 不标准的 STSH，用文本自身特征识别小标题 */
  function looksLikeHeading(t){
    var s = String(t || "").trim();
    if (!s || s.length > 30) return false;
    if (/^[一二三四五六七八九十百]+[、.．]/.test(s)) return true;
    if (/^[（(][一二三四五六七八九十]+[）)]/.test(s)) return true;
    if (/^第[一二三四五六七八九十百\d]+[章节讲部分]/.test(s)) return true;
    if (/^\d+[.、．]\s*\S/.test(s) && s.length <= 22) return true;
    if (/^(附件|附录|前言|引言|结语|总结|目录|方案|目的|背景|范围|职责|流程|要求|注意|说明|活动主题|活动宗旨|活动内容|活动对象|活动时间|活动要求)/.test(s) && s.length <= 24) return true;
    // 短行且不以标点结尾 → 大概率是小标题
    if (s.length <= 18 && !/[。！？；，、：]$/.test(s) && !/\d$/.test(s)) return true;
    return false;
  }
  function docTextToHtml(text){
    /* 状态机逐字符扫描：0x07=单元格结束，0x07 0x07=行结束，0x0D=段落符。
       早期用 split("\u0007\u0007") 切行是错的——`␇␇性别␇␇` 切出来的中间段
       不含分隔符，会被误判成普通段落（复杂表格就这样被打散成碎片）。 */
    var blocks = [], cells = [], buf = "", inCellRow = false;

    function pushRow(){
      if (buf.length) { cells.push(buf.trim()); buf = ""; }
      else if (cells.length) { cells.push(""); }
      if (cells.some(function(c){ return !!c; })){
        blocks.push({ type: "row", cells: cells.slice() });
      }
      cells = [];
      inCellRow = false;
    }
    function pushPara(){
      var t = docClean(buf);
      buf = "";
      if (t) blocks.push({ type: "p", text: t });
    }

    for (var i = 0; i < text.length; i++){
      var ch = text[i];
      if (ch === "\u0007"){
        if (text[i + 1] === "\u0007"){
          pushRow();
          i++;
        } else {
          cells.push(buf.trim());
          buf = "";
          inCellRow = true;
        }
      } else if (ch === "\r"){
        if (inCellRow){ buf += " "; }
        else { pushPara(); }
      } else {
        buf += ch;
      }
    }
    if (cells.length || inCellRow) pushRow(); else pushPara();

    var html = [], rows = [];
    function flush(){
      if (!rows.length) return;
      // 列数取众数：短行（合并单元格）补空，超宽行截断
      // 列数 = 「出现 >=2 次的最大列数」：
      // 只出现 1 次的超大列数是假列（Word 里偶发的多余 0x07），
      // 而众数又会被合并单元格的 1 格行带偏成 1 列。
      var counts = {};
      rows.forEach(function(r){ counts[r.length] = (counts[r.length] || 0) + 1; });
      var maxCols = 1;
      // 阈值：至少出现 2 次，且不少于总行数的 15%——既排除偶发假列，也排除只出现两次的噪声
      var need = Math.max(2, Math.ceil(rows.length * 0.15));
      for (var ck in counts){
        var cn = parseInt(ck, 10);
        if (counts[ck] >= need && cn > maxCols && cn <= 12) maxCols = cn;
      }
      if (maxCols === 1 && rows.length){
        var mx = 0;
        rows.forEach(function(r){ if (r.length > mx) mx = r.length; });
        maxCols = Math.min(Math.max(mx, 1), 8);
      }
      html.push("<table>");
      rows.forEach(function(r, ri){
        var tag = ri === 0 ? "th" : "td";
        var line = [];
        for (var c = 0; c < maxCols; c++) line.push("<" + tag + ">" + esc(r[c] || "") + "</" + tag + ">");
        html.push("<tr>" + line.join("") + "</tr>");
      });
      html.push("</table>");
      rows = [];
    }
    blocks.forEach(function(b){
      if (b.type === "row"){ rows.push(b.cells); return; }
      flush();
      if (looksLikeHeading(b.text)) {
        html.push('<p class="doc-heading"><strong>' + esc(b.text) + "</strong></p>");
      } else {
        html.push("<p>" + esc(b.text) + "</p>");
      }
    });
    flush();
    return html.join("");
  }

  /* .doc 的图片：Word 97 把图存在 Data 流（小图也可能在 WordDocument 流），
     用 JPEG/PNG 魔数扫描提取。位置拿不到，统一附在文末。 */
  function scanStreamImages(bytes){
    var out = [], i = 0, n = bytes.length;
    while (i < n - 8 && out.length < 30){
      if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF){
        var end = -1;
        for (var j = i + 2; j < n - 1; j++){
          if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9){ end = j + 2; break; }
        }
        if (end > i + 200 && end - i <= 12 * 1024 * 1024){
          out.push({ type: "image/jpeg", data: bytes.subarray(i, end) });
          i = end; continue;
        }
      }
      if (bytes[i] === 0x89 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x4E && bytes[i + 3] === 0x47){
        var endP = -1;
        for (var k = i + 4; k < n - 8; k++){
          if (bytes[k] === 0x49 && bytes[k + 1] === 0x45 && bytes[k + 2] === 0x4E && bytes[k + 3] === 0x44){
            endP = k + 8; break;
          }
        }
        if (endP > i + 200 && endP - i <= 12 * 1024 * 1024){
          out.push({ type: "image/png", data: bytes.subarray(i, endP) });
          i = endP; continue;
        }
      }
      i++;
    }
    return out;
  }
  function extractDocImages(cfb, wd){
    var streams = [];
    for (var i = 0; i < cfb.FullPaths.length; i++){
      if (/\/Data$/i.test(cfb.FullPaths[i] || "")){
        streams.push(new Uint8Array(cfb.FileIndex[i].content));
        break;
      }
    }
    streams.push(wd);
    var imgs = [];
    streams.forEach(function(s){
      try { imgs = imgs.concat(scanStreamImages(s)); } catch(e){}
    });
    var seen = {}, uniq = [];
    imgs.forEach(function(im){
      var key = im.type + ":" + im.data.length;
      if (seen[key]) return;
      seen[key] = 1;
      uniq.push(im);
    });
    return uniq.slice(0, 20);
  }

  function renderDoc(u8, name){
    busy(true, "解析 Word 97 文档…");
    return LIB.load("xlsx.full.min.js").then(function(){
      if (!window.XLSX || !XLSX.CFB) throw new Error("OLE2 解析器未就绪");
      var cfb = XLSX.CFB.read(u8, { type: "array" });
      var wdIdx = -1, t1Idx = -1, t0Idx = -1;
      for (var i = 0; i < cfb.FullPaths.length; i++){
        var fp = cfb.FullPaths[i] || "";
        if (/WordDocument$/i.test(fp)) wdIdx = i;
        else if (/\/1Table$/i.test(fp)) t1Idx = i;
        else if (/\/0Table$/i.test(fp)) t0Idx = i;
      }
      if (wdIdx < 0) throw new Error("这不是一份能解析的 Word 文档");
      var wd = new Uint8Array(cfb.FileIndex[wdIdx].content);
      // FIB flags 的 bit9 = fWhichTblStm，决定 Clx 在 1Table 还是 0Table
      var flags = docR16(wd, 0x0A);
      var useIdx = (flags & 0x0200) !== 0 ? t1Idx : t0Idx;
      if (useIdx < 0) useIdx = t1Idx >= 0 ? t1Idx : t0Idx;
      var tbl = useIdx >= 0 ? new Uint8Array(cfb.FileIndex[useIdx].content) : null;
      var text = extractDocText(wd, tbl);
      if (!text || text.replace(/\s/g, "").length < 2) throw new Error("没能从这份 .doc 里提取到文字");
      var html = docTextToHtml(text);
      var docImgs = extractDocImages(cfb, wd);
      if (docImgs.length){
        html += '<h2>文档中的图片（' + docImgs.length + ' 张）</h2>';
        docImgs.forEach(function(im, i){
          var b64 = u8ToB64(im.data);
          html += '<div style="margin:14px 0"><img alt="文档图片 ' + (i + 1) + '" src="data:' + im.type +
            ';base64,' + b64 + '" style="max-width:100%;height:auto;border-radius:6px"></div>';
        });
      }
      state.kind = "text";
      state.current = { name: name };
      var plain = text.replace(/\u0007/g, " | ").replace(/[\u0000-\u0008\u000E-\u001F]/g, "");
      renderRich(plain, name, false, html);
      $("progress").style.opacity = "0";
      busy(false);
    }).catch(function(e){
      busy(false);
      showUnsupported(name, "Word 97 (.doc)", e.message);
    });
  }
  function showUnsupported(name, label, detail){
    state.kind = "text";
    state.text = "";
    state.current = { name: name };
    var html = '<div style="padding:40px 8px;text-align:center;color:var(--muted)">' +
      "<div style=\"font-size:40px;margin-bottom:14px\">📄</div>" +
      "<h2 style=\"margin:0 0 10px;color:var(--fg)\">" + esc(label || "暂不支持") + "</h2>" +
      "<p style=\"font-size:14px;line-height:1.8;max-width:420px;margin:0 auto\">" +
      "这个格式暂时不能在 App 里直接渲染" + (detail ? "（" + esc(detail) + "）" : "") + "。<br>" +
      "可以先在 WPS / Word 里另存为 .docx 或 .pdf，再打开。" +
      "</p></div>";
    $("content").innerHTML = html;
    $("docView").innerHTML = "";
    showView("content");
    $("tocList").innerHTML = '<div class="empty">没有标题</div>';
    setTitle(name, label);
    updateSourceButton();
    $("progress").style.opacity = "0";
    busy(false);
  }

  /* ---------- PDF：系统 PdfRenderer 渲染，连续滚动显示全部页 ---------- */
  var pdfState = { path: null, page: 0, total: 0, loaded: {} };
  window.__pdfReady = function(path, name){
    pdfState = { path: path, page: 0, total: 0, loaded: {} };
    state.kind = "pdf";
    state.current = { name: name };
    state.text = "";
    $("pdfView").innerHTML =
      '<div class="pbar"><span id="pdfInfo" style="font-size:13px;color:var(--muted)">加载中…</span>' +
      '<button id="pdfSave">导出长图</button></div><div id="pdfPages"></div>';
    showView("pdfView");
    setTitle(name, "PDF");
    updateSourceButton();
    $("pdfSave").onclick = function(){
      // PDF 的长图由 Java 侧全页渲染拼接，不经过 WebView 截图
      if (NATIVE && MDNative.exportPdfLongImage && pdfState.path){
        var nm = (state.current.name || "document").replace(/\.pdf$/i, "") + ".png";
        MDNative.exportPdfLongImage(pdfState.path, nm);
      } else {
        exportCurrentPng();
      }
    };
    requestPdfPage(0);
  };
  function requestPdfPage(idx){
    if (!NATIVE || !MDNative.renderPdfPage) { toast("当前环境不支持原生 PDF 渲染"); return; }
    if (!pdfState.path){ toast("PDF 路径丢失，请重新打开"); return; }
    if (pdfState.loaded[idx]) return;
    pdfState.loaded[idx] = 1;
    // 用屏幕物理分辨率 ×1.2 渲染，保证清晰度（之前按 CSS 宽 ×2 只有 800px，糊）
    var w = Math.round(window.innerWidth * (window.devicePixelRatio || 2) * 1.2);
    busy(true, "渲染第 " + (idx + 1) + " 页…");
    MDNative.renderPdfPage(pdfState.path, idx, w);
  }
  window.__pdfPage = function(index, total, b64){
    pdfState.page = index;
    pdfState.total = total;
    busy(false);
    var box = $("pdfPages");
    if (!box) return;
    var wrap = document.createElement("div");
    wrap.style.marginBottom = "12px";
    wrap.innerHTML = '<img alt="PDF 第 ' + (index + 1) + ' 页" src="data:image/jpeg;base64,' + b64 +
      '" style="width:100%;max-width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:6px;background:#fff">' +
      '<div style="text-align:center;font-size:11.5px;color:var(--muted);margin-top:4px">第 ' +
      (index + 1) + " / " + total + " 页</div>";
    box.appendChild(wrap);
    var info = $("pdfInfo");
    if (info) info.textContent = (index + 1) + " / " + total + " 页";
    setTitle(state.current.name, "PDF · " + total + " 页");
    $("progress").style.opacity = "0";
    // 连续加载后续页（上限 60 页，避免超大文档卡死）
    if (index + 1 < total && index < 59) {
      setTimeout(function(){ requestPdfPage(index + 1); }, 120);
    } else if (index + 1 < total) {
      toast("页数较多，仅加载前 60 页");
    }
  };
  window.__pdfError = function(msg){
    busy(false);
    var box = $("pdfPages");
    if (box) box.innerHTML = '<div style="padding:30px;color:var(--muted);font-size:14px">PDF 渲染失败：' + esc(msg) + "</div>";
    toast("PDF 渲染失败：" + msg, 5200);
  };

  function renderPdf(u8, name){
    busy(true, "渲染 PDF…");
    LIB.load("pdf.min.js").then(function(){
      if (!window.pdfjsLib) throw new Error("pdf.js 未就绪");
      try { pdfjsLib.GlobalWorkerOptions.workerSrc = "libs/pdf.worker.min.js"; } catch(e){}
      var data = u8.slice();
      var base = {
        data: data,
        cMapUrl: "libs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "libs/standard_fonts/"
      };
      function withWorker(extra){
        var o = {};
        for (var k in base) o[k] = base[k];
        if (extra) for (var k2 in extra) o[k2] = extra[k2];
        return o;
      }
      return pdfjsLib.getDocument(withWorker()).promise.catch(function(){
        // file:// 下 Worker 可能被拦，退回主线程解析（仍带 CMap）
        return pdfjsLib.getDocument(withWorker({ disableWorker: true })).promise;
      });
    }).then(function(doc){
      state.pdfDoc = doc;
      state.kind = "pdf";
      state.current = { name: name };
      state.text = "";
      state.pdfPage = 0;
      $("pdfView").innerHTML =
        '<div class="pbar"><button id="pdfPrev">上一页</button>' +
        '<span id="pdfInfo" style="font-size:13px;color:var(--muted)">1 / ' + doc.numPages + '</span>' +
        '<button id="pdfNext">下一页</button>' +
        '<button id="pdfSave">导出长图</button></div><div id="pdfPages"></div>';
      showView("pdfView");
      setTitle(name, "PDF · " + doc.numPages + " 页");
      updateSourceButton();
      bindPdfBar();
      renderPdfPage(0);
      $("progress").style.opacity = "0";
    }).catch(function(e){
      toast("PDF 渲染失败：" + (e.message || e), 4600);
    }).then(function(){ busy(false); });
  }

  function renderPdfPage(idx){
    var doc = state.pdfDoc;
    if (!doc) return;
    busy(true, "渲染第 " + (idx + 1) + " 页…");
    doc.getPage(idx + 1).then(function(page){
      var vp1 = page.getViewport({ scale: 1 });
      var maxW = Math.min(window.innerWidth - 24, 900);
      var dpr = window.devicePixelRatio || 1;
      var scale = maxW / vp1.width;
      // 关键：单张 canvas 不能太大，Chromium 图层内存超限会直接不绘制（白屏）
      var MAX_PIXELS = 1600 * 2000;
      var s = scale * Math.min(dpr, 2);
      var vp = page.getViewport({ scale: s });
      var guard = 0;
      while (vp.width * vp.height > MAX_PIXELS && guard++ < 30) {
        s *= 0.88;
        vp = page.getViewport({ scale: s });
      }
      var cv = document.createElement("canvas");
      cv.width = Math.floor(vp.width);
      cv.height = Math.floor(vp.height);
      cv.style.width = Math.floor(vp.width / Math.min(dpr, 2)) + "px";
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      page.render({ canvasContext: ctx, viewport: vp }).promise.then(function(){
        var box = $("pdfPages");
        box.innerHTML = "";
        box.appendChild(cv);
        var pn = document.createElement("div");
        pn.className = "pageno";
        pn.textContent = "第 " + (idx + 1) + " / " + doc.numPages + " 页";
        box.appendChild(pn);
        state.pdfPage = idx;
        var info = $("pdfInfo");
        if (info) info.textContent = (idx + 1) + " / " + doc.numPages;
        $("scroller").scrollTop = 0;
        busy(false);
      });
    }).catch(function(e){
      busy(false); toast("PDF 页渲染失败：" + (e.message || e));
    });
  }
  function bindPdfBar(){
    $("pdfPrev").onclick = function(){ if (state.pdfPage > 0) renderPdfPage(state.pdfPage - 1); };
    $("pdfNext").onclick = function(){ if (state.pdfDoc && state.pdfPage < state.pdfDoc.numPages - 1) renderPdfPage(state.pdfPage + 1); };
    $("pdfSave").onclick = function(){ exportCurrentPng(); };
  }

  function renderXlsx(u8, name){
    busy(true, "解析 Excel…");
    LIB.load("xlsx.full.min.js").then(function(){
      var wb = (window.XLSX || {}).read ? XLSX.read(u8, { type: "array" }) : null;
      if (!wb) throw new Error("SheetJS 未就绪");
      state.xlsxWb = wb;
      state.kind = "xlsx";
      state.current = { name: name };
      state.text = "";
      renderSheetTabs();
      renderSheet(0);
      showView("sheetView");
      setTitle(name, "Excel · " + wb.SheetNames.length + " 个工作表");
      updateSourceButton();
      $("progress").style.opacity = "0";
    }).catch(function(e){
      toast("Excel 解析失败：" + (e.message || e), 4200);
    }).then(function(){ busy(false); });
  }
  function renderSheetTabs(){
    var wb = state.xlsxWb, box = $("sheetView");
    var tabs = '<div class="sheet-tabs">';
    wb.SheetNames.forEach(function(n, i){
      tabs += '<button data-i="' + i + '" class="' + (i === 0 ? "on" : "") + '">' + esc(n) + '</button>';
    });
    tabs += '</div><div id="sheetBody"></div>';
    box.innerHTML = tabs;
    box.querySelectorAll(".sheet-tabs button").forEach(function(b){
      b.onclick = function(){
        box.querySelectorAll(".sheet-tabs button").forEach(function(x){ x.classList.remove("on"); });
        b.classList.add("on");
        renderSheet(parseInt(b.dataset.i, 10));
      };
    });
  }
  function renderSheet(i){
    var wb = state.xlsxWb;
    var ws = wb.Sheets[wb.SheetNames[i]];
    var html = XLSX.utils.sheet_to_html(ws, { editable: false });
    var body = $("sheetBody");
    if (body) body.innerHTML = html;
    state.xlsxSheet = i;
  }

  /* 通用：把超大的 base64 图片缩到 maxW 宽（防止几百 MB 字符串撑爆 WebView） */
  function shrinkDataUrl(src, maxW, quality){
    return new Promise(function(resolve){
      if (!src || src.length < 400000) { resolve(src); return; }
      try {
        var im = new Image();
        im.onload = function(){
          try {
            var w = maxW || 1000;
            var scale = Math.min(1, w / im.width);
            if (scale >= 1) { resolve(src); return; }
            var cv = document.createElement("canvas");
            cv.width = Math.max(1, Math.round(im.width * scale));
            cv.height = Math.max(1, Math.round(im.height * scale));
            cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
            resolve(cv.toDataURL("image/jpeg", quality || 0.85));
          } catch(e){ resolve(src); }
        };
        im.onerror = function(){ resolve(src); };
        im.src = src;
      } catch(e){ resolve(src); }
    });
  }

  /* pptx 的图片：slide XML 里 <a:blip r:embed="rIdN">，经 slide rels 映射到 ../media/xxx */
  function pptxResolvePath(slidePath, target){
    var base = slidePath.substring(0, slidePath.lastIndexOf("/"));
    var parts = (base + "/" + target).split("/");
    var out = [];
    for (var i = 0; i < parts.length; i++){
      var p = parts[i];
      if (p === "..") out.pop();
      else if (p && p !== ".") out.push(p);
    }
    return out.join("/");
  }
  function pptxCollectImages(xml, relsXml, zip, slidePath){
    var rels = {}, re = /<Relationship\b[^>]*>/g, rm;
    while ((rm = re.exec(relsXml || ""))){
      var tag = rm[0];
      var idm = tag.match(/Id="([^"]+)"/), tgm = tag.match(/Target="([^"]+)"/);
      if (idm && tgm) rels[idm[1]] = tgm[1];
    }
    var ids = [], bre = /<a:blip[^>]*r:embed="([^"]+)"/g, bm;
    while ((bm = bre.exec(xml))) if (ids.indexOf(bm[1]) < 0) ids.push(bm[1]);
    return Promise.all(ids.map(function(id){
      var tgt = rels[id];
      if (!tgt) return Promise.resolve(null);
      var path = pptxResolvePath(slidePath, tgt);
      var f = zip.file(path);
      if (!f) return Promise.resolve(null);
      var mime = /\.png$/i.test(path) ? "image/png" : /\.gif$/i.test(path) ? "image/gif" : "image/jpeg";
      return f.async("base64").then(function(b64){
        return shrinkDataUrl("data:" + mime + ";base64," + b64, 900, 0.85);
      }).catch(function(){ return null; });
    })).then(function(list){ return list.filter(Boolean); });
  }

  function extractPptxText(xml){
    var out = [], re = /<a:t>([\s\S]*?)<\/a:t>/g, m;
    while ((m = re.exec(xml))){
      var s = m[1]
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
      if (s.trim()) out.push(s.trim());
    }
    return out;
  }
  function renderPptx(u8, name){
    busy(true, "解析 PPT…");
    LIB.load("jszip.min.js").then(function(){
      return JSZip.loadAsync(u8);
    }).then(function(zip){
      var list = [];
      zip.forEach(function(path){
        var m = path.match(/^ppt\/slides\/slide(\d+)\.xml$/);
        if (m) list.push({ num: parseInt(m[1], 10), path: path });
      });
      list.sort(function(a, b){ return a.num - b.num; });
      if (!list.length) throw new Error("没找到幻灯片");
      return Promise.all(list.map(function(s){
        var relPath = s.path.replace(/slides\/(slide\d+)\.xml$/, "slides/_rels/$1.xml.rels");
        var relFile = zip.file(relPath);
        var relTask = relFile ? relFile.async("string").catch(function(){ return ""; }) : Promise.resolve("");
        return Promise.all([zip.file(s.path).async("string"), relTask]).then(function(res){
          var xml = res[0], relsXml = res[1];
          return pptxCollectImages(xml, relsXml, zip, s.path).then(function(imgs){
            return { num: s.num, texts: extractPptxText(xml), images: imgs };
          });
        });
      }));
    }).then(function(slides){
      var html = slides.map(function(s){
        var t = s.texts;
        var head = t.length ? '<h3 class="slide-t">' + esc(t[0]) + '</h3>' : "";
        var rest = t.slice(1).map(function(x){ return "<li>" + esc(x) + "</li>"; }).join("");
        var imgs = (s.images || []).map(function(src){
          return '<img alt="幻灯片图片" src="' + src + '" style="max-width:100%;height:auto;border-radius:6px;margin-top:10px">';
        }).join("");
        return '<div class="slide"><div class="slide-h">第 ' + s.num + " 页" +
          (s.images && s.images.length ? " · " + s.images.length + " 张图" : "") + "</div>" + head +
          (rest ? "<ul>" + rest + "</ul>" : (t.length ? "" : '<div style="color:var(--muted);font-size:13px">（这一页没有文字）</div>')) +
          imgs + "</div>";
      }).join("");
      $("pptxView").innerHTML = html;
      state.kind = "pptx";
      state.current = { name: name };
      state.text = slides.map(function(s){ return s.texts.join("\n"); }).join("\n\n");
      state.current.slides = slides;
      showView("pptxView");
      setTitle(name, "PPT · " + slides.length + " 页");
      updateSourceButton();
      $("progress").style.opacity = "0";
    }).catch(function(e){
      toast("PPT 解析失败：" + (e.message || e), 4200);
    }).then(function(){ busy(false); });
  }

  /* ---- PowerPoint 97-2003 (.ppt)：扫描 PowerPoint Document 流的文本记录 ---- */
  function extractPptText(stream){
    var out = [], pos = 0, guard = 0;
    var rd16 = function(o){ return stream[o] | (stream[o+1] << 8); };
    var rd32 = function(o){ return (stream[o] | (stream[o+1]<<8) | (stream[o+2]<<16) | (stream[o+3]<<24)) >>> 0; };
    while (pos + 8 <= stream.length && guard++ < 300000){
      var type = rd16(pos + 2);
      var len = rd32(pos + 4);
      var start = pos + 8;
      if (len > stream.length - start) break;
      if (type === 0x0FA0){                     // TextCharsAtom: UTF-16LE
        var t = new TextDecoder("utf-16le").decode(stream.subarray(start, start + len));
        if (t.trim()) out.push(t);
      } else if (type === 0x0FA8 || type === 0x0FBA){  // TextBytesAtom / CString: ANSI
        try {
          var b = new TextDecoder("gbk").decode(stream.subarray(start, start + len));
          if (b.trim()) out.push(b);
        } catch(e){}
      }
      pos = start + len;
    }
    return out;
  }
  function renderPpt(u8, name){
    busy(true, "解析 PowerPoint 97 文档…");
    return LIB.load("xlsx.full.min.js").then(function(){
      if (!window.XLSX || !XLSX.CFB) throw new Error("OLE2 解析器未就绪");
      var cfb = XLSX.CFB.read(u8, { type: "array" });
      var idx = -1;
      for (var i = 0; i < cfb.FullPaths.length; i++){
        if (/PowerPoint Document/i.test(cfb.FullPaths[i] || "")) { idx = i; break; }
      }
      if (idx < 0) throw new Error("这不是一份能解析的 PPT");
      var stream = new Uint8Array(cfb.FileIndex[idx].content);
      var texts = extractPptText(stream);
      if (!texts.length) throw new Error("没提取到文字");
      var html = texts.map(function(t, i){
        var lines = t.split(/[\r\n\u000B\u000D]+/).map(function(x){ return x.trim(); }).filter(Boolean);
        if (!lines.length) return "";
        var head = '<div class="slide-t">' + esc(lines[0]) + "</div>";
        var rest = lines.slice(1).map(function(x){ return "<li>" + esc(x) + "</li>"; }).join("");
        return '<div class="slide"><div class="slide-h">文本块 ' + (i + 1) + "</div>" + head +
          (rest ? "<ul>" + rest + "</ul>" : "") + "</div>";
      }).join("");
      $("pptxView").innerHTML = html || '<div class="slide">（没有可显示的文本）</div>';
      state.kind = "pptx";
      state.current = { name: name };
      state.text = texts.join("\n\n");
      showView("pptxView");
      setTitle(name, "PPT · " + texts.length + " 个文本块");
      updateSourceButton();
      $("progress").style.opacity = "0";
      busy(false);
    }).catch(function(e){
      busy(false);
      showUnsupported(name, "PowerPoint 97 (.ppt)", e.message);
    });
  }

  /* ---- RTF：控制词 + \uN? / \'hh 编码，转成段落 ---- */
  function rtfToText(raw){
    var s = raw;
    s = s.replace(/\\u(-?\d+)\s?\??/g, function(m, n){
      var c = parseInt(n, 10);
      if (c < 0) c += 65536;
      return String.fromCharCode(c & 0xFFFF);
    });
    s = s.replace(/(?:\\'[0-9a-fA-F]{2})+/g, function(m){
      var hex = m.match(/[0-9a-fA-F]{2}/g) || [];
      var bytes = new Uint8Array(hex.map(function(h){ return parseInt(h, 16); }));
      try { return new TextDecoder("gbk").decode(bytes); } catch(e){ return m; }
    });
    s = s.replace(/\\\r?\n/g, "\n");
    s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, "");
    s = s.replace(/\\\\([\\{}\\])/g, "$1");
    s = s.replace(/[{}]/g, "");
    s = s.replace(/\r/g, "\n");
    return s;
  }
  function renderRtf(u8, name){
    var raw = bytesToLatin1(u8);
    var text = rtfToText(raw);
    var paras = text.split(/\n{1,}/).map(function(x){ return x.trim(); }).filter(Boolean);
    if (!paras.length) { showUnsupported(name, "RTF", "没提取到文字"); return; }
    var html = paras.map(function(p){ return "<p>" + esc(p) + "</p>"; }).join("");
    state.kind = "text";
    state.current = { name: name };
    renderRich(text, name, false, html);
    $("progress").style.opacity = "0";
  }

  /* ---- ODT：zip 里的 content.xml ---- */
  function odtToHtml(xml){
    var out = [];
    var doc;
    try { doc = new DOMParser().parseFromString(xml, "application/xml"); }
    catch(e){ return "<p>（ODT 解析失败）</p>"; }
    function push(el){
      var ln = el.localName;
      var txt = (el.textContent || "").trim();
      if (ln === "h"){
        var lv = 1;
        try {
          lv = parseInt(el.getAttribute("text:outline-level") ||
                       el.getAttributeNS("urn:oasis:names:tc:opendocument:xmlns:text:1.0", "outline-level") || "1", 10) || 1;
        } catch(e){}
        lv = Math.min(3, lv);
        if (txt) out.push("<h" + lv + ">" + esc(txt) + "</h" + lv + ">");
        return true;
      }
      if (ln === "p"){ if (txt) out.push("<p>" + esc(txt) + "</p>"); return true; }
      if (ln === "table"){
        var rows = [];
        var trs = el.getElementsByTagNameNS("*", "table-row");
        for (var i = 0; i < trs.length && i < 200; i++){
          var cells = [], tds = trs[i].getElementsByTagNameNS("*", "table-cell");
          for (var j = 0; j < tds.length && j < 40; j++) cells.push((tds[j].textContent || "").trim());
          if (cells.length) rows.push(cells);
        }
        if (rows.length){
          out.push("<table>" + rows.map(function(r, ri){
            var tag = ri === 0 ? "th" : "td";
            return "<tr>" + r.map(function(c){ return "<" + tag + ">" + esc(c) + "</" + tag + ">"; }).join("") + "</tr>";
          }).join("") + "</table>");
        }
        return true;
      }
      return false;
    }
    var body = doc.getElementsByTagNameNS("*", "body")[0] || doc.documentElement;
    (function walk(el){
      if (!el) return;
      if (push(el)) return;
      var kids = el.children || [];
      for (var i = 0; i < kids.length; i++) walk(kids[i]);
    })(body);
    return out.join("\n") || "<p>（这份 ODT 没有可显示的正文）</p>";
  }
  function renderOdt(u8, name){
    busy(true, "解析 ODT…");
    LIB.load("jszip.min.js").then(function(){
      return JSZip.loadAsync(u8);
    }).then(function(zip){
      var f = zip.file("content.xml");
      if (!f) throw new Error("这不是有效的 ODT");
      return f.async("string");
    }).then(function(xml){
      var html = odtToHtml(xml);
      state.kind = "text";
      state.current = { name: name };
      state.text = "";
      var tmp = document.createElement("div");
      tmp.innerHTML = html;
      renderRich(tmp.textContent || "", name, false, html);
      $("progress").style.opacity = "0";
      busy(false);
    }).catch(function(e){
      busy(false);
      showUnsupported(name, "ODT", e.message);
    });
  }

  /* ---------- 统一入口：按扩展名分流 ---------- */
  function routeFile(u8, name){
    state.source = false;
    $("btnSource").classList.remove("on");
    var k = kindOf(name, u8);
    if (k === "docx") return renderDocx(u8, name);
    if (k === "doc")  return renderDoc(u8, name);
    if (k === "pdf")  return renderPdf(u8, name);
    if (k === "xlsx" || k === "xls") return renderXlsx(u8, name);
    if (k === "pptx") return renderPptx(u8, name);
    if (k === "ppt")  return renderPpt(u8, name);
    if (k === "zip")  return showUnsupported(name, "压缩包 (.zip)", "请先解压");
    if (k === "ole2") return showUnsupported(name, "老式 Office 文档", "无法识别具体类型");
    if (k === "rtf") return renderRtf(u8, name);
    if (k === "odt") return renderOdt(u8, name);
    var text = decodeUtf8(u8);
    var ext = extOf(name);
    renderRich(text, name, ext === "md" || ext === "markdown" || ext === "mdx" || ext === "mdown" || ext === "mkd");
  }

  function blocksToHtml(blocks){
    return blocks.map(function(b){
      if (b.type === "h") return "<h" + b.level + ">" + esc(b.text) + "</h" + b.level + ">";
      if (b.type === "li") return "<ul><li>" + esc(b.text) + "</li></ul>";
      if (b.type === "p") return "<p>" + esc(b.text) + "</p>";
      if (b.type === "quote") return "<blockquote>" + esc(b.text) + "</blockquote>";
      if (b.type === "code") return "<pre><code>" + esc(b.text) + "</code></pre>";
      if (b.type === "hr") return "<hr>";
      if (b.type === "table"){
        return "<table>" + b.rows.map(function(r, i){
          var tag = i === 0 ? "th" : "td";
          return "<tr>" + r.map(function(c){ return "<" + tag + ">" + esc(c) + "</" + tag + ">"; }).join("") + "</tr>";
        }).join("") + "</table>";
      }
      return "";
    }).join("\n");
  }

  /* ==================== 搜索 ==================== */
  function currentRoot(){
    if (state.kind === "docx") return $("docView");
    if (state.kind === "text") return state.source ? $("sourceView") : $("content");
    return null;
  }
  function clearSearch(){
    var root = currentRoot();
    state.hits = []; state.hitIdx = 0;
    if (!root) return;
    root.querySelectorAll("mark.hl-hit").forEach(function(m){
      var p = m.parentNode;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    });
    $("searchCount").textContent = "0/0";
  }
  function runSearch(q){
    clearSearch();
    var root = currentRoot();
    if (!root || !q) { $("searchCount").textContent = "0/0"; return; }
    if (state.kind !== "text" && state.kind !== "docx"){ toast("这个格式不支持搜索"); return; }
    var lq = q.toLowerCase();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var targets = [], n;
    while ((n = walker.nextNode())){
      if (!n.nodeValue || n.nodeValue.toLowerCase().indexOf(lq) < 0) continue;
      if (n.parentNode && /^(SCRIPT|STYLE|MARK)$/.test(n.parentNode.tagName)) continue;
      targets.push(n);
    }
    targets.forEach(function(node){
      var s = node.nodeValue, l = s.toLowerCase(), parts = [], last = 0, idx;
      while ((idx = l.indexOf(lq, last)) >= 0){
        if (idx > last) parts.push(document.createTextNode(s.slice(last, idx)));
        var mk = document.createElement("mark");
        mk.className = "hl-hit";
        mk.textContent = s.slice(idx, idx + q.length);
        parts.push(mk);
        last = idx + q.length;
      }
      if (last < s.length) parts.push(document.createTextNode(s.slice(last)));
      if (!parts.length) return;
      var frag = document.createDocumentFragment();
      parts.forEach(function(p){ frag.appendChild(p); });
      node.parentNode.replaceChild(frag, node);
    });
    state.hits = Array.prototype.slice.call(root.querySelectorAll("mark.hl-hit"));
    state.hitIdx = 0;
    jumpHit(0);
    $("searchCount").textContent = state.hits.length ? ("1/" + state.hits.length) : "0/0";
  }
  function jumpHit(i){
    if (!state.hits.length) return;
    if (i < 0) i = state.hits.length - 1;
    if (i >= state.hits.length) i = 0;
    state.hitIdx = i;
    state.hits.forEach(function(h){ h.style.outline = "none"; });
    var cur = state.hits[i];
    cur.style.outline = "2px solid var(--accent)";
    scrollScroller(cur.getBoundingClientRect().top + $("scroller").scrollTop - 110);
    $("searchCount").textContent = (i + 1) + "/" + state.hits.length;
  }
