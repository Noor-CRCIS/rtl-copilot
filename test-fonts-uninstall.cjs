'use strict';

// test-fonts-uninstall.cjs — validates the v3.1.0 additions:
//  1. manifest localization (package.nls.json / package.nls.fa.json) resolves every %key%
//  2. fonts.js helpers rank/choose Persian fonts correctly
//  3. uninstall.js restoreOne fully reverts a patched workbench + re-syncs checksum

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const engine = require('./rtl-engine');
const fonts = require('./fonts');
const uninstall = require('./uninstall');

const ROOT = __dirname;

/* ---------- 1. Manifest localization ---------- */

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
assert.equal(manifest.version, '3.1.0', 'extension version must be 3.1.0');
assert.equal(manifest.scripts['vscode:uninstall'], 'node ./uninstall.js', 'vscode:uninstall hook must be registered');

const nlsEn = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.nls.json'), 'utf8'));
const nlsFa = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.nls.fa.json'), 'utf8'));

const raw = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
const keyRefs = [...new Set([...raw.matchAll(/%([a-zA-Z0-9._-]+)%/g)].map(m => m[1]))];
assert.ok(keyRefs.length > 0, 'expected at least one nls key reference in package.json');
for (const key of keyRefs) {
    assert.ok(nlsEn[key] !== undefined, `package.nls.json missing key: ${key}`);
    assert.ok(nlsFa[key] !== undefined, `package.nls.fa.json missing key: ${key}`);
}
// The default display-language must never show a raw placeholder.
assert.ok(!/%.+%/.test(JSON.stringify(nlsEn).replace(/%[a-zA-Z0-9._-]+%/g, '')), 'nls en values must contain no unresolved placeholder');
assert.ok(!/%.+%/.test(JSON.stringify(nlsFa).replace(/%[a-zA-Z0-9._-]+%/g, '')), 'nls fa values must contain no unresolved placeholder');

// selectFont command + font settings present
assert.ok(manifest.contributes.commands.some(c => c.command === 'rtlCopilot.selectFont'), 'selectFont command not declared');
const props = manifest.contributes.configuration.properties;
for (const key of ['rtlCopilot.font.enabled', 'rtlCopilot.font.family', 'rtlCopilot.font.size', 'rtlCopilot.font.lineHeight']) {
    assert.ok(props[key], `missing config ${key}`);
}

/* ---------- 2. fonts.js ---------- */
{
    const sorted = fonts.sortForPicker(['SomeOpaqueFont', 'Vazirmatn', 'Ubuntu']);
    assert.equal(sorted[0], 'Vazirmatn', 'Persian font must rank first');
    assert.ok(sorted.indexOf('Ubuntu') < sorted.indexOf('SomeOpaqueFont'), 'common Latin before opaque');
    assert.equal(fonts.defaultFamily(['Arial', 'Vazirmatn']), 'Vazirmatn', 'default family should prefer Persian');
    assert.equal(fonts.defaultFamily(['DejaVu Sans', 'Noto Sans']), 'DejaVu Sans');
    assert.equal(fonts.defaultFamily([]), null);
    // listInstalledFonts must resolve to an array (best-effort; may be empty on headless CI)
    fonts.listInstalledFonts().then((installed) => {
        assert.ok(Array.isArray(installed), 'listInstalledFonts must resolve to an array');
    });
}

/* ---------- 3. uninstall restoreOne ---------- */
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtlc-restore-test-'));
    const workbenchDir = path.join(dir, 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench');
    const appDir = path.join(dir, 'resources', 'app');
    const bundleDir = path.join(appDir, 'out', 'vs', 'workbench');
    fs.mkdirSync(workbenchDir, { recursive: true });
    fs.mkdirSync(bundleDir, { recursive: true });

    const htmlPath = path.join(workbenchDir, 'workbench.html');
    const productPath = path.join(appDir, 'product.json');
    const bundlePath = path.join(bundleDir, 'workbench.desktop.main.js');

    const originalHtml = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>\n';
    const originalBundle = '/* com.microsoft.applicationinsights */\nvar n=42;\nsvc.addCodeEditor(this);\n';
    const checksums = {
        'out/vs/code/electron-browser/workbench/workbench.html': engine.checksum(originalHtml),
        'out/vs/workbench/workbench/workbench.desktop.main.js': engine.checksum(originalBundle),
    };
    // baseline product.json with (wrong) checksums as Cursor/VS Code would have for a *clean* install
    fs.writeFileSync(productPath, JSON.stringify({ commit: 'abc', version: '1.0.0', checksums }, null, '\t') + '\n');

    // Simulate an installed patch.
    const patchedHtml = engine.applyPatchToHtml(originalHtml, { font: { enabled: true, family: 'Vazirmatn', size: 15 } });
    const runtimePath = path.join(workbenchDir, engine.RUNTIME_NAME);
    fs.writeFileSync(htmlPath, patchedHtml);
    fs.writeFileSync(runtimePath, engine.buildRuntime({ mode: 'auto' }));
    const patchedBundle = engine.applyEditorBridge(originalBundle);
    fs.writeFileSync(bundlePath, patchedBundle);
    // backups as the extension creates them
    fs.writeFileSync(htmlPath + '.rtl-backup', originalHtml);
    fs.writeFileSync(bundlePath + '.rtl-backup', originalBundle);
    fs.writeFileSync(productPath + '.rtl-backup', fs.readFileSync(productPath, 'utf8'));

    assert.equal(engine.markerState(fs.readFileSync(htmlPath, 'utf8')), 'valid');
    assert.notEqual(engine.editorBridgeState(fs.readFileSync(bundlePath, 'utf8')), 'absent');

    uninstall.restoreOne(htmlPath);

    assert.equal(fs.readFileSync(htmlPath, 'utf8'), originalHtml, 'workbench.html must be restored byte-for-byte');
    assert.equal(fs.readFileSync(bundlePath, 'utf8'), originalBundle, 'bundle must be restored byte-for-byte');
    assert.equal(fs.existsSync(runtimePath), false, 'runtime.js must be removed');
    assert.equal(fs.existsSync(htmlPath + '.rtl-backup'), false, 'html backup removed');
    assert.equal(fs.existsSync(bundlePath + '.rtl-backup'), false, 'bundle backup removed');

    const restoredProduct = JSON.parse(fs.readFileSync(productPath, 'utf8'));
    assert.equal(engine.markerState(fs.readFileSync(htmlPath, 'utf8')), 'absent');
    // product checksum for the html key must now match the restored (original) content
    const key = engine.checksumKey(appDir, htmlPath, restoredProduct.checksums);
    assert.equal(restoredProduct.checksums[key], engine.checksum(originalHtml), 'checksum must equal restored html digest');

    fs.rmSync(dir, { recursive: true, force: true });
}

console.log('test-fonts-uninstall: OK (' + keyRefs.length + ' nls keys, fonts + uninstall restore verified)');
