'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fonts = require('./fonts');
const engine = require('./rtl-engine');

const manifest = require('./package.json');
for (const name of ['selectFont', 'selectFontSize']) {
    const command = `rtlCopilot.${name}`;
    assert.ok(manifest.contributes.commands.some(item => item.command === command));
    assert.ok(manifest.contributes.menus.commandPalette.some(item => item.command === command));
    for (const locale of ['./package.nls.json', './package.nls.fa.json']) {
        assert.ok(require(locale)[`rtlCopilot.command.${name}`]);
    }
}

function harness({ value, pick, reinstall = false, initial = {}, installed = ['Tahoma'] } = {}) {
    const settings = { 'font.family': 'Vazirmatn', 'font.size': 18, 'font.lineHeight': 1.8, 'font.enabled': false, ...initial };
    const writes = [];
    const commands = new Map();
    const calls = { input: 0, quickPick: 0, messages: 0, patches: [], safeRuns: [] };
    const cfg = {
        get: (key, fallback) => settings[key] ?? fallback,
        update: async (key, value, target) => {
            writes.push([key, value, target]);
            if (value === undefined) delete settings[key];
            else settings[key] = value;
        },
    };
    const vscode = {
        ConfigurationTarget: { Global: 1 },
        QuickPickItemKind: { Separator: -1 },
        ProgressLocation: { Notification: 15 },
        StatusBarAlignment: { Right: 2 },
        l10n: { t: text => text },
        workspace: { getConfiguration: () => cfg, onDidChangeConfiguration: () => ({}) },
        commands: { registerCommand: (name, handler) => { commands.set(name, handler); return {}; } },
        window: {
            createOutputChannel: () => ({ appendLine() {} }),
            createStatusBarItem: () => ({ show() {} }),
            withProgress: async (_, run) => run(),
            showQuickPick: async items => { calls.quickPick++; return pick && pick(items); },
            showInputBox: async options => { calls.input++; calls.options = options; return value; },
            showInformationMessage: async (_, action) => { calls.messages++; return reinstall ? action : undefined; },
        },
    };
    const context = {
        require: id => id === 'vscode' ? vscode : id === './fonts'
            ? { ...fonts, listInstalledFonts: async () => installed } : require(id),
        module: { exports: {} }, console: { log() {} }, setTimeout() {}, calls,
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'extension.js'), 'utf8') + `
        safeRun = async (run, label) => { calls.safeRuns.push(label); await run(); };
        doPatch = async force => { calls.patches.push(force); };
    `, context);
    context.module.exports.activate({ subscriptions: [] });
    return { settings, writes, calls, run: name => commands.get(`rtlCopilot.${name}`)() };
}

