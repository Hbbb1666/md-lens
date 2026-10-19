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

## 在电脑上开始开发

```bash
git clone https://github.com/Hbbb1666/md-lens.git
cd md-lens
./fetch-vendors.sh          # 拉第三方库（约 12MB，不入库）
# 国内网络下 curl 单连接很慢、还可能留下 0 字节文件，可以用并发版：
node tools/fetch-vendors.mjs
./build.sh                  # 产出 out/mdlens.apk
```

**环境要求**
- JDK 17+（`javac --release 17`）
- Android SDK，`ANDROID_HOME` 指向它，需 `build-tools/34.0.0` 和 `platforms/android-34`
- Node（跑 `test/` 下的回归脚本，可选）
- Windows 用户请在 **WSL / Git Bash** 里跑，脚本是 bash

> **Windows 实测要点**（这套流程在 Windows 11 + Git Bash + JDK 17 + build-tools 34 上跑通过）：
> 1. `aapt2` / `zipalign` 是原生 Windows 程序，**项目路径不能含中文**——它会报
>    `failed to open directory: 系统找不到指定的文件`，那其实是编码问题不是文件不存在。
>    放在中文目录下就建一个英文 junction 再进去构建：
>    `cmd /c mklink /J D:\work\md-lens "<真实路径>"` 然后 `cd /d/work/md-lens && ./build.sh`。
> 2. Git Bash 的 `$P` 是 `/d/...` 形式，原生程序不认；`build.sh` 里统一用 `cygpath -w` 转换，别自己再拼路径。
> 3. SDK 可用镜像装：`commandlinetools-win` + `build-tools_r34-windows.zip`（解出来是 `android-14`，要改名成 `34.0.0`）+ `platform-34-ext7_r03.zip`（解出来是 `android-34`）。

**aarch64 与 x86_64 的差异**：Android 的 `aapt2` / `zipalign` 是 x86_64 ELF。本项目的开发容器是 aarch64，所以 `build.sh` 会自动检测并套 `qemu-amd64-static`；**普通 x86_64 电脑上不需要 qemu**，脚本检测不到就直连执行。

**不需要实机的部分**：`src/assemble.py` 的拼装断言、`test/` 下的渲染回归与导出校验都可以纯本地跑。
**需要实机的部分**：安装 APK、PDF 预览、长图导出、分享接收、文件管理器关联。

---

## 构建

```bash
./build.sh
```

产物：`out/mdlens.apk`，构建脚本会：
1. `src/assemble.py` **把四个分片按顺序拼接**成 `src/viewer.tpl.html`，再替换 CSS 占位符、生成 `assets/viewer.html`，并把库复制到 `assets/libs/`
2. aapt2 编译/链接资源（**注意：主资源用位置参数，不能用 `-R`**）
3. javac 编译（`--release 17 -classpath android.jar`，不要 `-bootclasspath`）
4. d8 生成 dex、打包、zipalign、apksigner 签名
5. **内容断言**：检查 APK 里的关键资源与 dex 字符串，缺一即失败

版本号：以 `AndroidManifest.xml` 里现有的 `versionCode` 为基准，每次构建 +1 并回写（`.versioncode` 只是缓存，它是 gitignore 的，新克隆时读不到——早期用 `|| echo 5` 兜底会导致 22 直接退到 6，见「已知限制」）。

---

## 目录结构

```
src/
  viewer.v2.part1.html   UI + CSS + 渲染路由
  viewer.v2.part2.js     各格式渲染器（docx/pdf/xlsx/pptx/doc/rtf/odt）
  viewer.v2.part3.js     导出（docx/xlsx/pptx/html）
  viewer.v2.part4.js     大纲解析、事件绑定、原生桥
  viewer.tpl.html        上面四段拼接的**快照**（assemble.py 每次构建都会用分片覆盖它）
  assemble.py            分片拼接 + CSS 注入 + 断言
  com/dsh/mdlens/MainActivity.java
vendor/                  轻量库（marked/DOMPurify/highlight.js/github-markdown-css）
vendor2/                 重型库（KaTeX+Mermaid+mammoth+pdfjs+SheetJS+PptxGenJS+JSZip + cmaps/字体）
res/ AndroidManifest.xml build.sh fetch-vendors.sh
tools/fetch-vendors.mjs  并发拉依赖（curl 太慢或留下 0 字节文件时用这个）
test/                    回归测试，见下
```

---

## 回归测试

三套，按“越接近真机越靠后”排列。**改解析或导出逻辑前后都要跑**。

### 1. 无头回归（jsdom，秒级）

```bash
cd test
python make-fixtures.py      # 生成 fixtures/ 样本（首次，需 python-docx / openpyxl / python-pptx）
node smoke.mjs               # 全部用例；也可 node smoke.mjs docx xlsx
```
覆盖 md / docx / xlsx / rtf 的渲染断言（共 13 条）。样本由 `make-fixtures.py` 用
python-docx / XlsxWriter / python-pptx 现场生成，**不依赖手机里的真实文件**。
`pptx` 在 jsdom 里跑不了（JSZip 解 zip 条目时 `file.async()` 永不返回），显式跳过。

