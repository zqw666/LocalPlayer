// 本地视频播放器 - 渲染层
const api = window.player;

const video = document.getElementById('video');
const hint = document.getElementById('hint');
const dropMask = document.getElementById('dropMask');
const controls = document.getElementById('controls');
const btnPlay = document.getElementById('btnPlay');
const btnOpen = document.getElementById('btnOpen');
const btnFolder = document.getElementById('btnFolder');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const btnFs = document.getElementById('btnFs');
const btnVol = document.getElementById('btnVol');
const btnLibrary = document.getElementById('btnLibrary');
const btnFit = document.getElementById('btnFit');
const btnOpacity = document.getElementById('btnOpacity');
const btnShortcut = document.getElementById('btnShortcut');
const btnMin = document.getElementById('btnMin');
const btnClose = document.getElementById('btnClose');
const seek = document.getElementById('seek');
const vol = document.getElementById('vol');
const timeEl = document.getElementById('time');

const opacityPanel = document.getElementById('opacityPanel');
const playOpacity = document.getElementById('playOpacity');
const playOpacityValue = document.getElementById('playOpacityValue');
const hiddenOpacity = document.getElementById('hiddenOpacity');
const hiddenOpacityValue = document.getElementById('hiddenOpacityValue');
const shortcutPanel = document.getElementById('shortcutPanel');
const shortcutRecorder = document.getElementById('shortcutRecorder');
const shortcutValue = document.getElementById('shortcutValue');
const shortcutAction = document.getElementById('shortcutAction');
const shortcutStatus = document.getElementById('shortcutStatus');

const libraryDrawer = document.getElementById('libraryDrawer');
const tabPlaylist = document.getElementById('tabPlaylist');
const tabHistory = document.getElementById('tabHistory');
const playlistPanel = document.getElementById('playlistPanel');
const historyPanel = document.getElementById('historyPanel');
const playlistTitle = document.getElementById('playlistTitle');
const playlistCount = document.getElementById('playlistCount');
const playlistList = document.getElementById('playlistList');
const playlistEmpty = document.getElementById('playlistEmpty');
const historyList = document.getElementById('historyList');
const historyEmpty = document.getElementById('historyEmpty');
const btnClearHistory = document.getElementById('btnClearHistory');
const btnCloseLibrary = document.getElementById('btnCloseLibrary');

const PLAYLIST_KEY = 'player_playlist_v1';
const HISTORY_KEY = 'player_history_v1';
const HISTORY_LIMIT = 30;

let currentPath = '';
let currentMedia = null;
let playlist = [];
let playlistRoot = '';
let currentIndex = -1;
let watchHistory = readStoredArray(HISTORY_KEY).filter((item) => item && typeof item.path === 'string').slice(0, HISTORY_LIMIT);
let missingHistoryPaths = new Set();
let activeLibraryTab = 'playlist';
let openRequestVersion = 0;
let lastSave = 0;
let windowHidden = false;
let hideTimer = null;
let cursorHideTimer = null;
let ctrlTimer = null;
let seekDragging = false;
let fullScreen = false;
let shortcutRecording = false;
let currentSummonShortcut = 'CommandOrControl+Alt+P';

function readStoredArray(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(value) ? value : [];
    } catch (_) {
        return [];
    }
}

function readStoredObject(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || 'null');
        return value && typeof value === 'object' ? value : null;
    } catch (_) {
        return null;
    }
}

