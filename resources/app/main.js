// 本地视频播放器 - 主进程
// 核心需求：鼠标移出窗口 → 整个窗口变透明隐形；鼠标移回窗口区域 → 恢复
const { app, BrowserWindow, ipcMain, dialog, Menu, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { isSupportedVideo, mediaItemForPath, openLocalPath } = require('./media-library');

// 这台机器的 AMD 驱动曾导致 Electron 渲染进程崩溃；本地播放器优先保证稳定。
app.disableHardwareAcceleration();

let win = null;
let revealWatchTimer = null;
let contentHidden = false;
let fullScreen = false;
const DEFAULT_SUMMON_SHORTCUT = 'CommandOrControl+Alt+P';
let summonShortcut = DEFAULT_SUMMON_SHORTCUT;
let shortcutSuspended = false;
const LOG = path.join(__dirname, '..', 'desktop.log');
function log(msg) {
    try { fs.appendFileSync(LOG, `[${new Date().toLocaleTimeString()}] ${msg}\n`); } catch (_) {}
}
console.log('[player] main process started, app path =', __dirname);

// 启动命令行带进来的文件（拖 mp4 到 exe 图标 / 右键"打开方式"）
function argVideo(argv) {
    for (const a of argv.slice(1)) {
        if (!isSupportedVideo(a) || !fs.existsSync(a)) continue;
        try {
            if (fs.statSync(a).isFile()) return a;
        } catch (_) {}
    }
    return null;
}

function stopRevealWatch() {
    clearInterval(revealWatchTimer);
    revealWatchTimer = null;
}

function revealWindowContent() {
    contentHidden = false;
    stopRevealWatch();
    if (win && !win.isDestroyed()) win.webContents.send('show-window-content');
}

function summonWindow() {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    revealWindowContent();
    win.focus();
}

function toggleWindowVisibility() {
    if (!win || win.isDestroyed()) return;
    if (!win.isVisible() || win.isMinimized() || contentHidden || !win.isFocused()) {
        summonWindow();
        log('window summoned by shortcut');
        return;
    }
    stopRevealWatch();
    win.hide();
    log('window hidden by shortcut');
}

function shortcutSettingsPath() {
    return path.join(app.getPath('userData'), 'player-settings.json');
}

function loadSummonShortcut() {
    try {
        const settings = JSON.parse(fs.readFileSync(shortcutSettingsPath(), 'utf8'));
        if (typeof settings.summonShortcut === 'string' && settings.summonShortcut.length <= 80) {
            return settings.summonShortcut;
        }
    } catch (_) {}
    return DEFAULT_SUMMON_SHORTCUT;
}

function saveSummonShortcut() {
    try {
        fs.mkdirSync(path.dirname(shortcutSettingsPath()), { recursive: true });
        fs.writeFileSync(shortcutSettingsPath(), JSON.stringify({ summonShortcut }, null, 2));
        return true;
    } catch (error) {
        log('shortcut settings save failed: ' + error.message);
        return false;
    }
}

function registerSummonShortcut(shortcut) {
    try {
        return globalShortcut.register(shortcut, toggleWindowVisibility);
    } catch (error) {
        log('shortcut registration error: ' + error.message);
        return false;
    }
}

function activateSummonShortcut(shortcut) {
    const nextShortcut = typeof shortcut === 'string' ? shortcut.trim() : '';
    if (!nextShortcut || nextShortcut.length > 80) {
        return { ok: false, shortcut: summonShortcut, error: '快捷键格式无效' };
    }

    const previousShortcut = summonShortcut;
    globalShortcut.unregister(previousShortcut);
    shortcutSuspended = false;

    if (!registerSummonShortcut(nextShortcut)) {
        const restored = registerSummonShortcut(previousShortcut);
        log('summon shortcut failed: ' + nextShortcut + ', restored=' + restored);
        return { ok: false, shortcut: previousShortcut, error: '该快捷键已被占用' };
    }

    summonShortcut = nextShortcut;
    const persisted = saveSummonShortcut();
    log('summon shortcut changed: ' + summonShortcut);
    return { ok: true, shortcut: summonShortcut, persisted };
}

function startRevealWatch() {
    if (revealWatchTimer) return;
    revealWatchTimer = setInterval(() => {
        if (!contentHidden || !win || win.isDestroyed() || win.isMinimized()) return;
        const point = screen.getCursorScreenPoint();
        const bounds = win.getBounds();
        const inside = point.x >= bounds.x && point.x < bounds.x + bounds.width &&
            point.y >= bounds.y && point.y < bounds.y + bounds.height;
        if (inside) revealWindowContent();
    }, 50);
}

function createWindow() {
    win = new BrowserWindow({
        width: 1024,
        height: 640,
        minWidth: 480,
        minHeight: 300,
        frame: false,
        transparent: true,
        hasShadow: false,
        backgroundColor: '#00000000',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    win.webContents.on('did-finish-load', () => log('page loaded'));
    win.webContents.on('did-fail-load', (_e, code, desc) => log('page FAIL: ' + code + ' ' + desc));
    win.webContents.on('render-process-gone', (_e, d) => log('renderer gone: ' + d.reason));
    win.webContents.on('console-message', (_e, level, msg) => log('renderer: ' + msg));

    win.on('focus', () => {
        revealWindowContent();
    });
    win.on('closed', () => {
        stopRevealWatch();
        win = null;
    });

    // 全屏状态同步给渲染层（Esc 退出用）
    win.on('enter-full-screen', () => {
        fullScreen = true;
        if (!win.isDestroyed()) win.webContents.send('fs-state', true);
        log('entered fullscreen');
    });
    win.on('leave-full-screen', () => {
        fullScreen = false;
        if (!win.isDestroyed()) win.webContents.send('fs-state', false);
        log('left fullscreen');
    });

    win.loadFile('index.html');

    // 交给渲染层播放一个本地文件
    win.webContents.on('did-finish-load', () => {
        const v = argVideo(process.argv);
        if (v) sendFile(v);
    });

    // 防误触：关闭确认一律没有，纯播放器
    win.on('page-title-updated', (e) => e.preventDefault());
    return win;
}

function sendFile(p) {
    if (!win || win.isDestroyed()) return;
    const d = { kind: 'file', ...mediaItemForPath(p) };
    log('play file: ' + p);
    win.webContents.send('play-file', d);
}

// 只保留一个播放器实例。重复打开时唤醒原窗口，并接收可能传入的视频。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', (_event, argv) => {
        summonWindow();

        const v = argVideo(argv);
        if (v) sendFile(v);
    });
}

