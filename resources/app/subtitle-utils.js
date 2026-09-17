(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.subtitleUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function srtToVtt(source) {
        const normalized = String(source || '')
            .replace(/^\uFEFF/, '')
            .replace(/\r\n?/g, '\n')
            .trim();
        if (normalized.startsWith('WEBVTT')) return normalized + '\n';
        const cues = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
        return 'WEBVTT\n\n' + cues + '\n';
    }

    return { srtToVtt };
});