function fmt(seconds) {
    let value = Number(seconds);
    if (!isFinite(value) || value < 0) value = 0;
    const h = Math.floor(value / 3600);
    const m = Math.floor(value % 3600 / 60);
    const s = Math.floor(value % 60);
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

function fileNameFromPath(filePath) {
    const parts = String(filePath || '').split(/[\\/]/);
    return parts[parts.length - 1] || filePath;
}

function directoryFromPath(filePath) {
    const value = String(filePath || '');
    const index = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
    return index > 0 ? value.slice(0, index) : '';
}

function folderName(folderPath) {
    return fileNameFromPath(String(folderPath || '').replace(/[\\/]$/, '')) || '播放队列';
}

function formatWatchedAt(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/* ============ 窗口内容隐形 / 恢复 ============ */
function showWindowContent() {
    clearTimeout(hideTimer);
    scheduleCursorHide();
    if (!windowHidden) return;
    windowHidden = false;
    document.body.classList.remove('window-hidden');
    api.setWindowContentHidden(false);
}

function showCursor() {
    clearTimeout(cursorHideTimer);
    document.body.classList.remove('cursor-hidden');
}

function scheduleCursorHide() {
    showCursor();
    clearTimeout(cursorHideTimer);
    cursorHideTimer = setTimeout(() => {
        if (windowHidden || shortcutRecording || !opacityPanel.hidden || !shortcutPanel.hidden || !libraryDrawer.hidden) return;
        document.body.classList.add('cursor-hidden');
    }, 1000);
}

function scheduleWindowHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        if (windowHidden || shortcutRecording) return;
        setOpacityPanelOpen(false);
        setShortcutPanelOpen(false);
        windowHidden = true;
        document.body.classList.add('window-hidden');
        api.setWindowContentHidden(true);
    }, 250);
}

document.documentElement.addEventListener('mouseenter', showWindowContent);
document.documentElement.addEventListener('mouseleave', scheduleWindowHide);
window.addEventListener('mousemove', showWindowContent, true);
window.addEventListener('keydown', showWindowContent, true);
api.onShowWindow(showWindowContent);
api.onFsState((state) => {
    fullScreen = !!state;
    btnFs.classList.toggle('active', fullScreen);
    btnFs.title = fullScreen ? '退出全屏 (Esc)' : '全屏 (双击 / F)';
});

/* ============ 顶部工具 ============ */
function setOpacityPanelOpen(open) {
    opacityPanel.hidden = !open;
    btnOpacity.setAttribute('aria-expanded', String(open));
    if (open) showCursor(); else scheduleCursorHide();
    if (open) {
        setLibraryOpen(false);
        setShortcutPanelOpen(false);
    }
}

function displayShortcut(shortcut) {
    return String(shortcut || '')
        .replace('CommandOrControl', 'Ctrl')
        .replace('Control', 'Ctrl')
        .replace('Super', 'Win')
        .split('+')
        .join(' + ');
}

function updateShortcutDisplay(shortcut) {
    currentSummonShortcut = shortcut;
    const label = displayShortcut(shortcut);
    shortcutValue.textContent = label;
    btnShortcut.title = '唤起/隐藏：' + label;
    btnShortcut.setAttribute('aria-label', btnShortcut.title);
}

function setShortcutRecording(recording) {
    shortcutRecording = recording;
    shortcutRecorder.classList.toggle('recording', recording);
    shortcutAction.textContent = recording ? '录制中' : '修改';
    shortcutValue.textContent = recording ? '请按新的组合键' : displayShortcut(currentSummonShortcut);
}

async function cancelShortcutRecording() {
    if (!shortcutRecording) return;
    setShortcutRecording(false);
    const result = await api.resumeSummonShortcut();
    shortcutStatus.textContent = result.ok ? '' : '快捷键恢复失败，请重新设置';
    shortcutStatus.classList.toggle('error', !result.ok);
}

function setShortcutPanelOpen(open) {
    shortcutPanel.hidden = !open;
    btnShortcut.classList.toggle('active', open);
    btnShortcut.setAttribute('aria-expanded', String(open));
    if (open) showCursor(); else scheduleCursorHide();
    if (open) {
        setOpacityPanelOpen(false);
        setLibraryOpen(false);
    } else {
        void cancelShortcutRecording();
    }
}

function shortcutFromKeyEvent(event) {
    let key = '';
    if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
    else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
    else if (/^F(?:[1-9]|1[0-2])$/.test(event.code)) key = event.code;

    const modifiers = [];
    if (event.ctrlKey) modifiers.push('Control');
    if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift');
    if (event.metaKey) modifiers.push('Super');
    if (!key || (modifiers.length === 0 && !key.startsWith('F'))) return '';
    return [...modifiers, key].join('+');
}

async function beginShortcutRecording() {
    if (shortcutRecording) return;
    shortcutStatus.textContent = '';
    shortcutStatus.classList.remove('error');
    const result = await api.suspendSummonShortcut();
    if (!result.ok) {
        shortcutStatus.textContent = '暂时无法修改快捷键';
        shortcutStatus.classList.add('error');
        return;
    }
    setShortcutRecording(true);
    shortcutRecorder.focus();
}

