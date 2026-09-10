// 本地视频播放器 - preload（沙箱桥）
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('player', {
    // 切换全屏
    toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
    // 退出全屏（Esc）
    exitFullscreen: () => ipcRenderer.send('exit-fullscreen'),
    // 无边框窗口按钮
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),
    setWindowContentHidden: (hidden) => ipcRenderer.send('window-content-hidden', hidden),
    onShowWindow: (cb) => ipcRenderer.on('show-window-content', cb),
    getSummonShortcut: () => ipcRenderer.invoke('get-summon-shortcut'),
    suspendSummonShortcut: () => ipcRenderer.invoke('suspend-summon-shortcut'),
    resumeSummonShortcut: () => ipcRenderer.invoke('resume-summon-shortcut'),
    setSummonShortcut: (shortcut) => ipcRenderer.invoke('set-summon-shortcut', shortcut),
    baiduStatus: () => ipcRenderer.invoke('baidu-status'),
    baiduConfigure: (apiKey, secretKey) => ipcRenderer.invoke('baidu-configure', apiKey, secretKey),
    baiduOpenAuthorization: () => ipcRenderer.invoke('baidu-open-authorization'),
    baiduCompleteAuthorization: (code) => ipcRenderer.invoke('baidu-complete-authorization', code),
    baiduList: (directory) => ipcRenderer.invoke('baidu-list', directory),
    baiduCloudItem: (file) => ipcRenderer.invoke('baidu-cloud-item', file),
    baiduDisconnect: () => ipcRenderer.invoke('baidu-disconnect'),
    onBaiduStreamStats: (cb) => ipcRenderer.on('baidu-stream-stats', (_event, stats) => cb(stats)),
    // 主进程同步全屏状态
    onFsState: (cb) => ipcRenderer.on('fs-state', (_e, fs) => cb(fs)),
    // 打开文件对话框
    pickVideo: () => ipcRenderer.invoke('pick-video'),
    // 打开文件夹并递归生成播放列表
    pickFolder: () => ipcRenderer.invoke('pick-folder'),
    // 识别拖入或历史记录中的本地文件/目录
    openLocalPath: (p) => ipcRenderer.invoke('open-local-path', p),
    // 拖放的 File 对象 → 本地路径
    pathForFile: (file) => webUtils.getPathForFile(file),
    // 主进程下发"播放这个文件"
    onPlayFile: (cb) => ipcRenderer.on('play-file', (_e, d) => cb(d))
});
