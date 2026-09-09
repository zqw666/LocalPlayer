'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openLocalPath, scanVideoFolder } = require('./media-library');

async function makeFixture(t) {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'local-player-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    await fs.promises.mkdir(path.join(root, '第二季'));
    await Promise.all([
        fs.promises.writeFile(path.join(root, '第10集.mp4'), ''),
        fs.promises.writeFile(path.join(root, '第2集.mp4'), ''),
        fs.promises.writeFile(path.join(root, '第1集.mkv'), ''),
        fs.promises.writeFile(path.join(root, '说明.txt'), ''),
        fs.promises.writeFile(path.join(root, '第二季', '第1集.webm'), '')
    ]);
    return root;
}

test('recursively scans supported videos in natural order', async (t) => {
    const root = await makeFixture(t);
    const result = await scanVideoFolder(root);
    assert.equal(result.kind, 'folder');
    assert.equal(result.root, root);
    assert.deepEqual(result.items.map((item) => item.relativePath), [
        '第1集.mkv',
        '第2集.mp4',
        '第10集.mp4',
        path.join('第二季', '第1集.webm')
    ]);
});

test('opens supported files and rejects missing or unsupported paths', async (t) => {
    const root = await makeFixture(t);
    const videoPath = path.join(root, '第1集.mkv');
    const file = await openLocalPath(videoPath);
    assert.equal(file.kind, 'file');
    assert.equal(file.path, videoPath);
    assert.equal(await openLocalPath(path.join(root, '说明.txt')), null);
    assert.equal(await openLocalPath(path.join(root, '不存在.mp4')), null);
});