async function applyRecordedShortcut(shortcut) {
    setShortcutRecording(false);
    shortcutStatus.textContent = '正在应用…';
    const result = await api.setSummonShortcut(shortcut);
    updateShortcutDisplay(result.shortcut || currentSummonShortcut);
    shortcutStatus.classList.toggle('error', !result.ok);
    shortcutStatus.textContent = result.ok
        ? (result.persisted === false ? '已生效，本次启动有效' : '已保存')
        : (result.error || '无法使用该快捷键');
}

async function loadShortcutSetting() {
    try {
        updateShortcutDisplay(await api.getSummonShortcut());
    } catch (_) {}
}

function applyOpacitySetting(input, output, cssVariable, storageKey, value, persist = true) {
    const min = Number(input.min);
    const max = Number(input.max);
    const percent = Math.max(min, Math.min(max, Number(value) || min));
    input.value = String(percent);
    output.textContent = percent + '%';
    document.documentElement.style.setProperty(cssVariable, String(percent / 100));
    if (persist) localStorage.setItem(storageKey, String(percent));
}

function savedOpacity(storageKey, fallback) {
    const saved = localStorage.getItem(storageKey);
    if (saved === null) return fallback;
    const value = Number(saved);
    return Number.isFinite(value) ? value : fallback;
}

function applyFitMode(mode, persist = true) {
    const cover = mode === 'cover';
    document.body.classList.toggle('video-cover', cover);
    btnFit.classList.toggle('active', cover);
    btnFit.setAttribute('aria-pressed', String(cover));
    btnFit.title = '画面模式：' + (cover ? '填充' : '适应');
    btnFit.setAttribute('aria-label', btnFit.title);
    if (persist) localStorage.setItem('fitMode', cover ? 'cover' : 'contain');
}

applyOpacitySetting(playOpacity, playOpacityValue, '--play-opacity', 'playOpacity', savedOpacity('playOpacity', 100), false);
applyOpacitySetting(hiddenOpacity, hiddenOpacityValue, '--hidden-opacity', 'hiddenOpacity', savedOpacity('hiddenOpacity', 0), false);
applyFitMode(localStorage.getItem('fitMode') === 'cover' ? 'cover' : 'contain', false);

btnOpacity.onclick = () => setOpacityPanelOpen(opacityPanel.hidden);
btnShortcut.onclick = () => setShortcutPanelOpen(shortcutPanel.hidden);
shortcutRecorder.onclick = () => void beginShortcutRecording();
playOpacity.addEventListener('input', () => {
    applyOpacitySetting(playOpacity, playOpacityValue, '--play-opacity', 'playOpacity', playOpacity.value);
});
hiddenOpacity.addEventListener('input', () => {
    applyOpacitySetting(hiddenOpacity, hiddenOpacityValue, '--hidden-opacity', 'hiddenOpacity', hiddenOpacity.value);
});
document.addEventListener('mousedown', (event) => {
    if (!opacityPanel.hidden && !btnOpacity.contains(event.target) && !opacityPanel.contains(event.target)) {
        setOpacityPanelOpen(false);
    }
    if (!shortcutPanel.hidden && !btnShortcut.contains(event.target) && !shortcutPanel.contains(event.target)) {
        setShortcutPanelOpen(false);
    }
});
btnFit.onclick = () => applyFitMode(document.body.classList.contains('video-cover') ? 'contain' : 'cover');
btnMin.onclick = () => api.minimizeWindow();
btnClose.onclick = () => api.closeWindow();

/* ============ 媒体库抽屉 ============ */
function setLibraryOpen(open) {
    libraryDrawer.hidden = !open;
    btnLibrary.classList.toggle('active', open);
    btnLibrary.setAttribute('aria-expanded', String(open));
    if (open) showCursor(); else scheduleCursorHide();
    if (open) {
        opacityPanel.hidden = true;
        btnOpacity.setAttribute('aria-expanded', 'false');
        setShortcutPanelOpen(false);
    }
}

