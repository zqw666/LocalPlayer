const path = require('path');

const AUTH_URL = 'https://openapi.baidu.com/oauth/2.0/authorize';
const TOKEN_URL = 'https://openapi.baidu.com/oauth/2.0/token';
const FILE_URL = 'https://pan.baidu.com/rest/2.0/xpan/file';
const MULTIMEDIA_URL = 'https://pan.baidu.com/rest/2.0/xpan/multimedia';
const TRANSCRIPTION_URL = 'https://pan.baidu.com/apaas/v1/api/mediainsight';
const REDIRECT_URI = 'oob';
const XPAN_USER_AGENT = 'xpanvideo;netdisk;iPhone13;ios-iphone;15.1;ts';
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi', '.flv', '.wmv', '.ts']);
const TRANSCRIPTION_LANGUAGES = new Set(['zh', 'en', 'zh-en', 'yueyu', 'jp', 'ko']);

// 常见失败码的处置提示，直接拼在错误信息里，避免用户只看到一串 request_id。
const ERROR_HINTS = {
    30006: '该应用未在百度网盘开放平台开通「离线音视频转写」权益',
    '-6': '授权已失效，请重新连接百度网盘',
    31024: '没有访问权限，请检查应用的授权范围',
    31066: '文件不存在，请确认网盘中的路径是否仍然有效',
    31649: '该视频在百度网盘上没有现成的 AI 字幕'
};

function describeFailure(code, payload = {}) {
    const message = payload.error_description || payload.error_message || payload.errmsg ||
        payload.show_msg || payload.request_id || '请求失败';
    const hint = ERROR_HINTS[String(code)];
    return hint ? `${message}（${hint}）` : message;
}

function authorizationUrl(apiKey) {
    const url = new URL(AUTH_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', apiKey);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', 'basic,netdisk');
    url.searchParams.set('display', 'popup');
    return url.toString();
}

async function requestJson(url, options = {}, fetchImpl = fetch) {
    const response = await fetchImpl(url, options);
    let payload;
    try {
        payload = await response.json();
    } catch (_) {
        throw new Error('百度网盘返回了无法解析的数据');
    }
    const failed = !response.ok || payload.error ||
        (typeof payload.errno === 'number' && payload.errno !== 0) ||
        (typeof payload.error_code === 'number' && payload.error_code !== 0);
    if (failed) {
        const code = payload.errno ?? payload.error_code ?? payload.error ?? response.status;
        throw new Error(`百度网盘错误 ${code}: ${describeFailure(code, payload)}`);
    }
    return payload;
}

async function exchangeAuthorizationCode(credentials, code, fetchImpl = fetch) {
    const url = new URL(TOKEN_URL);
    url.searchParams.set('grant_type', 'authorization_code');
    url.searchParams.set('code', code);
    url.searchParams.set('client_id', credentials.apiKey);
    url.searchParams.set('client_secret', credentials.secretKey);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    return requestJson(url, {}, fetchImpl);
}

async function refreshAccessToken(credentials, refreshToken, fetchImpl = fetch) {
    const url = new URL(TOKEN_URL);
    url.searchParams.set('grant_type', 'refresh_token');
    url.searchParams.set('refresh_token', refreshToken);
    url.searchParams.set('client_id', credentials.apiKey);
    url.searchParams.set('client_secret', credentials.secretKey);
    return requestJson(url, {}, fetchImpl);
}

async function listFiles(accessToken, directory = '/', fetchImpl = fetch) {
    const url = new URL(FILE_URL);
    url.searchParams.set('method', 'list');
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('dir', directory || '/');
    url.searchParams.set('order', 'name');
    url.searchParams.set('desc', '0');
    url.searchParams.set('start', '0');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('web', 'web');
    const payload = await requestJson(url, {}, fetchImpl);
    return Array.isArray(payload.list) ? payload.list : [];
}

async function getDownloadLink(accessToken, fsId, fetchImpl = fetch) {
    const url = new URL(MULTIMEDIA_URL);
    url.searchParams.set('method', 'filemetas');
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('fsids', JSON.stringify([Number(fsId)]));
    url.searchParams.set('dlink', '1');
    const payload = await requestJson(url, {}, fetchImpl);
    const item = Array.isArray(payload.list) ? payload.list[0] : null;
    if (!item?.dlink) throw new Error('百度网盘没有返回视频下载地址');
    return item.dlink;
}

function responseData(payload) {
    return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

async function createTranscription(accessToken, fsId, language = 'zh', fetchImpl = fetch) {
    const fileId = String(fsId || '');
    if (!/^\d+$/.test(fileId)) throw new Error('百度网盘文件 ID 无效');
    if (!TRANSCRIPTION_LANGUAGES.has(language)) throw new Error('转写语言无效');

    const url = new URL(TRANSCRIPTION_URL + '/taskcreate');
    url.searchParams.set('access_token', accessToken);
    const payload = await requestJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fsid: Number(fileId), language })
    }, fetchImpl);
    const data = responseData(payload);
    if (!data?.task_id) throw new Error('百度网盘没有返回字幕任务 ID');
    return { taskId: String(data.task_id), taskKey: String(data.task_key || '') };
}

