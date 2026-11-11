'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('./rtl-engine');

assert.equal(engine.VERSION, '3.1.9');
const font = { enabled: true, family: '"Vazirmatn", \'Noto Sans Arabic\'', size: 18, lineHeight: 1.8 };
assert.equal(engine.normalizeOptions({ font }).font.family, '"Vazirmatn", "Noto Sans Arabic"');
for (const family of ['Arial; color:red', 'Arial}body{display:none}', '</style><script>x</script>', 'url(evil)', 'Arial\\22', 'Arial,,serif', '"unterminated', 'Arial,']) {
    assert.equal(engine.normalizeOptions({ font: { family } }).font.family, '', family);
    assert.ok(!engine.buildCss({ font: { family } }).includes('font-family:'), family);
}
assert.ok(!engine.buildCss().includes('font-family:'));
assert.ok(!engine.buildCss({ font: { ...font, enabled: false } }).includes('font-family:'));
const css = engine.buildCss({ font });
const buttonRoots = 'button,[role="button"],input[type="button"],input[type="submit"],input[type="reset"],.monaco-button';
// Check actual generated selectors, not just the presence of button names:
// both custom typography and code restoration must exclude roots AND children.
const fontRules = [...css.matchAll(/([^{}]+)\{([^{}]*font-family:[^{}]*)\}/g)];
assert.equal(fontRules.length, 1);
assert.match(fontRules[0][1], /\[data-rtlc-font\]$/);
assert.ok(!css.includes(':has('));
assert.ok(css.length < 15000);
// Computed inheritance and streaming eligibility are exercised with real
// Chromium/Monaco in test-code-isolation.cjs, not selector-string exclusions.
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
const previewButtons = buttonRoots.replace(',.monaco-button', '').replaceAll(',', ', ');
const previewCodeSelectors = previewCss.slice(0, previewCss.indexOf('{'));
assert.equal(previewCodeSelectors.split(`:is(${previewButtons}) *))`).length - 1, 2,
    'preview code restoration excludes button roots and descendants in both selectors');
assert.ok(previewCss.includes(`:where([data-rtlc-preview-font] :is(${previewButtons}))`));
assert.match(previewCss, /font-family: var\(--vscode-font-family, system-ui\);/);
assert.match(previewCss, /font-size: var\(--vscode-font-size, 13px\);/);
console.log('Font coverage tests passed (safe CSS, nested lists/tables, exclusions, defaults, preview application/reset).');