function setLibraryTab(tab) {
    activeLibraryTab = tab === 'history' ? 'history' : 'playlist';
    const showPlaylist = activeLibraryTab === 'playlist';
    tabPlaylist.classList.toggle('active', showPlaylist);
    tabHistory.classList.toggle('active', !showPlaylist);
    tabPlaylist.setAttribute('aria-selected', String(showPlaylist));
    tabHistory.setAttribute('aria-selected', String(!showPlaylist));
    playlistPanel.hidden = !showPlaylist;
    historyPanel.hidden = showPlaylist;
    btnClearHistory.hidden = showPlaylist || watchHistory.length === 0;
}

btnLibrary.onclick = () => setLibraryOpen(libraryDrawer.hidden);
btnCloseLibrary.onclick = () => setLibraryOpen(false);
tabPlaylist.onclick = () => setLibraryTab('playlist');
tabHistory.onclick = () => setLibraryTab('history');

function createText(className, text) {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = text;
    return element;
}

function renderPlaylist() {
    playlistList.replaceChildren();
    playlistTitle.textContent = playlistRoot ? folderName(playlistRoot) : (playlist.length ? '当前文件' : '播放队列');
    playlistTitle.title = playlistRoot;
    playlistCount.textContent = playlist.length + ' 项';
    playlistEmpty.hidden = playlist.length > 0;
    playlistEmpty.textContent = playlistRoot ? '未找到支持的视频' : '尚未打开文件夹';

    const fragment = document.createDocumentFragment();
    playlist.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'media-row' + (index === currentIndex ? ' active' : '');

        const openButton = document.createElement('button');
        openButton.type = 'button';
        openButton.className = 'media-open';
        openButton.title = item.relativePath || item.name;
        openButton.appendChild(createText('media-title', item.relativePath || item.name));
        openButton.appendChild(createText('media-meta', index === currentIndex ? (video.paused ? '已暂停' : '正在播放') : '第 ' + (index + 1) + ' 项'));
        openButton.onclick = () => {
            playAtIndex(index, true);
            setLibraryOpen(false);
        };

        row.appendChild(openButton);
        fragment.appendChild(row);
    });
    playlistList.appendChild(fragment);
    updateQueueButtons();
}

function saveHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(watchHistory.slice(0, HISTORY_LIMIT)));
}

function updateHistoryRecord(options = {}) {
    if (!currentMedia || !currentPath) return;
    const index = watchHistory.findIndex((item) => item.path === currentPath);
    if (index < 0 && !options.create) return;

    const previous = index >= 0 ? watchHistory[index] : null;
    const record = {
        path: currentPath,
        name: currentMedia.name || fileNameFromPath(currentPath),
        directory: directoryFromPath(currentPath),
        position: isFinite(video.currentTime) ? video.currentTime : (previous?.position || 0),
        duration: isFinite(video.duration) ? video.duration : (previous?.duration || 0),
        lastPlayedAt: options.touchTime ? Date.now() : (previous?.lastPlayedAt || Date.now())
    };

    if (index >= 0) watchHistory.splice(index, 1);
    if (options.touchTime || index < 0) watchHistory.unshift(record);
    else watchHistory.splice(index, 0, record);
    watchHistory = watchHistory.slice(0, HISTORY_LIMIT);
    missingHistoryPaths.delete(currentPath);
    saveHistory();
    renderHistory();
}

function removeHistoryEntry(filePath) {
    watchHistory = watchHistory.filter((item) => item.path !== filePath);
    missingHistoryPaths.delete(filePath);
    localStorage.removeItem('pos_' + filePath);
    saveHistory();
    renderHistory();
}

