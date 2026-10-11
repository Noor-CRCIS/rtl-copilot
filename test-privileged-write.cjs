'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const helper = path.join(__dirname, 'privileged-write.sh');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtl-copilot-helper-test-'));
const root = path.join(temp, 'app');
const workbench = path.join(root, 'out', 'vs', 'code', 'workbench');
const manifest = path.join(temp, 'manifest');
const outside = path.join(temp, 'outside.txt');
const encode = value => Buffer.from(value).toString('base64');

function writeManifest(lines) {
    fs.writeFileSync(manifest, `${lines.join('\n')}\n`);
}

function runHelper(shouldSucceed) {
    let failed = false;
    let message = '';
    try {
        execFileSync('/bin/bash', [helper, manifest, root], { stdio: 'pipe' });
    } catch (error) {
        failed = true;
        message = error.stderr?.toString() || error.message;
    }
    assert.equal(failed, !shouldSucceed, `unexpected helper result: ${message}`);
}

try {
    fs.mkdirSync(workbench, { recursive: true });
    fs.writeFileSync(path.join(root, 'product.json'), '{}');
    fs.writeFileSync(path.join(workbench, 'workbench.html'), 'original');
    fs.writeFileSync(path.join(workbench, 'rtl-copilot-runtime.js'), 'runtime');
    fs.writeFileSync(outside, 'untouched');

    writeManifest([
        `WRITE\t${encode(path.join(workbench, 'workbench.html'))}\t${encode('patched')}`,
        `WRITE\t${encode(`${path.join(workbench, 'workbench.html')}.rtl-backup`)}\t${encode('original')}`,
        `DELETE\t${encode(path.join(workbench, 'rtl-copilot-runtime.js'))}\t`,
    ]);
    runHelper(true);
    assert.equal(fs.readFileSync(path.join(workbench, 'workbench.html'), 'utf8'), 'patched');
    assert.equal(fs.readFileSync(`${path.join(workbench, 'workbench.html')}.rtl-backup`, 'utf8'), 'original');
    assert.equal(fs.existsSync(path.join(workbench, 'rtl-copilot-runtime.js')), false);

    fs.writeFileSync(path.join(workbench, 'workbench.html'), 'before-rollback');
    writeManifest([
        `WRITE\t${encode(path.join(workbench, 'workbench.html'))}\t${encode('must-rollback')}`,
        `WRITE\t${encode(path.join(workbench, 'workbench.esm.html'))}\tinvalid-base64%%%`,
    ]);
    runHelper(false);
    assert.equal(fs.readFileSync(path.join(workbench, 'workbench.html'), 'utf8'), 'before-rollback');

    writeManifest([
        `WRITE\t${encode(outside)}\t${encode('must-not-write')}`,
    ]);
    runHelper(false);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'untouched');

    writeManifest([
        `WRITE\t${encode(path.join(workbench, 'not-a-workbench-file.txt'))}\t${encode('must-not-write')}`,
    ]);
    runHelper(false);
    assert.equal(fs.existsSync(path.join(workbench, 'not-a-workbench-file.txt')), false);
} finally {
    fs.rmSync(temp, { recursive: true, force: true });
}

console.log('PRIVILEGED_WRITE_TESTS_OK');
