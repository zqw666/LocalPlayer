# 任务交接：本地视频播放器（LocalPlayer）验证与收尾

> 本文件给 Codex 接手用。目标项目在 **D:\project\LocalPlayer**，代码全部就绪但**尚未在真实桌面验证过**，需要你跑起来并逐项验收，有 bug 就修。

## 你要完成的目标

让 `D:\project\LocalPlayer\本地视频播放器.exe` 在 Windows 桌面正常运行，并满足：

1. **双击 exe → 弹出深色无边框菜单的播放窗口**（极简 Electron 应用）
2. **拖一个 .mp4 文件进窗口 → 立即播放**；或点左下角"打开"按钮选文件
3. ★**鼠标移出窗口 → 整个窗口隐形（完全透明）**；鼠标移回窗口所在区域 → 窗口恢复可见 —— 这是用户的核心需求，务必验证
4. 播放时底部控制条：鼠标静止 2 秒自动隐藏，移动鼠标出现；暂停时控制条常显
5. 记住每个文件的播放进度（localStorage，key=`pos_<文件路径>`）
6. 关闭窗口 → 进程退出、无残留

## 项目结构（Electron 44 便携模式，无打包流程，改完源码重跑即生效）

```
D:\project\LocalPlayer\
├─ 本地视频播放器.exe      # 已就位（electron.exe 改名，246MB，勿动 exe 本身）
├─ desktop.log             # 运行时日志（主进程自动写，排障第一手资料）
├─ resources\
│  ├─ default_app.asar     # Electron 自带，勿动
│  └─ app\                 # ★应用代码全在这，改这里
│     ├─ package.json
│     ├─ main.js           # 主进程：窗口创建、透明度控制(setOpacity)、文件打开、全屏
│     ├─ preload.js        # contextBridge 桥（暴露 setWindowHidden/pickVideo 等）
│     ├─ index.html        # UI：video + 控制条 + 空状态提示
│     ├─ style.css
│     └─ renderer.js       # 渲染层：★鼠标移出检测 + 播放控制 + 拖放 + 快捷键
```

## 核心需求实现位置（改动时先看这里）

- **鼠标移出 → 窗口隐形**：`renderer.js` 顶部 `mouseout` + `relatedTarget` 判定真离开 document → `scheduleHide()` 延迟 250ms → `api.setWindowHidden(true)` → `main.js` 里 `win.setOpacity(HIDDEN_OPACITY)`
- **隐形程度可调**：`main.js` 顶部常量 `HIDDEN_OPACITY = 0`（0=完全隐形；想要影子轮廓改成 15~30）
- 移出延迟：`renderer.js` 的 `scheduleHide()` 内 `setTimeout(..., 250)`（防鼠标快速掠过边缘误触）

## 当前状态（如实交接）

- [x] 全部源码已写好，`node --check` 三个 JS 全过，无语法错误
- [x] exe 便携目录已组装完毕（结构如上）
- [x] ★静态通道审计已完成并修复 5 处（2026-09-08 交接前最后一轮）：
      1) pick-video 双重下发导致 loadVideo 双触发 → 已删 handle 内 sendFile
      2) 按钮聚焦时空格无响应 → 统一走 togglePlay
      3) 静音态按 ↑/↓ 不恢复有声 → 调音量时自动 unmute
      4) Esc 退出全屏查 HTML5 fullscreen（从未启用）→ 改为主进程 setFullScreen(false)，新增 exit-fullscreen IPC + fs-state 状态同步
      5) lastSave 重复声明 → 已清理（原声明本就在 17 行，进度记忆逻辑无 bug）
- [x] 三层通道一致性已核对：renderer 调用的 7 个 api.* 与 preload 暴露全对齐；13 个 DOM id 引用全命中；IPC channel 名 main/preload 完全一致
- [x] 在 WorkBuddy 沙箱内主进程能启动（`[player] main process started` 有输出）
- [ ] **页面 `did-finish-load` 在沙箱内始终未触发**（desktop.log 为空）——沙箱会绞杀 Electron 的渲染/网络子进程，属沙箱限制，**真实桌面大概率正常，但也可能是真 bug，需要你实测判断**
- [ ] 窗口弹出、拖放播放、隐形交互、进度记忆 —— 全部未在真实桌面验证

## 已知坑与注意事项

1. **本机 AMD RX 9070 XT 有 GPU 驱动崩溃史（TDR）**：若双击后窗口闪退/黑屏，先用命令行带 `--disable-gpu` 启动确认（`cd /d/project/LocalPlayer && "本地视频播放器.exe" --disable-gpu`）；若确认是 GPU 问题，考虑给 exe 的启动器加该参数
2. **排障第一入口 = desktop.log**：main.js 已记录 page loaded / did-fail-load / renderer gone / console-message / play file 等。窗口弹了但黑屏/空白，先看它
3. 若窗口弹了但隐形逻辑不生效，检查：窗口是否真的拿到焦点、`document.contains(e.relatedTarget)` 判定是否符合预期（可用 devtools：`"本地视频播放器.exe" --disable-gpu --remote-debugging-port=9222` 后开 Chrome 访问 localhost:9222）
4. **范围限制**：Chromium 内核只能解 mp4/webm/mov 及 h264 编码的 mkv；hevc/rmvb/avi(部分) 放不了属正常，不是 bug
5. 别碰同盘的其它项目：`D:\project\KVideo`（网页版源码）、`D:\project\KVideo-desktop`、`D:\project\KVideo-electron`、`D:\project\mpv` 都与本任务无关
6. 环境变量 `ELECTRON_RUN_AS_NODE` 只在 WorkBuddy 沙箱注入，你的终端没有，不用处理；若恰好有，`env -u ELECTRON_RUN_AS_NODE` 去掉再跑
7. 改完源码**无需重新打包**，直接重跑 exe 即生效（便携模式实时读 resources\app）

## 建议工作顺序

1. 命令行跑一次：`cd /d/project/LocalPlayer && .\本地视频播放器.exe`，看窗口是否弹出、desktop.log 写了什么
2. 窗口正常 → 拖 mp4 验证播放、控制条、暂停常显、进度记忆
3. 验证★鼠标移出隐形：窗口在桌面时鼠标移到屏幕其它位置 → 整窗消失；移回原位置 → 恢复（若隐形后找不到窗口，先改 `HIDDEN_OPACITY=20` 测试逻辑，确认 OK 再改回 0）
4. 窗口起不来/黑屏 → 读 desktop.log，按"已知坑"第 1、3 条排查，改 renderer.js/main.js 修复
5. 全部通过后：向用户汇报结果 + 附 desktop.log 关键行