function renderHistory() {
    historyList.replaceChildren();
    historyEmpty.hidden = watchHistory.length > 0;
    btnClearHistory.hidden = activeLibraryTab !== 'history' || watchHistory.length === 0;

    const fragment = document.createDocumentFragment();
    watchHistory.forEach((item) => {
        const missing = missingHistoryPaths.has(item.path);
        const row = document.createElement('div');
        row.className = 'media-row' + (missing ? ' missing' : '');

        const openButton = document.createElement('button');
        openButton.type = 'button';
        openButton.className = 'media-open';
        openButton.disabled = missing;
        openButton.title = item.path;
        openButton.appendChild(createText('media-title', item.name || fileNameFromPath(item.path)));
        openButton.appendChild(createText('media-meta', missing ? '文件不存在' : (item.directory || '本地文件')));
        if (!missing) {
            const watched = formatWatchedAt(item.lastPlayedAt);
            openButton.appendChild(createText('media-meta', (watched ? watched + ' · ' : '') + fmt(item.position) + ' / ' + fmt(item.duration)));
            const progress = document.createElement('span');
            progress.className = 'history-progress';
            const fill = document.createElement('span');
            const percent = item.duration > 0 ? Math.max(0, Math.min(100, item.position / item.duration * 100)) : 0;
            fill.style.width = percent + '%';
            progress.appendChild(fill);
            openButton.appendChild(progress);
            openButton.onclick = () => openHistoryEntry(item);
        }

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'history-remove';
        removeButton.title = '移除历史';
        removeButton.setAttribute('aria-label', '移除 ' + (item.name || fileNameFromPath(item.path)));
        removeButton.textContent = '×';
        removeButton.onclick = () => removeHistoryEntry(item.path);

        row.append(openButton, removeButton);
        fragment.appendChild(row);
    });
    historyList.appendChild(fragment);
}

async function openHistoryEntry(item) {
    const version = ++openRequestVersion;
    const result = await api.openLocalPath(item.path);
    if (version !== openRequestVersion) return;
    if (!result || result.kind !== 'file') {
        missingHistoryPaths.add(item.path);
        renderHistory();
        return;
    }

    const queuedIndex = playlist.findIndex((entry) => entry.path === result.path);
    if (playlistRoot && queuedIndex >= 0) playAtIndex(queuedIndex, true);
    else setStandalone(result, true);
    setLibraryOpen(false);
}

btnClearHistory.onclick = () => {
    if (!watchHistory.length || !window.confirm('清空全部观看历史？')) return;
    for (const item of watchHistory) localStorage.removeItem('pos_' + item.path);
    watchHistory = [];
    missingHistoryPaths.clear();
    saveHistory();
    renderHistory();
};

/* ============ 播放队列与进度 ============ */
function savePlaylistState() {
    if (!playlistRoot) {
        localStorage.removeItem(PLAYLIST_KEY);
        return;
    }
    localStorage.setItem(PLAYLIST_KEY, JSON.stringify({
        root: playlistRoot,
        currentPath: currentMedia?.path || playlist[currentIndex]?.path || ''
    }));
}

function updateQueueButtons() {
    btnPrev.disabled = currentIndex <= 0;
    btnNext.disabled = currentIndex < 0 || currentIndex >= playlist.length - 1;
}

function saveCurrentProgress() {
    if (!currentPath || !isFinite(video.currentTime)) return;
    localStorage.setItem('pos_' + currentPath, String(video.currentTime));
    updateHistoryRecord();
}

function clearVideo() {
    video.pause();
    video.removeAttribute('src');
    video.load();
    currentPath = '';
    currentMedia = null;
    currentIndex = -1;
    seek.value = 0;
    timeEl.textContent = '0:00 / 0:00';
    document.body.classList.remove('has-video', 'is-playing');
    hint.classList.add('show');
    refreshPausedState();
    updateQueueButtons();
}

function loadVideo(item, options = {}) {
    const autoplay = options.autoplay !== false;
    if (!video.paused) video.pause();
    currentMedia = item;
    currentPath = item.path;
    lastSave = 0;
    hint.classList.remove('show');
    document.body.classList.add('has-video');
    document.body.classList.remove('is-playing');
    video.volume = Number(localStorage.getItem('vol') ?? 1);
    video.src = item.url;

    const loadingPath = item.path;
    video.onloadedmetadata = () => {
        if (currentPath !== loadingPath) return;
        const saved = parseFloat(localStorage.getItem('pos_' + currentPath));
        if (saved > 5 && saved < video.duration - 8) video.currentTime = saved;
        seek.value = video.duration ? video.currentTime / video.duration * 1000 : 0;
        timeEl.textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
        updateHistoryRecord();
        refreshPausedState();
        if (autoplay) video.play().catch(() => {});
    };
    video.load();
}

function playAtIndex(index, autoplay = true) {
    if (index < 0 || index >= playlist.length) return;
    saveCurrentProgress();
    currentIndex = index;
    loadVideo(playlist[index], { autoplay });
    savePlaylistState();
    renderPlaylist();
}

