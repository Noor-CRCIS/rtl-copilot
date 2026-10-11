'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const engine = require('./rtl-engine');

function runtime(options = {}) {
    const timers = new Map();
    let id = 0;
    const context = {
        document: { readyState: 'loading', addEventListener() {} },
        setTimeout(callback) { timers.set(++id, callback); return id; },
        clearTimeout(key) { timers.delete(key); },
        queueMicrotask(callback) { callback(); },
    };
    vm.createContext(context);
    vm.runInContext(engine.buildRuntime(options).replace('function init(){',
        'globalThis.__test={isRtlCommentLine,processInputs,enabledInput};\nfunction init(){'), context);
    return { context, flush() { const batch = [...timers.values()]; timers.clear(); batch.forEach(fn => fn()); }, timers };
}

// Use actual Monaco token offsets and StandardTokenType values, not comment markers.
function modelFixture(lines) {
    const listeners = new Set();
    let accurate = true;
    return {
        lines,
        getLineCount() { return this.lines.length; },
        getLineContent(line) { return this.lines[line - 1].map(part => part[0]).join(''); },
        getLineMaxColumn(line) { return this.getLineContent(line).length + 1; },
        tokenization: {
            hasAccurateTokensForLine() { return accurate; },
            tokenizeIfCheap() {},
            getLineTokens(line) {
                const parts = lines[line - 1];
                const start = i => parts.slice(0, i).reduce((n, p) => n + p[0].length, 0);
                return { getCount: () => parts.length, getStartOffset: start,
                    getEndOffset: i => start(i) + parts[i][0].length, getStandardTokenType: i => parts[i][1] };
            },
        },
        onDidChangeTokens(callback) { listeners.add(callback); return { dispose() { listeners.delete(callback); } }; },
        setAccurate(value) { accurate = value; listeners.forEach(fn => fn({})); },
        listeners,
    };
}
const lines = [
    [['// توضیح فارسی', 1]],
    [['const n = 1; ', 0], ['// توضیح فارسی', 1]],
    [['"// متن فارسی در رشته"', 2]],
    [['  ', 0], ['/* توضیح ', 1], ['فارسی */', 1]],
    [['// English only', 1]],
    [['# فارسی', 0]], // unknown/plaintext must not be guessed
    [[' * ادامهٔ کامنت فارسی', 1]],
    [['// ۱۲۳ ؟', 1]],
    [['<!-- فارسی -->', 1]],
];
const model = modelFixture(lines);
const r = runtime();
assert.equal(engine.normalizeOptions().areas.editorComments, true);
for (const [i, expected] of [true, false, false, true, false, false, true, false, true].entries()) {
    assert.equal(r.context.__test.isRtlCommentLine(model, i + 1), expected, 'line ' + (i + 1));
}
model.setAccurate(false);
assert.equal(r.context.__test.isRtlCommentLine(model, 1), false);
model.setAccurate(true);
assert.equal(r.context.__test.isRtlCommentLine({ getLineContent: () => '// فارسی' }, 1), false);

function editorFixture(currentModel) {
    const events = new Map();
    const collections = [];
    let visible = [{ startLineNumber: 1, endLineNumber: 3 }];
    const dom = { closest() { return null; } };
    const editor = {
        getContainerDomNode: () => dom, getModel: () => currentModel,
        getVisibleRanges: () => visible,
        createDecorationsCollection() {
            const c = { values: [], writes: 0, set(value) { this.values = value; this.writes++; }, clear() { this.values = []; this.writes++; } };
            collections.push(c); return c;
        },
    };
    for (const name of ['FocusEditorText', 'BlurEditorText', 'ChangeModelContent', 'ChangeModel', 'Dispose', 'ScrollChange', 'LayoutChange']) {
        events.set(name, new Set());
        editor['onDid' + name] = callback => { events.get(name).add(callback); return { dispose: () => events.get(name).delete(callback) }; };
    }
    const emit = name => [...events.get(name)].forEach(callback => callback({ changes: [] }));
    return { editor, collections, emit, setModel(m) { currentModel = m; emit('ChangeModel'); }, scroll(ranges) { visible = ranges; emit('ScrollChange'); } };
}
const f = editorFixture(model);
r.context.__rtlCopilotRegisterEditor(f.editor);
r.flush();
assert.equal(f.collections[0].writes, 0, 'no whole-file direction decorations');
assert.equal(f.collections.length, 2);
assert.deepEqual(Array.from(f.collections[1].values, d => d.range.startLineNumber), [1, 4, 7]);
const initialWrites = f.collections[1].writes;
f.emit('ChangeModelContent'); r.flush();
assert.equal(f.collections[1].writes, initialWrites, 'unchanged comments do not rebuild decoration');
lines[0] = [['"فارسی"', 2]];
f.emit('ChangeModelContent'); r.flush();
assert.ok(!f.collections[1].values.some(d => d.range.startLineNumber === 1), 'comment turned string removes RTL');
model.setAccurate(false); r.flush();
assert.equal(f.collections[1].values.length, 0, 'stale token data never forces RTL');
model.setAccurate(true); r.flush();
assert.ok(f.collections[1].values.length > 0, 'late tokenization restores genuine comment direction');
f.scroll([{ startLineNumber: 9, endLineNumber: 9 }]); r.flush();
assert.ok(f.collections[1].values.some(d => d.range.startLineNumber === 9));
f.setModel(modelFixture([[['let x = "فارسی";', 0]]])); r.flush();
assert.equal(model.listeners.size, 0, 'old token listener disposed');
assert.equal(f.collections[1].values.length, 0);
f.emit('Dispose'); r.flush();
assert.equal(f.collections[1].values.length, 0);

