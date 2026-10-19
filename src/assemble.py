#!/usr/bin/env python3
"""组装 assets：viewer.html（外壳 + 应用逻辑）+ libs/（按需加载的库与字体）。

两个关键点：
1) 库不内联：总量约 8MB；而且 minified 库里的 `<!-->` 会让 HTML 进入 script
   escaped 状态、把脚本劈断。外部 <script src> 天然避开，还能按需加载。
2) 暗色 CSS 必须作用域化：github-markdown-dark.css 是无条件生效的，
   直接内联会在亮色主题下把文字刷成浅色（白底浅字看不见）。
   这里把它拆成「data-theme=dark 强制生效」+「data-theme=auto 且系统暗色」两套。
"""
import pathlib
import re
import shutil
import sys

# 项目根目录 = 本文件所在 src/ 的上一级（不要写死容器路径，否则 clones 到别的机器上必挂）
BASE = pathlib.Path(__file__).resolve().parent.parent
TPL = BASE / "src" / "viewer.tpl.html"
OUTDIR = BASE / "assets"
LIBS = OUTDIR / "libs"

V1 = BASE / "vendor"
V2 = BASE / "vendor2"

def rd(p: pathlib.Path) -> str:
    if not p.exists():
        sys.exit(f"[assemble] 缺少文件: {p}")
    return p.read_text(encoding="utf-8")

def css_safe(s: str) -> str:
    return s.replace("</style", "<\\/style")

def theme_scoped(css: str, token: str) -> str:
    forced = css.replace(token, 'html[data-theme="dark"] ' + token)
    follow = css.replace(token, 'html[data-theme="auto"] ' + token)
    return forced + "\n@media (prefers-color-scheme: dark){\n" + follow + "\n}"

LIB_FILES = [
    (V1 / "marked.min.js",      "marked.min.js"),
    (V1 / "purify.min.js",      "purify.min.js"),
    (V1 / "highlight.min.js",   "hljs.min.js"),
    (V2 / "katex.min.js",       "katex.min.js"),
    (V2 / "katex.min.css",      "katex.min.css"),
    (V2 / "mermaid.min.js",     "mermaid.min.js"),
    (V2 / "mammoth.js",         "mammoth.js"),
    (V2 / "pdf.min.js",         "pdf.min.js"),
    (V2 / "pdf.worker.min.js",  "pdf.worker.min.js"),
    (V2 / "xlsx.full.min.js",   "xlsx.full.min.js"),
    (V2 / "pptxgen.bundle.js",  "pptxgen.bundle.js"),
    (V2 / "jszip.min.js",       "jszip.min.js"),
]

# viewer.tpl.html 不是手写文件，它是四个分片按顺序拼接的结果。
# 以前这里只读 tpl，于是「改分片 → 跑 assemble」看起来正常、
# 实际改动根本进不了 APK（tpl 是上一次拼接留下的旧拷贝）。
PARTS = ["viewer.v2.part1.html", "viewer.v2.part2.js",
         "viewer.v2.part3.js", "viewer.v2.part4.js"]

def load_template() -> str:
    """有分片就用分片拼，缺分片才退回已提交的 tpl。"""
    src = BASE / "src"
    missing = [n for n in PARTS if not (src / n).exists()]
    if not missing:
        return "".join(rd(src / n) for n in PARTS)
    if len(missing) == len(PARTS):
        return rd(TPL)
    sys.exit(f"[assemble] 分片不全，缺 {missing}")

def check_template(text: str) -> None:
    # 分片拼错（少一个、顺序反了）在这里就要炸，别等到 APK 里白屏才发现
    if not text.lstrip().lower().startswith("<!doctype html") and "<html" not in text[:2000].lower():
        sys.exit("[assemble] 模板开头不像 HTML 文档")
    if "</html>" not in text:
        sys.exit("[assemble] 模板没有 </html> 结尾，分片可能没拼全")
    for fn in PARTS:
        if (BASE / "src" / fn).exists() and fn.startswith("viewer.v2.part") and fn.endswith(".js"):
            marker = (BASE / "src" / fn).read_text(encoding="utf-8").strip()[:60]
            if marker and marker not in text:
                sys.exit(f"[assemble] 分片 {fn} 的内容没出现在拼接结果里")

