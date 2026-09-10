const test = require('node:test');
const assert = require('node:assert/strict');
const {
    authorizationUrl,
    exchangeAuthorizationCode,
    listFiles,
    getDownloadLink,
    isVideoFile,
    cloudItem
} = require('./baidu-netdisk');

test('builds OAuth URL and exchanges authorization code', async () => {
    const auth = new URL(authorizationUrl('test-key'));
    assert.equal(auth.searchParams.get('client_id'), 'test-key');
    assert.equal(auth.searchParams.get('redirect_uri'), 'oob');
    assert.equal(auth.searchParams.get('scope'), 'basic,netdisk');

    let requestedUrl = '';
    const token = await exchangeAuthorizationCode(
        { apiKey: 'key', secretKey: 'secret' },
        'code',
        async (url) => {
            requestedUrl = String(url);
            return { ok: true, json: async () => ({ access_token: 'access', refresh_token: 'refresh' }) };
        }
    );
    assert.equal(token.access_token, 'access');
    assert.match(requestedUrl, /grant_type=authorization_code/);
    assert.match(requestedUrl, /client_secret=secret/);
});

test('lists files and resolves a download link', async () => {
    const requests = [];
    const fakeFetch = async (url) => {
        requests.push(String(url));
        const payload = String(url).includes('filemetas')
            ? { errno: 0, list: [{ dlink: 'https://example.test/video' }] }
            : { errno: 0, list: [{ fs_id: 7, path: '/视频/1.mp4', server_filename: '1.mp4' }] };
        return { ok: true, json: async () => payload };
    };
    const files = await listFiles('token', '/视频', fakeFetch);
    const link = await getDownloadLink('token', 7, fakeFetch);
    assert.equal(files.length, 1);
    assert.equal(link, 'https://example.test/video');
    assert.match(requests[0], /dir=%2F%E8%A7%86%E9%A2%91/);
});

test('filters video extensions and maps cloud items', () => {
    assert.equal(isVideoFile('电影.MKV'), true);
    assert.equal(isVideoFile('封面.jpg'), false);
    assert.deepEqual(cloudItem({ fs_id: 9, path: '/a/2.mp4', server_filename: '2.mp4', size: 12 }), {
        source: 'baidu',
        fsId: '9',
        path: 'baidu://9/a/2.mp4',
        cloudPath: '/a/2.mp4',
        url: 'baidu-video://stream/9',
        name: '2.mp4',
        relativePath: '2.mp4',
        size: 12
    });
});
