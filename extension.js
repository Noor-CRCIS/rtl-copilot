'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('node:child_process');
const engine = require('./rtl-engine');
const fonts = require('./fonts');

const EXT_ID = 'rtlCopilot';
const EXT_LABEL = 'راست‌چین هوشمند نور';
const BACKUP_SUFFIX = '.rtl-backup';
const KEY_DISABLED = 'userDisabled';
let outputChannel = null;
let statusBarItem = null;
let extensionContext = null;
let busy = false;
let elevatedWrite = false;
let lastWriteContext = null;

function log(message) {
    const line = `[${new Date().toTimeString().slice(0, 8)}] ${message}`;
    if (outputChannel) outputChannel.appendLine(line);
    console.log(`[RTL] ${message}`);
}

function exists(filePath) {
    try { return Boolean(filePath) && fs.existsSync(filePath); }
    catch { return false; }
}

function safeReadDir(dir) {
    try { return fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return []; }
}

function unsupportedInstallMessage(filePath) {
    const normalized = path.resolve(filePath).split(path.sep).join('/');
    if (process.platform === 'linux' && (/^\/snap\//.test(normalized) || /^\/var\/lib\/snapd\/snap\//.test(normalized))) {
        return 'نسخهٔ Snap روی فایلسیستم فقطخواندنی نصب شده و قابل پچ نیست. VS Code Snap را حذف و نسخهٔ رسمی DEB/RPM یا نصب writable دیگری را از https://code.visualstudio.com/Download نصب کنید؛ سپس افزونه را روی همان نسخه اجرا کنید. sudo این محدودیت را رفع نمیکند.';
    }
    return null;
}

function assertWritableInstallation(filePath) {
    const unsupported = unsupportedInstallMessage(filePath);
    if (unsupported) throw new Error(unsupported);
}

function getInstallRoots() {
    const roots = [];
    const add = (dir, label) => { if (dir && exists(dir)) roots.push({ dir, label }); };
    if (process.platform === 'win32') {
        add(path.dirname(process.execPath), 'execPath');
        add(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code'), 'User Stable');
        add(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code Insiders'), 'User Insiders');
        add(process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft VS Code'), 'System Stable');
        add(process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft VS Code Insiders'), 'System Insiders');
    } else if (process.platform === 'darwin') {
        add(path.resolve(path.dirname(process.execPath), '..', 'Resources', 'app'), 'execPath');
        add(path.join(os.homedir(), 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app'), 'User macOS Stable');
        add(path.join(os.homedir(), 'Applications', 'Visual Studio Code - Insiders.app', 'Contents', 'Resources', 'app'), 'User macOS Insiders');
        add('/Applications/Visual Studio Code.app/Contents/Resources/app', 'macOS Stable');
        add('/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app', 'macOS Insiders');
    } else {
        add(path.resolve(path.dirname(process.execPath), '..', 'lib', 'code', 'resources', 'app'), 'Linux Stable');
        add(path.resolve(path.dirname(process.execPath), '..', 'lib', 'code-insiders', 'resources', 'app'), 'Linux Insiders');
        add('/usr/share/code/resources/app', 'Linux Stable');
        add('/usr/share/code-insiders/resources/app', 'Linux Insiders');
        add(path.resolve(path.dirname(process.execPath), '..', 'resources', 'app'), 'execPath');
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

function findWorkbenchHtml() {
    const manualPath = globalSetting('workbenchHtmlPath', '');
    if (manualPath) {
        if (exists(manualPath) && /\.html$/i.test(manualPath)) return { htmlPath: manualPath, variant: 'Manual' };
        const manualCandidates = workbenchCandidates(manualPath);
        if (manualCandidates[0]) return { htmlPath: manualCandidates[0], variant: 'Manual directory' };
    }
    for (const root of getInstallRoots()) {
        const direct = workbenchCandidates(root.dir);
        if (direct[0]) return { htmlPath: direct[0], variant: root.label };
        for (const entry of safeReadDir(root.dir)) {
            if (!entry.isDirectory() || !/^[a-f0-9]{8,64}$/i.test(entry.name)) continue;
            const candidates = workbenchCandidates(path.join(root.dir, entry.name));
            if (candidates[0]) return { htmlPath: candidates[0], variant: `${root.label} (${entry.name})` };
        }
    }
    return null;
}

function findProductJson(htmlPath) {
    let dir = path.dirname(htmlPath);
    for (let depth = 0; depth < 16; depth += 1) {
        const productPath = path.join(dir, 'product.json');
        if (exists(productPath)) {
            const data = JSON.parse(fs.readFileSync(productPath, 'utf8'));
            return { productPath, appBase: dir, data };
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

function findWorkbenchBundle(htmlPath, requireCompatible = true) {
    const directory = path.dirname(htmlPath);
    const direct = [
        path.resolve(directory, '..', '..', '..', 'workbench', 'workbench.desktop.main.js'),
        path.join(directory, 'workbench.desktop.main.js'),
    ];
    const candidates = [...new Set(direct.filter(exists))];
    const compatible = candidates.filter(candidate => {
        try {
            const source = fs.readFileSync(candidate, 'utf8');
            engine.applyEditorBridge(source);
            return true;
        } catch { return false; }
    });
    if (compatible.length > 1) throw new Error('چند bundle سازگار Monaco پیدا شد؛ عملیات برای ایمنی متوقف شد.');
    if (compatible[0]) return compatible[0];
    if (!requireCompatible && candidates.length === 1) return candidates[0];
    return null;
}

function globalSetting(key, fallback) {
    const config = vscode.workspace.getConfiguration(EXT_ID);
    const inspected = typeof config.inspect === 'function' ? config.inspect(key) : null;
    if (inspected) {
        if (inspected.globalLanguageValue !== undefined) return inspected.globalLanguageValue;
        if (inspected.globalValue !== undefined) return inspected.globalValue;
        if (inspected.defaultLanguageValue !== undefined) return inspected.defaultLanguageValue;
        if (inspected.defaultValue !== undefined) return inspected.defaultValue;
    }
    return config.get(key, fallback);
}

function patchOptions() {
    const areas = {};
    for (const [name, definition] of Object.entries(engine.AREA_DEFINITIONS)) {
        areas[name] = globalSetting(`areas.${name}`, definition.default);
    }
    return engine.normalizeOptions({
        mode: globalSetting('mode', 'auto'),
        observe: globalSetting('useMutationObserver', true),
        autoEditorDirection: globalSetting('autoEditorDirection', false),
        autoInputDirection: globalSetting('autoInputDirection', true),
        font: {
            enabled: globalSetting('font.enabled', false),
            family: globalSetting('font.family', ''),
            size: globalSetting('font.size', 14),
            lineHeight: globalSetting('font.lineHeight', 0),
        },
        customSelectors: globalSetting('selectors', []),
        additionalCSS: globalSetting('additionalCSS', ''),
        areas,
    });
}

function getBackupPath(filePath) { return `${filePath}${BACKUP_SUFFIX}`; }

function atomicWrite(filePath, content) {
    const tempPath = `${filePath}.rtl-tmp-${process.pid}-${Date.now()}`;
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    try {
        fs.writeFileSync(tempPath, bytes);
        fs.renameSync(tempPath, filePath);
    }
    catch (error) {
        try { fs.unlinkSync(tempPath); } catch {}
        throw error;
    }
    if (exists(tempPath)) fs.unlinkSync(tempPath);
}

function backupEntry(filePath, sourceContent = null, refresh = false) {
    const backupPath = getBackupPath(filePath);
    if (!exists(backupPath)) {
        const content = sourceContent === null ? fs.readFileSync(filePath) : sourceContent;
        return { path: backupPath, content };
    }
    const current = sourceContent === null ? fs.readFileSync(filePath) : sourceContent;
    const backup = fs.readFileSync(backupPath);
    const currentBytes = Buffer.isBuffer(current) ? current : Buffer.from(current, 'utf8');
    return refresh && !currentBytes.equals(backup) ? { path: backupPath, content: currentBytes } : null;
}

function isPermissionError(error) {
    return ['EACCES', 'EPERM', 'EROFS'].includes(error && error.code)
        || ['EACCES', 'EPERM', 'EROFS'].includes(error && error.cause && error.cause.code);
}

function execFileAsync(file, args, options) {
    return new Promise((resolve, reject) => {
        execFile(file, args, options, (error, stdout, stderr) => {
            if (error) {
                const detail = [stderr, stdout].filter(Boolean).map(value => value.trim()).filter(Boolean).join('\n');
                if (detail) error.message = `${error.message}: ${detail}`;
                reject(error);
            } else resolve(stdout);
        });
    });
}

async function runElevatedWrite(entries, appRoot) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtl-copilot-elevation-'));
    const manifestPath = path.join(tempDir, 'write-manifest.json');
    try {
        const root = fs.realpathSync(appRoot);
        const normalizedEntries = entries.map(entry => ({
            path: path.resolve(entry.path),
            operation: entry.operation || 'write',
            content: entry.operation === 'delete'
                ? ''
                : (Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8')).toString('base64'),
        }));
        if (process.platform === 'win32') {
            fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, entries: normalizedEntries }), { mode: 0o600 });
            const helperPath = path.join(extensionContext.extensionPath, 'privileged-write.ps1');
            const errorReportPath = path.join(tempDir, 'helper-error.txt');
            const quotePowerShell = value => `'${value.replace(/'/g, "''")}'`;
            const script = [
                '$ErrorActionPreference = "Stop"',
                `$helper = ${quotePowerShell(helperPath)}`,
                `$manifest = ${quotePowerShell(manifestPath)}`,
                `$tempDirectory = ${quotePowerShell(tempDir)}`,
                `$errorReport = ${quotePowerShell(errorReportPath)}`,
                `$root = ${quotePowerShell(root)}`,
                '$administrators = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")',
                '$directoryAcl = Get-Acl -LiteralPath $tempDirectory',
                '$directoryRule = New-Object System.Security.AccessControl.FileSystemAccessRule($administrators, "Modify", "ContainerInherit,ObjectInherit", "None", "Allow")',
                '$directoryAcl.SetAccessRule($directoryRule)',
                'Set-Acl -LiteralPath $tempDirectory -AclObject $directoryAcl',
                '$manifestAcl = Get-Acl -LiteralPath $manifest',
                '$manifestRule = New-Object System.Security.AccessControl.FileSystemAccessRule($administrators, "Read", "Allow")',
                '$manifestAcl.SetAccessRule($manifestRule)',
                'Set-Acl -LiteralPath $manifest -AclObject $manifestAcl',
                '$arguments = \'-NoProfile -ExecutionPolicy Bypass -File "\' + $helper + \'" -Manifest "\' + $manifest + \'" -Root "\' + $root + \'" -ErrorReport "\' + $errorReport + \'"\'',
                '$process = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -Verb RunAs -Wait -PassThru',
                'if ($process.ExitCode -ne 0 -and (Test-Path -LiteralPath $errorReport)) {',
                '  [Console]::Error.WriteLine((Get-Content -LiteralPath $errorReport -Raw))',
                '}',
                'exit $process.ExitCode',
            ].join('\n');
            try {
                await execFileAsync('powershell.exe', [
                    '-NoProfile',
                    '-NonInteractive',
                    '-EncodedCommand',
                    Buffer.from(script, 'utf16le').toString('base64'),
                ], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
            } catch (error) {
                error.elevatedWriteHandled = true;
                throw error;
            }
        } else if (process.platform === 'linux') {
            const encodePath = value => Buffer.from(value, 'utf8').toString('base64');
            const lines = [];
            for (const entry of normalizedEntries) {
                const operation = entry.operation === 'delete' ? 'DELETE' : 'WRITE';
                lines.push(`${operation}\t${encodePath(entry.path)}\t${entry.content}`);
            }
            fs.writeFileSync(manifestPath, `${lines.join('\n')}\n`, { mode: 0o600 });
            const helperPath = path.join(extensionContext.extensionPath, 'privileged-write.sh');
            try {
                await execFileAsync('pkexec', ['/bin/bash', helperPath, manifestPath, root], {
                    windowsHide: true,
                    timeout: 120000,
                    maxBuffer: 1024 * 1024,
                });
            } catch (error) {
                error.elevatedWriteHandled = true;
                throw error;
            }
        } else if (process.platform === 'darwin') {
            const encodePath = value => Buffer.from(value, 'utf8').toString('base64');
            const lines = normalizedEntries.map(entry =>
                `${entry.operation === 'delete' ? 'DELETE' : 'WRITE'}\t${encodePath(entry.path)}\t${entry.content}`);
            fs.writeFileSync(manifestPath, `${lines.join('\n')}\n`, { mode: 0o600 });
            if (!path.resolve(root, '..', '..', '..').endsWith('.app')) {
                throw new Error('مسیر نصب macOS باید داخل بستهٔ .app باشد.');
            }
            const helperPath = path.join(extensionContext.extensionPath, 'privileged-write.sh');
            const script = 'do shell script ("/bin/bash " & ' + [helperPath, manifestPath, root]
                .map(value => `quoted form of ${JSON.stringify(value)}`).join(' & " " & ') +
                ') with administrator privileges';
            try {
                await execFileAsync('osascript', ['-e', script], { timeout: 120000, maxBuffer: 1024 * 1024 });
            } catch (error) {
                error.elevatedWriteHandled = true;
                throw error;
            }
        } else {
            throw new Error(`درخواست دسترسی بالاتر در ${process.platform} پشتیبانی نمی‌شود.`);
        }
    } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); }
        catch (error) { log(`temporary elevation manifest cleanup failed: ${error.message}`); }
    }
}

async function writeEntries(entries, appRoot) {
    if (!entries.length) return;
    lastWriteContext = { paths: entries.map(entry => path.resolve(entry.path)) };
    if (elevatedWrite) return runElevatedWrite(entries, appRoot);
    const appliedEntries = [];
    for (const entry of entries) {
        try {
            if (entry.operation === 'delete') {
                if (exists(entry.path)) fs.unlinkSync(entry.path);
            } else atomicWrite(entry.path, entry.content);
            appliedEntries.push(entry);
        } catch (error) {
            if (['EACCES', 'EPERM', 'EROFS'].includes(error.code)) {
                const permissionError = new Error(`نصب VS Code اجازهٔ نوشتن در ${entry.path} را نمی‌دهد. (${error.code})`, { cause: error });
                permissionError.code = error.code;
                permissionError.appliedEntries = appliedEntries;
                throw permissionError;
            }
            error.appliedEntries = appliedEntries;
            throw error;
        }
    }
    if (process.platform === 'darwin') {
        const bundle = path.resolve(appRoot, '..', '..', '..');
        if (!bundle.endsWith('.app')) throw new Error('مسیر نصب macOS باید داخل بستهٔ .app باشد.');
        try {
            await execFileAsync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags,runtime', bundle], { timeout: 120000 });
        } catch (error) {
            error.appliedEntries = appliedEntries;
            throw error;
        }
    }
}

function buildTransaction(htmlPath, enable) {
    const originalHtml = fs.readFileSync(htmlPath, 'utf8');
    const runtimePath = path.join(path.dirname(htmlPath), engine.RUNTIME_NAME);
    const productInfo = findProductJson(htmlPath);
    if (!productInfo) throw new Error('product.json متناظر با workbench پیدا نشد.');
    const options = patchOptions();
    const htmlContent = enable
        ? engine.applyPatchToHtml(originalHtml, options)
        : engine.removePatchFromHtml(originalHtml);
    let updatedProduct = productInfo.data;
    const checksumResult = engine.updateWorkbenchChecksum(updatedProduct, productInfo.appBase, htmlPath, htmlContent);
    updatedProduct = checksumResult.product;
    const entries = [
        { path: htmlPath, content: htmlContent },
    ];
    const nativeEditorEnabled = enable && (options.areas.inputs && options.areas.promptInputs || options.areas.editorsCode || options.areas.editorComments);
    const candidateBundlePath = findWorkbenchBundle(htmlPath, nativeEditorEnabled);
    let bundlePath = null;
    let bundleContent = null;
    let bundleBytes = null;
    let bundleChecksum = null;
    if (candidateBundlePath) {
        const originalBundle = fs.readFileSync(candidateBundlePath, 'utf8');
        const nextBundle = nativeEditorEnabled ? engine.applyEditorBridge(originalBundle) : engine.removeEditorBridge(originalBundle);
        if (nextBundle !== originalBundle) {
            bundlePath = candidateBundlePath;
            bundleContent = nextBundle;
            bundleBytes = Buffer.from(bundleContent, 'utf8');
            bundleChecksum = engine.updateWorkbenchChecksum(updatedProduct, productInfo.appBase, bundlePath, bundleContent);
            updatedProduct = bundleChecksum.product;
            entries.push({ path: bundlePath, content: bundleBytes });
        }
    } else if (nativeEditorEnabled) {
        throw new Error('bundle سازگار workbench.desktop.main.js برای RTL بومی Monaco پیدا نشد.');
    }
    const productContent = `${JSON.stringify(updatedProduct, null, 2)}\n`;
    if (productContent !== fs.readFileSync(productInfo.productPath, 'utf8')) {
        entries.push({ path: productInfo.productPath, content: productContent });
    }
    if (enable) entries.push({ path: runtimePath, content: engine.buildRuntime(options) });
    else if (exists(runtimePath)) entries.push({ path: runtimePath, operation: 'delete' });
    return { entries, htmlPath, htmlContent, runtimePath, productInfo, checksumResult, bundlePath, bundleContent, bundleBytes, bundleChecksum, bundleEnabled: nativeEditorEnabled, enable };
}

function verifyTransaction(transaction, enabled) {
    const html = fs.readFileSync(transaction.htmlPath, 'utf8');
    if (html !== transaction.htmlContent) throw new Error('محتوای workbench پس از نوشتن تطبیق ندارد.');
    const marker = engine.markerState(html);
    if ((enabled && marker !== 'valid') || (!enabled && marker !== 'absent')) throw new Error('وضعیت marker پچ نامعتبر است.');
    const product = JSON.parse(fs.readFileSync(transaction.productInfo.productPath, 'utf8'));
    if (product.checksums[transaction.checksumResult.key] !== engine.checksum(html)) throw new Error('checksum نهایی workbench تطبیق ندارد.');
    if (transaction.bundlePath) {
        const persisted = fs.readFileSync(transaction.bundlePath);
        if (!persisted.equals(transaction.bundleBytes)) throw new Error('محتوای bundle پس از نوشتن تطبیق ندارد.');
        const bridge = engine.editorBridgeState(persisted.toString('utf8'));
        if ((transaction.bundleEnabled && bridge !== 'valid') || (!transaction.bundleEnabled && bridge !== 'absent')) throw new Error('وضعیت bridge بومی Monaco نامعتبر است.');
        if (product.checksums[transaction.bundleChecksum.key] !== engine.checksum(persisted)) throw new Error('checksum نهایی bundle تطبیق ندارد.');
    }
    if (enabled) new Function(fs.readFileSync(transaction.runtimePath, 'utf8'));
    else if (exists(transaction.runtimePath)) throw new Error('فایل runtime پس از غیرفعال‌سازی حذف نشده است.');
}

async function executeTransaction(transaction, enabled) {
    const refreshBackups = engine.markerState(fs.readFileSync(transaction.htmlPath, 'utf8')) === 'absent'
        && (!transaction.bundlePath || engine.editorBridgeState(fs.readFileSync(transaction.bundlePath, 'utf8')) === 'absent');
    const backupEntries = transaction.entries
        .filter(entry => exists(entry.path) && entry.path !== transaction.runtimePath)
        .map(entry => backupEntry(entry.path, fs.readFileSync(entry.path), refreshBackups))
        .filter(Boolean);
    const entries = [...backupEntries, ...transaction.entries];
    const originals = entries.map(entry => ({
        path: entry.path,
        existed: exists(entry.path),
        content: exists(entry.path) ? fs.readFileSync(entry.path) : null,
    }));
    try {
        await writeEntries(entries, transaction.productInfo.appBase);
        verifyTransaction(transaction, enabled);
    } catch (error) {
        if (error.elevatedWriteHandled) throw error;
        const appliedEntries = error.appliedEntries || entries;
        if (appliedEntries.length) {
            const originalsByPath = new Map(originals.map(original => [original.path, original]));
            const rollbackEntries = [...appliedEntries].reverse().map(entry => {
                const original = originalsByPath.get(entry.path);
                return original.existed
                    ? { path: original.path, content: original.content }
                    : { path: original.path, operation: 'delete' };
            });
            try { await writeEntries(rollbackEntries, transaction.productInfo.appBase); }
            catch (rollbackError) { log(`rollback failed: ${rollbackError.message}`); }
        }
        throw error;
    }
}

function setStatusBar(active) {
    if (!statusBarItem) return;
    if (active === true) {
        statusBarItem.text = '$(check) RTL';
        statusBarItem.tooltip = `${EXT_LABEL} v${engine.VERSION}: فعال`;
        statusBarItem.backgroundColor = undefined;
    } else if (active === false) {
        statusBarItem.text = '$(circle-slash) RTL';
        statusBarItem.tooltip = `${EXT_LABEL} v${engine.VERSION}: غیرفعال`;
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = '$(warning) RTL';
        statusBarItem.tooltip = 'فایل workbench پیدا نشد';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

function refreshStatusBar() {
    const found = findWorkbenchHtml();
    if (!found) return setStatusBar(null);
    try { setStatusBar(engine.markerState(fs.readFileSync(found.htmlPath, 'utf8')) === 'valid'); }
    catch { setStatusBar(null); }
}

async function promptFullRestart(message) {
    const choice = await vscode.window.showInformationMessage(
        `${message} برای بارگذاری پچ، VS Code را کاملاً ببندید و دوباره باز کنید.`,
        'بستن VS Code', 'بعداً', 'Log',
    );
    if (choice === 'Log') return outputChannel.show(true);
    if (choice === 'بستن VS Code') await vscode.commands.executeCommand('workbench.action.quit');
}

async function doPatch(enable, quiet = false) {
    const found = findWorkbenchHtml();
    if (!found) throw new Error(vscode.env.remoteName
        ? 'در Remote، افزونه را روی VS Code محلی نصب کنید؛ UI روی سرور نیست.'
        : 'فایل workbench پیدا نشد.');
    assertWritableInstallation(found.htmlPath);
    log(`target: ${found.htmlPath}`);
    const transaction = buildTransaction(found.htmlPath, enable);
    await executeTransaction(transaction, enable);
    await extensionContext.globalState.update(KEY_DISABLED, !enable);
    setStatusBar(enable);
    if (!quiet) await promptFullRestart(`${EXT_LABEL}: ${enable ? 'فعال' : 'غیرفعال'} شد.`);
    return true;
}

async function safeRun(action, label) {
    if (busy) return;
    busy = true;
    lastWriteContext = null;
    log(`START ${label}`);
    try {
        try { return await action(); }
        catch (initialError) {
            let error = initialError;
            if (isPermissionError(error) && lastWriteContext && ['win32', 'linux', 'darwin'].includes(process.platform)) {
                const targets = lastWriteContext.paths.map(target => `• ${target}`).join('\n');
                log(`requesting one elevated transaction for ${lastWriteContext.paths.length} file(s):\n${targets}`);
                elevatedWrite = true;
                try { return await action(); }
                catch (elevationError) { error = elevationError; }
                finally { elevatedWrite = false; }
            }
            log(`ERROR ${label}: ${error.stack || error.message}`);
            const choice = await vscode.window.showErrorMessage(`${EXT_LABEL}: ${error.message}`, 'Log');
            if (choice === 'Log') outputChannel.show(true);
            return false;
        }
    } finally {
        elevatedWrite = false;
        busy = false;
        log(`END ${label}`);
    }
}

const cmdEnable = () => safeRun(() => doPatch(true), 'enable');
const cmdDisable = () => safeRun(() => doPatch(false), 'disable');
const cmdReinstall = () => safeRun(() => doPatch(true), 'reinstall');

async function cmdToggle() {
    const found = findWorkbenchHtml();
    const active = Boolean(found && engine.markerState(fs.readFileSync(found.htmlPath, 'utf8')) === 'valid');
    return active ? cmdDisable() : cmdEnable();
}

function cmdStatus() {
    const found = findWorkbenchHtml();
    if (!found) return vscode.window.showWarningMessage(`${EXT_LABEL}: workbench پیدا نشد.`);
    const html = fs.readFileSync(found.htmlPath, 'utf8');
    const marker = engine.markerState(html);
    return vscode.window.showInformationMessage(
        `${EXT_LABEL}: ${marker === 'valid' ? '✅ فعال' : marker === 'absent' ? '❌ غیرفعال' : '⚠️ marker خراب'} | patch v${engine.patchedVersion(html)} | ${found.variant}`,
    );
}

function cmdBackup() {
    return safeRun(async () => {
        const found = findWorkbenchHtml();
        if (!found) throw new Error('workbench پیدا نشد.');
        const html = fs.readFileSync(found.htmlPath, 'utf8');
        const bundlePath = findWorkbenchBundle(found.htmlPath, false);
        const bundle = bundlePath ? fs.readFileSync(bundlePath, 'utf8') : null;
        if (engine.markerState(html) !== 'absent' || (bundle && engine.editorBridgeState(bundle) !== 'absent')) {
            throw new Error('برای جلوگیری از backup آلوده، ابتدا پچ را غیرفعال کنید و سپس پشتیبان بگیرید.');
        }
        const backupEntries = [backupEntry(found.htmlPath, html, true)];
        const product = findProductJson(found.htmlPath);
        if (!product) throw new Error('product.json متناظر با workbench پیدا نشد.');
        if (product) backupEntries.push(backupEntry(product.productPath, fs.readFileSync(product.productPath, 'utf8'), true));
        if (bundlePath) backupEntries.push(backupEntry(bundlePath, bundle, true));
        await writeEntries(backupEntries.filter(Boolean), product.appBase);
        vscode.window.showInformationMessage(`${EXT_LABEL}: پشتیبان HTML، bundle و product.json ذخیره شد.`);
    }, 'backup');
}

function cmdFixChecksum() {
    return safeRun(async () => {
        const found = findWorkbenchHtml();
        if (!found) throw new Error('workbench پیدا نشد.');
        assertWritableInstallation(found.htmlPath);
        const html = fs.readFileSync(found.htmlPath, 'utf8');
        const productInfo = findProductJson(found.htmlPath);
        if (!productInfo) throw new Error('product.json پیدا نشد.');
        const updated = engine.updateWorkbenchChecksum(productInfo.data, productInfo.appBase, found.htmlPath, html);
        const bundlePath = findWorkbenchBundle(found.htmlPath, false);
        const bundle = bundlePath ? fs.readFileSync(bundlePath, 'utf8') : null;
        const bundleUpdated = bundlePath
            ? engine.updateWorkbenchChecksum(updated.product, productInfo.appBase, bundlePath, bundle)
            : null;
        const productContent = `${JSON.stringify(bundleUpdated ? bundleUpdated.product : updated.product, null, 2)}\n`;
        await writeEntries([{ path: productInfo.productPath, content: productContent }], productInfo.appBase);
        await promptFullRestart(`${EXT_LABEL}: checksum فایلهای Workbench بازسازی شد.`);
        return true;
    }, 'fixChecksum');
}

function cmdRestore() {
    return safeRun(async () => {
        const found = findWorkbenchHtml();
        if (!found) throw new Error('workbench پیدا نشد.');
        const product = findProductJson(found.htmlPath);
        const htmlBackup = getBackupPath(found.htmlPath);
        const productBackup = product && getBackupPath(product.productPath);
        if (!exists(htmlBackup) || !productBackup || !exists(productBackup)) throw new Error('پشتیبان کامل HTML و product.json وجود ندارد.');
        const runtimePath = path.join(path.dirname(found.htmlPath), engine.RUNTIME_NAME);
        const bundlePath = findWorkbenchBundle(found.htmlPath, false);
        const bundleBackup = bundlePath && getBackupPath(bundlePath);
        if (bundlePath && engine.editorBridgeState(fs.readFileSync(bundlePath, 'utf8')) === 'valid' && !exists(bundleBackup)) {
            throw new Error('پشتیبان bundle بومی Monaco وجود ندارد.');
        }
        const cleanHtml = fs.readFileSync(htmlBackup, 'utf8');
        if (engine.markerState(cleanHtml) !== 'absent') throw new Error('پشتیبان HTML شامل پچ است و Restore ایمن نیست.');
        const cleanBundle = bundleBackup && exists(bundleBackup) ? fs.readFileSync(bundleBackup, 'utf8') : null;
        if (bundlePath && engine.editorBridgeState(fs.readFileSync(bundlePath, 'utf8')) !== 'absent' && !cleanBundle) {
            throw new Error('پشتیبان bundle برای Restore ایمن لازم است.');
        }
        if (cleanBundle && engine.editorBridgeState(cleanBundle) !== 'absent') {
            throw new Error('پشتیبان bundle شامل bridge است و Restore ایمن نیست.');
        }
        const cleanProduct = JSON.parse(fs.readFileSync(productBackup, 'utf8'));
        if (!product.data.commit || !product.data.version
            || cleanProduct.commit !== product.data.commit || cleanProduct.version !== product.data.version) {
            throw new Error('نسخهٔ پشتیبان با نصب فعلی VS Code قابل تأیید یا یکسان نیست؛ Restore برای حفظ یکپارچگی متوقف شد.');
        }
        const htmlKey = engine.checksumKey(product.appBase, found.htmlPath, cleanProduct.checksums);
        if (cleanProduct.checksums[htmlKey] !== engine.checksum(cleanHtml)) throw new Error('checksum پشتیبان HTML معتبر نیست.');
        let bundleKey = null;
        if (bundlePath && cleanBundle) {
            bundleKey = engine.checksumKey(product.appBase, bundlePath, cleanProduct.checksums);
            if (cleanProduct.checksums[bundleKey] !== engine.checksum(cleanBundle)) throw new Error('checksum پشتیبان bundle معتبر نیست.');
        }
        const restoreEntries = [
            { path: found.htmlPath, content: fs.readFileSync(htmlBackup) },
            { path: product.productPath, content: fs.readFileSync(productBackup) },
            ...(bundlePath && exists(bundleBackup) ? [{ path: bundlePath, content: fs.readFileSync(bundleBackup) }] : []),
            { path: runtimePath, operation: 'delete' },
        ];
        await writeEntries(restoreEntries, product.appBase);
        await extensionContext.globalState.update(KEY_DISABLED, true);
        setStatusBar(false);
        await promptFullRestart(`${EXT_LABEL}: فایلهای اصلی بازگردانی شدند.`);
        return true;
    }, 'restore');
}

async function cmdConfigureAreas() {
    const items = Object.entries(engine.AREA_DEFINITIONS).map(([name, definition]) => {
        const enabled = globalSetting(`areas.${name}`, definition.default);
        return { label: `${enabled ? '$(check)' : '$(circle-slash)'} ${name}`, description: `rtlCopilot.areas.${name}`, name };
    });
    const selected = await vscode.window.showQuickPick(items, { placeHolder: 'یک بخش را برای فعال/غیرفعالکردن انتخاب کنید' });
    if (!selected) return;
    const key = `areas.${selected.name}`;
    const current = globalSetting(key, engine.AREA_DEFINITIONS[selected.name].default);
    await vscode.workspace.getConfiguration(EXT_ID).update(key, !current, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`${EXT_LABEL}: بخش ${selected.name} ${!current ? 'فعال' : 'غیرفعال'} شد. دستور «نصب مجدد پچ» را اجرا کنید.`);
}

async function cmdSelectFont() {
    let families = [];
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('جستجوی فونتهای نصبشده…') },
        async () => { families = await fonts.listInstalledFonts(); }
    );
    const cfg = vscode.workspace.getConfiguration(EXT_ID);
    const current = (cfg.get('font.family', '') || '').trim();
    const items = [
        { label: '$(close) ' + vscode.l10n.t('حالت پیشفرض (فونت ادیتور)'), description: current ? '' : vscode.l10n.t('فعلی'), reset: true },
        ...(current ? [{ label: '$(check) ' + current, description: vscode.l10n.t('فعلی'), family: current }] : []),
        ...families.map(family => ({ label: family, description: family === current ? vscode.l10n.t('فعلی') : undefined, family })),
    ];
    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: vscode.l10n.t('فونت فارسی/لاتین برای چت RTL را انتخاب کنید…'),
        matchOnDescription: true,
    });
    if (!picked) return;
    const target = vscode.ConfigurationTarget.Global;
    if (picked.reset) {
        await cfg.update('font.family', '', target);
        await cfg.update('font.enabled', false, target);
    } else {
        await cfg.update('font.family', picked.family, target);
        await cfg.update('font.enabled', true, target);
    }
    const choice = await vscode.window.showInformationMessage(
        vscode.l10n.t('فونت چت بهروزرسانی شد. برای اعمال، پچ را دوباره نصب کنید.'),
        vscode.l10n.t('نصب مجدد')
    );
    if (choice === vscode.l10n.t('نصب مجدد')) {
        const ok = await safeRun(() => doPatch(true), 'reinstall-after-font');
        if (ok) await promptFullRestart(vscode.l10n.t('پچ برای فونت جدید چت بهروزرسانی شد.'));
    }
}

function showDiagnostics() {
    const found = findWorkbenchHtml();
    const lines = [
        `${EXT_LABEL} v${engine.VERSION}`,
        `platform=${process.platform}`,
        `remote=${vscode.env.remoteName || 'local'}`,
        `execPath=${process.execPath}`,
        `workbench=${found ? found.htmlPath : 'not found'}`,
    ];
    log(lines.join('\n'));
    outputChannel.show(true);
}

async function onStartup() {
    const disabled = extensionContext.globalState.get(KEY_DISABLED, false);
    const autoApply = globalSetting('autoApply', true);
    log(`startup disabled=${disabled} autoApply=${autoApply}`);
    if (disabled || !autoApply) return refreshStatusBar();
    const found = findWorkbenchHtml();
    if (!found) return setStatusBar(null);
    const html = fs.readFileSync(found.htmlPath, 'utf8');
    let ready = engine.markerState(html) === 'valid' && engine.patchedVersion(html) === engine.VERSION;
    if (ready) {
        try {
            const options = patchOptions();
            const nativeRequired = options.areas.inputs && options.areas.promptInputs || options.areas.editorsCode || options.areas.editorComments;
            const expectedRuntime = engine.buildRuntime(options);
            const runtimePath = path.join(path.dirname(found.htmlPath), engine.RUNTIME_NAME);
            const bundlePath = nativeRequired ? findWorkbenchBundle(found.htmlPath) : findWorkbenchBundle(found.htmlPath, false);
            const productInfo = findProductJson(found.htmlPath);
            ready = exists(runtimePath)
                && fs.readFileSync(runtimePath, 'utf8') === expectedRuntime
                && Boolean(productInfo)
                && productInfo.data.checksums[engine.checksumKey(productInfo.appBase, found.htmlPath, productInfo.data.checksums)] === engine.checksum(html);
            if (ready && nativeRequired) {
                ready = Boolean(bundlePath)
                    && engine.editorBridgeState(fs.readFileSync(bundlePath, 'utf8')) === 'valid'
                    && productInfo.data.checksums[engine.checksumKey(productInfo.appBase, bundlePath, productInfo.data.checksums)] === engine.checksum(fs.readFileSync(bundlePath, 'utf8'));
            }
        } catch { ready = false; }
    }
    if (ready) return setStatusBar(true);
    setStatusBar(false);
    if (!globalSetting('notifyOnUpdate', true)) return;
    log(`${EXT_LABEL} v${engine.VERSION}: patch is absent or outdated; run reinstall and fully restart VS Code.`);
    statusBarItem.tooltip = `${EXT_LABEL} v${engine.VERSION}: پچ نیاز به نصب مجدد دارد. روی RTL کلیک کنید یا فرمان «نصب مجدد پچ» را اجرا کنید.`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
}

function activate(context) {
    extensionContext = context;
    outputChannel = vscode.window.createOutputChannel(EXT_LABEL);
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
    statusBarItem.command = `${EXT_ID}.toggle`;
    statusBarItem.show();
    context.subscriptions.push(outputChannel, statusBarItem);
    const commands = {
        enable: cmdEnable,
        disable: cmdDisable,
        toggle: cmdToggle,
        status: cmdStatus,
        detectPath: showDiagnostics,
        showInstructions: showDiagnostics,
        openLog: () => outputChannel.show(true),
        reinstall: cmdReinstall,
        backup: cmdBackup,
        restore: cmdRestore,
        fixChecksum: cmdFixChecksum,
        configureAreas: cmdConfigureAreas,
        selectFont: cmdSelectFont,
    };
    for (const [name, handler] of Object.entries(commands)) {
        context.subscriptions.push(vscode.commands.registerCommand(`${EXT_ID}.${name}`, handler));
    }
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration(EXT_ID)) {
            log('configuration changed; explicit reinstall is required');
            refreshStatusBar();
            if (event.affectsConfiguration(`${EXT_ID}.areas.markdownPreview`)
                || event.affectsConfiguration(`${EXT_ID}.areas.lists`)
                || event.affectsConfiguration(`${EXT_ID}.areas.tables`)
                || event.affectsConfiguration(`${EXT_ID}.mode`)) {
                vscode.commands.executeCommand('markdown.preview.refresh');
            }
        }
    }));
    log(`${EXT_LABEL} v${engine.VERSION} activated`);
    setTimeout(onStartup, 800);
    return {
        extendMarkdownIt(markdownIt) {
            const originalRender = markdownIt.renderer.render;
            markdownIt.renderer.render = function (tokens, options, env) {
                const config = vscode.workspace.getConfiguration(EXT_ID);
                const payload = encodeURIComponent(JSON.stringify({
                    enabled: config.get('areas.markdownPreview', true),
                    mode: config.get('mode', 'auto'),
                    lists: config.get('areas.lists', true),
                    tables: config.get('areas.tables', true),
                }));
                const html = originalRender.call(this, tokens, options, env);
                return `<span id="rtl-copilot-preview-config" hidden aria-hidden="true" data-config="${payload}"></span>${html}`;
            };
            return markdownIt;
        },
    };
}

function deactivate() { log('deactivate'); }

module.exports = {
    activate,
    deactivate,
    _test: {
        buildTransaction,
        findProductJson,
        patchOptions,
    },
};
