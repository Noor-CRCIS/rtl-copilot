'use strict';

// Optional real-browser regression: NODE_PATH may point to an external
// Playwright installation. No extension dependency or build is required.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const engine = require('./rtl-engine');

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const mode of ['auto', 'forceRtl']) {
            for (const enabled of [false, true]) {
                const page = await browser.newPage();
                await page.setContent(`<style>
                    body { font: 13px Arial; --vscode-font-family: Arial; --vscode-font-size: 13px; }
                    .monaco-action-bar .actions-container { display:flex; padding:0; margin:0; list-style:none; }
                    .action-item { margin:0 4px; padding:0; }
                    .monaco-button { display:flex; padding:4px 12px; margin:2px 3px; font-size:13px; line-height:normal; }
                    .notification-list-item-buttons-container { display:flex; direction:ltr; }
                </style><div class="monaco-workbench"><div class="notifications-list-container">
                  <div class="monaco-list-row"><div class="notification-list-item">
                    <div class="notification-list-item-message">&#1605;&#1578;&#1606; &#1601;&#1575;&#1585;&#1587;&#1740;</div>
                    <div class="notification-list-item-buttons-container"><a id="native" class="monaco-button">OK</a></div>
                    <div class="rendered-markdown">
                      <p id="prose">&#1605;&#1578;&#1606; &#1601;&#1575;&#1585;&#1587;&#1740;</p>
                      <ul id="prose-list"><li>Item</li></ul>
                      <div class="monaco-toolbar" role="toolbar"><div class="monaco-action-bar">
                        <ul id="actions" class="actions-container" role="list"><li id="item" class="action-item">
                          <a id="button" class="monaco-button" role="button"><span id="label">OK</span></a>
                          <p id="action-prose">Action label</p><table id="action-table"><tr><td>Cell</td></tr></table>
                        </li></ul>
                      </div></div>
                    </div>
                  </div></div>
                </div></div>`);
                const snapshot = () => page.evaluate(() => {
                    const props = ['paddingLeft','paddingRight','paddingTop','paddingBottom','marginLeft','marginRight','marginTop','marginBottom','direction','textAlign','display','flexDirection','fontSize','lineHeight'];
                    return Object.fromEntries(['native','actions','item','button','label','action-prose','action-table'].map(id => {
                        const el = document.getElementById(id), css = getComputedStyle(el);
                        return [id, { styles: Object.fromEntries(props.map(p => [p, css[p]])), inline: el.getAttribute('style'), dir: el.getAttribute('dir') }];
                    }));
                });
                const before = await snapshot();
                const options = { mode, observe: true, font: { enabled, family: 'serif', size: 24, lineHeight: 2 }, customSelectors: ['.action-item', '[role="list"]', '.monaco-toolbar p'] };
                await page.addStyleTag({ content: engine.buildCss(options) });
                await page.addScriptTag({ content: engine.buildRuntime(options) });
                assert.deepEqual(await snapshot(), before, `${mode}, font=${enabled}: action spacing and layout stay native`);
                await page.locator('#label').evaluate(el => { el.textContent = 'Longer action label'; });
                await page.waitForTimeout(1700); // Covers debounce, observer and final runtime pass.
                assert.deepEqual(await snapshot(), before, 'streamed action labels must not acquire prose styles');
                assert.equal(await page.locator('#prose').getAttribute('dir'), 'rtl');
                assert.equal(await page.locator('#prose-list').evaluate(el => el.style.paddingInlineStart), '1.6em');
                await page.close();
            }
        }
        console.log('Action spacing computed-style regressions passed (Chromium, both modes, font on/off, mutations).');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });