'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');

const RESPONSE_HEADERS = [
    'accept-ranges',
    'cache-control',
    'content-length',
    'content-range',
    'content-type',
    'etag',
    'last-modified'
];
const DOWNLOAD_LINK_TTL_MS = 6 * 60 * 60 * 1000;

function requestUpstream(url, requestHeaders, agents, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const transport = target.protocol === 'http:' ? http : https;
        const request = transport.request(target, {
            method: 'GET',
            headers: requestHeaders,
            agent: target.protocol === 'http:' ? agents.http : agents.https
        }, (response) => {
            const location = response.headers.location;
            if (location && [301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.resume();
                if (redirectsLeft <= 0) {
                    reject(new Error('百度下载地址重定向次数过多'));
                    return;
                }
                resolve(requestUpstream(new URL(location, target).toString(), requestHeaders, agents, redirectsLeft - 1));
                return;
            }
            resolve({ request, response });
        });
        request.on('error', reject);
        request.end();
    });
}

async function startBaiduStreamServer(options) {
    const secret = crypto.randomBytes(24).toString('hex');
    const logger = typeof options.log === 'function' ? options.log : () => {};
    const onStats = typeof options.onStats === 'function' ? options.onStats : () => {};
    const linkTtlMs = options.linkTtlMs || DOWNLOAD_LINK_TTL_MS;
    const linkCache = new Map();
    const transferStats = new Map();
    const agents = {
        http: new http.Agent({ keepAlive: true, maxSockets: 6, maxFreeSockets: 3 }),
        https: new https.Agent({ keepAlive: true, maxSockets: 6, maxFreeSockets: 3 })
    };

    async function cachedDownloadLink(accessToken, fsId) {
        const cached = linkCache.get(fsId);
        if (cached && cached.expiresAt > Date.now()) return cached.promise;

        const promise = Promise.resolve(options.getDownloadLink(accessToken, fsId));
        linkCache.set(fsId, { expiresAt: Date.now() + linkTtlMs, promise });
        try {
            const downloadLink = await promise;
            logger(`baidu download link refreshed fsId=${fsId}`);
            return downloadLink;
        } catch (error) {
            linkCache.delete(fsId);
            throw error;
        }
    }

    function trackTransfer(fsId, upstreamResponse) {
        let stats = transferStats.get(fsId);
        if (!stats) {
            stats = { bytes: 0, activeRequests: 0, lastSampleAt: Date.now() };
            transferStats.set(fsId, stats);
        }
        stats.activeRequests++;
        upstreamResponse.on('data', (chunk) => {
            stats.bytes += chunk.length;
        });

        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            stats.activeRequests = Math.max(0, stats.activeRequests - 1);
        };
        upstreamResponse.once('end', finish);
        upstreamResponse.once('close', finish);
    }

    const statsTimer = setInterval(() => {
        const now = Date.now();
        for (const [fsId, stats] of transferStats) {
            const elapsedSeconds = Math.max(1, now - stats.lastSampleAt) / 1000;
            const bytesPerSecond = Math.round(stats.bytes / elapsedSeconds);
            stats.bytes = 0;
            stats.lastSampleAt = now;
            onStats({ fsId, bytesPerSecond, activeRequests: stats.activeRequests });
            if (stats.activeRequests === 0 && bytesPerSecond === 0) transferStats.delete(fsId);
        }
    }, options.statsIntervalMs || 1000);
    statsTimer.unref();

    const server = http.createServer(async (request, response) => {
        let upstreamRequest = null;
        try {
            const requestUrl = new URL(request.url, 'http://127.0.0.1');
            const match = requestUrl.pathname.match(/^\/baidu-video\/(\d+)$/);
            if (!match || requestUrl.searchParams.get('key') !== secret) {
                response.writeHead(404).end();
                return;
            }
            if (request.method !== 'GET') {
                response.writeHead(405, { Allow: 'GET' }).end();
                return;
            }

            const fsId = match[1];
            const range = request.headers.range;
            logger(`baidu stream request fsId=${fsId} range=${range || 'none'}`);

            const headers = {
                Accept: '*/*',
                'User-Agent': 'pan.baidu.com'
            };
            if (range) headers.Range = range;
            if (request.headers['if-range']) headers['If-Range'] = request.headers['if-range'];

            const accessToken = await options.getAccessToken();
            const openUpstream = async () => {
                const downloadUrl = new URL(await cachedDownloadLink(accessToken, fsId));
                downloadUrl.searchParams.set('access_token', accessToken);
                return requestUpstream(downloadUrl.toString(), headers, agents);
            };

            let upstream = await openUpstream();
            if ([401, 403].includes(upstream.response.statusCode)) {
                upstream.response.resume();
                linkCache.delete(fsId);
                logger(`baidu download link rejected, retrying fsId=${fsId}`);
                upstream = await openUpstream();
            }
            upstreamRequest = upstream.request;
            const upstreamResponse = upstream.response;
            logger(`baidu stream upstream fsId=${fsId} status=${upstreamResponse.statusCode}`);
            if ([200, 206].includes(upstreamResponse.statusCode)) trackTransfer(fsId, upstreamResponse);

            for (const name of RESPONSE_HEADERS) {
                const value = upstreamResponse.headers[name];
                if (value !== undefined) response.setHeader(name, value);
            }
            response.statusCode = upstreamResponse.statusCode || 502;
            upstreamResponse.on('error', (error) => {
                if (error.code !== 'ECONNRESET' && error.message !== 'aborted') {
                    logger(`baidu stream response failed: ${error.message}`);
                    response.destroy(error);
                }
            });
            response.on('close', () => {
                if (!response.writableEnded) upstreamRequest.destroy();
            });
            upstreamResponse.pipe(response);
        } catch (error) {
            logger(`baidu stream failed: ${error.message}`);
            if (!response.headersSent) {
                response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
                response.end('Baidu Netdisk stream failed');
            } else {
                response.destroy(error);
            }
        }
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    logger(`baidu stream proxy listening on 127.0.0.1:${address.port}`);

    return {
        urlFor(fsId) {
            if (!/^\d+$/.test(String(fsId))) throw new Error('百度网盘文件 ID 无效');
            return `http://127.0.0.1:${address.port}/baidu-video/${fsId}?key=${secret}`;
        },
        clearCache() {
            linkCache.clear();
        },
        close() {
            clearInterval(statsTimer);
            agents.http.destroy();
            agents.https.destroy();
            server.close();
        }
    };
}

module.exports = { startBaiduStreamServer };
