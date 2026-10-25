'use strict';

// RTL-COPILOT uninstall.js — `vscode:uninstall` hook.
// Runs in plain Node (NO vscode API) when the user uninstalls the extension,
// and restores the patched workbench files back to their original state so VS
// Code is never left "corrupt" or half-patched after removal.
//
// An idempotent, marker-based strip + checksum re-sync that fully reverts
// the install.

const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('./rtl-engine');

const BACKUP_SUFFIX = '.rtl-backup';
const LOG_DIR = path.join(os.tmpdir(), 'rtl-copilot');

function exists(p) {
    try { return Boolean(p) && fs.existsSync(p); }
    catch { return false; }
}

function safeReadDir(dir) {
    try { return fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return []; }
}

function log(message) {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        fs.appendFileSync(path.join(LOG_DIR, 'uninstall.log'), `[${new Date().toISOString()}] ${message}\n`);
    } catch { /* ignore */ }
    try { console.log(`[RTL-UNINSTALL] ${message}`); } catch { /* ignore */ }
}

// Static installation roots (no execPath: unreliable during uninstall).
function getInstallRoots() {
    const roots = [];
    const add = (dir) => { if (dir && exists(dir)) roots.push(dir); };
    if (process.platform === 'win32') {
        add(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code'));
        add(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code Insiders'));
        add(process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft VS Code'));
        add(process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft VS Code Insiders'));
        add(process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft VS Code'));
    } else if (process.platform === 'darwin') {
        add(path.join(os.homedir(), 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app'));
        add(path.join(os.homedir(), 'Applications', 'Visual Studio Code - Insiders.app', 'Contents', 'Resources', 'app'));
        add('/Applications/Visual Studio Code.app/Contents/Resources/app');
        add('/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app');
    } else {
        add('/usr/share/code/resources/app');
        add('/usr/share/code-insiders/resources/app');
        add('/usr/lib/code/resources/app');
        add('/usr/lib/code-insiders/resources/app');
        add('/opt/visual-studio-code/resources/app');
        add(path.join(os.homedir(), '.vscode'));
        add(path.join(os.homedir(), '.vscode-insiders'));
    }
    return roots;
}

function workbenchCandidates(base) {
    const relativeDirs = [
        ['out', 'vs', 'code', 'electron-browser', 'workbench'],
        ['out', 'vs', 'workbench'],
        ['resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench'],
        ['resources', 'app', 'out', 'vs', 'workbench'],
    ];
    const result = [];
    for (const parts of relativeDirs) {
        const dir = path.join(base, ...parts);
        for (const name of ['workbench.html', 'workbench.esm.html']) {
            const candidate = path.join(dir, name);
            if (exists(candidate)) result.push(candidate);
        }
    }
    return result;
}

function collectWorkbenchHtmls() {
    const htmls = new Map(); // htmlPath -> root
    const add = (html, root) => { if (html && !htmls.has(html)) htmls.set(html, root); };
    for (const root of getInstallRoots()) {
        for (const c of workbenchCandidates(root)) add(c, root);
        for (const entry of safeReadDir(root)) {
            if (!entry.isDirectory() || !/^[a-f0-9]{8,64}$/i.test(entry.name)) continue;
            for (const c of workbenchCandidates(path.join(root, entry.name))) add(c, root);
        }
    }
    return htmls;
}

function findProductJson(htmlPath) {
    let dir = path.dirname(htmlPath);
    for (let depth = 0; depth < 16; depth += 1) {
        const productPath = path.join(dir, 'product.json');
        if (exists(productPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(productPath, 'utf8'));
                return { productPath, appBase: dir, data };
            } catch { return null; }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

function findWorkbenchBundle(htmlPath) {
    const directory = path.dirname(htmlPath);
    const candidates = [...new Set([
        path.resolve(directory, '..', '..', '..', 'workbench', 'workbench.desktop.main.js'),
        path.join(directory, 'workbench.desktop.main.js'),
    ].filter(exists))];
    if (candidates.length === 1) return candidates[0];
    // if multiple, prefer the one that actually carries the bridge
    for (const c of candidates) {
        if (engine.editorBridgeState(fs.readFileSync(c, 'utf8')) !== 'absent') return c;
    }
    return candidates[0] || null;
}

function atomicWrite(filePath, content) {
    const tmp = `${filePath}.tmp${process.pid}`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, filePath);
}

function readBackup(filePath) {
    const b = `${filePath}${BACKUP_SUFFIX}`;
    return exists(b) ? fs.readFileSync(b, 'utf8') : null;
}

function pruneBackups(files) {
    for (const f of files.filter(Boolean)) {
        const b = `${f}${BACKUP_SUFFIX}`;
        if (exists(b)) {
            try { fs.unlinkSync(b); log(`   ✓ remove backup: ${b}`); }
            catch { /* ignore */ }
        }
    }
}

function restoreOne(htmlPath) {
    const productInfo = findProductJson(htmlPath);
    const runtimePath = path.join(path.dirname(htmlPath), engine.RUNTIME_NAME);
    let bundlePath = null;
    const bundleCandidate = findWorkbenchBundle(htmlPath);
    if (bundleCandidate) bundlePath = bundleCandidate;

    const htmlBackup = readBackup(htmlPath);
    const bundleBackup = bundlePath ? readBackup(bundlePath) : null;
    const productBackup = productInfo ? readBackup(productInfo.productPath) : null;

    let writeHtml = null;
    let writeBundle = null;
    let changed = false;

    // HTML: prefer byte-for-byte restore from backup, else strip markers.
    const htmlState = engine.markerState(fs.readFileSync(htmlPath, 'utf8'));
    if (htmlBackup !== null && engine.markerState(htmlBackup) === 'absent') {
        writeHtml = htmlBackup;
        changed = true;
        log(`   ✓ restore html from backup: ${htmlPath}`);
    } else if (htmlState === 'valid') {
        writeHtml = engine.removePatchFromHtml(fs.readFileSync(htmlPath, 'utf8'));
        changed = true;
        log(`   ✓ strip patch markers: ${htmlPath}`);
    } else if (htmlState === 'invalid') {
        log(`   ⚠ malformed markers, skipped: ${htmlPath}`);
    }

    // Bundle: prefer byte-for-byte restore from backup, else strip the editor bridge.
    if (bundlePath && bundleBackup !== null && engine.editorBridgeState(bundleBackup) === 'absent') {
        writeBundle = bundleBackup;
        changed = true;
        log(`   ✓ restore bundle from backup: ${bundlePath}`);
    } else if (bundlePath && engine.editorBridgeState(fs.readFileSync(bundlePath, 'utf8')) !== 'absent') {
        writeBundle = engine.removeEditorBridge(fs.readFileSync(bundlePath, 'utf8'));
        changed = true;
        log(`   ✓ strip editor bridge: ${bundlePath}`);
    }

    if (exists(runtimePath)) {
        try { fs.unlinkSync(runtimePath); log(`   ✓ remove runtime: ${runtimePath}`); }
        catch { log(`   ⚠ could not remove runtime: ${runtimePath}`); }
    }

    const backupFiles = [htmlPath, bundlePath, productInfo && productInfo.productPath];
    if (!changed) {
        pruneBackups(backupFiles);
        log(`   – nothing to restore: ${htmlPath}`);
        return;
    }

    if (writeHtml !== null) atomicWrite(htmlPath, writeHtml);
    if (writeBundle !== null && bundlePath) atomicWrite(bundlePath, writeBundle);

    if (productInfo) {
        let productBackupValid = false;
        if (productBackup) {
            try {
                const clean = JSON.parse(productBackup);
                productBackupValid = Boolean(clean && clean.commit === productInfo.data.commit && clean.version === productInfo.data.version);
            } catch { /* ignore */ }
        }
        if (productBackupValid) {
            atomicWrite(productInfo.productPath, productBackup);
            log(`   ✓ restore product.json from backup: ${productInfo.productPath}`);
        } else {
            // Fallback: remove the checksum entries so no false "corrupt install" warning appears.
            const checksums = { ...productInfo.data.checksums };
            for (const target of [htmlPath, bundlePath]) {
                if (!target) continue;
                try {
                    delete checksums[engine.checksumKey(productInfo.appBase, target, checksums)];
                } catch { /* key not present → nothing to drop */ }
            }
            productInfo.data.checksums = checksums;
            atomicWrite(productInfo.productPath, JSON.stringify(productInfo.data, null, '\t') + '\n');
            log(`   ✓ re-synced product.json checksums: ${productInfo.productPath}`);
        }
    }

    pruneBackups(backupFiles);
}

function main() {
    log('=== RTL-COPILOT uninstall hook ===');
    const htmls = collectWorkbenchHtmls();
    if (!htmls.size) { log('No VS Code workbench found; nothing to restore.'); return 0; }
    let touched = 0;
    for (const htmlPath of htmls.keys()) {
        try {
            const before = fs.readFileSync(htmlPath, 'utf8');
            const hadMarkers = engine.markerState(before) !== 'absent';
            restoreOne(htmlPath);
            if (hadMarkers) touched += 1;
        } catch (error) {
            log(`   ✗ failed for ${htmlPath}: ${error.message}`);
        }
    }
    log(`Uninstall hook finished (${touched} patched workbench restored).`);
    return touched;
}

module.exports = {
    collectWorkbenchHtmls,
    restoreOne,
    findProductJson,
    findWorkbenchBundle,
};

if (require.main === module) {
    main();
}
