'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { srtToVtt } = require('./subtitle-utils');

test('converts SRT timestamps to WebVTT', () => {
    assert.equal(
        srtToVtt('\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\n你好\r\n'),
        'WEBVTT\n\n1\n00:00:01.250 --> 00:00:03.500\n你好\n'
    );
});
