#!/usr/bin/env python3
"""生成回归测试用的样本文件（不依赖手机上的真实样本）。

仓库原来 test/ 下的脚本全指向 /sdcard 与 /root/mdlens 的真实文件，
换一台机器就跑不了。这里用 python-docx / openpyxl / python-pptx 造出
结构确定的小样本，让「打开 → 渲染」这条链路可以在任何机器上被验证。

用法：python make-fixtures.py [输出目录]（默认本文件同级的 fixtures/）
"""
import pathlib
import sys

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).parent / "fixtures")
OUT.mkdir(parents=True, exist_ok=True)


def make_docx():
    from docx import Document
    from docx.shared import Inches
    from PIL import Image

    img = OUT / "_dot.png"
    Image.new("RGB", (64, 48), (220, 40, 40)).save(img)

    d = Document()
    d.add_heading("一级标题", level=1)
    d.add_paragraph("正文段落，用来验证 mammoth 的段落还原。")
    d.add_heading("二级标题", level=2)
    d.add_paragraph("列表：", style="List Bullet")
    d.add_paragraph("条目一", style="List Bullet")
    d.add_paragraph("条目二", style="List Bullet")
    t = d.add_table(rows=3, cols=3)
    for r in range(3):
        for c in range(3):
            t.cell(r, c).text = f"R{r}C{c}"
    d.add_paragraph("图片：")
    d.add_picture(str(img), width=Inches(0.6))
    d.save(OUT / "sample.docx")
    img.unlink()


def make_xlsx():
    # 用 XlsxWriter 而不是 openpyxl：它会把公式的缓存值一起写进去。
    # Excel 存的文件本来就带缓存值；没有缓存值，预览只能显示 "=B2+C2" 字面量，
    # 那样测出来的「公式没算」是样本的问题，不是 App 的问题。
    import xlsxwriter

    wb = xlsxwriter.Workbook(str(OUT / "sample.xlsx"))
    ws = wb.add_worksheet("成绩表")
    ws.write_row(0, 0, ["姓名", "语文", "数学", "总分"])
    rows = [("张三", 91, 88, 179), ("李四", 76, 95, 171), ("王五", 60, 59, 119)]
    for i, (n, a, b, total) in enumerate(rows, start=1):
        ws.write(i, 0, n)
        ws.write_number(i, 1, a)
        ws.write_number(i, 2, b)
        ws.write_formula(i, 3, f"=B{i + 1}+C{i + 1}", None, total)
    ws2 = wb.add_worksheet("第二表")
    ws2.write(0, 0, "第二个工作表")
    ws2.write_number(1, 0, 12345)
    wb.close()


def make_pptx():
    # 不插图：jsdom 没有 canvas / 图片解码，带图会让 shrinkDataUrl 永远等不到 onload。
    # 图片内联那条路径只能在真机（或带 canvas 的浏览器）上验。
    from pptx import Presentation
    from pptx.util import Pt  # noqa: F401

    p = Presentation()
    s1 = p.slides.add_slide(p.slide_layouts[1])
    s1.shapes.title.text = "封面标题"
    s1.placeholders[1].text = "副标题一行"
    s2 = p.slides.add_slide(p.slide_layouts[1])
    s2.shapes.title.text = "第二页"
    tf = s2.placeholders[1].text_frame
    tf.text = "要点一"
    tf.add_paragraph().text = "要点二"
    p.save(OUT / "sample.pptx")


def make_md():
    text = """# 回归样本

这是一段正文，包含 `行内代码`。

## 表格

| 名称 | 数量 | 备注 |
|---|---|---|
| 甲 | 1 | 第一条 |
| 乙 | 2 | 第二条 |

## 代码

```js
function add(a, b) { return a + b; }
```

## 列表

- 第一项
- 第二项

> 引用块
"""
    (OUT / "sample.md").write_text(text, encoding="utf-8")


def make_rtf():
    rtf = (r"{\rtf1\ansi\deff0{\fonttbl{\f0 Times;}}\f0\fs24 "
           r"RTF regression sample.\par Second paragraph.\par}")
    (OUT / "sample.rtf").write_text(rtf, encoding="ascii")


if __name__ == "__main__":
    make_md()
    make_docx()
    make_xlsx()
    make_pptx()
    make_rtf()
    for f in sorted(OUT.iterdir()):
        print(f"{f.name:14s} {f.stat().st_size:>8,} bytes")