const off = runtime({ areas: { editorComments: false, editorsCode: false, inputs: false } });
const unregistered = editorFixture(model);
off.context.__rtlCopilotRegisterEditor(unregistered.editor);
assert.equal(unregistered.collections.length, 0, 'editor features can all be disabled');

function inputFixture(zone, value, find = false) {
    const attrs = new Map();
    return {
        value, nodeType: 1, style: {},
        getAttribute(name) { return attrs.get(name) || null; },
        setAttribute(name, data) { attrs.set(name, data); },
        matches(selector) { return selector.startsWith('input') || selector.startsWith('.monaco-workbench input'); },
        closest(selector) {
            if (find && selector === '.monaco-editor') return this;
            if (selector === '.monaco-editor,.interactive-input-editor') return find ? this : null;
            if (selector === '.chat-input-part,.interactive-input-part,.comment-input') return zone === 'prompt' ? this : null;
            if (selector === '.search-view,.search-widget,.find-widget,.simple-find-part') return zone === 'search' ? this : null;
            if (selector === '.settings-editor') return zone === 'settings' ? this : null;
            if (selector === '.quick-input-widget') return zone === 'quickPick' ? this : null;
            if (selector === '.find-widget,.simple-find-part') return find ? this : null;
            if (selector === '.monaco-editor,.monaco-diff-editor,.notebook-editor') return find ? this : null;
            return null;
        },
    };
}
const configs = { prompt: 'promptInputs', search: 'searchInputs', settings: 'settingsInputs', quickPick: 'quickPickInputs', other: 'otherInputs' };
for (const [zone, setting] of Object.entries(configs)) {
    const input = inputFixture(zone, 'جستجوی فارسی');
    const enabled = runtime();
    enabled.context.__test.processInputs(input); enabled.flush();
    assert.equal(input.getAttribute('dir'), 'rtl', zone);
    input.value = 'English search';
    enabled.context.__test.processInputs(input); enabled.flush();
    assert.equal(input.getAttribute('dir'), 'ltr', zone);
    input.value = '';
    enabled.context.__test.processInputs(input); enabled.flush();
    assert.equal(input.getAttribute('dir'), 'ltr', 'empty ' + zone);
    const disabled = inputFixture(zone, 'جستجوی فارسی');
    runtime({ areas: { [setting]: false } }).context.__test.processInputs(disabled);
    assert.equal(disabled.getAttribute('dir'), null, 'disabled ' + zone);
}
const find = inputFixture('search', 'پیدا کن', true);
r.context.__test.processInputs(find); r.flush();
assert.equal(find.getAttribute('dir'), 'rtl', 'Monaco Find reads input value, not code');
const manifest = JSON.parse(fs.readFileSync(require.resolve('./package.json'), 'utf8'));
for (const key of Object.keys(engine.AREA_DEFINITIONS)) {
    assert.equal(manifest.contributes.configuration.properties['rtlCopilot.areas.' + key]?.type, 'boolean', 'setting for ' + key);
}
console.log('COMMENT_AND_INPUT_AREA_TESTS_OK');