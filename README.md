# LocalPlayer

一个轻量、无边框、可透明隐藏的 Windows 本地视频播放器。

## 特性

- 无边框透明窗口，支持鼠标移出隐藏、鼠标移回恢复
- 可分别设置播放时和移出后的透明度，启动时沿用播放时透明度
- 自定义全局唤起/隐藏快捷键，默认 `Ctrl+Alt+P`
- 支持“适应 / 填充”画面模式并记住选择
- 单文件播放、文件夹递归扫描、自然排序和自动播放下一集
- 播放列表与最近观看历史，支持断点续播
- 支持拖放文件和文件夹

## 运行

源码位于 `resources/app`，使用 Electron 运行时。

```powershell
node --check resources/app/main.js
node --test resources/app/media-library.test.js
```

普通用户无需安装 Node.js，可从 Releases 下载 Windows 便携版，解压后双击 `本地视频播放器.exe`。

## 快捷键

默认全局快捷键为 `Ctrl+Alt+P`。在播放器顶部键盘按钮中可以修改，按下新的组合键后立即生效并保存。

## 许可

本项目当前未指定开源许可证。如需他人自由修改和分发，建议后续补充许可证文件。