(async () => {
    const extensionSource = fs.readFileSync(path.join(__dirname, 'extension.js'), 'utf8');
    const promptSource = extensionSource.slice(extensionSource.indexOf('async function promptFullRestart('), extensionSource.indexOf('\nasync function doPatch('));
    for (const choice of ['بازخوانی پنجره', 'بعداً', undefined]) {
        const executed = [];
        const logs = [];
        const prompt = vm.runInNewContext(`${promptSource}; promptFullRestart`, {
            extensionContext: { globalState: { get: () => undefined } },
            KEY_RESTART_PENDING: 'productRestartPending',
            vscode: {
                l10n: { t: text => text },
                window: { showInformationMessage: async (message, ...actions) => {
                    assert.deepEqual(actions, ['بازخوانی پنجره', 'بعداً']);
                    assert.ok(message.startsWith('Patched. '));
                    assert.ok(message.includes('برای اعمال تغییرات، پنجره را بازخوانی کنید.'));
                    return choice;
                } },
                commands: { executeCommand: async command => executed.push(command) },
            },
            outputChannel: { show: preserveFocus => logs.push(preserveFocus) },
        });
        await prompt('Patched.');
        assert.deepEqual(executed, choice === 'بازخوانی پنجره' ? ['workbench.action.reloadWindow'] : []);
        assert.deepEqual(logs, []);
    }
    for (const value of [undefined, '', '   ', 'abc', 'NaN', 'Infinity', '-Infinity', '8.99', '96.01', '0']) {
        const test = harness({ value, reinstall: true });
        await test.run('selectFontSize');
        assert.deepEqual(test.writes, [], `must not save ${String(value)}`);
        assert.equal(test.calls.messages, 0);
        assert.equal(test.calls.quickPick, 0);
        assert.deepEqual(test.calls.patches, []);
        if (value !== undefined) assert.ok(test.calls.options.validateInput(value));
    }
    for (const value of ['9', '96', ' 20.5 ']) {
        const test = harness({ value });
        await test.run('selectFontSize');
        assert.equal(test.calls.options.value, '18');
        assert.equal(test.calls.options.validateInput(value), undefined);
        assert.deepEqual(test.writes, [['font.size', Number(value), 1], ['font.enabled', true, 1]]);
        assert.equal(test.settings['font.family'], 'Vazirmatn');
        assert.equal(test.calls.messages, 1);
        assert.equal(test.calls.quickPick, 0);
        assert.deepEqual(test.calls.patches, []);
    }
    const sizeOnly = harness({ value: '24', initial: { 'font.family': '' }, reinstall: true });
    await sizeOnly.run('selectFontSize');
    assert.equal(sizeOnly.settings['font.family'], '');
    assert.equal(sizeOnly.settings['font.enabled'], true);
    assert.deepEqual(sizeOnly.calls.patches, [true]);
    assert.deepEqual(sizeOnly.calls.safeRuns, ['reinstall-after-font-size']);

    for (const reset of [false, true]) {
        const test = harness({ pick: items => items.find(item => reset ? item.reset : item.label === 'Tahoma'), reinstall: true });
        await test.run('selectFont');
        assert.equal(test.calls.input, 0, 'family command must not prompt for size');
        assert.equal(test.settings['font.size'], reset ? undefined : 18);
        assert.equal(test.settings['font.lineHeight'], reset ? undefined : 1.8);
        assert.deepEqual(test.writes, reset ? [
            ['font.family', undefined, 1], ['font.size', undefined, 1],
            ['font.lineHeight', undefined, 1], ['font.enabled', false, 1],
        ] : [['font.family', '"Tahoma", Tahoma, Arial, sans-serif', 1], ['font.enabled', true, 1]]);
        if (reset) {
            const css = engine.buildCss({ font: { enabled: test.settings['font.enabled'] } });
            for (const property of ['font-family:', 'font-size:', 'line-height:']) {
                assert.ok(!css.includes(property), `reset must preserve native ${property}`);
            }
        }
        assert.deepEqual(test.calls.patches, [true]);
        assert.deepEqual(test.calls.safeRuns, ['reinstall-after-font']);
    }
    const cancelledFamily = harness();
    await cancelledFamily.run('selectFont');
    assert.deepEqual(cancelledFamily.writes, []);
    assert.equal(cancelledFamily.calls.input, 0);
    assert.equal(cancelledFamily.calls.messages, 0);
    for (const preset of fonts.FALLBACK_PRESETS) {
        const test = harness({ installed: [], initial: { 'font.family': '' }, pick: items => {
            assert.ok(items.some(item => item.reset));
            assert.ok(!items.some(item => item.label === 'Vazirmatn'), 'uninstalled optional fonts must not be offered');
            return items.find(item => item.family === preset.family);
        } });
        await test.run('selectFont');
        assert.deepEqual(test.writes, [['font.family', preset.family, 1], ['font.enabled', true, 1]]);
        assert.equal(test.settings['font.size'], 18);
        assert.equal(test.settings['font.lineHeight'], 1.8);
        const normalized = engine.normalizeOptions({ font: { family: preset.family } }).font.family;
        assert.ok(normalized.endsWith(', sans-serif'), 'generic fallback must remain unquoted in generated CSS');
        assert.ok(engine.buildCss({ font: { enabled: true, family: preset.family } }).includes(normalized));
    }
    const optional = harness({ installed: ['Vazirmatn'], pick: items => items.find(item => item.label === 'Vazirmatn') });
    await optional.run('selectFont');
    assert.equal(optional.settings['font.family'], '"Vazirmatn", Tahoma, Arial, sans-serif');
    console.log('Font command tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });