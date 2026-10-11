'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildRuntime, normalizeOptions } = require('./rtl-engine');

function harness({ prompt = false, autoEditorDirection = false, autoInputDirection, areas = {}, initialLines = ['متن فارسی'] } = {}) {
    const microtasks = [];
    const timers = new Map();
    let timerId = 0;
    const writes = [];
    const events = {};
    let lines = initialLines;
    let model = makeModel();
    function makeModel() {
        return {
            getLineCount: () => lines.length,
            getLineContent: line => lines[line - 1],
            getLineMaxColumn: line => lines[line - 1].length + 1,
        };
    }
    const dom = { closest: selector => prompt && selector === '.chat-input-part,.interactive-input-part' ? dom : null };
    const editor = {
        getContainerDomNode: () => dom,
        getModel: () => model,
        getPosition: () => ({ lineNumber: 1, column: 1 }),
        hasTextFocus: () => true,
        createDecorationsCollection: () => ({ set: value => writes.push(value), clear: () => writes.push([]) }),
    };
    for (const event of ['FocusEditorText', 'BlurEditorText', 'ChangeModelContent', 'ChangeModel', 'Dispose']) {
        editor[`onDid${event}`] = callback => { events[event] = callback; return { dispose() {} }; };
    }
    const context = {
        document: { readyState: 'loading', addEventListener() {} },
        setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
        clearTimeout: id => timers.delete(id),
        queueMicrotask: callback => microtasks.push(callback),
        Promise: { resolve: () => ({ then: callback => microtasks.push(callback) }) },
    };
    vm.createContext(context);
    const source = buildRuntime({ autoEditorDirection, autoInputDirection, areas: { editorsCode: true, editorComments: false, ...areas } });
    vm.runInContext(source.replace('function init(){', 'globalThis.__test={manualDirection:manualDirection,schedule:schedule};\nfunction init(){'), context);
    function drain() { while (microtasks.length) microtasks.shift()(); }
    context.__rtlCopilotRegisterEditor(editor);
    drain();
    events.FocusEditorText?.();
    return {
        writes, timers, context, microtasks, events, drain,
        change(value, flush = false) {
            lines = value;
            events.ChangeModelContent?.({ changes: [], isFlush: flush });
            drain();
        },
        switchModel(value) { lines = value; model = makeModel(); events.ChangeModel?.(); drain(); },
        key(code, ctrlKey = true) {
            let prevented = false;
            context.__test.manualDirection({ code, key: 'Shift', ctrlKey, shiftKey: true, altKey: false, metaKey: false,
                target: dom, preventDefault() { prevented = true; }, stopPropagation() {} });
            drain();
            return prevented;
        },
    };
}

assert.equal(normalizeOptions().autoEditorDirection, false);
assert.equal(normalizeOptions({ autoEditorDirection: true }).autoEditorDirection, true);
assert.equal(normalizeOptions({ autoEditorDirection: 'true' }).autoEditorDirection, false);
assert.equal(normalizeOptions().autoInputDirection, true);
assert.equal(normalizeOptions({ autoInputDirection: false }).autoInputDirection, false);
for (const prompt of [false, true]) {
    const h = harness({ prompt, autoInputDirection: false });
    assert.equal(h.writes.length, 0, 'opening Persian content must not impose a direction');
    for (const value of ['English', 'متن فارسی', '', 'English و فارسی']) h.change([value]);
    assert.equal(h.writes.length, 0, 'generation must not create direction decorations');
    assert.equal(h.timers.size, 0, 'manual mode must not schedule automatic direction timers');
    assert.equal(h.key('ShiftRight', false), false, 'plain Shift must remain available for typing and selection');
    assert.equal(h.writes.length, 0);
    h.change(['']);
    assert.equal(h.key('ShiftRight'), true);
    assert.equal(h.writes.at(-1)[0].options.textDirection, 1, 'right Ctrl+Shift works on an empty line');
    const count = h.writes.length;
    h.change(['English streamed content']);
    h.change(['فارسی ادامه متن']);
    assert.equal(h.writes.length, count, 'typing must not rebuild an unchanged manual direction');
    assert.equal(h.key('ShiftLeft'), true);
    assert.equal(h.writes.at(-1)[0].options.textDirection, 0);
    h.switchModel(['فایل جدید']);
    assert.equal(h.writes.at(-1).length, 0, 'manual state must not leak to another file');
    const afterSwitch = h.writes.length;
    h.change(['Another English line']);
    assert.equal(h.writes.length, afterSwitch, 'new file must not inherit automatic direction');
    h.key('ShiftRight');
    const beforeFlush = h.writes.length;
    h.change(['Generation replaces the model contents'], true);
    assert.ok(h.writes.length >= beforeFlush, 'model flush is handled without automatic detection');
    assert.equal(h.writes.at(-1)[0].options.textDirection, 1, 'explicit direction remains manual after model flush');
    h.events.Dispose();
    h.drain();
}
for (const prompt of [false, true]) {
    const h = harness({ prompt, autoEditorDirection: true });
    assert.ok(h.writes.length > 0, 'opt-in retains the former automatic mode');
}
for (const value of ['', 'English', '۱۲۳ ٤٥٦ ، ؛ ؟', 'فارسی English']) {
    const h = harness({ autoEditorDirection: true, initialLines: [value] });
    assert.equal(h.writes.at(-1)[0].options.textDirection, 0, 'automatic editor must not start RTL: ' + value);
}
const neutralPrompt = harness({ prompt: true, autoEditorDirection: true, initialLines: ['۱۲۳ ؟'] });
assert.equal(neutralPrompt.writes.length, 0, 'neutral prompt must not be forced RTL');
const input = harness({ prompt: true, initialLines: [''] });
assert.equal(input.writes.length, 0, 'empty default prompt is untouched');
input.change(['سلام']);
assert.equal(input.writes.at(-1)[0].options.textDirection, 1, 'default prompt detects Persian');
const afterPersian = input.writes.length;
input.change(['سلام with a long English continuation']);
assert.equal(input.writes.length, afterPersian, 'mixed-language appends do not rebuild locked direction');
input.change(['']);
assert.equal(input.writes.at(-1).length, 0, 'cleared prompt releases automatic direction');
input.change(['English']);
assert.equal(input.writes.at(-1)[0].options.textDirection, 0, 'fresh English prompt is LTR');
input.key('ShiftRight');
input.change(['English continuation']);
assert.equal(input.writes.at(-1)[0].options.textDirection, 1, 'manual override wins over input auto detection');
const independent = harness({ autoInputDirection: true });
assert.equal(independent.writes.length, 0, 'automatic inputs do not enable file editor auto direction');
const manualInput = harness({ prompt: true, autoInputDirection: false, autoEditorDirection: true });
assert.equal(manualInput.writes.length, 0, 'automatic file editor does not override manual input preference');
const disabledInput = harness({ prompt: true, areas: { inputs: false } });
assert.equal(disabledInput.events.FocusEditorText, undefined, 'disabled input area wins over default auto input');
const disabled = harness({ areas: { editorsCode: false, inputs: false } });
assert.equal(disabled.writes.length, 0);
assert.equal(disabled.events.FocusEditorText, undefined, 'disabled editor area stays untouched');

const h = harness();
const newBlock = { nodeType: 1, closest: () => null };
h.context.__test.schedule(newBlock);
h.context.__test.schedule(newBlock);
assert.equal(h.microtasks.length, 1, 'new DOM blocks are batched before the next paint');
assert.equal(h.timers.size, 0, 'there is no 80ms unstyled-content timer');
console.log('MANUAL_EDITOR_DIRECTION_TESTS_OK');