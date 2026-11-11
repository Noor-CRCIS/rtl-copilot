'use strict';

// Optional browser suite: use existing Playwright via NODE_PATH and supply
// MONACO_ROOT pointing to an existing monaco-editor package. No downloads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const engine = require('./rtl-engine');

(async () => {
    const monacoRoot = process.env.MONACO_ROOT;
    assert.ok(monacoRoot, 'MONACO_ROOT is required (existing monaco-editor package)');
    const server = http.createServer((req, res) => {
        const file = path.resolve(monacoRoot, 'min', '.' + req.url);
        if (!file.startsWith(path.resolve(monacoRoot, 'min') + path.sep)) { res.writeHead(403).end(); return; }
        fs.readFile(file, (error, data) => {
            if (error) { res.writeHead(404).end(); return; }
            res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
            res.end(data);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true });
    try {
        for (const mode of ['auto', 'forceRtl']) for (const enabled of [false, true]) {
            const page = await browser.newPage();
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            await page.setContent(`<style>body{font:13px Arial;direction:ltr}.rendered-markdown{width:700px}.interactive-result-editor{width:600px;height:120px}</style>
              <div class="monaco-workbench"><div class="chat-output-container"><div class="rendered-markdown" id="markdown">
                <p id="prose">متن فارسی برای آزمایش</p>
                <blockquote id="quote"><p>متن فارسی</p><div class="code" data-code="1" id="code"><div class="interactive-result-code-block"><div id="header">Native header</div><div class="interactive-result-editor" id="editor"></div></div></div></blockquote>
                <ul id="list"><li id="item">متن فارسی<div data-code="2">Native placeholder</div></li></ul>
                <table id="table"><tr><td id="cell">متن فارسی<div data-code="3">Native placeholder</div></td></tr></table>
                <blockquote id="stream">متن فارسی</blockquote>
              </div></div></div>`);
            await page.addScriptTag({ url: `${base}/vs/loader.js` });
            await page.evaluate(base => new Promise(resolve => {
                require.config({ paths: { vs: `${base}/vs` } });
                require(['vs/editor/editor.main'], () => {
                    window.editor = monaco.editor.create(document.getElementById('editor'), {
                        value: '', language: 'plaintext', fontSize: 14, lineHeight: 20,
                        minimap: { enabled: false }, automaticLayout: false,
                    });
                    resolve();
                });
            }), base);
            const metrics = () => page.evaluate(() => Object.fromEntries(
                ['markdown', 'quote', 'code', 'header', 'editor', 'list', 'item', 'table', 'cell'].map(id => {
                    const e = document.getElementById(id), s = getComputedStyle(e);
                    return [id, { font: s.fontFamily, size: s.fontSize, line: s.lineHeight, direction: s.direction,
                        width: e.getBoundingClientRect().width, padding: s.paddingInlineStart }];
                })));
            const before = await metrics();
            // Demonstrate the old exclusion fallacy independently of Monaco's
            // explicit line font: host/header metrics inherit through exclusions.
            const legacy = await page.addStyleTag({ content: '.rendered-markdown{font:28px/2 serif!important}' });
            assert.equal((await metrics()).header.size, '28px');
            await legacy.evaluate(e => e.remove());
            const options = { mode, font: { enabled, family: 'serif', size: 28, lineHeight: 2 },
                customSelectors: ['.rendered-markdown', '.chat-output-container', 'blockquote', 'p'] };
            await page.addStyleTag({ content: engine.buildCss(options) });
            await page.addScriptTag({ content: engine.buildRuntime(options) });
            // Actual Monaco must not receive even an empty decoration collection.
            const registrations = await page.evaluate(() => {
                let count = 0;
                const original = editor.createDecorationsCollection;
                editor.createDecorationsCollection = function(...args) { count++; return original.apply(this, args); };
                __rtlCopilotRegisterEditor(editor);
                return count;
            });
            assert.equal(registrations, 0);
            assert.deepEqual(await metrics(), before, `${mode}/${enabled}: native ancestors retain metrics`);
            if (enabled) assert.equal(await page.locator('#prose').evaluate(e => getComputedStyle(e).fontSize), '28px');
            await page.evaluate(() => {
                document.getElementById('stream').insertAdjacentHTML('beforeend', '<div data-code="late"><div class="interactive-result-editor">Late code</div></div>');
                editor.setValue('const visible = 42;\n// متن فارسی');
                editor.layout({ width: 600, height: 120 });
                editor.render(true);
            });
            await page.waitForFunction(() => !document.getElementById('stream').hasAttribute('data-rtlc-content-sig'));
            assert.equal(await page.locator('#stream').getAttribute('style'), null);
            assert.equal(await page.locator('#stream').getAttribute('data-rtlc-font'), null);
            await page.waitForFunction(() => document.querySelector('#editor .view-lines').textContent.includes('visible'));
            const layout = await page.evaluate(() => ({ info: editor.getLayoutInfo(), height: editor.getContentHeight(),
                lineHeight: document.querySelector('#editor .view-line').getBoundingClientRect().height,
                decorations: editor.getModel().getAllDecorations().filter(d => /persian-rtl/.test(d.options.description || '')).length }));
            assert.ok(layout.info.contentWidth > 0 && layout.height > 0);
            assert.equal(layout.lineHeight, 20);
            assert.equal(layout.decorations, 0);
            // Same-node streaming, then detach/remount without replacing model.
            await page.evaluate(() => {
                editor.getModel().applyEdits([{ range: new monaco.Range(2, 1, 2, 1), text: '// streamed\n' }]);
                const code = document.getElementById('code'), parent = code.parentElement;
                code.remove(); parent.append(code); editor.render(true);
            });
            await page.waitForFunction(() => document.querySelector('#editor .view-lines').textContent.includes('streamed'));
            assert.deepEqual(await metrics(), before);
            assert.deepEqual(errors, []);
            await page.close();
        }
        console.log('Code isolation passed: real Monaco, 4 mode/font combinations, inheritance, native metrics, empty-to-populated, streaming and remount.');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });