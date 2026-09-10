'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { startBaiduStreamServer } = require('./baidu-stream-server');

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
}

function close(server) {
    return new Promise((resolve) => server.close(resolve));
}

test('proxies byte ranges without exposing the access token in the player URL', async (t) => {
    let receivedRange = '';
    let receivedToken = '';
    const upstream = http.createServer((request, response) => {
        receivedRange = request.headers.range || '';
        receivedToken = new URL(request.url, 'http://127.0.0.1').searchParams.get('access_token');
        response.writeHead(206, {
            'Accept-Ranges': 'bytes',
            'Content-Range': 'bytes 2-4/6',
            'Content-Length': '3',
            'Content-Type': 'video/mp4'
        });
        response.end('cde');
    });
    await listen(upstream);
    t.after(() => close(upstream));
    const upstreamPort = upstream.address().port;

    const proxy = await startBaiduStreamServer({
        getAccessToken: async () => 'private-token',
        getDownloadLink: async () => `http://127.0.0.1:${upstreamPort}/video`,
        log: () => {}
    });
    t.after(() => proxy.close());

    const playerUrl = proxy.urlFor('123');
    assert.doesNotMatch(playerUrl, /private-token/);
    const response = await fetch(playerUrl, { headers: { Range: 'bytes=2-4' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 2-4/6');
    assert.equal(await response.text(), 'cde');
    assert.equal(receivedRange, 'bytes=2-4');
    assert.equal(receivedToken, 'private-token');
});
