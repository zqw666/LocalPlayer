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

function requestUpstream(url, requestHeaders, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const transport = target.protocol === 'http:' ? http : https;
        const request = transport.request(target, {
            method: 'GET',
            headers: requestHeaders
        }, (response) => {
            const location = response.headers.location;
            if (location && [301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.resume();
                if (redirectsLeft <= 0) {
                    reject(new Error('百度下载地址重定向次数过多'));
                    return;
                }
                resolve(requestUpstream(new URL(location, target).toString(), requestHeaders, redirectsLeft - 1));
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

            const accessToken = await options.getAccessToken();
            const downloadUrl = new URL(await options.getDownloadLink(accessToken, fsId));
            downloadUrl.searchParams.set('access_token', accessToken);

            const headers = {
                Accept: '*/*',
                'User-Agent': 'pan.baidu.com'
            };
            if (range) headers.Range = range;
            if (request.headers['if-range']) headers['If-Range'] = request.headers['if-range'];

            const upstream = await requestUpstream(downloadUrl.toString(), headers);
            upstreamRequest = upstream.request;
            const upstreamResponse = upstream.response;
            logger(`baidu stream upstream fsId=${fsId} status=${upstreamResponse.statusCode}`);

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
        close() {
            server.close();
        }
    };
}

module.exports = { startBaiduStreamServer };
