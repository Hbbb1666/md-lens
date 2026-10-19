#!/usr/bin/env python3
"""用 Office 官方解析库校验 viewer 导出的 docx / xlsx / pptx 是否真的是合法文件。

只检查「能不能打开、结构对不对」——不做像素级版式比对。
产物由 test/server.mjs 的 POST /__save 从浏览器回写，见 test/run-all.mjs。

用法：python verify-exports.py [目录]（默认 test/out）
"""
import sys
import pathlib

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).parent / "out")
problems = []


def check_docx():
    from docx import Document
    f = OUT / "export.docx"
    if not f.exists():
        problems.append("export.docx 不存在")
        return
    d = Document(str(f))
    text = "\n".join(p.text for p in d.paragraphs)
    if "一级标题" not in text:
        problems.append("docx 里没有「一级标题」")
    if "二级标题" not in text:
        problems.append("docx 里没有「二级标题」")
    if not d.tables:
        problems.append("docx 没有表格")
    else:
        cells = [c.text for r in d.tables[0].rows for c in r.cells]
        if not ("甲" in cells and "乙" in cells and "名称" in cells):
            problems.append(f"docx 表格内容不对：{cells}")
    print(f"  docx: 段落 {len(d.paragraphs)} 个，表格 {len(d.tables)} 个，表格单元格 {len(d.tables[0].rows) if d.tables else 0} 行")


def check_xlsx():
    import openpyxl
    f = OUT / "export.xlsx"
    if not f.exists():
        problems.append("export.xlsx 不存在")
        return
    wb = openpyxl.load_workbook(str(f))
    vals = [c for ws in wb.worksheets for row in ws.iter_rows() for c in row if c.value is not None]
    flat = [str(c.value) for c in vals]
    if not any("一级标题" in v for v in flat):
        problems.append("xlsx 里没有「一级标题」")
    print(f"  xlsx: 工作表 {wb.sheetnames}，非空单元格 {len(flat)} 个")


def check_pptx():
    from pptx import Presentation
    f = OUT / "export.pptx"
    if not f.exists():
        problems.append("export.pptx 不存在")
        return
    p = Presentation(str(f))
    texts = []
    for s in p.slides:
        for sh in s.shapes:
            if sh.has_text_frame and sh.text_frame.text.strip():
                texts.append(sh.text_frame.text.strip())
    joined = "\n".join(texts)
    if "一级标题" not in joined:
        problems.append("pptx 里没有「一级标题」")
    print(f"  pptx: {len(p.slides)} 页，有文字的形状 {len(texts)} 个")


if __name__ == "__main__":
    print(f"校验目录 {OUT}")
    for fn in (check_docx, check_xlsx, check_pptx):
        try:
            fn()
        except Exception as e:  # noqa: BLE001 — 解析库抛什么都要报出来
            problems.append(f"{fn.__name__} 异常：{type(e).__name__}: {e}")
    if problems:
        print("\n✗ 导出校验失败：")
        for p in problems:
            print("   -", p)
        sys.exit(1)
    print("\n✓ 三种导出格式都能被 Office 官方解析库正常打开")
