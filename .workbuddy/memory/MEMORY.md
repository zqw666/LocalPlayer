# LocalPlayer 项目长期约定

## 项目性质
Electron 打包的"本地视频播放器"（`D:\project\LocalPlayer`），源码在 `resources/app/`（asar 外的明文 JS）。
同时支持本地文件与百度网盘在线播放。

## 关键文件
- `resources/app/main.js` — 主进程：窗口透明度、IPC 通道、百度 OAuth 状态持久化（safeStorage）
- `resources/app/renderer.js` — 渲染层：播放器、媒体库、字幕面板
- `resources/app/baidu-netdisk.js` — 百度开放平台 API 封装（纯函数 + 可注入 fetchImpl，便于单测）
- `resources/app/baidu-stream-server.js` — 网盘视频流本地代理（端口随机分配，无冲突风险）
- `resources/app/desktop.log` — 运行时日志，排查第一手资料

## 编码约定
- `baidu-netdisk.js` 的函数一律接受可注入的 `fetchImpl`，单测不得发真实网络请求。
- 所有对外部 API 的响应必须先校验业务错误码，并优先提取服务端 `show_msg` 作为错误信息。
- 测试用 `node --test`（Node 22 内置），不引入第三方测试框架。

## 排查约定
- 启动应用做真机验证时：必须 `env -u ELECTRON_RUN_AS_NODE`、必须带 `--no-sandbox --disable-gpu --in-process-gpu`、
  必须用独立 `--user-data-dir`（应用有单实例锁）。
- 不要动用户正在使用的实例（真实 userData、无调试端口）。
