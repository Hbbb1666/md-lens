# MD 解读（md-lens）

一个 Android 上的「万能文档解读器」：把 `.md`、`.doc`、`.docx`、`.pdf`、`.xlsx`、`.pptx`、`.rtf`、`.odt`、`.txt` 打开成可读的排版文档，并能导出成 Word / Excel / PPT / PDF / HTML / 长图。

设计目标对齐 7-Zip / WinRAR 那种「拿到文件就能看」的体验：**无需联网、无需存储权限**，也可以在文件管理器里点文档直接用本 App 打开。

---

## 功能矩阵

| 格式 | 预览 | 图片 | 备注 |
|---|---|---|---|
| `.md` / `.txt` / 代码文件 | ✅ Markdown 渲染 / 等宽纯文本 | ✅ 本地相对/绝对路径由 Java 读取 | 支持 KaTeX 公式、Mermaid 图 |
| `.docx` | ✅ mammoth → HTML | ✅ 超过 400KB 自动缩到 1000px | |
| `.doc`（Word 97-2003） | ✅ 自研 OLE2 解析 | ✅ 魔数扫描（无位置） | 表格靠 `0x07/0x0D` 重建；格式用启发式 |
| `.pdf` | ✅ 系统 `PdfRenderer` 原生渲染 | ✅ 随页面一起渲染 | 连续滚动、原生长图导出 |
| `.xlsx` / `.xls` | ✅ SheetJS | — | 多工作表切换 |
| `.pptx` | ✅ 文字卡片 | ✅ `r:embed → rels → ppt/media/` | 不做像素级版式 |
| `.ppt`（97-2003） | ✅ 记录流文本提取 | ❌ | |
| `.rtf` / `.odt` | ✅ 纯文本 / content.xml | ❌ | |

**导出**：Word(`.docx`)、Excel(`.xlsx`)、PPT(`.pptx`)、PDF（系统打印引擎，矢量）、HTML（单文件）、长图 PNG。导出产物落在 `Download/MDLens/`。

**大纲转文档**：把 DeepSeek 一类的纯文字大纲粘进来，自动识别结构（支持 Markdown 与「一、」「（一）」「1.」中文层级），一键生成 Word / Excel / PPT / PDF。

---

## 技术架构

```
Java 壳（MainActivity）
  ├─ WebView 加载 assets/viewer.html（单文件 UI + 渲染逻辑）
  ├─ 文件读取：Intent VIEW/SEND、SAF 选择器、文件夹递归扫描
  ├─ 零权限导出：MediaStore.Downloads（Android 10+）
  ├─ PDF：android.graphics.pdf.PdfRenderer 渲染成 JPEG → base64 交 JS
  └─ JS 桥：MDNative.*（读文件、写文件、PDF 页、图片、剪贴板、分享、主题）

JS 渲染层（src/viewer.tpl.html 分片 + src/assemble.py 拼装）
  ├─ marked（Markdown）+ DOMPurify（净化）+ highlight.js（代码高亮）
  ├─ KaTeX（公式，20 个字体全带）
  ├─ Mermaid（流程图，3.6MB，按需加载）
  ├─ mammoth（docx）/ SheetJS + CFB（xls/doc 的 OLE2）/ pdf.js（浏览器兜底）/ JSZip / PptxGenJS
  └─ 自研：.doc 的 OLE2 解析、piece table、表格重建、rtf/odt 解析
```

**为什么库走外部 `<script src>` 而不是内联**：minified 库里的 `` `<!-->` `` 片段会触发 HTML 的 script escaped 状态把脚本劈断；总量 9MB 内联也会让 WebView 解析和内存爆掉。外部加载还能按需加载（Mermaid 只用时才拉）。

---

## 构建

环境：Linux（本项目在 aarch64 容器里开发，用 qemu 跑 x86_64 的 aapt2/zipalign）、JDK 17+、Android SDK build-tools 34。

```bash
cd /root/mdlens
./build.sh
```

产物：`out/mdlens.apk`，构建脚本会：
1. `src/assemble.py` 拼装 `assets/viewer.html` 并把库复制到 `assets/libs/`
2. aapt2 编译/链接资源（**注意：主资源用位置参数，不能用 `-R`**）
3. javac 编译（`--release 17 -classpath android.jar`，不要 `-bootclasspath`）
4. d8 生成 dex、打包、zipalign、apksigner 签名
5. **内容断言**：检查 APK 里的关键资源与 dex 字符串，缺一即失败

