'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('./rtl-engine');
const source = fs.readFileSync(path.join(__dirname, 'extension.js'), 'utf8');

(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtlc-restart-'));
    try {
        const html = path.join(root, 'out/vs/workbench/workbench.html');
        const productPath = path.join(root, 'product.json');
        const stock = '<html><head></head><body></body></html>';
        fs.mkdirSync(path.dirname(html), { recursive: true });
        fs.writeFileSync(html, stock);
        fs.writeFileSync(productPath, JSON.stringify({ checksums: { 'vs/workbench/workbench.html': engine.checksum(stock), unrelated: 'unchanged' } }));
        const state = new Map();
        const messages = [], commands = [], logs = [];
        let choice;
        let pickAction;
        const picks = [];
        const vscode = {
            env: { appRoot: root },
            l10n: { t: text => text },
            workspace: { getConfiguration: () => ({ get: (_, fallback) => fallback }) },
            window: {
                showInformationMessage: async (message, ...actions) => { messages.push({ message, actions }); return choice; },
                showQuickPick: async (items, options) => {
                    picks.push({ items, options });
                    return items.find(item => item.action === pickAction);
                },
            },
            commands: { executeCommand: async command => { commands.push(command); } },
        };
        const globalState = { get: (key, fallback) => state.has(key) ? state.get(key) : fallback, update: async (key, value) => value === undefined ? state.delete(key) : state.set(key, value) };
        function load() {
            const ctx = { require: id => id === 'vscode' ? vscode : require(id), module: { exports: {} }, console: { log() {} }, process, Buffer, globalState, logs };
            vm.runInNewContext(source + `\nextensionContext = { globalState }; outputChannel = { appendLine() {}, show: value => logs.push(value) }; module.exports = { buildTransaction, executeTransaction, promptFullRestart, onStartup, cmdFixChecksum };`, ctx);
            return ctx.module.exports;
        }
        let api = load();
        const install = api.buildTransaction(html, true);
        assert.equal(install.changedProduct, true);
        await api.executeTransaction(install, true);
        assert.ok(state.get('productRestartPending'));
        assert.equal(JSON.parse(fs.readFileSync(productPath)).checksums.unrelated, 'unchanged');
        const reinstall = api.buildTransaction(html, true);
        assert.equal(reinstall.changedProduct, false);
        assert.ok(!reinstall.entries.some(e => e.path === productPath));
        fs.writeFileSync(reinstall.runtimePath, '// old runtime');
        assert.equal(api.buildTransaction(html, true).changedProduct, false, 'runtime-only refresh does not change product');
        // Serialization/whitespace alone must not rewrite product or require restart.
        fs.writeFileSync(productPath, JSON.stringify(JSON.parse(fs.readFileSync(productPath))));
        assert.equal(api.buildTransaction(html, true).changedProduct, false);
        await api.executeTransaction(reinstall, true);
        assert.ok(state.get('productRestartPending'), 'no-op must not erase pending restart');
        for (choice of ['بعداً', undefined, 'بستن برنامه']) {
            await api.promptFullRestart('Patched.');
            assert.ok(state.get('productRestartPending'));
            assert.deepEqual(messages.at(-1).actions, ['بستن برنامه', 'بعداً']);
            assert.match(messages.at(-1).message, /همهٔ پنجره‌ها/);
            assert.match(messages.at(-1).message, /بازخوانی پنجره کافی نیست/);
            assert.ok(messages.at(-1).message.length < 180, 'notification stays concise');
        }
        assert.deepEqual(commands, ['workbench.action.quit']);
        assert.equal(picks.length, 0, 'normal notifications never open acknowledgement');
        const execute = vscode.commands.executeCommand;
        vscode.commands.executeCommand = async () => { throw new Error('quit unavailable'); };
        choice = 'بستن برنامه';
        await assert.rejects(api.promptFullRestart('Patched.'), /quit unavailable/);
        assert.ok(state.get('productRestartPending'), 'failed quit must preserve pending state');
        vscode.commands.executeCommand = execute;
        api = load(); // extension host restart / renderer reload, same durable state
        const before = messages.length;
        await api.onStartup();
        assert.equal(messages.length, before, 'no repeated prompt or reload loop');
        assert.ok(state.get('productRestartPending'));
        choice = 'بعداً';
        const commandCount = commands.length;
        for (pickAction of [undefined, 'later', 'restart']) {
            await api.cmdFixChecksum();
            assert.ok(state.get('productRestartPending'), 'matching disk hashes/cancel/defer do not clear pending');
        }
        assert.equal(commands.length, commandCount, 'no automatic quit or reload');
        assert.match(picks.at(-1).options.placeHolder, /بررسی سلامت نصب نیست/);
        assert.match(picks.at(-1).items.find(item => item.action === 'acknowledge').detail, /نه فقط بازخوانی پنجره/);
        assert.equal(picks.at(-1).items[0].action, 'later', 'acknowledgement is not the default');
        pickAction = 'acknowledge';
        await api.cmdFixChecksum();
        assert.equal(state.has('productRestartPending'), false);
        assert.equal(commands.length, commandCount, 'acknowledgement only clears the reminder');
        const pickCount = picks.length;
        await api.cmdFixChecksum();
        assert.equal(picks.length, pickCount, 'no acknowledgement when nothing is pending');
        choice = 'بازخوانی پنجره';
        await api.promptFullRestart('Unchanged.');
        assert.deepEqual(messages.at(-1).actions, ['بازخوانی پنجره', 'بعداً']);
        assert.equal(commands.at(-1), 'workbench.action.reloadWindow');
        const disable = api.buildTransaction(html, false);
        assert.equal(disable.changedProduct, true);
        await api.executeTransaction(disable, false);
        assert.ok(state.get('productRestartPending'));
        state.delete('productRestartPending');
        const failing = api.buildTransaction(html, true);
        failing.htmlContent = 'force verification failure';
        await assert.rejects(api.executeTransaction(failing, true));
        assert.equal(state.has('productRestartPending'), false, 'rolled back transaction does not request restart');
        assert.equal(fs.readFileSync(html, 'utf8'), stock);
        console.log('RESTART_LIFECYCLE_REGRESSIONS_OK');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });