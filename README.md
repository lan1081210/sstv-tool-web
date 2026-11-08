# SSTV Tool Web

[English](README.en.md) · 中文

一个跑在浏览器里的慢扫描电视（SSTV）工具：**接收**（把录音或麦克风里的 SSTV 解成图片）
和**生成**（把一张图变成 SSTV 音频，带裁切/旋转/文字叠加）。

解码器和编码器是同一个项目的 C 核心，编译成 WebAssembly 在页面里跑；图片编辑用 `<canvas>`。
不上传任何数据，全部在本机完成。

## 版权

© 2026 LAN (BI7KGI)。本项目以其新增的 WASM 移植、JS 界面与构建脚本以 **GPL-3.0** 发布，
因为它链接了 SodaGray/apricot-sstv 的解码核心（GPL-3.0）与同仓库的编码器。
上游核心的版权归其作者所有，见 `LICENSE`。

    版权所有 (C) 2026 LAN (BI7KGI)  ·  许可 GPL-3.0

## 编译

需要 `clang`（Apple 的 Command Line Tools 就带 wasm32 目标）和 `wasm-ld`：

```sh
brew install lld
./build.sh          # 产出 www/sstv.wasm
```

## 本地跑

```sh
cd www && python3 -m http.server 8765
# 打开 http://localhost:8765
```

麦克风输入要求 `https://` 或 `localhost`（浏览器的安全上下文限制）。

## 用

**接收**

- 「选择录音」支持 wav / mp3 / m4a / flac，解出来的图会排在右侧，点开可存 PNG
- 「从麦克风听」直接实时解码，画面逐行出图
- 接收模式可锁定某一种（不等 VIS），也可以勾「连续」一张接一张
- 「扫完整张才结束」默认开着：中间掉信号就留白，扫满整幅才收尾

**生成**

- 选图（或把图拖进页面）→ 拖动画面调整取景、滚轮缩放
- 旋转 90°、左右/上下翻、留黑边/裁满/拉伸、字号/缩放/亮度/对比
- 文字叠加 + 九宫格位置
- 14 种模式（Robot 36/72、Martin M1/M2、Scottie S1/S2/DX、PD50–PD290）
- 「生成并播放」或「存成 WAV」

也可以用链接直接带素材：`?audio=某段录音.wav`、`?image=某张图.png`。

## 目录

    src/sstv_dsp.c   解码核心（上游，未改动）
    src/enc.c        编码核心（上游 host 版，未改动）
    src/shim.c       wasm 用的极简 libc：bump allocator + mem* + 把数学函数接到 JS 的 Math
    src/sstv_web.c   给页面用的 C 接口（喂样本、取图、编码出 WAV）
    www/             页面、样式、脚本，以及构建产物 sstv.wasm
    build.sh         编译 + 链接