function setFolderPlaylist(result, options = {}) {
    saveCurrentProgress();
    playlistRoot = result.root;
    playlist = Array.isArray(result.items) ? result.items : [];
    currentIndex = options.currentPath ? playlist.findIndex((item) => item.path === options.currentPath) : 0;
    if (currentIndex < 0 && playlist.length) currentIndex = 0;

    if (playlist.length) {
        loadVideo(playlist[currentIndex], { autoplay: options.autoplay !== false });
    } else {
        clearVideo();
    }
    savePlaylistState();
    renderPlaylist();
}

function setStandalone(item, autoplay = true) {
    saveCurrentProgress();
    playlistRoot = '';
    playlist = [item];
    currentIndex = 0;
    localStorage.removeItem(PLAYLIST_KEY);
    loadVideo(item, { autoplay });
    renderPlaylist();
}

function handleOpenResult(result, options = {}) {
    if (!result) return false;
    if (result.kind === 'folder') {
        setFolderPlaylist(result, options);
        if (!result.items.length) {
            setLibraryTab('playlist');
            setLibraryOpen(true);
        }
        return true;
    }
    if (result.kind === 'file') {
        setStandalone(result, options.autoplay !== false);
        return true;
    }
    return false;
}

btnPrev.onclick = () => playAtIndex(currentIndex - 1, true);
btnNext.onclick = () => playAtIndex(currentIndex + 1, true);

btnOpen.onclick = async () => {
    const version = ++openRequestVersion;
    const result = await api.pickVideo();
    if (version === openRequestVersion) handleOpenResult(result, { autoplay: true });
};

btnFolder.onclick = async () => {
    const version = ++openRequestVersion;
    const result = await api.pickFolder();
    if (version === openRequestVersion) handleOpenResult(result, { autoplay: true });
};

api.onPlayFile((item) => {
    openRequestVersion++;
    setStandalone(item, true);
});

async function restoreLastPlaylist() {
    const saved = readStoredObject(PLAYLIST_KEY);
    if (!saved?.root) return;
    const version = openRequestVersion;
    const result = await api.openLocalPath(saved.root);
    if (version !== openRequestVersion) return;
    if (!result || result.kind !== 'folder') {
        localStorage.removeItem(PLAYLIST_KEY);
        return;
    }
    setFolderPlaylist(result, { currentPath: saved.currentPath, autoplay: false });
}

/* ============ 控制条与视频事件 ============ */
function showControls() {
    controls.classList.add('show');
    clearTimeout(ctrlTimer);
    ctrlTimer = setTimeout(() => {
        if (!video.paused) controls.classList.remove('show');
    }, 1000);
}

function refreshPausedState() {
    controls.classList.toggle('show-paused', !!video.src && video.paused);
}

function togglePlay() {
    if (!video.src) {
        btnOpen.click();
        return;
    }
    if (video.paused) video.play().catch(() => {}); else video.pause();
    refreshPausedState();
}

btnPlay.onclick = togglePlay;
video.onclick = () => {
    if (video.src) {
        showControls();
        togglePlay();
    }
};
btnFs.onclick = () => api.toggleFullscreen();
btnVol.onclick = () => {
    video.muted = !video.muted;
    vol.value = video.muted ? 0 : Math.round(video.volume * 100);
};

video.addEventListener('mousemove', showControls);
video.addEventListener('mouseleave', () => {
    clearTimeout(ctrlTimer);
    if (!video.paused && !controls.matches(':hover')) controls.classList.remove('show');
});
controls.addEventListener('mouseenter', () => {
    clearTimeout(ctrlTimer);
    showControls();
});
controls.addEventListener('mouseleave', () => {
    clearTimeout(ctrlTimer);
    if (!video.paused) ctrlTimer = setTimeout(() => controls.classList.remove('show'), 1000);
});

