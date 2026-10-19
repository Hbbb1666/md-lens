package com.dsh.mdlens;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.print.PrintDocumentInfo;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.graphics.pdf.PdfDocument;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.TreeMap;

/**
 * MD 解读 —— 把 .md 渲染成能读的文档，并能导出 HTML / PDF / 长图。
 * 不申请任何存储权限：文件通过 Intent / 系统文件选择器（SAF）进入，导出走 MediaStore。
 */
public class MainActivity extends Activity {

    private static final int REQ_OPEN_FILE   = 1001;
    private static final int REQ_OPEN_FOLDER = 1002;
    private static final long MAX_FILE_BYTES = 48L * 1024 * 1024;   // 单文件上限 48MB
    private static final int  MAX_SCAN_FILES = 3000;                 // 目录扫描上限
    private static final int  MAX_SCAN_DEPTH = 6;

    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private Uri    pendingUri;          // 冷启动时 Intent 带来的文件
    private String pendingName;
    private boolean pageReady = false;

    // 导出写文件用的缓冲
    private ByteArrayOutputStream writeBuf;
    private String writeName;
    private String writeMime;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            Window w = getWindow();
            w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            w.setStatusBarColor(Color.parseColor("#FFFFFF"));
            w.setNavigationBarColor(Color.parseColor("#FFFFFF"));
            if (Build.VERSION.SDK_INT >= 23) {
                w.getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
            }
        } catch (Throwable ignored) {}

        web = new WebView(this);
        setupWebView();
        setContentView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        handleIntent(getIntent());
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setAllowContentAccess(true);
        s.setLoadsImagesAutomatically(true);
        s.setBlockNetworkImage(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setTextZoom(100);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= 19) WebView.setWebContentsDebuggingEnabled(false);

        web.setBackgroundColor(Color.parseColor("#FFFFFF"));
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "MDNative");

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                return interceptUrl(req.getUrl());
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return interceptUrl(Uri.parse(url));
            }
            @Override
            public void onPageFinished(WebView v, String url) {
                pageReady = true;
                flushPending();
            }
        });

        web.loadUrl("file:///android_asset/viewer.html");
    }

    private boolean interceptUrl(Uri u) {
        if (u == null) return false;
        String sch = u.getScheme() == null ? "" : u.getScheme();
        if ("file".equals(sch) || "about".equals(sch) || "javascript".equals(sch)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (Throwable t) {
            jsToast("没有能打开这个链接的 App");
        }
        return true;
    }

    /* ==================== 启动时带来的文件 ==================== */

    private void handleIntent(Intent it) {
        if (it == null) return;
        String action = it.getAction();
        Uri uri = null;
        String name = null;

        if (Intent.ACTION_VIEW.equals(action)) {
            uri = it.getData();
        } else if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            // 微信 / QQ / 网盘分享文件走 ACTION_SEND(_MULTIPLE) + EXTRA_STREAM(content://)
            if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                ArrayList<Uri> list = it.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (list != null && !list.isEmpty()) uri = list.get(0);
            } else {
                uri = it.getParcelableExtra(Intent.EXTRA_STREAM);
            }
            // 微信常常只给 EXTRA_TITLE 当显示名，query 不出 DISPLAY_NAME 时拿它兜底
            name = it.getStringExtra(Intent.EXTRA_TITLE);
            if (uri == null) {
                CharSequence txt = it.getCharSequenceExtra(Intent.EXTRA_TEXT);
                if (txt != null && txt.length() > 0) {
                    pendingContent = txt.toString();
                    pendingName    = name != null ? name : "分享的文本.md";
                    return;
                }
            }
        }
        if (uri != null) {
            pendingUri  = uri;
            pendingName = name;
        }
    }

    private String pendingContent;

    private void flushPending() {
        if (!pageReady) return;
        if (pendingContent != null) {
            final String c = pendingContent, n = pendingName;
            pendingContent = null;
            ui.post(new Runnable() {
                @Override public void run() {
                    pushText(n, c.getBytes(java.nio.charset.Charset.forName("UTF-8")));
                }
            });
        }
        if (pendingUri != null) {
            final Uri u = pendingUri; final String n = pendingName;
            pendingUri = null;
            ui.post(new Runnable() {
                @Override public void run() { readUri(u, n); }
            });
        }
    }

    /* ==================== 读文件 ==================== */

    private void readUri(final Uri uri, final String nameHint) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    String name = nameHint != null ? nameHint : displayName(uri);
                    String d = dirOf(uri);
                    if (d != null) currentDir = d;
                    byte[] data = readAll(uri);
                    if (data == null) {
                        fail("读不到文件内容（可能是云盘占位文件或没有访问权限）");
                        return;
                    }
                    if (data.length == 0) { fail("文件是空的"); return; }
                    if (looksLikePdf(name, data)) {
                        try {
                            File cache = new File(getCacheDir(),
                                    "pdf-" + System.currentTimeMillis() + ".pdf");
                            FileOutputStream fos = new FileOutputStream(cache);
                            try { fos.write(data); fos.flush(); } finally { try { fos.close(); } catch (Throwable ignored) {} }
                            final String p = cache.getAbsolutePath();
                            final String n = name;
                            ui.post(new Runnable() {
                                @Override public void run() {
                                    eval("window.__pdfReady(" + JSONObject.quote(p) + "," +
                                         JSONObject.quote(n) + ")");
                                }
                            });
                            return;
                        } catch (Throwable t) {
                            // 原生路径失败就回退到 WebView 渲染
                        }
                    }
                    pushText(name, data);
                } catch (Throwable t) {
                    fail(t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage()));
                }
            }
        }).start();
    }

    /** 当前文档所在目录（能解析出真实路径时有效），供 md 里相对路径图片使用 */
    private String currentDir = null;

    private String dirOf(Uri uri){
        try {
            String p = uri.getPath();
            if (p != null && p.startsWith("/") &&
                    (p.startsWith("/storage/") || p.startsWith("/sdcard/"))) {
                File f = new File(p);
                String d = f.getParent();
                if (d != null) return d;
            }
            if ("content".equals(uri.getScheme())) {
                Cursor c = null;
                try {
                    c = getContentResolver().query(uri, new String[]{"_data"}, null, null, null);
                    if (c != null && c.moveToFirst() && !c.isNull(0)) {
                        String d = c.getString(0);
                        if (d != null) {
                            File f = new File(d);
                            String parent = f.getParent();
                            if (parent != null) return parent;
                        }
                    }
                } catch (Throwable ignored) {
                } finally { if (c != null) try { c.close(); } catch (Throwable ignored) {} }
            }
        } catch (Throwable ignored) {}
        return null;
    }

    /** md 里的本地图片：Java 读文件 → 采样缩放 → JPEG → base64 回传 */
    private void readAssetImage(final String path, final String callbackId){
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    File f = new File(path);
                    if (!f.exists() || !f.isFile() || f.length() > 40L * 1024 * 1024) {
                        emitAsset(callbackId, null);
                        return;
                    }
                    android.graphics.BitmapFactory.Options probe = new android.graphics.BitmapFactory.Options();
                    probe.inJustDecodeBounds = true;
                    android.graphics.BitmapFactory.decodeFile(path, probe);
                    int sample = 1;
                    int w = probe.outWidth > 0 ? probe.outWidth : 0;
                    while (w / sample > 1400) sample *= 2;
                    android.graphics.BitmapFactory.Options opts = new android.graphics.BitmapFactory.Options();
                    opts.inSampleSize = sample;
                    Bitmap bmp = android.graphics.BitmapFactory.decodeFile(path, opts);
                    if (bmp == null) { emitAsset(callbackId, null); return; }
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    bmp.compress(Bitmap.CompressFormat.JPEG, 85, bos);
                    bmp.recycle();
                    String b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
                    emitAsset(callbackId, "data:image/jpeg;base64," + b64);
                } catch (Throwable t) {
                    emitAsset(callbackId, null);
                }
            }
        }).start();
    }

    private void emitAsset(final String id, final String url){
        ui.post(new Runnable() {
            @Override public void run() {
                eval("window.__assetB64(" + JSONObject.quote(id) + "," +
                        (url == null ? "null" : JSONObject.quote(url)) + ")");
            }
        });
    }

    private static boolean looksLikePdf(String name, byte[] data){
        if (name != null && name.toLowerCase().endsWith(".pdf")) return true;
        return data != null && data.length > 4 &&
                data[0] == 0x25 && data[1] == 0x50 && data[2] == 0x44 && data[3] == 0x46;
    }

    private byte[] readAll(Uri uri) throws Exception {
        InputStream in = null;
        try {
            in = getContentResolver().openInputStream(uri);
            if (in == null) return null;
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            long total = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_FILE_BYTES) throw new Exception("文件太大（超过 64MB）");
                bos.write(buf, 0, n);
            }
            return bos.toByteArray();
        } finally {
            if (in != null) try { in.close(); } catch (Exception ignored) {}
        }
    }

    private String displayName(Uri uri) {
        String name = null;
        Cursor c = null;
        String[] proj = { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE };
        try {
            c = getContentResolver().query(uri, proj, null, null, null);
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0 && !c.isNull(i)) name = c.getString(i);
            }
        } catch (Throwable ignored) {
        } finally { if (c != null) try { c.close(); } catch (Throwable ignored) {} }
        if (name == null) {
            name = uri.getLastPathSegment();
            if (name != null) {
                int slash = name.lastIndexOf('/');
                if (slash >= 0) name = name.substring(slash + 1);
            }
        }
        if (name == null || name.isEmpty()) name = "分享的文件";
        // 微信分享的文件名经常是一串哈希、没有扩展名；用 MIME 补一个，
        // 真正格式由前端的文件头嗅探兜底。
        if (name.indexOf('.') < 0) {
            String ext = extFromMime(getContentResolver().getType(uri));
            if (ext != null) name = name + "." + ext;
        }
        return name;
    }

    private static String extFromMime(String mime) {
        if (mime == null) return null;
        switch (mime) {
            case "application/pdf": return "pdf";
            case "application/msword": return "doc";
            case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "docx";
            case "application/vnd.ms-excel": return "xls";
            case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return "xlsx";
            case "application/vnd.ms-powerpoint": return "ppt";
            case "application/vnd.openxmlformats-officedocument.presentationml.presentation": return "pptx";
            case "text/markdown": return "md";
            case "text/plain": return "txt";
            default: return null;
        }
    }

    /* ---------- PDF：用系统 PdfRenderer 渲染成图片，彻底绕开 WebView 的 canvas/图层内存限制 ---------- */
    private void emitPdfPage(final int index, final int total, final String b64){
        ui.post(new Runnable() {
            @Override public void run() {
                eval("window.__pdfPage(" + index + "," + total + "," + JSONObject.quote(b64) + ")");
            }
        });
    }

    private void emitPdfError(final String msg){
        ui.post(new Runnable() {
            @Override public void run() {
                eval("window.__pdfError(" + JSONObject.quote(msg) + ")");
            }
        });
    }

    /* PDF 导出长图：Java 侧把所有页渲染出来竖向拼接，不经过 WebView 截图 */
    private void exportPdfLongImage(final String path, final String fileName){
        new Thread(new Runnable() {
            @Override public void run() {
                ParcelFileDescriptor pfd = null;
                android.graphics.pdf.PdfRenderer r = null;
                try {
                    jsToast("正在拼接 PDF 长图…", 5000);
                    pfd = ParcelFileDescriptor.open(new File(path), ParcelFileDescriptor.MODE_READ_ONLY);
                    r = new android.graphics.pdf.PdfRenderer(pfd);
                    int total = r.getPageCount();
                    if (total <= 0) { jsToast("PDF 没有页面"); return; }
                    final int targetW = 1240;
                    int[] heights = new int[total];
                    int totalH = 0;
                    for (int i = 0; i < total; i++){
                        android.graphics.pdf.PdfRenderer.Page p = r.openPage(i);
                        int hh = Math.max(1, (int) Math.round(p.getHeight() * (targetW / (double) p.getWidth())));
                        heights[i] = hh;
                        totalH += hh;
                        p.close();
                    }
                    if (totalH <= 0) { jsToast("PDF 页面尺寸异常"); return; }
                    int partH = pngPartHeight();
                    int parts = (int) Math.ceil(totalH / (double) partH);
                    if (parts < 1) parts = 1;
                    for (int part = 0; part < parts; part++){
                        int partTop = part * partH;
                        int ph = Math.min(partH, totalH - partTop);
                        Bitmap big = Bitmap.createBitmap(targetW, ph, Bitmap.Config.ARGB_8888);
                        Canvas cv = new Canvas(big);
                        cv.drawColor(Color.WHITE);
                        int y = -partTop;
                        for (int i = 0; i < total; i++){
                            if (y + heights[i] <= 0) { y += heights[i]; continue; }
                            if (y >= ph) break;
                            android.graphics.pdf.PdfRenderer.Page p = r.openPage(i);
                            Bitmap pb = Bitmap.createBitmap(targetW, heights[i], Bitmap.Config.ARGB_8888);
                            pb.eraseColor(Color.WHITE);
                            p.render(pb, null, null, android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                            p.close();
                            cv.drawBitmap(pb, 0, y, null);
                            pb.recycle();
                            y += heights[i];
                        }
                        ByteArrayOutputStream bos = new ByteArrayOutputStream();
                        big.compress(Bitmap.CompressFormat.PNG, 100, bos);
                        big.recycle();
                        String base = fileName.replaceAll("\\.[^.]*$", "");
                        String outName = base + (parts > 1 ? ("-part" + (part + 1)) : "") + ".png";
                        saveToDownloads(outName, "image/png", bos.toByteArray());
                    }
                    ui.post(new Runnable() {
                        @Override public void run() {
                            eval("window.__nativeSaved(" + JSONObject.quote(
                                "PDF 长图已保存到 Download/MDLens/") + ")");
                        }
                    });
                } catch (Throwable t) {
                    jsToast("PDF 长图失败：" + t.getClass().getSimpleName() + ": " + t.getMessage(), 5000);
                } finally {
                    try { if (r != null) r.close(); } catch (Throwable ignored) {}
                    try { if (pfd != null) pfd.close(); } catch (Throwable ignored) {}
                }
            }
        }).start();
    }

    private void renderPdfPage(final String path, final int index, final int widthPx){
        new Thread(new Runnable() {
            @Override public void run() {
                ParcelFileDescriptor pfd = null;
                android.graphics.pdf.PdfRenderer r = null;
                try {
                    File f = new File(path);
                    if (!f.exists()) { emitPdfError("PDF 缓存文件不见了"); return; }
                    pfd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
                    r = new android.graphics.pdf.PdfRenderer(pfd);
                    int total = r.getPageCount();
                    if (total <= 0) { emitPdfError("PDF 没有页面"); return; }
                    int idx = Math.max(0, Math.min(index, total - 1));
                    android.graphics.pdf.PdfRenderer.Page page = r.openPage(idx);
                    int w = Math.max(400, Math.min(widthPx, 2400));
                    float scale = w / (float) page.getWidth();
                    int h = Math.max(1, Math.round(page.getHeight() * scale));
                    if (h > 8000) h = 8000;
                    Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                    bmp.eraseColor(Color.WHITE);
                    page.render(bmp, null, null, android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    page.close();
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    bmp.compress(Bitmap.CompressFormat.JPEG, 92, bos);
                    bmp.recycle();
                    String b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
                    emitPdfPage(idx, total, b64);
                } catch (Throwable t) {
                    emitPdfError(t.getClass().getSimpleName() + ": " + t.getMessage());
                } finally {
                    try { if (r != null) r.close(); } catch (Throwable ignored) {}
                    try { if (pfd != null) pfd.close(); } catch (Throwable ignored) {}
                }
            }
        }).start();
    }

    private void pushText(final String name, final byte[] data) {
        final String dir = currentDir;
        ui.post(new Runnable() {
            @Override public void run() {
                eval("window.__setBaseDir(" + JSONObject.quote(dir) + ")");
                String b64 = Base64.encodeToString(data, Base64.NO_WRAP);
                eval("window.__nativeBegin(" + JSONObject.quote(name == null ? "未命名.md" : name) + ")");
                int CH = 180000;
                for (int i = 0; i < b64.length(); i += CH) {
                    int end = Math.min(i + CH, b64.length());
                    eval("window.__nativeChunk('" + b64.substring(i, end) + "')");
                }
                eval("window.__nativeEnd()");
            }
        });
    }

    private void fail(final String msg) {
        ui.post(new Runnable() {
            @Override public void run() { eval("window.__nativeError(" + JSONObject.quote(msg) + ")"); }
        });
    }

    private void eval(String js) {
        if (web != null) web.evaluateJavascript(js, null);
    }

    private void eval(String js, ValueCallback<String> cb) {
        if (web != null) web.evaluateJavascript(js, cb);
    }

    private byte[] readLocalFile(File f) throws Exception {
        FileInputStream in = new FileInputStream(f);
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        } finally {
            try { in.close(); } catch (Throwable ignored) {}
        }
    }

    private void jsToast(final String msg) {
        jsToast(msg, 2600);
    }

    private void jsToast(final String msg, final int ms) {
        ui.post(new Runnable() {
            @Override public void run() {
                eval("window.MDLens && window.MDLens.toast(" + JSONObject.quote(msg) + "," + ms + ")");
            }
        });
    }

    /* ==================== 选文件 / 选文件夹 ==================== */

    private void pickFile() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        String[] mimes = new String[]{
                "text/markdown", "text/x-markdown", "text/plain", "application/octet-stream",
                "application/pdf",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"
        };
        i.putExtra(Intent.EXTRA_MIME_TYPES, mimes);
        try {
            startActivityForResult(i, REQ_OPEN_FILE);
        } catch (Throwable t) {
            jsToast("打不开系统文件选择器");
        }
    }

    private void pickFolder() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivityForResult(i, REQ_OPEN_FOLDER);
        } catch (Throwable t) {
            jsToast("打不开文件夹选择器");
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (res != RESULT_OK || data == null) return;
        if (req == REQ_OPEN_FILE) {
            Uri u = data.getData();
            if (u != null) {
                try { getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Throwable ignored) {}
                readUri(u, null);
            }
        } else if (req == REQ_OPEN_FOLDER) {
            Uri u = data.getData();
            if (u != null) {
                try { getContentResolver().takePersistableUriPermission(u,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); } catch (Throwable ignored) {}
                scanTree(u);
            }
        }
    }

    private static boolean isMarkdown(String name) {
        if (name == null) return false;
        String s = name.toLowerCase(java.util.Locale.ROOT);
        return s.endsWith(".md") || s.endsWith(".markdown") || s.endsWith(".mdx")
            || s.endsWith(".mdown") || s.endsWith(".mkd");
    }

    private void scanTree(final Uri treeUri) {
        jsToast("正在扫描文件夹…");
        new Thread(new Runnable() {
            @Override public void run() {
                JSONArray arr = new JSONArray();
                int[] count = new int[]{0};
                String rootId = DocumentsContract.getTreeDocumentId(treeUri);
                walk(treeUri, rootId, 0, arr, count, "");
                final String json = arr.toString();
                ui.post(new Runnable() {
                    @Override public void run() { eval("window.__nativeFiles(" + JSONObject.quote(json) + ")"); }
                });
            }
        }).start();
    }

    private void walk(Uri treeUri, String docId, int depth, JSONArray out, int[] count, String dirLabel) {
        if (depth > MAX_SCAN_DEPTH || count[0] >= MAX_SCAN_FILES) return;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
        Cursor c = null;
        try {
            c = getContentResolver().query(children, new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE
            }, null, null, null);
            if (c == null) return;
            List<String[]> dirs = new ArrayList<>();
            while (c.moveToNext() && count[0] < MAX_SCAN_FILES) {
                String id = c.getString(0);
                String nm = c.getString(1);
                String mime = c.getString(2);
                long size = c.isNull(3) ? -1 : c.getLong(3);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    dirs.add(new String[]{id, nm == null ? "" : nm});
                } else if (isMarkdown(nm)) {
                    try {
                        JSONObject o = new JSONObject();
                        o.put("name", nm == null ? "未命名.md" : nm);
                        o.put("uri", DocumentsContract.buildDocumentUriUsingTree(treeUri, id).toString());
                        o.put("size", size);
                        o.put("dir", dirLabel);
                        out.put(o);
                        count[0]++;
                    } catch (Throwable ignored) {}
                }
            }
            for (String[] d : dirs) {
                if (count[0] >= MAX_SCAN_FILES) break;
                String sub = dirLabel.isEmpty() ? d[1] : dirLabel + " / " + d[1];
                walk(treeUri, d[0], depth + 1, out, count, sub);
            }
        } catch (Throwable ignored) {
        } finally {
            if (c != null) try { c.close(); } catch (Throwable ignored) {}
        }
    }

    /* ==================== 导出 HTML（JS 分块写入） ==================== */

    private void beginWrite(String name, String mime) {
        writeBuf = new ByteArrayOutputStream();
        writeName = name;
        writeMime = mime;
    }

    private void writeChunk(String b64) {
        if (writeBuf == null) return;
        try { writeBuf.write(Base64.decode(b64, Base64.DEFAULT)); } catch (Throwable ignored) {}
    }

    private void endWrite() {
        if (writeBuf == null) return;
        final byte[] data = writeBuf.toByteArray();
        final String name = writeName, mime = writeMime;
        writeBuf = null;
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    Uri u = saveToDownloads(name, mime, data);
                    jsToast("已保存到 Download/MDLens/" + name);
                    final String m = "已保存到 Download/MDLens/" + name;
                    ui.post(new Runnable() {
                        @Override public void run() { eval("window.__nativeSaved(" + JSONObject.quote(m) + ")"); }
                    });
                } catch (Throwable t) {
                    jsToast("保存失败：" + t.getMessage());
                }
            }
        }).start();
    }

    private Uri saveToDownloads(String name, String mime, byte[] data) throws Exception {
        ContentValues cv = new ContentValues();
        cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/MDLens");
        cv.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
        Uri item = getContentResolver().insert(collection, cv);
        if (item == null) throw new Exception("无法在 Download 创建文件");
        OutputStream os = null;
        try {
            os = getContentResolver().openOutputStream(item, "w");
            if (os == null) throw new Exception("无法写入");
            os.write(data);
            os.flush();
        } finally {
            if (os != null) try { os.close(); } catch (Throwable ignored) {}
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        getContentResolver().update(item, done, null, null);
        return item;
    }

    /* ==================== 导出：截图 → PDF / 长图 ==================== */

    private boolean capturing = false;

    private void exportPng(final String fileName) { startCapture(fileName); }

    private void startCapture(final String fileName) {
        if (capturing) { jsToast("正在导出，请稍等"); return; }
        capturing = true;
        ui.post(new Runnable() {
            @Override public void run() {
                try { web.setLayerType(android.view.View.LAYER_TYPE_SOFTWARE, null); } catch (Throwable ignored) {}
                jsToast("正在导出，请勿操作…");
                // 渲染模式切换是异步的，立刻截图会抓到空白图
                ui.postDelayed(new Runnable() {
                    @Override public void run() {
                        beginCaptureSession(fileName);
                    }
                }, 600);
            }
        });
    }

    private void beginCaptureSession(final String fileName) {
        eval("(function(){document.body.classList.add('exporting');"
                + "var c=document.getElementById('content');"
                + "if(c){c.style.paddingBottom=(window.innerHeight)+'px';}"
                + "window.scrollTo(0,0);"
                + "return {h:document.documentElement.scrollHeight,"
                + "sw:document.documentElement.scrollWidth,"
                + "dpr:(window.devicePixelRatio||1)};})()",
                new ValueCallback<String>() {
                    @Override public void onReceiveValue(String v) {
                        try {
                            JSONObject o = new JSONObject(v);
                            double dpr = o.optDouble("dpr", 1d);
                            if (dpr <= 0) dpr = 1;
                            int totalCss = (int) Math.ceil(o.optDouble("h", 0));
                            int cssW = (int) Math.ceil(o.optDouble("sw", 0));
                            if (totalCss < 10) throw new Exception("页面高度异常");
                            int viewW = web.getWidth();
                            if (viewW <= 0) viewW = 1080;
                            // 内容比视口宽时截图只能拿到左边一截，明确告诉用户改走 PDF
                            if (cssW > 0 && cssW * dpr > viewW * 1.15) {
                                endCapture();
                                jsToast("内容比屏幕宽，长图会缺右边；建议用「导出 PDF」（按页宽自动缩放）", 5200);
                                return;
                            }
                            int totalPx = (int) Math.round(totalCss * dpr);
                            runPng(fileName, totalPx, viewW, dpr);
                        } catch (Throwable t) {
                            endCapture();
                            jsToast("导出失败：" + t.getMessage());
                        }
                    }
                });
    }

    private void endCapture() {
        capturing = false;
        try { web.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null); } catch (Throwable ignored) {}
        eval("(function(){document.body.classList.remove('exporting');"
                + "var c=document.getElementById('content');if(c){c.style.paddingBottom='';}"
                + "window.scrollTo(0,0);})()");
    }

    private void savedToast(final String msg) {
        ui.post(new Runnable() {
            @Override public void run() {
                eval("window.__nativeSaved(" + JSONObject.quote(msg) + ")");
            }
        });
    }

    /* ---------- PDF：交给系统打印引擎（矢量、自动分页、宽表格按页宽缩放） ---------- */
    private void exportPdf(final String fileName) {
        ui.post(new Runnable() {
            @Override public void run() {
                try {
                    PrintManager pm = (PrintManager) getSystemService(android.content.Context.PRINT_SERVICE);
                    if (pm == null) { jsToast("这个系统没有可用的打印服务"); return; }
                    PrintDocumentAdapter adapter = web.createPrintDocumentAdapter(fileName);
                    PrintAttributes attrs = new PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                            .setResolution(new PrintAttributes.Resolution("r300", "300dpi", 300, 300))
                            .build();
                    pm.print("MD解读 - " + fileName, adapter, attrs);
                    jsToast("在打印界面选「保存为 PDF」", 5200);
                } catch (Throwable t) {
                    jsToast("PDF 导出失败：" + t.getClass().getSimpleName() + ": " + t.getMessage(), 4600);
                }
            }
        });
    }

    /* ---------- 长图 PNG：竖向拼接，超高自动分段 ---------- */

    /** 长图单张高度按可用内存动态给：内存越大越少分张、图越完整。 */
    private static int pngPartHeight(){
        try {
            long maxMb = Runtime.getRuntime().maxMemory() / (1024 * 1024);
            if (maxMb >= 384) return 16000;
            if (maxMb >= 256) return 12000;
        } catch (Throwable ignored) {}
        return 6000;
    }

    private void runPng(final String fileName, final int totalPx, final int viewW, final double dpr) {
        int parts = (int) Math.ceil(totalPx / (double) pngPartHeight());
        if (parts < 1) parts = 1;
        runPngPart(fileName, 0, parts, totalPx, viewW, dpr);
    }

    private void runPngPart(final String fileName, final int part, final int parts,
                            final int totalPx, final int viewW, final double dpr) {
        if (part >= parts) {
            endCapture();
            savedToast("长图已保存到 Download/MDLens/");
            return;
        }
        final int partTop = part * pngPartHeight();
        final int partH = Math.min(pngPartHeight(), totalPx - partTop);
        final Bitmap big;
        try {
            big = Bitmap.createBitmap(viewW, partH, Bitmap.Config.ARGB_8888);
        } catch (Throwable t) {
            jsToast("内存不足，文档太长了，建议用 PDF");
            endCapture();
            return;
        }
        final Canvas cv = new Canvas(big);
        cv.drawColor(Color.WHITE);
        shotInto(big, cv, 0, partTop, partH, viewW, dpr, new Runnable() {
            @Override public void run() {
                try {
                    String base = fileName.replaceAll("\\.[^.]*$", "");
                    File f = new File(getCacheDir(), base + (parts > 1 ? ("-part" + (part + 1)) : "") + ".png");
                    FileOutputStream fos = new FileOutputStream(f);
                    try { big.compress(Bitmap.CompressFormat.PNG, 100, fos); fos.flush(); }
                    finally { try { fos.close(); } catch (Throwable ignored) {} }
                    big.recycle();
                    saveToDownloads(f.getName(), "image/png", readLocalFile(f));
                    f.delete();
                    runPngPart(fileName, part + 1, parts, totalPx, viewW, dpr);
                } catch (Throwable t) {
                    jsToast("长图保存失败：" + t.getMessage());
                    endCapture();
                }
            }
        });
    }

    private void shotInto(final Bitmap target, final Canvas cv, final int dstY, final int contentTop,
                          final int remain, final int viewW, final double dpr, final Runnable done) {
        if (remain <= 0) { done.run(); return; }
        eval("window.scrollTo(0," + Math.round(contentTop / dpr) + ")");
        ui.postDelayed(new Runnable() {
            @Override public void run() {
                int viewH = web.getHeight();
                if (viewH <= 0) viewH = getResources().getDisplayMetrics().heightPixels;
                if (viewH <= 0) viewH = 1200;
                int h = Math.min(remain, viewH);
                if (h < 8) { done.run(); return; }
                try {
                    Bitmap chunk = Bitmap.createBitmap(viewW, h, Bitmap.Config.ARGB_8888);
                    Canvas cc = new Canvas(chunk);
                    cc.drawColor(Color.WHITE);
                    web.draw(cc);
                    cv.drawBitmap(chunk, 0, dstY, null);
                    chunk.recycle();
                } catch (Throwable ignored) {
                }
                shotInto(target, cv, dstY + h, contentTop + h, remain - h, viewW, dpr, done);
            }
        }, 140);
    }

    private static String sanitize(String n) {
        if (n == null) return "document";
        return n.replaceAll("[\\\\/:*?\"<>|]+", "_").replaceAll("\\.[^.]*$", "");
    }

    /* ==================== 其他原生能力 ==================== */

    private void openUrl(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Throwable t) {
            jsToast("没有能打开这个链接的 App");
        }
    }

    private void copyText(String text) {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("markdown", text));
            jsToast("已复制 Markdown 源码");
        } catch (Throwable t) {
            jsToast("复制失败");
        }
    }

    private void shareText(String text, String name) {
        try {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_SUBJECT, name);
            i.putExtra(Intent.EXTRA_TEXT, text);
            startActivity(Intent.createChooser(i, "分享文档"));
        } catch (Throwable t) {
            jsToast("没有可分享的 App");
        }
    }

    private void syncTheme(boolean dark) {
        ui.post(new Runnable() {
            @Override public void run() {
                try {
                    Window w = getWindow();
                    int bg = dark ? Color.parseColor("#0d1117") : Color.parseColor("#FFFFFF");
                    w.setStatusBarColor(bg);
                    w.setNavigationBarColor(bg);
                    int vis = w.getDecorView().getSystemUiVisibility();
                    if (dark) vis &= ~android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    else vis |= android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    w.getDecorView().setSystemUiVisibility(vis);
                } catch (Throwable ignored) {}
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (web != null) {
            web.evaluateJavascript(
                "(function(){var d=document.getElementById('fileDrawer'),t=document.getElementById('tocDrawer'),s=document.getElementById('sheet');"
                + "if(d.classList.contains('open')||t.classList.contains('open')||s.classList.contains('open')){"
                + "d.classList.remove('open');t.classList.remove('open');s.classList.remove('open');"
                + "document.getElementById('scrim').classList.remove('show');return 'closed';}return 'none';})()",
                new android.webkit.ValueCallback<String>() {
                    @Override public void onReceiveValue(String value) {
                        if (value != null && value.contains("closed")) {
                            // 只是关掉面板，不退出
                        } else {
                            MainActivity.super.onBackPressed();
                        }
                    }
                });
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
        flushPending();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("MDNative");
            web.destroy();
        }
        super.onDestroy();
    }

    /* ==================== JS 桥 ==================== */

    private class Bridge {
        @JavascriptInterface public void ready() { pageReady = true; flushPending(); }
        @JavascriptInterface public void pickFile() { MainActivity.this.pickFile(); }
        @JavascriptInterface public void pickFolder() { MainActivity.this.pickFolder(); }
        @JavascriptInterface public void openFromList(String uri, String name) { readUri(Uri.parse(uri), name); }
        @JavascriptInterface public void openUrl(String url) { MainActivity.this.openUrl(url); }
        @JavascriptInterface public void copyText(String t) { MainActivity.this.copyText(t); }
        @JavascriptInterface public void shareText(String t, String n) { MainActivity.this.shareText(t, n); }
        @JavascriptInterface public void beginWrite(String name, String mime) { MainActivity.this.beginWrite(name, mime); }
        @JavascriptInterface public void writeChunk(String b64) { MainActivity.this.writeChunk(b64); }
        @JavascriptInterface public void endWrite() { MainActivity.this.endWrite(); }
        @JavascriptInterface public void exportPdf(String name) { MainActivity.this.exportPdf(name); }
        @JavascriptInterface public void exportPng(String name) { MainActivity.this.exportPng(name); }
        @JavascriptInterface public void readAssetImage(String path, String callbackId) {
            MainActivity.this.readAssetImage(path, callbackId);
        }
        @JavascriptInterface public void renderPdfPage(String path, int index, int width) {
            MainActivity.this.renderPdfPage(path, index, width);
        }
        @JavascriptInterface public void exportPdfLongImage(String path, String name) {
            MainActivity.this.exportPdfLongImage(path, name);
        }
        @JavascriptInterface public void syncTheme(boolean dark) { MainActivity.this.syncTheme(dark); }
        @JavascriptInterface public void toast(String m) { MainActivity.this.jsToast(m); }
    }
}
