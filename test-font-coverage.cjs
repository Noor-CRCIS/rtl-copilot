'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('./rtl-engine');

assert.equal(engine.VERSION, '3.1.4');
const font = { enabled: true, family: '"Vazirmatn", \'Noto Sans Arabic\'', size: 18, lineHeight: 1.8 };
assert.equal(engine.normalizeOptions({ font }).font.family, '"Vazirmatn", "Noto Sans Arabic"');
for (const family of ['Arial; color:red', 'Arial}body{display:none}', '</style><script>x</script>', 'url(evil)', 'Arial\\22', 'Arial,,serif', '"unterminated', 'Arial,']) {
    assert.equal(engine.normalizeOptions({ font: { family } }).font.family, '', family);
    assert.ok(!engine.buildCss({ font: { family } }).includes('font-family:'), family);
}
assert.ok(!engine.buildCss().includes('font-family:'));
assert.ok(!engine.buildCss({ font: { ...font, enabled: false } }).includes('font-family:'));
const css = engine.buildCss({ font });
const typography = css.split('/* RTL-COPILOT font:')[1].split('/* RTL-COPILOT: lists')[0];
for (const selector of ['.rendered-markdown ul', '.rendered-markdown ol', '.rendered-markdown table', '.markdown-body table']) {
    assert.ok(typography.includes(selector), `missing ${selector}`);
    assert.ok(typography.split('\n').some(line => line.includes(selector) && line.includes(' *:not(:is(')), `missing nested coverage for ${selector}`);
}
for (const excluded of ['pre,code', '.monaco-editor', '.monaco-diff-editor', '.katex', 'math', '.codicon', '.xterm', '.terminal-outer-container']) {
    assert.ok(typography.includes(excluded), `missing exclusion ${excluded}`);
}
// :has() selectors re-match the whole workbench DOM on every mutation and
// froze the chat renderer; typography must stay inheritance-based and small.
assert.ok(!typography.includes(':has('), 'typography rules must not use :has()');
assert.ok(typography.length < 70000, `font CSS too large: ${typography.length} bytes`);
assert.ok(typography.includes('font-family:var(--vscode-editor-font-family,monospace)'));
const codeRestoreSelectors = typography.split('\n').filter(line => line.includes(' :is(pre,code)'));
assert.ok(codeRestoreSelectors.length > 0);
for (const selector of codeRestoreSelectors) {
    assert.ok(selector.includes(':not(:is('), 'protected descendants inside code wrappers must keep native typography');
}
const zeroCss = engine.buildCss({ font: { family: 'Vazirmatn', size: 0, lineHeight: 0 } });
assert.ok(!zeroCss.includes('font-size:0'));
assert.ok(!zeroCss.includes('line-height:0'));
const disabledAreas = Object.fromEntries(Object.keys(engine.AREA_DEFINITIONS).map(key => [key, false]));
assert.ok(!engine.buildCss({ areas: disabledAreas, font }).includes('font-family:'));
assert.ok(!engine.buildCss({ areas: { ...disabledAreas, editorsCode: true, terminal: true }, font }).includes('font-family:'));

const source = fs.readFileSync(path.join(__dirname, 'media/rtl-markdown-preview.js'), 'utf8');
let config = { enabled: true, font };
const attributes = new Map();
const root = {
    style: {},
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    querySelectorAll() { return []; },
};
let update;
vm.runInNewContext(source, {
    document: {
        querySelector() { return root; },
        getElementById() { return { dataset: { config: encodeURIComponent(JSON.stringify(config)) } }; },
    },
    window: { addEventListener(event, callback) { update = callback; } },
});
assert.equal(root.style.fontFamily, '"Vazirmatn", "Noto Sans Arabic"');
assert.equal(root.style.fontSize, '18px');
assert.equal(root.style.lineHeight, '1.8');
assert.equal(attributes.get('data-rtlc-preview-font'), 'true');
config.font = { family: 'Arial; color:red', size: 0, lineHeight: 0 };
update();
assert.equal(root.style.fontFamily, '');
assert.equal(root.style.fontSize, '');
assert.equal(root.style.lineHeight, '');
assert.ok(!attributes.has('data-rtlc-preview-font'));
for (const next of [{ enabled: true }, { enabled: true, font: { ...font, enabled: false } }, { enabled: false, font }]) {
    config = next;
    update();
    assert.equal(root.style.fontFamily, '');
    assert.equal(root.style.fontSize, '');
    assert.equal(root.style.lineHeight, '');
}
const previewCss = fs.readFileSync(path.join(__dirname, 'media/rtl-markdown-preview.css'), 'utf8');
for (const property of ['font-family', 'font-size', 'line-height']) {
    assert.ok(previewCss.includes(`${property}: var(--vscode-editor-${property}`));
}
assert.ok(previewCss.includes(':is(pre, code, .vscode-code-block) *'));
console.log('Font coverage tests passed (safe CSS, nested lists/tables, exclusions, defaults, preview application/reset).');