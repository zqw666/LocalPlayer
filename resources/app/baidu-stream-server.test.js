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

test('caches links, reuses connections, and reports byte-range speed', async (t) => {
    let receivedRange = '';
    let receivedToken = '';
    let linkRequests = 0;
    const upstreamPorts = new Set();
    const upstream = http.createServer((request, response) => {
        receivedRange = request.headers.range || '';
        receivedToken = new URL(request.url, 'http://127.0.0.1').searchParams.get('access_token');
        upstreamPorts.add(request.socket.remotePort);
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

    let resolveStats;
    const receivedStats = new Promise((resolve) => { resolveStats = resolve; });
    const proxy = await startBaiduStreamServer({
        getAccessToken: async () => 'private-token',
        getDownloadLink: async () => {
            linkRequests++;
            return `http://127.0.0.1:${upstreamPort}/video`;
        },
        onStats: (stats) => {
            if (stats.bytesPerSecond > 0) resolveStats(stats);
        },
        statsIntervalMs: 20,
        log: () => {}
    });
    t.after(() => proxy.close());

    const playerUrl = proxy.urlFor('123');
    assert.doesNotMatch(playerUrl, /private-token/);
    const response = await fetch(playerUrl, { headers: { Range: 'bytes=2-4' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 2-4/6');
    assert.equal(await response.text(), 'cde');
    const secondResponse = await fetch(playerUrl, { headers: { Range: 'bytes=2-4' } });
    assert.equal(await secondResponse.text(), 'cde');
    const stats = await receivedStats;
    assert.equal(receivedRange, 'bytes=2-4');
    assert.equal(receivedToken, 'private-token');
    assert.equal(linkRequests, 1);
    assert.equal(upstreamPorts.size, 1);
    assert.equal(stats.fsId, '123');
    assert.ok(stats.bytesPerSecond > 0);
});