// 点击 Esc 由渲染层请求退出全屏
ipcMain.on('toggle-fullscreen', () => {
    if (!win) return;
    const nextState = !fullScreen;
    win.setFullScreen(nextState);
    log('fullscreen requested -> ' + nextState);
});
ipcMain.on('exit-fullscreen', () => {
    if (!win || win.isDestroyed()) return;
    fullScreen = false;
    win.setFullScreen(false);
    log('fullscreen exit requested');
});
ipcMain.on('minimize-window', () => {
    if (win && !win.isDestroyed()) win.minimize();
});
ipcMain.on('close-window', () => {
    if (win && !win.isDestroyed()) win.close();
});
ipcMain.on('window-content-hidden', (_event, hidden) => {
    contentHidden = !!hidden;
    log('window content ' + (contentHidden ? 'hidden' : 'visible'));
    if (contentHidden) startRevealWatch(); else stopRevealWatch();
});

ipcMain.handle('get-summon-shortcut', () => summonShortcut);
ipcMain.handle('suspend-summon-shortcut', () => {
    globalShortcut.unregister(summonShortcut);
    shortcutSuspended = true;
    return { ok: true, shortcut: summonShortcut };
});
ipcMain.handle('resume-summon-shortcut', () => {
    if (!shortcutSuspended) return { ok: true, shortcut: summonShortcut };
    const ok = registerSummonShortcut(summonShortcut);
    shortcutSuspended = !ok;
    return { ok, shortcut: summonShortcut };
});
ipcMain.handle('set-summon-shortcut', (_event, shortcut) => activateSummonShortcut(shortcut));

ipcMain.handle('open-local-path', (_event, p) => openLocalPath(p));

// "打开文件"按钮 → 系统对话框
ipcMain.handle('pick-video', async () => {
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
        title: '选择视频文件',
        filters: [
            { name: '视频', extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'flv', 'wmv', 'ts'] },
            { name: '所有文件', extensions: ['*'] }
        ],
        properties: ['openFile']
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return openLocalPath(r.filePaths[0]);
});

ipcMain.handle('pick-folder', async () => {
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
        title: '选择视频文件夹',
        properties: ['openDirectory']
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return openLocalPath(r.filePaths[0]);
});

if (gotSingleInstanceLock) {
    app.whenReady().then(() => {
        Menu.setApplicationMenu(null); // 极简：去掉菜单栏
        app.setName('本地视频播放器');
        createWindow();
        summonShortcut = loadSummonShortcut();
        let registered = registerSummonShortcut(summonShortcut);
        if (!registered && summonShortcut !== DEFAULT_SUMMON_SHORTCUT) {
            summonShortcut = DEFAULT_SUMMON_SHORTCUT;
            registered = registerSummonShortcut(summonShortcut);
        }
        log('summon shortcut ' + (registered ? 'registered' : 'failed') + ': ' + summonShortcut);
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
