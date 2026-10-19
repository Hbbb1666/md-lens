#!/bin/bash
# 拉取构建所需的第三方库（不入 git，因为总体约 12MB，push 会超时）
# 用法：./fetch-vendors.sh
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p vendor vendor2/katexfonts vendor2/pdfjs/cmaps vendor2/pdfjs/standard_fonts

dl() {  # dl <url> <输出路径>
  if [ -s "$2" ]; then echo "  跳过 $2"; return; fi
  curl -sS --retry 3 --max-time 120 -o "$2" "$1" || { echo "  ✗ 下载失败: $1"; exit 1; }
  echo "  ✓ $2"
}

echo "== 轻量库（vendor/）=="
dl "https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"        vendor/marked.min.js
dl "https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js" vendor/purify.min.js
dl "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11/highlight.min.js" vendor/highlight.min.js
dl "https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown.min.css"      vendor/github-markdown.css
dl "https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown-light.min.css" vendor/github-markdown-light.css
dl "https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown-dark.min.css"  vendor/github-markdown-dark.css
dl "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11/styles/github.min.css"      vendor/hl-github.css
dl "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11/styles/github-dark.min.css" vendor/hl-github-dark.css

echo "== 重型库（vendor2/）=="
dl "https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.js"   vendor2/katex.min.js
dl "https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css"  vendor2/katex.min.css
dl "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js" vendor2/mermaid.min.js
dl "https://cdn.jsdelivr.net/npm/mammoth/mammoth.browser.min.js" vendor2/mammoth.js
dl "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js"        vendor2/pdf.min.js
dl "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js" vendor2/pdf.worker.min.js
dl "https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js"          vendor2/xlsx.full.min.js
dl "https://cdn.jsdelivr.net/npm/pptxgenjs/dist/pptxgen.bundle.js"    vendor2/pptxgen.bundle.js
dl "https://cdn.jsdelivr.net/npm/jszip@3.10.2/dist/jszip.min.js"      vendor2/jszip.min.js

echo "== KaTeX 字体（20 个）=="
for f in KaTeX_Main-Regular KaTeX_Main-Bold KaTeX_Main-Italic KaTeX_Main-BoldItalic \
         KaTeX_Math-Italic KaTeX_Math-BoldItalic KaTeX_AMS-Regular KaTeX_Size1-Regular \
         KaTeX_Size2-Regular KaTeX_Size3-Regular KaTeX_Size4-Regular KaTeX_Caligraphic-Regular \
         KaTeX_Caligraphic-Bold KaTeX_Fraktur-Regular KaTeX_Fraktur-Bold KaTeX_SansSerif-Regular \
         KaTeX_SansSerif-Bold KaTeX_SansSerif-Italic KaTeX_Script-Regular KaTeX_Typewriter-Regular; do
  dl "https://cdn.jsdelivr.net/npm/katex@0.16/dist/fonts/$f.woff2" "vendor2/katexfonts/$f.woff2"
done

echo "== pdf.js CMap + 标准字体（中文 PDF 必需，缺了会整页白屏）=="
if [ ! -f vendor2/pdfjs/.fetched ]; then
  curl -sS --max-time 60 "https://data.jsdelivr.com/v1/packages/npm/pdfjs-dist@3.11.174?structure=flat" -o /tmp/pj4.json
  python3 - <<'PY'
import json, os, subprocess
d = json.load(open("/tmp/pj4.json"))
files = [f["name"] for f in d.get("files", [])]
for f in files:
    if "/cmaps/" in f or "/standard_fonts/" in f:
        sub = "cmaps" if "/cmaps/" in f else "standard_fonts"
        base = os.path.basename(f)
        out = f"vendor2/pdfjs/{sub}/{base}"
        if os.path.exists(out):
            continue
        subprocess.run(["curl","-sS","--max-time","90","-o",out,
                        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174"+f], check=False)
print("cmaps:", len(os.listdir("vendor2/pdfjs/cmaps")),
      "| standard_fonts:", len(os.listdir("vendor2/pdfjs/standard_fonts")))
PY
  touch vendor2/pdfjs/.fetched
fi

echo
echo "完成。现在可以运行 ./build.sh"
