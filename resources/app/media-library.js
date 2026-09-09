'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv|avi|flv|wmv|ts)$/i;
const naturalCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function isSupportedVideo(filePath) {
    return VIDEO_EXT.test(filePath);
}

function mediaItemForPath(filePath, root = path.dirname(filePath)) {
    const absolutePath = path.resolve(filePath);
    const relativePath = path.relative(root, absolutePath) || path.basename(absolutePath);
    return {
        path: absolutePath,
        url: pathToFileURL(absolutePath).href,
        name: path.basename(absolutePath),
        relativePath
    };
}

async function scanVideoFolder(folderPath) {
    const root = path.resolve(folderPath);
    let rootStat;
    try {
        rootStat = await fs.promises.stat(root);
    } catch (_) {
        return null;
    }
    if (!rootStat.isDirectory()) return null;

    const items = [];
    async function walk(directory) {
        let entries;
        try {
            entries = await fs.promises.readdir(directory, { withFileTypes: true });
        } catch (_) {
            return;
        }

        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await walk(entryPath);
            } else if (entry.isFile() && isSupportedVideo(entry.name)) {
                items.push(mediaItemForPath(entryPath, root));
            }
        }
    }

    await walk(root);
    items.sort((a, b) => naturalCollator.compare(a.relativePath, b.relativePath));
    return { kind: 'folder', root, items };
}

async function openLocalPath(localPath) {
    if (!localPath) return null;
    const absolutePath = path.resolve(localPath);
    let stat;
    try {
        stat = await fs.promises.stat(absolutePath);
    } catch (_) {
        return null;
    }

    if (stat.isDirectory()) return scanVideoFolder(absolutePath);
    if (!stat.isFile() || !isSupportedVideo(absolutePath)) return null;
    return { kind: 'file', ...mediaItemForPath(absolutePath) };
}

module.exports = {
    isSupportedVideo,
    mediaItemForPath,
    openLocalPath,
    scanVideoFolder
};
