const path = require('path');

const AUTH_URL = 'https://openapi.baidu.com/oauth/2.0/authorize';
const TOKEN_URL = 'https://openapi.baidu.com/oauth/2.0/token';
const FILE_URL = 'https://pan.baidu.com/rest/2.0/xpan/file';
const MULTIMEDIA_URL = 'https://pan.baidu.com/rest/2.0/xpan/multimedia';
const REDIRECT_URI = 'oob';
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi', '.flv', '.wmv', '.ts']);

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
    if (!response.ok || payload.error || (typeof payload.errno === 'number' && payload.errno !== 0)) {
        const code = payload.errno ?? payload.error ?? response.status;
        const message = payload.error_description || payload.errmsg || payload.request_id || '请求失败';
        throw new Error(`百度网盘错误 ${code}: ${message}`);
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

function isVideoFile(name) {
    return VIDEO_EXTENSIONS.has(path.extname(String(name || '')).toLowerCase());
}

function cloudItem(file) {
    const fsId = String(file.fs_id);
    return {
        source: 'baidu',
        fsId,
        path: `baidu://${fsId}${file.path}`,
        cloudPath: file.path,
        url: `baidu-video://stream/${encodeURIComponent(fsId)}`,
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
    isVideoFile,
    cloudItem
};
