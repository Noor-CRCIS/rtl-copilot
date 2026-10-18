'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('./rtl-engine');

assert.equal(engine.VERSION, '3.0.1');

const original = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'\"></head><body></body></html>';
const patched = engine.applyPatchToHtml(original);
assert.equal(engine.markerState(patched), 'valid');
assert.equal((patched.match(/RTL-COPILOT:START/g) || []).length, 1);
assert.match(patched, /<script id="rtl-copilot-runtime" src="\.\/rtl-copilot-runtime\.js"><\/script>/);
assert.doesNotMatch(patched, /<script id="rtl-copilot-runtime">/);
assert.equal(engine.applyPatchToHtml(patched), patched, 'patching twice must be idempotent');
assert.equal(engine.removePatchFromHtml(patched), original);
assert.throws(() => engine.applyPatchToHtml(`${engine.PATCH_START}<html></html>`), /malformed/);
assert.throws(() => engine.applyPatchToHtml('<main>missing closing document tag</main>'), /closing/);

const defaults = engine.normalizeOptions();
assert.equal(defaults.areas.lists, true);
assert.equal(defaults.areas.notifications, true);
assert.equal(defaults.areas.sessions, true);
assert.equal(defaults.areas.markdownPreview, true);
assert.equal(defaults.areas.explorer, true);
assert.equal(defaults.areas.search, true);
assert.equal(defaults.areas.scm, true);
assert.equal(defaults.areas.debug, true);
assert.equal(defaults.areas.extensions, true);
assert.equal(defaults.areas.settings, true);
assert.equal(defaults.areas.welcome, true);
assert.equal(defaults.areas.problems, true);
assert.equal(defaults.areas.comments, true);
assert.equal(defaults.areas.notebooks, true);
assert.equal(defaults.areas.editorsCode, false);
assert.equal(defaults.areas.terminal, false);
const disabledLists = engine.buildRuntime({ areas: { lists: false } });
assert.match(disabledLists, /"lists":\[\]/);
const runtime = engine.buildRuntime();
new vm.Script(runtime, { filename: engine.RUNTIME_NAME });
assert.match(runtime, /A\+key/);
assert.match(runtime, /'list-sig'/);
assert.match(runtime, /var DIRECTION_STATES=new WeakMap\(\)/);
assert.match(runtime, /var DIRECTION_DELAY=300/);
assert.match(runtime, /function directionState\(owner,value,apply\)/);
assert.match(runtime, /function collect\(root,selector\).*try\{/);
assert.match(runtime, /function manualState\(owner,d,apply\)/);
assert.match(runtime, /list\.setAttribute\(A\+'list-dir',d\)/);
assert.match(runtime, /'content-sig'/);
assert.match(runtime, /processLists\(base\);processTables\(base\);processInputs\(base\);processContent\(base\)/);
assert.match(runtime, /characterData:true/);
assert.match(runtime, /event\.code==='ShiftLeft'/);
assert.match(runtime, /event\.code==='ShiftRight'/);
assert.match(runtime, /event\.key==='Shift'&&event\.location===1/);
assert.match(runtime, /event\.key==='Shift'&&event\.location===2/);
assert.match(runtime, /document\.addEventListener\('keydown',manualDirection,true\)/);
assert.match(runtime, /stopPropagation\(\)/);
assert.match(runtime, /directionOwner\(input\)/);
const editorRuntime = engine.buildRuntime({ areas: { editorsCode: true } });
new vm.Script(editorRuntime, { filename: `editor-${engine.RUNTIME_NAME}` });
assert.match(editorRuntime, /"nativeEditor":true/);
assert.match(editorRuntime, /createDecorationsCollection\(\)/);
assert.match(editorRuntime, /getContainerDomNode/);
assert.match(editorRuntime, /model\.getLineCount\(\)/);
assert.match(editorRuntime, /current\.getLineContent\(line\)/);
assert.match(editorRuntime, /model\.getLineMaxColumn\(line\)/);
assert.match(editorRuntime, /directions:new Map\(\)/);
assert.match(editorRuntime, /lineLocks:new Map\(\)/);
assert.match(editorRuntime, /manualLines:new Map\(\)/);
assert.match(editorRuntime, /function rebaseLineState\(map,changes\)/);
assert.match(editorRuntime, /"promptRtl":true/);
assert.match(editorRuntime, /if\(prompt&&!CFG\.promptRtl\|\|!prompt&&!CFG\.nativeEditor\)return/);
assert.match(editorRuntime, /if\(state\.prompt\)\{rebaseLineState\(state\.lineLocks,changes\);schedulePromptNative\(editor,state\)/);
assert.match(editorRuntime, /manualLines\.set\(position\.lineNumber,d\)/);
assert.match(editorRuntime, /description:'persian-rtl-prompt-first-word-line'/);
assert.match(editorRuntime, /isWholeLine:true/);
assert.match(editorRuntime, /function schedulePromptNative\(editor,state\)/);
assert.match(editorRuntime, /Promise\.resolve\(\)\.then/);
assert.match(editorRuntime, /if\(!value\.trim\(\)\)\{state\.lineLocks\.delete\(line\);continue;\}/);
assert.match(editorRuntime, /if\(plan\.signature===state\.lastPromptSignature\)return/);
assert.match(editorRuntime, /if\(e\.isFlush\)\{state\.lineLocks\.clear\(\)/);
assert.match(editorRuntime, /\(retry\|\|0\)<3/);
assert.match(editorRuntime, /ACTIVE_NATIVE\.hasTextFocus/);
assert.match(editorRuntime, /description:'persian-rtl-majority-line'/);
assert.match(editorRuntime, /textDirection:d==='rtl'\?TEXT_DIRECTION\.RTL:TEXT_DIRECTION\.LTR/);
assert.match(editorRuntime, /globalThis\.__rtlCopilotRegisterEditor=registerEditor/);
assert.match(editorRuntime, /__rtlCopilotPendingEditors/);
assert.match(editorRuntime, /document\.addEventListener\('keyup',manualDirectionUp,true\)/);
assert.match(runtime, /isPromptEditor\(e\)/);
assert.match(runtime, /function manualState\(owner,d,apply\)/);
assert.match(runtime, /paragraphDirection\(value\)/);
assert.match(runtime, /function paragraphDirection\(s\)/);
assert.match(runtime, /return rtlWords>latinWords\?'rtl':'ltr'/);
assert.match(runtime, /split\(\/\\s\+\/\)/);
const runtimeContext = {
    globalThis: null,
    document: { readyState: 'loading', addEventListener() {}, querySelectorAll() { return []; }, activeElement: null },
    MutationObserver: function MutationObserver() { this.observe = () => {}; },
    setTimeout: () => 1,
    clearTimeout() {},
    Set,
    WeakMap,
    Math,
    Array,
    RegExp,
};
runtimeContext.globalThis = runtimeContext;
vm.createContext(runtimeContext);
vm.runInContext(runtime, runtimeContext);
for (const [value, expected] of [
    ['english فارسی text', 'ltr'],
    ['english فارسی', 'ltr'],
    ['فارسی english text', 'ltr'],
    ['فارسی english متن', 'rtl'],
    ['✅ 123 فارسی text', 'ltr'],
    ['... English فارسی', 'ltr'],
    ['123 !!!', 'ltr'],
    ['۱۲۳ ٤٥٦ ، ؛ ؟', 'ltr'],
    ['', 'ltr'],
    ['   ', 'ltr'],
    ['https://example.com فارسی', 'ltr'],
    ['README.md فارسی', 'ltr'],
    ['فارسی Python', 'ltr'],
    ['فارسی. This is a much longer English sentence. دوباره فارسی', 'ltr'],
    ['English. این جملهٔ فارسی بسیار بلندتر است. Then English', 'rtl'],
    ['(فارسی) English!', 'ltr'],
    ['(English) فارسی؟', 'ltr'],
    ['contact@example.com README.md فارسی', 'ltr'],
]) {
    assert.equal(runtimeContext.__rtlCopilotParagraphDirection(value), expected, value);
}
assert.doesNotMatch(runtime, /function isolateInline\(/, 'streamed Markdown inline nodes must not be rewritten');
assert.doesNotMatch(runtime, /\[data-rtlc-inline\]/, 'inline bidi styling should not force reflow during streaming');
vm.runInContext(runtime.replace('globalThis.__rtlCopilotParagraphDirection=paragraphDirection;', 'globalThis.__rtlCopilotParagraphDirection=paragraphDirection;globalThis.__rtlCopilotStable=directionState;globalThis.__rtlCopilotManual=manualState;globalThis.__rtlCopilotApplyList=applyListDir;'), runtimeContext);
const scheduled = new Map();
let nextTimer = 0;
runtimeContext.setTimeout = callback => { scheduled.set(++nextTimer, callback); return nextTimer; };
runtimeContext.clearTimeout = id => scheduled.delete(id);
const stable = runtimeContext.__rtlCopilotStable;
const owner = {};
let applied = '';
const apply = direction => { applied = direction; };
stable(owner, 'متن فارسی', apply);
assert.equal(applied, 'rtl', 'majority RTL applied immediately');
const before = applied;
stable(owner, 'متن فارسی در حال تولید', apply);
assert.equal(applied, before, 'streaming appends are debounced and not reapplied immediately');
for (const callback of [...scheduled.values()]) callback();
scheduled.clear();
assert.equal(applied, 'rtl', 'settled recompute keeps stable RTL');
let listWrites = 0;
const listStyles = { listStylePosition: '', paddingInlineStart: '', paddingInlineEnd: '' };
const listAttrs = new Map();
const list = {
    children: [],
    getAttribute(name) { return listAttrs.get(name) || null; },
    setAttribute(name, value) { listWrites++; listAttrs.set(name, value); },
    style: new Proxy(listStyles, { set(target, key, value) { listWrites++; target[key] = value; return true; } }),
};
runtimeContext.__rtlCopilotApplyList(list, 'rtl');
const firstListWrites = listWrites;
runtimeContext.__rtlCopilotApplyList(list, 'rtl');
assert.equal(listWrites, firstListWrites, 'unchanged streaming list must not rewrite direction and layout');
const manualOwner = {};
runtimeContext.__rtlCopilotManual(manualOwner, 'rtl', apply);
stable(manualOwner, 'English text with many english words', apply);
assert.equal(applied, 'rtl', 'manual override always wins');
const directoryTree = `mteb/ ← نسخه سفارشی
├── mteb/ ← کد منبع
│   ├── abstasks/ ← پایه تسکها
│   └── tasks/
│       ├── retrieval/fas/
│       └── clustering/fas/
└── tests/`;
assert.equal(runtimeContext.__rtlCopilotIsDirectoryTree(directoryTree), true);
assert.equal(runtimeContext.__rtlCopilotIsDirectoryTree('├── src/ └── tests/ توضیح فارسی'), true, 'collapsed tree must remain LTR');
assert.equal(runtimeContext.__rtlCopilotIsDirectoryTree('این یک متن فارسی معمولی است'), false);
assert.equal(runtimeContext.__rtlCopilotIsDirectoryTree('- آیتم اول\n- آیتم دوم'), false);
assert.match(runtime, /setAttribute\(A\+'directory-tree','1'\)/);
assert.match(runtime, /e\.style\.unicodeBidi='isolate'/);
assert.match(runtime, /e\.style\.whiteSpace='pre-wrap'/);
assert.match(runtime, /isMonacoInput\(input\)/);
assert.match(runtime, /function setInputDir\(input,d,force\)\{if\(isMonacoInput\(input\)\)\{setMonacoPromptDir\(input,d\);return;\}/);
assert.match(runtime, /setMonacoPromptDir/);
assert.match(runtime, /data-rtlc-prompt-dir/);
assert.match(runtime, /function firstWordDirection\(s\)/);
assert.match(runtime, /function firstWordDirection\(s\).*split\(\/\\s\+\//);
assert.match(runtime, /closest\('\.monaco-editor'\)/);
assert.match(runtime, /\.chat-input-part \.monaco-editor/);
assert.match(runtime, /\.chat-request-text/);
assert.match(runtime, /\.sessions-list-control \.session-title/);
assert.match(runtime, /\.agent-sessions-viewer \.agent-session-title/);
assert.match(runtime, /root\.closest\(selector\)/);
assert.match(runtime, /notification-list-item-buttons-container/);
assert.match(runtime, /monaco-dialog-box \.dialog-message-text/);
assert.match(runtime, /monaco-dialog-box > \.dialog-buttons-row/);
assert.match(runtime, /notification-list-item-buttons-container \.monaco-button\.monaco-text-button:not\(\.monaco-dropdown-button\)/);
for (const selector of [
    '.explorer-viewlet .explorer-item .label-name',
    '.search-view .message',
    '.scm-view .monaco-highlighted-label',
    '.debug-call-stack .stack-frame .label',
    '.extensions-viewlet .extension-list-item .description',
    '.settings-editor .setting-item-description',
    '.gettingStartedContainer .category-title',
    '.markers-panel .marker-message',
    '.review-widget .author',
    '.notebookOverlay .notebook-editor-label',
]) assert.match(runtime, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(engine.buildCss(), /list-style-position:outside/);
assert.match(engine.buildCss(), /notification-list-item-buttons-container.*direction:ltr!important/s);
assert.match(engine.buildCss(), /monaco-dialog-box \.dialog-buttons>\.monaco-button\[data-rtlc-content-sig="rtl"\]/);
assert.match(engine.buildCss(), /notification-list-item-message\[data-rtlc-content-sig="rtl"\].*text-align:right!important/s);
assert.match(engine.buildCss(), /notification-list-item-message\[data-rtlc-content-sig="ltr"\].*text-align:left!important/s);
assert.match(engine.buildCss(), /notification-list-item-message\[data-rtlc-content-sig="rtl"\]>span/);
const noNotificationsCss = engine.buildCss({ areas: { notifications: false } });
assert.doesNotMatch(noNotificationsCss, /notification-list-item-buttons-container/);
assert.doesNotMatch(noNotificationsCss, /monaco-dialog-box \.dialog-buttons-row/);
assert.match(engine.buildCss(), /:is\(h1,h2,h3,h4,h5,h6\)/);
assert.match(engine.buildCss(), /\.session-title\[data-rtlc-content-sig="rtl"\]/);
assert.match(engine.buildCss(), /\.agent-session-title\[data-rtlc-content-sig="rtl"\]/);
assert.doesNotMatch(engine.buildCss(), /\.monaco-list-row\{direction:ltr/);
assert.doesNotMatch(engine.buildCss(), /interactive-input-editor\[data-rtlc-prompt-dir="rtl"\] \.view-line/);
assert.doesNotMatch(engine.buildCss(), /--rtlc-prompt-cursor-right/);
assert.doesNotMatch(engine.buildCss(), /data-rtlc-prompt-dir="rtl"\] \.cursor/);
assert.doesNotMatch(engine.buildCss(), /\.view-line > span\{display:block;min-width:100%/);
assert.doesNotMatch(runtime, /applyDir\(editor,d,'input-sig'/);
assert.doesNotMatch(runtime, /querySelectorAll\('\.view-line'\)/);
assert.doesNotMatch(runtime, /inputArea\.style\.direction/);
assert.doesNotMatch(runtime, /if\(!target\|\|isMonacoInput\(target\)\)return false/);
assert.match(runtime, /host\.setAttribute\(A\+'prompt-dir',d\)/);
assert.match(runtime, /directionState\(e,value/);
assert.doesNotMatch(engine.buildCss(), /rendered-markdown > \*/);
assert.doesNotMatch(engine.buildCss(), /direction:auto!important/);
const allAreasOff = Object.fromEntries(Object.keys(engine.AREA_DEFINITIONS).map(name => [name, false]));
const allAreasOffCss = engine.buildCss({ areas: allAreasOff });
assert.doesNotMatch(allAreasOffCss, /code-component__code/);
assert.doesNotMatch(allAreasOffCss, /\.monaco-workbench pre/);
const chatOffRuntime = engine.buildRuntime({ areas: { chat: false, markdown: true } });
assert.doesNotMatch(chatOffRuntime, /\.chat-output-container \.rendered-markdown > p/);
assert.match(chatOffRuntime, /rendered-markdown:not\(\.chat-output-container/);
const panelOnlyRuntime = engine.buildRuntime({ areas: { sidebar: false, panel: true } });
assert.doesNotMatch(panelOnlyRuntime, /"\.pane-header \.title"/);
assert.match(panelOnlyRuntime, /\.part\.panel \.pane-header \.title/);
const noInputsCss = engine.buildCss({ mode: 'forceRtl', areas: { inputs: false, sessions: false } });
assert.doesNotMatch(noInputsCss, /interactive-input-editor[^}]*direction:rtl!important/);
const editorOnlyCss = engine.buildCss({ areas: { inputs: false, editorsCode: true } });
const editorOnlyRuntime = engine.buildRuntime({ areas: { inputs: false, editorsCode: true } });
assert.match(editorOnlyRuntime, /"promptRtl":false/);
assert.match(editorOnlyRuntime, /"nativeEditor":true/);
assert.doesNotMatch(editorOnlyCss, /\.view-line\{/);
assert.doesNotMatch(editorOnlyCss, /\.view-line[^}]*direction/);
assert.doesNotMatch(editorOnlyCss, /\.monaco-scrollable-element\{direction:ltr/);
assert.doesNotMatch(runtime, /idle=setTimeout\(function\(\)\{fix\(document\)/);
assert.doesNotMatch(engine.buildCss({ areas: { lists: false } }), /list-style-position:outside/);
assert.equal(engine.normalizeOptions({ customSelectors: ['.ok', 'body{direction:rtl}', '</style>', '.monaco-editor', '.chat-input-part *', '.interactive-input-editor'] }).customSelectors.join(','), '.ok');
assert.equal(engine.normalizeOptions({ additionalCSS: '</style><script>alert(1)</script>' }).additionalCSS, '');
assert.match(runtime, /&&!isPromptEditor\(e\)\)return true/);

const bridgeFixture = 'before;this._codeEditorService.addCodeEditor(this)}after';
const bridged = engine.applyEditorBridge(bridgeFixture);
assert.equal(engine.editorBridgeState(bridgeFixture), 'absent');
assert.equal(engine.editorBridgeState(bridged), 'valid');
assert.equal(engine.applyEditorBridge(bridged), bridged, 'editor bridge must be idempotent');
assert.equal(engine.removeEditorBridge(bridged), bridgeFixture);
assert.throws(() => engine.applyEditorBridge('no compatible editor registration'), /anchor/);
assert.throws(() => engine.applyEditorBridge('a.addCodeEditor(this)}b.addCodeEditor(this)}'), /ambiguous/);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtl-engine-'));
const appBase = path.join(temp, 'resources', 'app');
const htmlPath = path.join(appBase, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html');
const bundlePath = path.join(appBase, 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
const originalChecksums = {
    'vs/code/electron-browser/workbench/workbench.html': 'old',
    'vs/workbench/workbench.desktop.main.js': 'old-bundle',
    'vs/loader.js': 'keep-me',
};
const update = engine.updateWorkbenchChecksum({ name: 'Code', checksums: originalChecksums }, appBase, htmlPath, patched);
assert.equal(update.key, 'vs/code/electron-browser/workbench/workbench.html');
assert.equal(update.product.checksums['vs/loader.js'], 'keep-me');
assert.equal(update.product.checksums[update.key], engine.checksum(patched));
assert.equal(originalChecksums[update.key], 'old', 'input product must not be mutated');
const bundleUpdate = engine.updateWorkbenchChecksum(update.product, appBase, bundlePath, bridged);
assert.equal(bundleUpdate.key, 'vs/workbench/workbench.desktop.main.js');
assert.equal(bundleUpdate.product.checksums[bundleUpdate.key], engine.checksum(bridged));
assert.equal(bundleUpdate.product.checksums[update.key], engine.checksum(patched));
assert.equal(bundleUpdate.product.checksums['vs/loader.js'], 'keep-me');
assert.doesNotMatch(update.hash, /=+$/);
assert.equal(engine.checksum(Buffer.from(patched, 'utf8')), engine.checksum(patched));
assert.throws(() => engine.updateWorkbenchChecksum({}, appBase, htmlPath, patched), /checksums/);
assert.throws(() => engine.checksumKey(appBase, path.join(appBase, 'out', 'missing.js'), originalChecksums), /not found/);
assert.throws(() => engine.checksumKey(appBase, path.join(temp, 'outside.js'), originalChecksums), /outside/);

const extensionSource = fs.readFileSync(path.join(__dirname, 'extension.js'), 'utf8');
new vm.Script(extensionSource, { filename: 'extension.js' });
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
assert.equal(manifest.contributes['markdown.markdownItPlugins'], true);
assert.deepEqual(manifest.contributes['markdown.previewStyles'], ['./media/rtl-markdown-preview.css']);
assert.deepEqual(manifest.contributes['markdown.previewScripts'], ['./media/rtl-markdown-preview.js']);
const previewCss = fs.readFileSync(path.join(__dirname, 'media', 'rtl-markdown-preview.css'), 'utf8');
const previewScript = fs.readFileSync(path.join(__dirname, 'media', 'rtl-markdown-preview.js'), 'utf8');
new vm.Script(previewScript, { filename: 'rtl-markdown-preview.js' });
const previewElement = {
    dataset: {},
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    getAttribute(name) { return this.attributes.get(name) || null; },
};
const previewRoot = {
    querySelectorAll(selector) { return selector === 'p,blockquote,h1,h2,h3,h4,h5,h6,dt,dd,figcaption' ? [previewElement] : []; },
};
previewElement.innerText = '';
previewElement.textContent = '';
previewElement.closest = () => null;
previewElement.querySelectorAll = () => [];
const previewContext = {
    document: { querySelector(selector) { return selector === '.markdown-body' ? previewRoot : null; }, getElementById() { return null; } },
    window: { addEventListener(_name, callback) { this.refresh = callback; } },
    WeakMap,
};
vm.createContext(previewContext);
vm.runInContext(previewScript, previewContext);
assert.equal(previewElement.getAttribute('dir'), 'ltr', 'empty preview defaults to LTR');
for (const value of ['123', '۱۲۳ ٤٥٦ ، ؛ ؟', 'فارسی English', 'English فارسی']) {
    previewElement.innerText = value;
    previewContext.window.refresh();
    assert.equal(previewElement.getAttribute('dir'), 'ltr', value);
}
previewElement.innerText = 'متن فارسی';
previewContext.window.refresh();
assert.equal(previewElement.getAttribute('dir'), 'rtl', 'preview majority RTL');
previewElement.innerText = 'متن فارسی بیشتر از قبل';
previewContext.window.refresh();
assert.equal(previewElement.getAttribute('dir'), 'rtl', 'preview majority stays RTL as content grows');
previewElement.innerText = 'English text many words';
previewContext.window.refresh();
assert.equal(previewElement.getAttribute('dir'), 'ltr', 'preview majority LTR');
assert.match(previewScript, /return rtlWords > latinWords \? 'rtl' : 'ltr'/);
assert.doesNotMatch(previewCss, /data-rtlc-preview-inline/);
assert.match(previewCss, /unicode-bidi: plaintext/);
assert.doesNotMatch(engine.buildCss(), /data-rtlc-inline/);
assert.match(previewCss, /data-rtlc-preview-dir="rtl"/);
assert.match(previewCss, /data-rtlc-preview-tree/);
assert.match(previewScript, /vscode\.markdown\.updateContent/);
assert.match(previewScript, /function paragraphDirection/);
assert.match(previewScript, /function isDirectoryTree/);
assert.match(extensionSource, /extendMarkdownIt\(markdownIt\)/);
assert.match(extensionSource, /rtl-copilot-preview-config/);
assert.match(extensionSource, /markdown\.preview\.refresh/);
assert.match(extensionSource, /process\.platform === 'win32'/);
assert.match(extensionSource, /function unsupportedInstallMessage\(filePath\)/);
assert.match(extensionSource, /نسخهٔ Snap روی فایلسیستم فقطخواندنی نصب شده و قابل پچ نیست/);
assert.match(extensionSource, /https:\/\/code\.visualstudio\.com\/Download/);
assert.match(extensionSource, /assertWritableInstallation\(found\.htmlPath\)/);
assert.match(extensionSource, /'بستن VS Code'/);
assert.match(extensionSource, /workbench\.action\.quit/);
assert.doesNotMatch(extensionSource, /workbench\.action\.reloadWindow/);
assert.doesNotMatch(extensionSource, /scheduleWindowsRelaunch/);
assert.doesNotMatch(extensionSource, /\bspawn\(/);
assert.match(extensionSource, /patch is absent or outdated; run reinstall and fully restart VS Code/);
assert.doesNotMatch(extensionSource, /پچ نیاز به نصب مجدد دارد\. برای جلوگیری از هشدار integrity/);
assert.doesNotMatch(extensionSource, /'startupApply'/);
assert.doesNotMatch(extensionSource, /doPatch\(true, true\)/);
assert.match(extensionSource, /const nativeEditorEnabled = enable && \(options\.areas\.inputs && options\.areas\.promptInputs \|\| options\.areas\.editorsCode \|\| options\.areas\.editorComments\)/);
assert.match(extensionSource, /const nextBundle = nativeEditorEnabled \? engine\.applyEditorBridge\(originalBundle\) : engine\.removeEditorBridge\(originalBundle\)/);
assert.match(extensionSource, /const nativeRequired = options\.areas\.inputs && options\.areas\.promptInputs \|\| options\.areas\.editorsCode \|\| options\.areas\.editorComments/);
assert.match(extensionSource, /let busy = false/);
assert.match(extensionSource, /function executeTransaction\(transaction, enabled\)/);
assert.match(extensionSource, /const entries = \[\.\.\.backupEntries, \.\.\.transaction\.entries\]/);
assert.match(extensionSource, /await writeEntries\(entries, transaction\.productInfo\.appBase\)/);
assert.match(extensionSource, /verifyTransaction\(transaction, enabled\)/);
assert.match(extensionSource, /require\('node:child_process'\)/);
assert.doesNotMatch(extensionSource, /showWarningMessage\([\s\S]*?modal: true/, 'OS elevation is the only authorization prompt');
assert.match(extensionSource, /requesting one elevated transaction/);
assert.match(extensionSource, /error\.elevatedWriteHandled = true/);
assert.match(extensionSource, /if \(error\.elevatedWriteHandled\) throw error/);
assert.match(extensionSource, /permissionError\.appliedEntries = appliedEntries/);
assert.match(extensionSource, /const appliedEntries = error\.appliedEntries \|\| entries/);
assert.match(extensionSource, /pkexec/);
assert.match(extensionSource, /osascript/);
assert.match(extensionSource, /codesign/);
assert.match(extensionSource, /Start-Process[\s\S]*?RunAs/);
assert.match(extensionSource, /-ErrorReport/);
assert.match(extensionSource, /privileged-write\.ps1/);
assert.match(extensionSource, /privileged-write\.sh/);
assert.match(extensionSource, /async function runElevatedWrite\(entries, appRoot\)/);
assert.match(extensionSource, /fs\.renameSync\(tempPath, filePath\)/);
assert.match(extensionSource, /\['EACCES', 'EPERM', 'EROFS'\]/);
const windowsHelper = fs.readFileSync(path.join(__dirname, 'privileged-write.ps1'), 'utf8');
assert.match(windowsHelper, /\[IO\.File\]::WriteAllText\(\$ErrorReport/);
assert.match(windowsHelper, /Write verification failed/);
assert.match(windowsHelper, /Rollback failed for/);
assert.match(windowsHelper, /\$replacementBackup = "\$Target\.rtl-replaced-\$suffix"/);
assert.match(windowsHelper, /\[IO\.File\]::Replace\(\$temporary, \$Target, \$replacementBackup\)/);
assert.doesNotMatch(windowsHelper, /\[IO\.File\]::Replace\([^)]*\$null/);
assert.match(extensionSource, /cleanProduct\.commit !== product\.data\.commit \|\| cleanProduct\.version !== product\.data\.version/);
assert.doesNotMatch(extensionSource, /stageOfflineTransaction/);
assert.doesNotMatch(extensionSource, /currentOperation/);
assert.doesNotMatch(extensionSource, /operationStatus/);
assert.equal(fs.existsSync(path.join(__dirname, 'offline-patch.ps1')), false);

fs.rmSync(temp, { recursive: true, force: true });
console.log('RTL_ENGINE_3_0_0_TESTS_OK');