video.addEventListener('play', () => {
    document.body.classList.add('is-playing');
    document.getElementById('icPlay').style.display = 'none';
    document.getElementById('icPause').style.display = 'block';
    updateHistoryRecord({ create: true, touchTime: true });
    refreshPausedState();
    showControls();
    renderPlaylist();
});
video.addEventListener('pause', () => {
    document.body.classList.remove('is-playing');
    document.getElementById('icPlay').style.display = 'block';
    document.getElementById('icPause').style.display = 'none';
    saveCurrentProgress();
    refreshPausedState();
    renderPlaylist();
});
video.addEventListener('ended', () => {
    document.body.classList.remove('is-playing');
    saveCurrentProgress();
    refreshPausedState();
    renderPlaylist();
    if (currentIndex >= 0 && currentIndex < playlist.length - 1) playAtIndex(currentIndex + 1, true);
});
video.addEventListener('timeupdate', () => {
    if (!seekDragging && isFinite(video.duration) && video.duration > 0) {
        seek.value = video.currentTime / video.duration * 1000;
    }
    timeEl.textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
    const now = Date.now();
    if (currentPath && now - lastSave > 5000) {
        lastSave = now;
        saveCurrentProgress();
    }
});

seek.addEventListener('input', () => {
    seekDragging = true;
    if (video.duration) {
        video.currentTime = seek.value / 1000 * video.duration;
        timeEl.textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
    }
});
seek.addEventListener('change', () => {
    seekDragging = false;
    saveCurrentProgress();
});
vol.addEventListener('input', () => {
    video.volume = vol.value / 100;
    video.muted = video.volume === 0;
    localStorage.setItem('vol', String(video.volume));
});

/* ============ 拖放 ============ */
let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    showWindowContent();
    dragDepth++;
    dropMask.classList.add('show');
});
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('dragleave', (event) => {
    event.preventDefault();
    if (--dragDepth <= 0) {
        dragDepth = 0;
        dropMask.classList.remove('show');
    }
});
window.addEventListener('drop', async (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropMask.classList.remove('show');
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const localPath = api.pathForFile(file);
    if (!localPath) return;
    const version = ++openRequestVersion;
    const result = await api.openLocalPath(localPath);
    if (version === openRequestVersion) handleOpenResult(result, { autoplay: true });
});

/* ============ 快捷键 ============ */
document.addEventListener('keydown', async (event) => {
    if (shortcutRecording) {
        event.preventDefault();
        event.stopPropagation();
        if (event.code === 'Escape') {
            await cancelShortcutRecording();
            return;
        }
        if (event.repeat) return;
        const shortcut = shortcutFromKeyEvent(event);
        if (!shortcut) {
            shortcutStatus.textContent = '请按组合键，或使用 F1 至 F12';
            shortcutStatus.classList.add('error');
            return;
        }
        await applyRecordedShortcut(shortcut);
        return;
    }

    const target = event.target;
    if (target && target.tagName === 'INPUT') return;

    if (target && target.tagName === 'BUTTON' && event.code === 'Space') {
        if (target === btnPlay) {
            event.preventDefault();
            togglePlay();
        }
        return;
    }

    switch (event.code) {
        case 'Space':
            event.preventDefault();
            togglePlay();
            break;
        case 'ArrowRight':
            video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
            break;
        case 'ArrowLeft':
            video.currentTime = Math.max(0, video.currentTime - 5);
            break;
        case 'ArrowUp':
            video.muted = false;
            video.volume = Math.min(1, video.volume + 0.08);
            vol.value = Math.round(video.volume * 100);
            break;
        case 'ArrowDown':
            video.muted = false;
            video.volume = Math.max(0, video.volume - 0.08);
            vol.value = Math.round(video.volume * 100);
            break;
        case 'KeyM':
            video.muted = !video.muted;
            break;
        case 'KeyF':
            api.toggleFullscreen();
            break;
        case 'Escape':
            if (fullScreen) api.exitFullscreen();
            else if (!shortcutPanel.hidden) setShortcutPanelOpen(false);
            else if (!opacityPanel.hidden) setOpacityPanelOpen(false);
            else if (!libraryDrawer.hidden) setLibraryOpen(false);
            else api.exitFullscreen();
            break;
        case 'KeyO':
            if (event.ctrlKey) {
                event.preventDefault();
                if (event.shiftKey) btnFolder.click(); else btnOpen.click();
            }
            break;
    }
});

video.addEventListener('dblclick', () => api.toggleFullscreen());
window.addEventListener('blur', () => void cancelShortcutRecording());
window.addEventListener('beforeunload', saveCurrentProgress);

renderPlaylist();
renderHistory();
setLibraryTab('playlist');
showControls();
loadShortcutSetting();
restoreLastPlaylist();