版本号：`build.sh` 每次构建自动 +1 并同步写入 `AndroidManifest.xml`（这个机制是踩过坑加的——之前连续 5 个版本 versionCode 都是 2，装没装上根本看不出来）。

---

## 目录结构

```
src/
  viewer.v2.part1.html   UI + CSS + 渲染路由
  viewer.v2.part2.js     各格式渲染器（docx/pdf/xlsx/pptx/doc/rtf/odt）
  viewer.v2.part3.js     导出（docx/xlsx/pptx/html）
  viewer.v2.part4.js     大纲解析、事件绑定、原生桥
  viewer.tpl.html        上面四段拼装产物（不要手改，改分片）
  assemble.py            拼装 + 断言
  com/dsh/mdlens/MainActivity.java
vendor/                  轻量库（marked/DOMPurify/highlight.js/github-markdown-css）
vendor2/                 重型库（KaTeX+Mermaid+mammoth+pdfjs+SheetJS+PptxGenJS+JSZip + cmaps/字体）
res/ AndroidManifest.xml build.sh
test/                    用 jsdom / Node 做的回归脚本（见下）
```

---

## 回归测试

改解析逻辑前后必须跑，三个 `.doc` 样本 + 一个 `.docx` 的期望值：

| 样本 | 期望 |
|---|---|
| `红色经典配音活动方案.doc` | 表 3 / 列 3 / 行 10 / 段 30 |
| `国家助学金申请表.doc` | 表 3 / 列 2 / 行 21 / 段 5 |
| `国家励志奖学金申请表.doc` | 表 3 / 列 2 / 行 24 / 段 3 |
| `玩家保密协议9.22最终版.docx` | 2 张图内联 |

`test/` 下的脚本用 jsdom 从本地 HTTP 服务加载 `assets/viewer.html` 跑渲染。**注意**：jsdom 里 JSZip 这类 UMD 库不一定挂到 window，依赖动态加载库的逻辑要用 Node 原生 `require` + 复制纯函数来验证。

---

## 已知限制（写清楚，避免重复踩）

1. **`.doc` 字符格式**：只做启发式（行首序号/短行→加粗），不做真还原。原因见下条。
2. **WPS 的 `.doc` STSH 不合标准**：`cbStshi=1062`（标准 18），样式数组交错，真格式还原需逆向私有格式，已放弃。而且即使忠实还原，很多 WPS 文档本身正文就被设成了直接粗体，还原后反而“满屏粗体”。
3. **`.doc` 表格列宽/合并单元格**：`0x07` 只标记单元格结束，不含列宽与合并信息；要还原 4~6 列的申请表版式需解析 TAP，未做。列数目前用「出现次数 ≥ max(2, 行数×15%) 的最大列数」推断。
4. **`.doc` 图片**：魔数扫描（JPEG/PNG），拿不到位置，统一附在文末；不支持 WMF/EMF 矢量图。
5. **`.ppt`**：只提取文字，无图片、无版式。
6. **WebView 里画大 canvas 会白屏**：`tile memory limits exceeded`，所以 PDF 渲染必须走系统 `PdfRenderer`，不要在 WebView 里用 pdf.js+canvas 画。
7. **`.md` 本地图片**：依赖 Java 读文件回传，`content://` 拿不到父目录时会失败（微信分享进来的文件常见）。

---

## 待办

- [ ] `.doc` 表格 TAP 解析（还原合并单元格与列宽）
- [ ] `.ppt` 图片提取
- [ ] `.docx` 里的批注/修订
- [ ] 全文搜索扩展到 docx/pdf
- [ ] 阅读进度记忆

---

## 开发约定

- **改模板分片（`src/viewer.v2.part*.js`）再跑 `assemble.py`**，不要直接改 `assets/viewer.html`（会被覆盖）
- 改完跑 `node --check` 检查语法 + 上面那张回归表
- 按“两个函数之间”整段替换代码前，先列清区间内所有函数名，替换后 `grep "function X"` 逐个确认没被误删
- APK 交付路径固定：`cp` 到 `/sdcard/Download/` 让用户手动安装（`pm install` 被设备策略禁止）