async function queryTranscription(accessToken, taskId, fetchImpl = fetch) {
    const id = String(taskId || '').trim();
    if (!id || id.length > 200) throw new Error('字幕任务 ID 无效');

    const url = new URL(TRANSCRIPTION_URL + '/taskquery');
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('task_id', id);
    const data = responseData(await requestJson(url, {}, fetchImpl));
    const transcription = data?.transcription || {};
    return {
        taskId: String(data?.task_id || id),
        status: Number(transcription.status) || 0,
        errorCode: Number(transcription.error_code) || 0,
        errorMessage: String(transcription.error_message || ''),
        subtitleUrl: String(transcription.transcription_srt || '')
    };
}

async function downloadSubtitle(subtitleUrl, fetchImpl = fetch, extraHeaders = {}) {
    let url;
    try {
        url = new URL(subtitleUrl);
    } catch (_) {
        throw new Error('百度网盘返回的字幕地址无效');
    }
    if (url.protocol !== 'https:') throw new Error('百度网盘返回的字幕地址不安全');

    const response = await fetchImpl(url, { headers: extraHeaders });
    if (!response.ok) throw new Error(`字幕下载失败 (${response.status})`);
    const contentLength = Number(response.headers?.get?.('content-length')) || 0;
    if (contentLength > 10 * 1024 * 1024) throw new Error('字幕文件过大');
    const text = await response.text();
    if (text.length > 10 * 1024 * 1024) throw new Error('字幕文件过大');
    return text;
}

// 网盘视频若已被百度客户端生成过 AI 字幕，可通过 streaming 接口直接取回，
// 无需申请「离线音视频转写」权益。
function parseSubtitlePlaylist(playlist) {
    const lines = String(playlist || '').split(/\r?\n/).map((line) => line.trim());
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.startsWith('#EXT-X-MEDIA') || !/TYPE=SUBTITLES/i.test(line)) continue;
        const target = lines.slice(index + 1).find((next) => next.startsWith('http'));
        if (!target) continue;
        return {
            url: target,
            name: /NAME="([^"]*)"/.exec(line)?.[1] || 'AI 字幕',
            language: /LANGUAGE="([^"]*)"/.exec(line)?.[1] || ''
        };
    }
    return null;
}

async function fetchBundledSubtitle(accessToken, filePath, fetchImpl = fetch) {
    const target = String(filePath || '').trim();
    if (!target) throw new Error('百度网盘文件路径无效');

    const url = new URL(FILE_URL);
    url.searchParams.set('method', 'streaming');
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('path', target);
    url.searchParams.set('type', 'M3U8_SUBTITLE_SRT');

    const response = await fetchImpl(url, {
        headers: { 'User-Agent': XPAN_USER_AGENT, Host: 'pan.baidu.com' }
    });
    const text = await response.text();

    if (!text.trim().startsWith('#EXTM3U')) {
        let payload = null;
        try {
            payload = JSON.parse(text);
        } catch (_) {
            payload = null;
        }
        if (payload) {
            const code = payload.errno ?? payload.error_code ?? response.status;
            throw new Error(`百度网盘错误 ${code}: ${describeFailure(code, payload)}`);
        }
        throw new Error(`百度网盘字幕清单请求失败 (${response.status})`);
    }

    const track = parseSubtitlePlaylist(text);
    if (!track) throw new Error('该视频在百度网盘上没有现成的 AI 字幕');
    const srt = await downloadSubtitle(track.url, fetchImpl, { 'User-Agent': XPAN_USER_AGENT });
    return { text: srt, name: track.name, language: track.language };
}

function isVideoFile(name) {
    return VIDEO_EXTENSIONS.has(path.extname(String(name || '')).toLowerCase());
}

function cloudItem(file, streamUrl) {
    const fsId = String(file.fs_id);
    if (!streamUrl) throw new Error('百度网盘播放地址无效');
    return {
        source: 'baidu',
        fsId,
        path: `baidu://${fsId}${file.path}`,
        cloudPath: file.path,
        url: streamUrl,
        name: file.server_filename,
        relativePath: file.server_filename,
        size: Number(file.size) || 0
    };
}

module.exports = {
    REDIRECT_URI,
    authorizationUrl,
    exchangeAuthorizationCode,
    refreshAccessToken,
    listFiles,
    getDownloadLink,
    createTranscription,
    queryTranscription,
    downloadSubtitle,
    fetchBundledSubtitle,
    isVideoFile,
    cloudItem
};
