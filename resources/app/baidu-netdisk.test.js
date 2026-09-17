const test = require('node:test');
const assert = require('node:assert/strict');
const {
    authorizationUrl,
    exchangeAuthorizationCode,
    listFiles,
    getDownloadLink,
    createTranscription,
    queryTranscription,
    downloadSubtitle,
    fetchBundledSubtitle,
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

test('creates, queries, and downloads an AI subtitle', async () => {
    const requests = [];
    const fakeFetch = async (url, options = {}) => {
        requests.push({ url: String(url), options });
        if (String(url).includes('taskcreate')) {
            return { ok: true, json: async () => ({ errno: 0, data: { task_id: 'task-7' } }) };
        }
        if (String(url).includes('taskquery')) {
            return {
                ok: true,
                json: async () => ({
                    errno: 0,
                    data: { task_id: 'task-7', transcription: { status: 300, transcription_srt: 'https://example.test/7.srt' } }
                })
            };
        }
        return {
            ok: true,
            headers: { get: () => '42' },
            text: async () => '1\n00:00:01,000 --> 00:00:02,000\n测试字幕\n'
        };
    };

    const created = await createTranscription('token', '123456', 'zh-en', fakeFetch);
    const queried = await queryTranscription('token', created.taskId, fakeFetch);
    const subtitle = await downloadSubtitle(queried.subtitleUrl, fakeFetch);

    assert.equal(created.taskId, 'task-7');
    assert.equal(queried.status, 300);
    assert.match(subtitle, /测试字幕/);
    assert.deepEqual(JSON.parse(requests[0].options.body), { fsid: 123456, language: 'zh-en' });
    assert.match(requests[1].url, /task_id=task-7/);
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

test('surfaces baidu show_msg and remedy hint when the app lacks the entitlement', async () => {
    const fakeFetch = async () => ({
        ok: false,
        status: 500,
        json: async () => ({ errno: 30006, request_id: 258193871066788670, show_msg: 'APP权益不存在' })
    });
    await assert.rejects(
        () => createTranscription('token', '123456', 'zh', fakeFetch),
        (error) => {
            assert.match(error.message, /APP权益不存在/);
            assert.match(error.message, /离线音视频转写/);
            assert.doesNotMatch(error.message, /258193871066788670/);
            return true;
        }
    );
});

test('reads the AI subtitle already bundled with a cloud video', async () => {
    const playlist = [
        '#EXTM3U',
        '#MEDIA:SUBTITLES',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="中文字幕",DEFAULT=YES,AUTOSELECT=NO,LANGUAGE="中文",VIDEO-LAN=zh,AI-SUB=YES',
        'https://example.test/sub.srt'
    ].join('\n');
    const requested = [];
    const fakeFetch = async (url) => {
        requested.push(String(url));
        if (String(url).includes('method=streaming')) {
            return { ok: true, status: 200, text: async () => playlist };
        }
        return {
            ok: true,
            status: 200,
            headers: { get: () => '64' },
            text: async () => '1\n00:00:00,000 --> 00:00:02,000\n你好\n'
        };
    };

    const result = await fetchBundledSubtitle('token', '/视频/a.mp4', fakeFetch);
    assert.equal(result.name, '中文字幕');
    assert.equal(result.language, '中文');
    assert.match(result.text, /你好/);
    assert.match(requested[0], /type=M3U8_SUBTITLE_SRT/);
    assert.match(requested[0], /path=%2F%E8%A7%86%E9%A2%91%2Fa.mp4/);
    assert.equal(requested[1], 'https://example.test/sub.srt');
});

test('reports when a cloud video has no bundled subtitle', async () => {
    const fakeFetch = async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ errno: 31649, request_id: 1 })
    });
    await assert.rejects(
        () => fetchBundledSubtitle('token', '/视频/b.mp4', fakeFetch),
        /31649/
    );
});

test('filters video extensions and maps cloud items', () => {
    assert.equal(isVideoFile('电影.MKV'), true);
    assert.equal(isVideoFile('封面.jpg'), false);
    assert.deepEqual(cloudItem(
        { fs_id: 9, path: '/a/2.mp4', server_filename: '2.mp4', size: 12 },
        'http://127.0.0.1:1234/baidu-video/9?key=test'
    ), {
        source: 'baidu',
        fsId: '9',
        path: 'baidu://9/a/2.mp4',
        cloudPath: '/a/2.mp4',
        url: 'http://127.0.0.1:1234/baidu-video/9?key=test',
        name: '2.mp4',
        relativePath: '2.mp4',
        size: 12
    });
});