def main() -> None:
    tpl = load_template()
    check_template(tpl)
    # 保持 tpl 与分片同步：它是给人 grep 用的快照，不是真源
    if tpl != (TPL.read_text(encoding="utf-8") if TPL.exists() else None):
        TPL.write_text(tpl, encoding="utf-8")
        print("[assemble] 已用分片刷新 src/viewer.tpl.html")
    mapping = {
        "@@GITHUB_LIGHT@@": css_safe(rd(V1 / "github-markdown-light.css")),
        "@@GITHUB_DARK@@":  css_safe(theme_scoped(rd(V1 / "github-markdown-dark.css"), ".markdown-body")),
        "@@HL_LIGHT@@":     css_safe(rd(V1 / "hl-github.css")),
        "@@HL_DARK@@":      css_safe(theme_scoped(rd(V1 / "hl-github-dark.css"), ".hljs")),
    }
    for key, val in mapping.items():
        if key not in tpl:
            sys.exit(f"[assemble] 模板里找不到占位符 {key}")
        tpl = tpl.replace(key, val)
    if "@@GITHUB_LIGHT@@" in tpl:
        sys.exit("[assemble] 占位符未替换")

    # 断言：暗色规则必须带主题前缀，不能裸奔
    if 'html[data-theme="dark"] .markdown-body' not in tpl:
        sys.exit("[assemble] 暗色 CSS 缺少 data-theme 前缀")
    if "}.markdown-body{color-scheme:dark" in tpl:
        sys.exit("[assemble] 存在裸暗色规则，亮色主题下会白底浅字")
    if "@media (prefers-color-scheme: dark)" not in tpl:
        sys.exit("[assemble] 缺少跟随系统暗色的 media query")

    OUTDIR.mkdir(parents=True, exist_ok=True)
    (OUTDIR / "viewer.html").write_text(tpl, encoding="utf-8")
    print(f"[assemble] viewer.html {len(tpl):,} 字符")

    if LIBS.exists():
        shutil.rmtree(LIBS)
    (LIBS / "fonts").mkdir(parents=True)

    total = 0
    for src, dst in LIB_FILES:
        if not src.exists():
            sys.exit(f"[assemble] 缺少库: {src}")
        shutil.copyfile(src, LIBS / dst)
        total += src.stat().st_size

    fonts = sorted((V2 / "katexfonts").glob("*.woff2"))
    if len(fonts) < 15:
        sys.exit(f"[assemble] KaTeX 字体不全: {len(fonts)} 个")
    for f in fonts:
        shutil.copyfile(f, LIBS / "fonts" / f.name)
        total += f.stat().st_size

    # pdf.js 的字符映射表与标准字体：中文 CID 字体 PDF 缺了 CMap 会整页白屏
    for sub in ("cmaps", "standard_fonts"):
        src_dir = V2 / "pdfjs" / sub
        if not src_dir.exists():
            sys.exit(f"[assemble] 缺少 pdf.js 资源目录: {src_dir}")
        dst_dir = LIBS / sub
        dst_dir.mkdir(parents=True, exist_ok=True)
        n = 0
        for f in sorted(src_dir.iterdir()):
            if f.is_file():
                shutil.copyfile(f, dst_dir / f.name)
                total += f.stat().st_size
                n += 1
        if n < 10:
            sys.exit(f"[assemble] {sub} 文件太少: {n}")
        print(f"[assemble] {sub}: {n} 个文件")

    files = [p for p in LIBS.rglob("*") if p.is_file()]
    print(f"[assemble] libs: {len(files)} 个文件, {total/1048576:.2f} MB")

if __name__ == "__main__":
    main()