### 2. 真实浏览器自检（推荐，覆盖 pptx 与导出）

```bash
node test/server.mjs                     # 起 http://127.0.0.1:8899
# 浏览器打开 http://127.0.0.1:8899/test/selfcheck.html
```

页面上会逐条列 ✓/✗：5 种格式渲染 + 3 种导出，并把导出的字节回写到 `test/out/`。

### 3. 导出产物校验（Office 官方解析库）

```bash
python test/verify-exports.py            # 读取 test/out/export.{docx,xlsx,pptx}
```

用 python-docx / openpyxl / python-pptx 真正打开导出文件，检查标题、表格、工作表都在。
只验证“文件合法且内容没丢”，不做像素级版式比对。

### 历史样本（真机上的 `.doc`）

早年用过的三个 `.doc` 期望值，样本在手机上，不在仓库里：

| 样本 | 期望 |
|---|---|
| `红色经典配音活动方案.doc` | 表 3 / 列 3 / 行 10 / 段 30 |
| `国家助学金申请表.doc` | 表 3 / 列 2 / 行 21 / 段 5 |
| `国家励志奖学金申请表.doc` | 表 3 / 列 2 / 行 24 / 段 3 |
| `玩家保密协议9.22最终版.docx` | 2 张图内联 |

---

## 已知限制（写清楚，避免重复踩）

1. **`.doc` 字符格式**：只做启发式（行首序号/短行→加粗），不做真还原。原因见下条。
2. **WPS 的 `.doc` STSH 不合标准**：`cbStshi=1062`（标准 18），样式数组交错，真格式还原需逆向私有格式，已放弃。而且即使忠实还原，很多 WPS 文档本身正文就被设成了直接粗体，还原后反而“满屏粗体”。
3. **`.doc` 表格列宽/合并单元格**：`0x07` 只标记单元格结束，不含列宽与合并信息；要还原 4~6 列的申请表版式需解析 TAP，未做。列数目前用「出现次数 ≥ max(2, 行数×15%) 的最大列数」推断。
4. **`.doc` 图片**：魔数扫描（JPEG/PNG），拿不到位置，统一附在文末；不支持 WMF/EMF 矢量图。
5. **`.ppt`**：只提取文字，无图片、无版式。
6. **WebView 里画大 canvas 会白屏**：`tile memory limits exceeded`，所以 PDF 渲染必须走系统 `PdfRenderer`，不要在 WebView 里用 pdf.js+canvas 画。
7. **`.md` 本地图片**：依赖 Java 读文件回传，`content://` 拿不到父目录时会失败（微信分享进来的文件常见）。

### 构建/工程侧的坑（都实际踩过）

8. **`pdfjs-dist@3.32.2` 不存在**：这个版本号在 npm 上一查就是 404，`fetch-vendors.sh` 会在拉 pdf.js 时直接断掉。已改钉 **3.11.174**（3.x 最后一版），cmaps / standard_fonts 也跟着从同一版本取，避免跨大版本混搭。
9. **`assemble.py` 曾经只读 `viewer.tpl.html`、不拼分片**：于是“改分片 → 跑 assemble → 构建”看起来一切正常，改动却进不了 APK（tpl 是上一次拼接留下的旧拷贝）。现在 `assemble.py` 先拼分片、拼完校验头和尾、再覆盖 tpl。
10. **零字节文件会被当成下载成功**：`curl -o` 失败时留下 0 字节文件，而 `assemble.py` 只判断文件在不在。`tools/fetch-vendors.mjs` 会把 0 字节当失败重下。
11. **Windows 中文路径让 `aapt2` 报“系统找不到指定的文件”**：不是路径不存在，是编码问题，见上面「Windows 实测要点」。

---

## 待办

- [ ] `.doc` 表格 TAP 解析（还原合并单元格与列宽）
- [ ] `.ppt` 图片提取
- [ ] `.docx` 里的批注/修订
- [ ] 全文搜索扩展到 docx/pdf
- [ ] 阅读进度记忆

---

## 开发约定

- **改分片（`src/viewer.v2.part*.js`）再跑 `assemble.py`**，不要直接改 `assets/viewer.html`（每次构建都会被重新生成）。`src/viewer.tpl.html` 是拼接快照，同样会被覆盖，不用手改。
- 改完跑 `node --check <改动的分片>` 检查语法，再跑 `test/smoke.mjs` 与 `test/selfcheck.html`
- 按“两个函数之间”整段替换代码前，先列清区间内所有函数名，替换后 `grep "function X"` 逐个确认没被误删
- APK 交付路径固定：`cp` 到 `/sdcard/Download/` 让用户手动安装（`pm install` 被设备策略禁止）
