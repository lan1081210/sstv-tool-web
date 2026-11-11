#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 LAN (BI7KGI)
"""把 www/ 打成单文件 HTML：CSS、JS、wasm(base64) 全内联，双击即可用。

    python3 scripts/bundle_single.py

产出两个文件（内容相同）：
  sstv-tool-web.html   根目录，给人下载后直接打开
  docs/index.html      GitHub Pages 的入口
"""
import base64
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
WWW = ROOT / "www"

html = (WWW / "index.html").read_text(encoding="utf-8")
css = (WWW / "style.css").read_text(encoding="utf-8")
js = (WWW / "app.js").read_text(encoding="utf-8")
wasm = (WWW / "sstv.wasm").read_bytes()
b64 = base64.b64encode(wasm).decode("ascii")

html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + css + "\n</style>")

old = """  const res = await fetch('sstv.wasm');
  if (!res.ok) throw new Error('sstv.wasm 没找到，先跑 ./build.sh');
  const buf = await res.arrayBuffer();"""
new = """  let buf;
  if (typeof __SSTV_WASM === 'string' && __SSTV_WASM.length) {
    const bin = atob(__SSTV_WASM);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    buf = u8.buffer;
  } else {
    const res = await fetch('sstv.wasm');
    if (!res.ok) throw new Error('sstv.wasm 没找到，先跑 ./build.sh');
    buf = await res.arrayBuffer();
  }"""
if old not in js:
    raise SystemExit("app.js 里的 wasm 加载段变了，先更新本脚本再打包")
js = js.replace(old, new)

html = html.replace(
    '<script src="app.js"></script>',
    '<script>\nconst __SSTV_WASM = "' + b64 + '";\n</script>\n<script>\n' + js + "\n</script>",
)
html = html.replace(
    "</title>",
    "</title>\n<!-- single-file build: wasm inlined as base64, no external requests -->",
    1,
)

for out in (ROOT / "sstv-tool-web.html", ROOT / "docs" / "index.html"):
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"{out.relative_to(ROOT)}  {out.stat().st_size // 1024} KB")
