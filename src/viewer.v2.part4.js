
  /* ==================== 大纲解析（纯文本 / 中文层级） ==================== */
  function looksLikeMarkdown(text){
    // 只认强 markdown 标志（# 标题 / | 表格 / 代码块）。
    // 列表符号和 "1." 太宽松，会把「一、二、三」式大纲整段误判成 markdown。
    return /^#{1,6}\s/m.test(text) || /^\|.+\|$/m.test(text) || /```/.test(text);
  }
  function blocksFromPlainText(text){
    var lines = String(text || "").split(/\r?\n/), out = [], table = null;
    function flushTable(){
      if (table && table.rows.length){ out.push({ type: "table", rows: table.rows }); }
      table = null;
    }
    lines.forEach(function(raw){
      var t = raw.replace(/\s+$/, "");
      if (!t.trim()){ flushTable(); return; }
      // 表格行
      if (/^\s*\|.*\|\s*$/.test(t)){
        var cells = t.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function(c){ return c.trim(); });
        var isSep = cells.every(function(c){ return /^:?-{2,}:?$/.test(c); });
        if (!table) table = { rows: [] };
        if (isSep){ return; }
        table.rows.push(cells);
        return;
      }
      flushTable();
      var m;
      if ((m = t.match(/^(#{1,6})\s+(.*)$/))){
        out.push({ type: "h", level: Math.min(3, m[1].length), text: m[2].trim() });
      } else if ((m = t.match(/^第?([一二三四五六七八九十百]+)[、.．章部分节]\s*(.*)$/))){
        out.push({ type: "h", level: 1, text: (m[2] || "").trim() || (m[1] + "、") });
      } else if ((m = t.match(/^[（(]([一二三四五六七八九十]+)[）)]\s*(.*)$/))){
        out.push({ type: "h", level: 2, text: (m[2] || "").trim() });
      } else if ((m = t.match(/^(\d+)[.、．]\s+(.*)$/))){
        out.push({ type: "li", text: m[2].trim() });
      } else if ((m = t.match(/^(\d+\.\d+)\s+(.*)$/))){
        out.push({ type: "h", level: 3, text: m[2].trim() });
      } else if ((m = t.match(/^\s*([-*•·+])\s+(.*)$/))){
        out.push({ type: "li", text: m[2].trim() });
      } else if ((m = t.match(/^>\s*(.*)$/))){
        out.push({ type: "quote", text: m[1].trim() });
      } else {
        out.push({ type: "p", text: t.trim() });
      }
    });
    flushTable();
    return out;
  }
  function parseOutline(text){
    return looksLikeMarkdown(text) ? blocksFromHtml(fakeInput(text, true)) : blocksFromPlainText(text);
  }

  /* ==================== 抽屉 / 面板 ==================== */
  function openDrawer(id){
    closeDrawers();
    $(id).classList.add("open");
    $("scrim").classList.add("show");
  }
  function closeDrawers(){
    ["fileDrawer", "tocDrawer"].forEach(function(id){ $(id).classList.remove("open"); });
    $("scrim").classList.remove("show");
    $("sheet").classList.remove("open");
  }
  function openOutline(){ $("outlinePanel").classList.add("open"); }
  function closeOutline(){ $("outlinePanel").classList.remove("open"); }

  /* ==================== 主题 / 字号 ==================== */
  function applyTheme(t){
    state.theme = t;
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("mdlens.theme", t); } catch(e){}
    syncNativeTheme();
  }
  function syncNativeTheme(){
    var dark = state.theme === "dark" ||
      (state.theme === "auto" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    try { if (NATIVE && MDNative.syncTheme) MDNative.syncTheme(!!dark); } catch(e){}
  }
  function applyFs(delta){
    state.fs = Math.max(13, Math.min(26, state.fs + delta));
    document.documentElement.style.setProperty("--fs", state.fs + "px");
    try { localStorage.setItem("mdlens.fs", String(state.fs)); } catch(e){}
  }

  /* ==================== 事件绑定 ==================== */
  function boot(){
    applyTheme((function(){ try { return localStorage.getItem("mdlens.theme") || "auto"; } catch(e){ return "auto"; } })());
    try { var fsv = parseInt(localStorage.getItem("mdlens.fs") || "", 10); if (fsv >= 13 && fsv <= 26) state.fs = fsv; } catch(e){}
    document.documentElement.style.setProperty("--fs", state.fs + "px");
    updateSourceButton();

    $("btnMenu").onclick = function(){ openDrawer("fileDrawer"); };
    $("btnToc").onclick = function(){
      if ($("tocDrawer").classList.contains("open")){ closeDrawers(); $("btnToc").classList.remove("on"); }
      else { openDrawer("tocDrawer"); $("btnToc").classList.add("on"); }
    };
    $("btnSource").onclick = function(){ showSource(!state.source); };
    $("btnExport").onclick = function(){ $("sheet").classList.add("open"); $("scrim").classList.add("show"); };
    $("btnSearch").onclick = function(){ toggleSearch(); };
    $("scrim").onclick = closeDrawers;
    $("fClose").onclick = closeDrawers;
    $("tClose").onclick = function(){ closeDrawers(); $("btnToc").classList.remove("on"); };
    $("exClose").onclick = closeDrawers;

    $("wOpenFile").onclick = function(){ NATIVE ? MDNative.pickFile() : pickLocal(); };
    $("wOpenFolder").onclick = function(){ NATIVE ? MDNative.pickFolder() : pickLocal(); };
    $("wOutline").onclick = openOutline;

    $("exWord").onclick = function(){ closeDrawers(); exportAs("docx"); };
    $("exExcel").onclick = function(){ closeDrawers(); exportAs("xlsx"); };
    $("exPpt").onclick = function(){ closeDrawers(); exportAs("pptx"); };
    $("exPdf").onclick = function(){ closeDrawers(); exportCurrentPdf(); };
    $("exHtml").onclick = function(){ closeDrawers(); exportHtml(); };
    $("exPng").onclick = function(){ closeDrawers(); exportCurrentPng(); };
    $("exCopy").onclick = function(){
      closeDrawers();
      var t = state.text || "";
      if (NATIVE && MDNative.copyText) MDNative.copyText(t);
      else if (navigator.clipboard) navigator.clipboard.writeText(t).then(function(){ toast("已复制"); });
      else toast("复制失败");
    };
    $("exShare").onclick = function(){
      closeDrawers();
      if (NATIVE && MDNative.shareText) MDNative.shareText(state.text || "", (state.current && state.current.name) || "document.md");
    };

    // 搜索
    $("sClose").onclick = toggleSearch;
    $("sPrev").onclick = function(){ jumpHit(state.hitIdx - 1); };
    $("sNext").onclick = function(){ jumpHit(state.hitIdx + 1); };
    var sTimer = null;
    $("searchInput").addEventListener("input", function(){
      clearTimeout(sTimer);
      var v = $("searchInput").value;
      sTimer = setTimeout(function(){ runSearch(v); }, 260);
    });
    $("searchInput").addEventListener("keydown", function(e){
      if (e.key === "Enter"){ e.preventDefault(); jumpHit(state.hitIdx + 1); }
    });

    // 大纲面板
    $("opClose").onclick = closeOutline;
    $("opPreview").onclick = function(){
      var t = $("opText").value;
      if (!t.trim()){ toast("先粘贴大纲内容"); return; }
      closeOutline();
      state.kind = "text";
      var blocks = parseOutline(t);
      renderRich(t, "大纲预览.md", true, blocksToHtml(blocks));
    };
    $("opDocx").onclick = function(){ outlineExport("docx"); };
    $("opXlsx").onclick = function(){ outlineExport("xlsx"); };
    $("opPptx").onclick = function(){ outlineExport("pptx"); };
    $("opPdf").onclick = function(){ outlineExport("pdf"); };

    // 标题双击换主题
    var tap = 0;
    $("title").onclick = function(){
      var now = Date.now();
      if (now - tap < 420){
        applyTheme(state.theme === "dark" ? "light" : (state.theme === "light" ? "auto" : "dark"));
        toast("主题：" + ({auto: "跟随系统", light: "亮色", dark: "暗色"})[state.theme]);
        tap = 0;
      } else tap = now;
    };

    // 键盘
    document.addEventListener("keydown", function(e){
      if ((e.ctrlKey || e.metaKey) && e.key === "="){ e.preventDefault(); applyFs(1); }
      if ((e.ctrlKey || e.metaKey) && e.key === "-"){ e.preventDefault(); applyFs(-1); }
      if (e.key === "Escape"){ closeDrawers(); closeOutline(); $("searchBar").classList.remove("open"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "f"){ e.preventDefault(); toggleSearch(); }
    });

    // 链接交给原生
    document.addEventListener("click", function(e){
      var a = e.target.closest && e.target.closest("a");
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (!href || href.charAt(0) === "#") return;
      if (NATIVE && /^https?:/i.test(href)){ e.preventDefault(); MDNative.openUrl(href); }
    });

    // 浏览器降级：选文件 / 拖拽
    function pickLocal(){
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".md,.markdown,.mdx,.txt,.docx,.pdf,.xlsx,.xls,.pptx,.json,.csv";
      inp.onchange = function(){
        var f = inp.files[0]; if (!f) return;
        var r = new FileReader();
        r.onload = function(){ routeFile(new Uint8Array(r.result), f.name); };
        r.readAsArrayBuffer(f);
      };
      inp.click();
    }
    document.addEventListener("dragover", function(e){ e.preventDefault(); });
    document.addEventListener("drop", function(e){
      e.preventDefault();
      var f = e.dataTransfer.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function(){ routeFile(new Uint8Array(r.result), f.name); };
      r.readAsArrayBuffer(f);
    });

    $("wHint").textContent = NATIVE
      ? "也可以在文件管理器里点文档，选「MD 解读」直接打开"
      : "浏览器版本：也可以直接把文件拖进这个页面";

    if (NATIVE && MDNative.ready) MDNative.ready();
  }

  function toggleSearch(){
    var bar = $("searchBar");
    if (bar.classList.contains("open")){
      bar.classList.remove("open");
      clearSearch();
      $("btnSearch").classList.remove("on");
    } else {
      if (state.kind !== "text" && state.kind !== "docx"){ toast("这个格式不支持搜索"); return; }
      bar.classList.add("open");
      $("btnSearch").classList.add("on");
      $("searchInput").focus();
    }
  }

  function outlineExport(kind){
    var t = $("opText").value;
    if (!t.trim()){ toast("先粘贴大纲内容"); return; }
    var base = "大纲";
    if (kind === "pdf"){
      closeOutline();
      renderRich(t, "大纲预览.md", true);
      setTimeout(function(){ exportCurrentPdf(); }, 700);
      return;
    }
    exportAs(kind, t, base);
  }

  /* ==================== 原生桥 ==================== */
  var _rx = { name: "", buf: [] };
  window.__nativeBegin = function(name){ _rx.name = name; _rx.buf = []; setProgress(25); };
  window.__nativeChunk = function(b64){ _rx.buf.push(b64); };
  window.__nativeEnd = function(){
    setProgress(85);
    try {
      var u8 = b64ToU8(_rx.buf.join(""));
      routeFile(u8, _rx.name);
    } catch(e){
      toast("打开失败：" + e.message, 4200);
    }
    _rx.buf = [];
    setProgress(null);
  };
  window.__nativeError = function(msg){ setProgress(null); busy(false); toast("打开失败：" + msg, 4200); };
  window.__nativeFiles = function(json){
    try {
      var files = JSON.parse(json);
      state.files = files;
      renderFileList(files);
      if (files.length) toast("找到 " + files.length + " 个文档");
      else toast("这个文件夹里没有找到文档");
      openDrawer("fileDrawer");
    } catch(e){ toast("列表解析失败"); }
  };
  window.__nativeSaved = function(msg){ setProgress(null); busy(false); toast(msg, 3400); };
  window.__nativeBusy = function(show, msg){
    busy(!!show, msg || "处理中…");
    if (!show) setProgress(null);
  };
  window.MDLens = {
    show: function(name, b64){ routeFile(b64ToU8(b64), name); },
    setFiles: function(json){ window.__nativeFiles(json); },
    toast: toast
  };

  function renderFileList(files){
    var box = $("fileList");
    if (!files.length){ box.innerHTML = '<div class="empty">这个文件夹里没有找到文档</div>'; return; }
    var frag = document.createDocumentFragment();
    files.forEach(function(f){
      var b = document.createElement("button");
      b.className = "fileitem";
      b.innerHTML = '<span class="nm">' + esc(f.name || f.path) + "</span>" +
        '<span class="meta">' + esc(f.dir || "") + (f.size ? " · " + fmtSize(f.size) : "") + "</span>";
      b.onclick = function(){
        closeDrawers();
        setProgress(25);
        if (NATIVE && MDNative.openFromList) MDNative.openFromList(f.uri, f.name);
      };
      frag.appendChild(b);
    });
    box.innerHTML = ""; box.appendChild(frag);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
</script>
</body>
</html>
