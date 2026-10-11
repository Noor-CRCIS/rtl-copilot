'use strict';

const crypto = require('crypto');
const path = require('path');

const VERSION = '2.9.21';
const PATCH_START = '<!-- RTL-COPILOT:START -->';
const PATCH_END = '<!-- RTL-COPILOT:END -->';
const RUNTIME_NAME = 'rtl-copilot-runtime.js';
const LEGACY_EDITOR_BRIDGE = 'globalThis.__rtlCopilotRegisterEditor?.(this);';
const EDITOR_BRIDGE = ';try{const g=globalThis;(g.__rtlCopilotRegisterEditor?g.__rtlCopilotRegisterEditor(this):(g.__rtlCopilotPendingEditors??=[]).push(this))}catch{};';

const AREA_DEFINITIONS = Object.freeze({
    chat: {
        default: true,
        selectors: ['.chat-output-container .rendered-markdown > p', '.chat-output-container .rendered-markdown > blockquote', '.chat-output-container .rendered-markdown > :is(h1,h2,h3,h4,h5,h6)', '.chat-list-item .rendered-markdown > p', '.chat-list-item .rendered-markdown > blockquote', '.chat-list-item .rendered-markdown > :is(h1,h2,h3,h4,h5,h6)', '.interactive-session .rendered-markdown > p', '.interactive-session .rendered-markdown > blockquote', '.interactive-session .rendered-markdown > :is(h1,h2,h3,h4,h5,h6)', '.interactive-item-container .rendered-markdown > p', '.interactive-item-container .rendered-markdown > blockquote', '.interactive-item-container .rendered-markdown > :is(h1,h2,h3,h4,h5,h6)', '.aideditorchat-widget .rendered-markdown > p', '.aideditorchat-widget .rendered-markdown > blockquote', '.aideditorchat-widget .rendered-markdown > :is(h1,h2,h3,h4,h5,h6)', '.chat-message .rendered-markdown > p', '.chat-message .rendered-markdown > blockquote', '.chat-message .rendered-markdown > :is(h1,h2,h3,h4,h5,h6)', '.composer-message .rendered-markdown > p', '.composer-message .rendered-markdown > blockquote', '.composer-message .rendered-markdown > :is(h1,h2,h3,h4,h5,h6)', '.chat-request .rendered-markdown > p', '.chat-request .rendered-markdown > blockquote', '.chat-request .rendered-markdown > :is(h1,h2,h3,h4,h5,h6)', '.chat-request-text', '.chat-request-text-part', '.interactive-request .rendered-markdown > p', '.interactive-request .rendered-markdown > blockquote', '.interactive-request .rendered-markdown > :is(h1,h2,h3,h4,h5,h6)'],
    },
    markdown: {
        default: true,
        selectors: ['.monaco-workbench .rendered-markdown:not(.chat-output-container .rendered-markdown):not(.chat-list-item .rendered-markdown):not(.interactive-session .rendered-markdown):not(.interactive-item-container .rendered-markdown):not(.aideditorchat-widget .rendered-markdown):not(.chat-message .rendered-markdown):not(.composer-message .rendered-markdown):not(.chat-request .rendered-markdown):not(.interactive-request .rendered-markdown) :is(p,blockquote,h1,h2,h3,h4,h5,h6,dt,dd,figcaption)', '.monaco-workbench .markdown-body:not(.chat-output-container .markdown-body):not(.chat-list-item .markdown-body):not(.interactive-session .markdown-body):not(.interactive-item-container .markdown-body):not(.chat-message .markdown-body) :is(p,blockquote,h1,h2,h3,h4,h5,h6,dt,dd,figcaption)'],
    },
    markdownPreview: {
        default: true,
        selectors: [],
    },
    lists: {
        default: true,
        selectors: ['.monaco-workbench .rendered-markdown ul', '.monaco-workbench .rendered-markdown ol', '.monaco-workbench .markdown-body ul', '.monaco-workbench .markdown-body ol'],
    },
    tables: {
        default: true,
        selectors: ['.monaco-workbench .rendered-markdown table', '.monaco-workbench .rendered-markdown [role="table"]', '.monaco-workbench .markdown-body table'],
    },
    inputs: {
        default: true,
        selectors: ['.chat-input-part textarea', '.interactive-input-part textarea', '.comment-input textarea', '.chat-input-part [contenteditable="true"]:not(.monaco-editor *)', '.interactive-input-part [contenteditable="true"]:not(.monaco-editor *)', '.chat-input-part .interactive-input-editor', '.interactive-input-part .interactive-input-editor', '.chat-input-part .monaco-editor', '.interactive-input-part .monaco-editor', '.monaco-workbench input:not([type])', '.monaco-workbench input[type="text"]', '.monaco-workbench input[type="search"]', '.monaco-workbench textarea:not(.monaco-editor *)', '.monaco-workbench [contenteditable="true"]:not(.monaco-editor *):not(.xterm *)'],
    },
    promptInputs: { default: true, selectors: [] },
    searchInputs: { default: true, selectors: [] },
    settingsInputs: { default: true, selectors: [] },
    quickPickInputs: { default: true, selectors: [] },
    otherInputs: { default: true, selectors: [] },
    notifications: {
        default: true,
        selectors: [
            '.monaco-workbench .notifications-list-container .notification-list-item-message',
            '.monaco-workbench .notifications-list-container .notification-list-item-source',
            '.monaco-workbench .notifications-list-container .notification-list-item-buttons-container .monaco-button.monaco-text-button:not(.monaco-dropdown-button)',
            '.monaco-workbench .notifications-list-container .notification-list-item-buttons-container .monaco-button .monaco-button-label',
            '.monaco-workbench .notifications-list-container .notification-list-item-buttons-container .monaco-button .monaco-button-label-short',
            '.monaco-workbench .notifications-list-container .notification-list-item-buttons-container .monaco-button .monaco-button-mdlabel',
            '.monaco-dialog-box .dialog-message-text',
            '.monaco-dialog-box .dialog-message-detail',
            '.monaco-dialog-box .dialog-message-body',
            '.monaco-dialog-box .dialog-checkbox-message',
            '.monaco-dialog-box > .dialog-buttons-row > .dialog-buttons > .monaco-button.monaco-text-button:not(.monaco-icon-button):not(.monaco-dropdown-button)',
            '.monaco-dialog-box .dialog-buttons > .monaco-button .monaco-button-label',
            '.monaco-dialog-box .monaco-button-mdlabel',
            '.monaco-dialog-box .monaco-button-description',
        ],
    },
    menus: {
        default: true,
        selectors: ['.monaco-menu .action-menu-item .action-label:not(.codicon)', '.menubar-menu-items-holder .action-label:not(.codicon)'],
    },
    sidebar: {
        default: true,
        selectors: ['.part.sidebar .monaco-highlighted-label', '.part.sidebar .label-name', '.part.auxiliarybar .monaco-highlighted-label', '.part.auxiliarybar .label-name', '.part.sidebar .pane-header .title', '.part.auxiliarybar .pane-header .title'],
    },
    panel: {
        default: true,
        selectors: ['.part.panel .monaco-highlighted-label', '.part.panel .label-name', '.part.panel .pane-header .title'],
    },
    statusBar: {
        default: true,
        selectors: ['.part.statusbar .statusbar-item-label:not(.codicon)', '.part.statusbar .statusbar-item-label > span:not(.codicon)'],
    },
    quickPick: {
        default: true,
        selectors: ['.quick-input-widget .quick-input-title', '.quick-input-widget .quick-input-message', '.quick-input-widget .label-name', '.quick-input-widget .monaco-highlighted-label'],
    },
    breadcrumbs: {
        default: true,
        selectors: ['.breadcrumbs-control .monaco-icon-label .label-name', '.breadcrumbs-control .monaco-highlighted-label'],
    },
    explorer: {
        default: true,
        selectors: ['.explorer-viewlet .explorer-item .label-name', '.explorer-viewlet .monaco-highlighted-label'],
    },
    search: {
        default: true,
        selectors: ['.search-view .message', '.search-view .foldermatch .label-name', '.search-view .filematch .label-name', '.search-view .linematch > .match'],
    },
    scm: {
        default: true,
        selectors: ['.scm-view .resource-group > .name', '.scm-view .resource > .name .label-name', '.scm-view .monaco-highlighted-label', '.scm-repositories-view .monaco-highlighted-label'],
    },
    debug: {
        default: true,
        selectors: ['[id="workbench.view.debug"] .debug-pane .scope', '.debug-pane .expression .name', '.debug-pane .expression .value', '.debug-call-stack .thread > .name', '.debug-call-stack .session > .name', '.debug-call-stack .stack-frame .label', '.debug-call-stack .file-name', '.call-stack-state-message > .label'],
    },
    extensions: {
        default: true,
        selectors: ['.extensions-viewlet .extension-list-item .name', '.extensions-viewlet .extension-list-item .description', '.extensions-viewlet .extension-list-item .publisher-name', '.extensions-viewlet .message-container .message', '.extensions-viewlet .notification-container .message-text'],
    },
    settings: {
        default: true,
        selectors: ['.settings-editor .setting-item-label', '.settings-editor .setting-item-category', '.settings-editor .setting-item-description', '.settings-editor .setting-item-markdown :is(p,li)', '.settings-editor .setting-item-deprecation-message', '.settings-editor .settings-group-title-label', '.settings-toc-container .label-name', '.settings-editor .no-results-message'],
    },
    welcome: {
        default: true,
        selectors: ['.gettingStartedContainer .product-name', '.gettingStartedContainer .subtitle', '.gettingStartedContainer .category-title', '.gettingStartedContainer .category-description', '.gettingStartedContainer .description-content', '.gettingStartedContainer .step-title', '.gettingStartedContainer .moreText', '.gettingStartedContainer .step-description-container p'],
    },
    problems: {
        default: true,
        selectors: ['.markers-panel .marker-message', '.marker-message-details-container .marker-message', '.markers-table-container .monaco-table-td > .message', '.markers-table-container .monaco-table-td > .source', '.markers-panel .file-label', '.markers-panel .message-box-container'],
    },
    comments: {
        default: true,
        selectors: ['.comments-panel .comment-thread-container .text', '.comments-panel .comment-thread-container .user', '.comments-panel .comment-thread-container .reply-detail', '.review-widget .review-comment-contents .comment-body', '.review-widget .author', '.review-widget .timestamp'],
    },
    notebooks: {
        default: true,
        selectors: ['.notebookOverlay .cell-title-toolbar .action-label:not(.codicon)', '.notebookOverlay .cell-statusbar-item:not(.codicon)', '.notebookOverlay .notebook-editor-label'],
    },
    sessions: {
        default: true,
        selectors: ['.sessions-list-control .session-title', '.sessions-list-control .session-title .monaco-highlighted-label', '.sessions-list-control .session-title .label-name', '.sessions-list-control .session-chat-title', '.sessions-list-control .session-chat-title .monaco-highlighted-label', '.sessions-list-control .session-section-label', '.sessions-list-control .session-description', '.sessions-list-control .session-placeholder-label', '.sessions-list-control .session-show-more-label', '.agent-sessions-viewer .agent-session-title', '.agent-sessions-viewer .agent-session-title .monaco-highlighted-label', '.agent-sessions-viewer .agent-session-description', '.agent-sessions-viewer .agent-session-section-label', '.agent-sessions-viewer .agent-session-show-more', '.agent-sessions-title', '.chat-composite-bar-session-title-text'],
    },
    editorsCode: {
        default: false,
        selectors: ['.monaco-workbench .monaco-editor .view-line'],
    },
    editorComments: { default: true, selectors: [] },
    terminal: {
        default: false,
        selectors: ['.terminal-outer-container .xterm-rows > div'],
    },
});

function sanitizeSelector(value) {
    if (typeof value !== 'string') return null;
    const selector = value.trim();
    if (!selector || selector.length > 300 || /[{};<>`\\]/.test(selector) || /(?:monaco-editor|interactive-input-editor|chat-input-part|interactive-input-part)/i.test(selector)) return null;
    try { if (typeof globalThis.CSS !== 'undefined' && typeof globalThis.CSS.supports === 'function' && !globalThis.CSS.supports(`selector(${selector})`)) return null; }
    catch { return null; }
    return selector;
}

function normalizeOptions(raw = {}) {
    const areas = {};
    for (const [name, definition] of Object.entries(AREA_DEFINITIONS)) {
        const value = raw.areas && raw.areas[name];
        areas[name] = typeof value === 'boolean' ? value : definition.default;
    }
    const customSelectors = Array.isArray(raw.customSelectors)
        ? [...new Set(raw.customSelectors.map(sanitizeSelector).filter(Boolean))]
        : [];
    const additionalCSS = typeof raw.additionalCSS === 'string' && !/<\/?(?:style|script)\b/i.test(raw.additionalCSS)
        ? raw.additionalCSS.slice(0, 20000)
        : '';
    return {
        mode: raw.mode === 'forceRtl' ? 'forceRtl' : 'auto',
        observe: raw.observe !== false,
        autoEditorDirection: raw.autoEditorDirection === true,
        autoInputDirection: raw.autoInputDirection !== false,
        areas,
        customSelectors,
        additionalCSS,
    };
}

function enabledSelectors(options) {
    const result = [];
    for (const [name, definition] of Object.entries(AREA_DEFINITIONS)) {
        if (options.areas[name] && !['lists', 'tables', 'inputs', 'editorsCode', 'terminal'].includes(name)) result.push(...definition.selectors);
    }
    result.push(...options.customSelectors);
    return [...new Set(result)];
}

function buildCss(rawOptions = {}) {
    const options = normalizeOptions(rawOptions);
    const generic = enabledSelectors(options);
    const contentRule = generic.length
        ? `${generic.join(',\n')}{unicode-bidi:plaintext;text-align:start;} `
        : '';
    const chunks = [`/* RTL-COPILOT ${VERSION}: semantic workbench RTL */`, contentRule];

    if (options.areas.lists) {
        chunks.push(`${AREA_DEFINITIONS.lists.selectors.join(',\n')}{list-style-position:outside!important;padding-inline-start:1.6em!important;padding-inline-end:0!important;unicode-bidi:embed;text-align:start;}`);
        chunks.push(`${AREA_DEFINITIONS.lists.selectors.map(s => `${s} > li`).join(',\n')}{unicode-bidi:embed;text-align:start;}`);
    }
    if (options.areas.tables) {
        chunks.push(`${AREA_DEFINITIONS.tables.selectors.join(',\n')}{direction:ltr!important;unicode-bidi:isolate;text-align:start;}`);
        chunks.push(`.monaco-workbench .rendered-markdown th,.monaco-workbench .rendered-markdown td,.monaco-workbench .rendered-markdown [role="cell"],.monaco-workbench .rendered-markdown [role="columnheader"],.monaco-workbench .rendered-markdown [role="rowheader"]{unicode-bidi:plaintext;text-align:start;}`);
    }
    if (options.areas.inputs) {
            const nativeInputs = AREA_DEFINITIONS.inputs.selectors.filter(selector => !selector.includes('.monaco-editor') && !selector.includes('.interactive-input-editor'));
        chunks.push(`${nativeInputs.map(selector => selector + '[data-rtlc-input-sig]').join(',\n')}{unicode-bidi:normal!important;text-align:start;}`);
    }
    if (options.areas.terminal) {
        chunks.push(`${AREA_DEFINITIONS.terminal.selectors.join(',\n')}{unicode-bidi:plaintext!important;text-align:start!important;}`);
    }
    if (options.areas.notifications) {
        const notificationMessage = '.monaco-workbench .notifications-list-container .notification-list-item .notification-list-item-message';
        const notificationSource = '.monaco-workbench .notifications-list-container .notification-list-item .notification-list-item-source';
        const notificationButton = '.monaco-workbench .notifications-list-container .notification-list-item-buttons-container .monaco-button.monaco-text-button:not(.monaco-dropdown-button)';
        chunks.push(`.monaco-workbench .notifications-list-container .notification-list-item-buttons-container,.monaco-dialog-box .dialog-buttons-row,.monaco-dialog-box .dialog-buttons{direction:ltr!important;}`);
        chunks.push(`${notificationMessage}[data-rtlc-content-sig="rtl"],${notificationSource}[data-rtlc-content-sig="rtl"]{direction:rtl!important;text-align:right!important;unicode-bidi:normal!important;}`);
        chunks.push(`${notificationMessage}[data-rtlc-content-sig="ltr"],${notificationSource}[data-rtlc-content-sig="ltr"]{direction:ltr!important;text-align:left!important;unicode-bidi:normal!important;}`);
        chunks.push(`${notificationMessage}[data-rtlc-content-sig="rtl"]>span{direction:rtl!important;text-align:right!important;unicode-bidi:normal!important;}${notificationMessage}[data-rtlc-content-sig="ltr"]>span{direction:ltr!important;text-align:left!important;unicode-bidi:normal!important;}`);
        chunks.push(`${notificationButton}[data-rtlc-content-sig="rtl"],.monaco-dialog-box .dialog-buttons>.monaco-button[data-rtlc-content-sig="rtl"]{direction:rtl!important;text-align:right!important;unicode-bidi:normal!important;}${notificationButton}[data-rtlc-content-sig="ltr"],.monaco-dialog-box .dialog-buttons>.monaco-button[data-rtlc-content-sig="ltr"]{direction:ltr!important;text-align:left!important;unicode-bidi:normal!important;}`);
    }
    if (options.areas.chat || options.areas.markdown || options.areas.markdownPreview) {
        chunks.push(`.monaco-workbench .rendered-markdown pre,.monaco-workbench .rendered-markdown code,.monaco-workbench .markdown-body pre,.monaco-workbench .markdown-body code,.monaco-workbench .code-component__code{direction:ltr;unicode-bidi:normal;text-align:left;}`);
    }
    if (options.areas.sessions) {
        const sessions = AREA_DEFINITIONS.sessions.selectors.join(',\n');
        chunks.push(`${sessions}{unicode-bidi:plaintext;text-align:start;}`);
        chunks.push(`${AREA_DEFINITIONS.sessions.selectors.map(selector => `${selector}[data-rtlc-content-sig="rtl"]`).join(',\n')}{direction:rtl!important;text-align:right!important;}`);
    }
    if (options.additionalCSS) chunks.push(`/* RTL-COPILOT user CSS (global setting) */\n${options.additionalCSS}`);
    return chunks.filter(Boolean).join('\n\n');
}

function buildRuntime(rawOptions = {}) {
    const options = normalizeOptions(rawOptions);
    const config = {
        version: VERSION,
        mode: options.mode,
        observe: options.observe,
        selectors: [...enabledSelectors(options),
            ...(options.areas.terminal ? AREA_DEFINITIONS.terminal.selectors : [])],
        lists: options.areas.lists ? AREA_DEFINITIONS.lists.selectors : [],
        tables: options.areas.tables ? AREA_DEFINITIONS.tables.selectors : [],
        inputs: options.areas.inputs ? AREA_DEFINITIONS.inputs.selectors : [],
        promptRtl: options.areas.inputs && options.areas.promptInputs,
        nativeEditor: options.areas.editorsCode || options.areas.editorComments,
        fileManual: options.areas.editorsCode,
        editorComments: options.areas.editorComments,
        inputAreas: { prompt: options.areas.promptInputs, search: options.areas.searchInputs, settings: options.areas.settingsInputs, quickPick: options.areas.quickPickInputs, other: options.areas.otherInputs },
        autoEditorDirection: options.autoEditorDirection && options.areas.editorsCode,
        autoInputDirection: options.autoInputDirection,
        allowEditor: options.areas.editorsCode,
        allowTerminal: options.areas.terminal,
    };
    const serialized = JSON.stringify(config).replace(/</g, '\\u003c');
    return `'use strict';
/* RTL-COPILOT external runtime ${VERSION} */
(function(){
var CFG=${serialized};
var A='data-rtlc-';
var NATIVE=new WeakMap();
var ACTIVE_NATIVE=null;
var DIRECTION_STATES=new WeakMap();
var DIRECTION_DELAY=300;
var TEXT_DIRECTION={LTR:0,RTL:1};
var RTL=/[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF]/;
var LAT=/[A-Za-z\\u00C0-\\u024F]/;

function firstWordDirection(s){var words=(s||'').trim().split(/\\s+/);for(var i=0;i<words.length;i++){var word=words[i];for(var j=0;j<word.length;j++){var c=word.charAt(j);if(RTL.test(c)&&/\\p{L}/u.test(c))return'rtl';if(LAT.test(c))return'ltr';}}return'';}
function paragraphDirection(s){var words=(s||'').trim().split(/\\s+/),rtlWords=0,latinWords=0;for(var i=0;i<words.length;i++){var word=words[i],hasRtl=false,hasLatin=false;for(var j=0;j<word.length;j++){var c=word.charAt(j);if(RTL.test(c)&&/\\p{L}/u.test(c))hasRtl=true;else if(LAT.test(c))hasLatin=true;}if(hasRtl)rtlWords++;else if(hasLatin)latinWords++;}if(CFG.mode==='forceRtl'&&rtlWords)return'rtl';return rtlWords>latinWords?'rtl':'ltr';}
globalThis.__rtlCopilotParagraphDirection=paragraphDirection;
function isDirectoryTree(s){s=s||'';var glyphCount=(s.match(/[├└│]──/g)||[]).length,lines=s.split(/\\r?\\n/),treeLines=0,pathLines=0,contentLines=0;for(var i=0;i<lines.length;i++){var line=lines[i].trim();if(!line||/^[-*+]\\s*$/.test(line)||/^[-*_]{3,}$/.test(line))continue;contentLines++;if(/[├└│]──|^[│├└]/.test(line))treeLines++;if(/(?:^|\\s)[\\w.@+~-]+(?:\\/[\\w.@+~-]+)+\\/?(?:\\s|$)/.test(line)||/(?:^|\\s)[\\w.@+~-]+\\/(?:\\s|$)/.test(line)||/[\\\\/](?:[\\w.@+~-]+[\\\\/])+[\\w.@+~-]*/.test(line))pathLines++;}return glyphCount>=2||contentLines>=2&&(treeLines>=2||treeLines>=1&&pathLines>=1);}
globalThis.__rtlCopilotIsDirectoryTree=isDirectoryTree;
function directionState(owner,value,apply){var state=DIRECTION_STATES.get(owner);if(!state){state={direction:paragraphDirection(value),manual:'',timer:0};DIRECTION_STATES.set(owner,state);apply(state.direction);return state;}if(state.manual){apply(state.manual);return state;}clearTimeout(state.timer);state.timer=setTimeout(function(){state.direction=paragraphDirection(value);apply(state.direction);},DIRECTION_DELAY);return state;}
function manualState(owner,d,apply){var state=DIRECTION_STATES.get(owner)||{direction:'ltr',manual:'',timer:0};clearTimeout(state.timer);state.manual=d;state.direction=d;DIRECTION_STATES.set(owner,state);apply(d);}
function text(e){return(e.innerText||e.textContent||'').trim();}
function collect(root,selector){var out=[],seen=new Set();function add(e){if(e&&!seen.has(e)){seen.add(e);out.push(e);}}try{if(root.nodeType===1&&root.matches&&root.matches(selector))add(root);if(root.nodeType===1&&root.closest)add(root.closest(selector));if(root.querySelectorAll)Array.prototype.forEach.call(root.querySelectorAll(selector),add);}catch(_){}return out;}
function isPromptEditor(e){return!!(e&&e.closest&&e.closest('.chat-input-part,.interactive-input-part,.comment-input'));}
function blocked(e){if(!e||!e.closest)return true;if(e.closest('script,style,svg,math,canvas,.katex,.katex-display,pre,code,.code-component__code,[aria-hidden="true"]'))return true;if(!CFG.allowEditor&&e.closest('.monaco-editor,.monaco-diff-editor,.notebook-editor')&&!isPromptEditor(e))return true;if(!CFG.allowTerminal&&e.closest('.xterm,.terminal-outer-container'))return true;return false;}
function applyDir(e,d,key,force){if(!force&&e.getAttribute(A+key)===d)return;e.setAttribute(A+key,d);e.setAttribute('dir',d);e.style.direction=d;e.style.textAlign='start';}
function inputValue(input){var editor=input.closest&&input.closest('.monaco-editor');if(!editor&&input.matches&&input.matches('.monaco-editor'))editor=input;if(editor)return text(editor.querySelector('.view-lines')||editor);if(typeof input.value==='string')return input.value;return text(input);}
function isMonacoInput(input){return!!(input&&((input.matches&&input.matches('.monaco-editor,.interactive-input-editor'))||(input.closest&&input.closest('.monaco-editor,.interactive-input-editor'))||(input.querySelector&&input.querySelector('.monaco-editor'))));}
function promptEditor(input){var editor=input&&input.closest&&input.closest('.monaco-editor');if(!editor&&input&&input.matches&&input.matches('.monaco-editor'))editor=input;if(!editor&&input&&input.querySelector)editor=input.querySelector('.monaco-editor');return editor&&editor.closest('.interactive-input-editor')||editor;}
function directionOwner(input){return promptEditor(input)||manualOwner(input);}
function setMonacoPromptDir(input,d){var host=promptEditor(input);if(!host)return;host.setAttribute(A+'prompt-dir',d);host.setAttribute('data-rtlc-prompt-dir',d);}
function setInputDir(input,d,force){if(isMonacoInput(input)){setMonacoPromptDir(input,d);return;}applyDir(input,d,'input-sig',force);}
function inputStyleSnapshot(input){return{dir:input.getAttribute('dir'),direction:input.style&&input.style.direction||'',textAlign:input.style&&input.style.textAlign||'',unicodeBidi:input.style&&input.style.unicodeBidi||''};}
function restoreInputStyle(input,state){if(state.original.dir===null)input.removeAttribute('dir');else input.setAttribute('dir',state.original.dir);['direction','textAlign','unicodeBidi'].forEach(function(name){if(!input.style)return;var value=state.original[name],property=name.replace(/[A-Z]/g,function(c){return'-'+c.toLowerCase();});if(value)input.style[name]=value;else if(input.style.removeProperty)input.style.removeProperty(property);else input.style[name]='';});input.removeAttribute(A+'input-sig');}
function inputDirectionState(input,value,apply){var state=DIRECTION_STATES.get(input);if(!state){state={direction:'',manual:'',timer:0,original:inputStyleSnapshot(input)};DIRECTION_STATES.set(input,state);}if(state.manual){apply(state.manual);return;}if(!value.trim()){clearTimeout(state.timer);state.direction='';restoreInputStyle(input,state);return;}if(!state.direction)state.direction=firstWordDirection(value);if(state.direction)apply(state.direction);}
function manualOwner(input){return input&&input.closest&&(input.closest('.chat-input-part .monaco-editor,.interactive-input-part .monaco-editor,.chat-input-part [contenteditable="true"],.interactive-input-part [contenteditable="true"],.chat-input-part textarea,.interactive-input-part textarea,.comment-input textarea')||input);}
function applyListDir(list,d){if(list.getAttribute(A+'list-dir')!==d)list.setAttribute(A+'list-dir',d);applyDir(list,d,'list-sig');if(list.style.listStylePosition!=='outside')list.style.listStylePosition='outside';if(list.style.paddingInlineStart!=='1.6em')list.style.paddingInlineStart='1.6em';if(list.style.paddingInlineEnd!=='0px'&&list.style.paddingInlineEnd!=='0')list.style.paddingInlineEnd='0';Array.prototype.forEach.call(list.children,function(li){if(li.tagName==='LI')applyDir(li,d,'list-item-sig');});}
function processLists(root){CFG.lists.forEach(function(sel){collect(root,sel).forEach(function(list){if(blocked(list))return;directionState(list,text(list),function(d){if(list.isConnected)applyListDir(list,d);});});});}
function processTables(root){CFG.tables.forEach(function(sel){collect(root,sel).forEach(function(table){if(blocked(table))return;if(table.getAttribute(A+'table')!=='1')table.setAttribute(A+'table','1');if(table.style.direction!=='ltr')table.style.direction='ltr';if(table.style.unicodeBidi!=='isolate')table.style.unicodeBidi='isolate';table.querySelectorAll('th,td,[role="cell"],[role="columnheader"],[role="rowheader"]').forEach(function(cell){directionState(cell,text(cell),function(d){applyDir(cell,d,'cell-sig');});});});});}
function enabledInput(input){if(!input||!input.closest)return false;if(input.closest('.chat-input-part,.interactive-input-part,.comment-input'))return CFG.inputAreas.prompt;if(input.closest('.search-view,.search-widget,.find-widget,.simple-find-part'))return CFG.inputAreas.search;if(input.closest('.settings-editor'))return CFG.inputAreas.settings;if(input.closest('.quick-input-widget'))return CFG.inputAreas.quickPick;return CFG.inputAreas.other;}
function processInputs(root){if(!CFG.autoInputDirection)return;CFG.inputs.forEach(function(sel){collect(root,sel).forEach(function(input){var findInput=input.matches&&input.matches('input:not([type]),input[type="text"],input[type="search"]')&&input.closest('.find-widget,.simple-find-part');if((!findInput&&(blocked(input)||isMonacoInput(input)))||!enabledInput(input))return;var value=typeof input.value==='string'?input.value:text(input);inputDirectionState(input,value,function(d){applyDir(input,d,'input-sig');if(input.tagName==='TEXTAREA'||input.isContentEditable)input.style.unicodeBidi='plaintext';});});});}
function processContent(root){CFG.selectors.forEach(function(sel){collect(root,sel).forEach(function(e){if(blocked(e)||e.tagName==='UL'||e.tagName==='OL'||e.tagName==='TABLE'||e.getAttribute('role')==='table')return;var value=text(e);if(isDirectoryTree(value)){applyDir(e,'ltr','content-sig');if(e.getAttribute(A+'directory-tree')!=='1'){e.setAttribute(A+'directory-tree','1');e.style.unicodeBidi='isolate';e.style.whiteSpace='pre-wrap';}return;}if(e.hasAttribute(A+'directory-tree')){e.removeAttribute(A+'directory-tree');e.style.removeProperty('unicode-bidi');e.style.removeProperty('white-space');}directionState(e,value,function(d){applyDir(e,d,'content-sig');});});});}
function disposeNative(state){if(!state)return;state.disposed=true;clearTimeout(state.timer);if(state.host)try{delete state.host.__rtlCopilotEditor;}catch(_){}if(state.dom)try{delete state.dom.__rtlCopilotEditor;}catch(_){}try{state.collection.clear();}catch(_){}state.disposables.forEach(function(d){try{d.dispose();}catch(_){}});}
function isPromptDom(dom){return!!(dom&&dom.closest&&dom.closest('.chat-input-part,.interactive-input-part'))}
function lineRange(model,line){return{startLineNumber:line,startColumn:1,endLineNumber:line,endColumn:model.getLineMaxColumn(line)}}
function isRtlCommentLine(model,line){var value=model.getLineContent(line),tokens=model.tokenization;if(!RTL.test(value)||!tokens||typeof tokens.getLineTokens!=='function'||typeof tokens.hasAccurateTokensForLine!=='function')return false;try{if(tokens.tokenizeIfCheap)tokens.tokenizeIfCheap(line);if(!tokens.hasAccurateTokensForLine(line))return false;var spans=tokens.getLineTokens(line),end=0,comment='';for(var i=0;i<spans.getCount();i++){var start=spans.getStartOffset(i),stop=spans.getEndOffset(i);if(start!==end||stop<start||stop>value.length)return false;var part=value.slice(start,stop);if(spans.getStandardTokenType(i)===1)comment+=part;else if(part.trim())return false;end=stop;}return end===value.length&&firstWordDirection(comment)==='rtl';}catch(_){return false;}}
function attachCommentDirection(editor,state){if(state.prompt||!CFG.editorComments||CFG.autoEditorDirection)return;var collection=editor.createDecorationsCollection(),timer=0,disposed=false,busy=false,model=null,subscription=null,lastSignature='';function render(){timer=0;if(disposed)return;busy=true;try{var current=editor.getModel&&editor.getModel();if(current!==model){if(subscription)subscription.dispose();subscription=null;model=current;lastSignature='';collection.clear();if(model&&model.onDidChangeTokens)subscription=model.onDidChangeTokens(schedule);}if(!model)return;var ranges=editor.getVisibleRanges?editor.getVisibleRanges():[{startLineNumber:1,endLineNumber:Math.min(model.getLineCount(),500)}],seen=new Set(),decorations=[],parts=[];ranges.forEach(function(range){for(var line=Math.max(1,range.startLineNumber-5);line<=Math.min(model.getLineCount(),range.endLineNumber+5)&&seen.size<500;line++){if(seen.has(line))continue;seen.add(line);if(state.manualLines.has(line)||!isRtlCommentLine(model,line))continue;var r=lineRange(model,line);parts.push(line+':'+r.endColumn);decorations.push({range:r,options:{description:'persian-rtl-comment-only-line',isWholeLine:true,textDirection:TEXT_DIRECTION.RTL}});}});var signature=parts.join('|');if(signature!==lastSignature){lastSignature=signature;if(decorations.length)collection.set(decorations);else collection.clear();}}finally{busy=false;}}function schedule(){if(disposed||busy||timer)return;timer=setTimeout(render,50);}state.refreshComments=schedule;state.disposables.push(editor.onDidChangeModelContent(schedule),editor.onDidChangeModel(schedule));if(editor.onDidScrollChange)state.disposables.push(editor.onDidScrollChange(schedule));if(editor.onDidLayoutChange)state.disposables.push(editor.onDidLayoutChange(schedule));state.disposables.push({dispose:function(){disposed=true;clearTimeout(timer);if(subscription)subscription.dispose();collection.clear();}});render();}
function renderManualNative(editor,state){if(state.refreshComments)state.refreshComments();var model=editor.getModel&&editor.getModel(),decorations=[],parts=[];if(model)state.manualLines.forEach(function(d,line){if(line<1||line>model.getLineCount()){state.manualLines.delete(line);return;}parts.push(line+':'+d);decorations.push({range:lineRange(model,line),options:{description:'persian-rtl-manual-line',isWholeLine:true,textDirection:d==='rtl'?TEXT_DIRECTION.RTL:TEXT_DIRECTION.LTR}});});var signature=parts.join('|');if(state.lastManualModel===model&&state.lastManualSignature===signature)return;state.lastManualModel=model;state.lastManualSignature=signature;if(decorations.length)state.collection.set(decorations);else if(state.hadManualDecorations)state.collection.clear();state.hadManualDecorations=!!decorations.length;}
function promptDecorationPlan(editor,state){var model=editor.getModel&&editor.getModel();if(!model)return{model:null,decorations:[],signature:''};var count=model.getLineCount(),decorations=[],parts=[];[state.lineLocks,state.manualLines].forEach(function(map){for(var key of map.keys())if(key>count)map.delete(key);});for(var line=1;line<=count;line++){var value=model.getLineContent(line),manual=state.manualLines.get(line),locked=state.lineLocks.get(line);if(!value.trim()){state.lineLocks.delete(line);continue;}if(!locked){locked=firstWordDirection(value);if(locked)state.lineLocks.set(line,locked);}var d=manual||locked;if(!d)continue;parts.push(line+':'+d);decorations.push({range:lineRange(model,line),options:{description:'persian-rtl-prompt-first-word-line',isWholeLine:true,textDirection:d==='rtl'?TEXT_DIRECTION.RTL:TEXT_DIRECTION.LTR}});}return{model:model,decorations:decorations,signature:parts.join('|')};}
function refreshPromptNative(editor,state){if(!CFG.autoInputDirection){renderManualNative(editor,state);return;}var plan=promptDecorationPlan(editor,state);if(!plan.model){state.collection.clear();state.lineLocks.clear();state.lastPromptSignature='';return;}if(plan.signature===state.lastPromptSignature)return;state.lastPromptSignature=plan.signature;state.collection.set(plan.decorations);}
function schedulePromptNative(editor,state){if(state.refreshQueued||state.disposed)return;state.refreshQueued=true;Promise.resolve().then(function(){state.refreshQueued=false;if(state.disposed)return;refreshPromptNative(editor,state);});}
function renderNative(editor,state){if(!CFG.autoEditorDirection){renderManualNative(editor,state);return;}var model=editor.getModel&&editor.getModel();if(!model){state.collection.clear();return;}var decorations=[];for(var line=1;line<=model.getLineCount();line++){var d=state.manualLines.get(line)||state.directions.get(line)||'ltr';decorations.push({range:lineRange(model,line),options:{description:'persian-rtl-majority-line',textDirection:d==='rtl'?TEXT_DIRECTION.RTL:TEXT_DIRECTION.LTR}});}state.collection.set(decorations);}
function scheduleNative(editor,state){if(!CFG.autoEditorDirection){clearTimeout(state.timer);renderManualNative(editor,state);return;}var model=editor.getModel&&editor.getModel();if(!model){state.collection.clear();return;}for(var line=1;line<=model.getLineCount();line++){if(!state.directions.has(line))state.directions.set(line,paragraphDirection(model.getLineContent(line)));}renderNative(editor,state);clearTimeout(state.timer);state.timer=setTimeout(function(){var current=editor.getModel&&editor.getModel();if(!current)return;var next=new Map();for(var line=1;line<=current.getLineCount();line++)next.set(line,paragraphDirection(current.getLineContent(line)));state.directions=next;for(var key of state.manualLines.keys())if(key>current.getLineCount())state.manualLines.delete(key);renderNative(editor,state);},DIRECTION_DELAY);}
function rebaseLineState(map,changes){var entries=[...map.entries()];map.clear();entries.forEach(function(entry){var line=entry[0],value=entry[1];changes.forEach(function(c){var start=c.range.startLineNumber,end=c.range.endLineNumber,removed=end-start,added=(c.text.match(/\\n/g)||[]).length;if(line>end)line+=added-removed;else if(line>start&&line<=end)line=-1;});if(line>0)map.set(line,value);});}
function registerEditor(editor,retry){if(!editor||NATIVE.has(editor)||!editor.createDecorationsCollection)return;var dom=editor.getContainerDomNode&&editor.getContainerDomNode()||editor.getDomNode&&editor.getDomNode(),host=dom&&dom.closest&&dom.closest('.interactive-input-editor'),prompt=isPromptDom(dom);if(!prompt&&!CFG.nativeEditor&&CFG.promptRtl&&(retry||0)<3){Promise.resolve().then(function(){registerEditor(editor,(retry||0)+1);});return;}if(prompt&&!CFG.promptRtl||!prompt&&!CFG.nativeEditor)return;var state={collection:editor.createDecorationsCollection(),directions:new Map(),lineLocks:new Map(),manualLines:new Map(),timer:0,prompt:prompt,host:host,dom:dom,disposables:[],refreshQueued:false,disposed:false,lastPromptSignature:''};if(host)host.__rtlCopilotEditor=editor;if(dom)dom.__rtlCopilotEditor=editor;NATIVE.set(editor,state);state.disposables.push(editor.onDidFocusEditorText(function(){ACTIVE_NATIVE=editor;}));state.disposables.push(editor.onDidBlurEditorText(function(){if(ACTIVE_NATIVE===editor)ACTIVE_NATIVE=null;}));state.disposables.push(editor.onDidChangeModelContent(function(e){var changes=e.changes||[];if(e.isFlush){state.lineLocks.clear();state.lastPromptSignature='';}rebaseLineState(state.manualLines,changes);if(state.prompt){rebaseLineState(state.lineLocks,changes);schedulePromptNative(editor,state);}else{rebaseLineState(state.directions,changes);scheduleNative(editor,state);}}));state.disposables.push(editor.onDidChangeModel(function(){state.directions.clear();state.lineLocks.clear();state.manualLines.clear();state.lastPromptSignature='';if(state.prompt)schedulePromptNative(editor,state);else scheduleNative(editor,state);}));state.disposables.push(editor.onDidDispose(function(){if(ACTIVE_NATIVE===editor)ACTIVE_NATIVE=null;disposeNative(state);NATIVE.delete(editor);}));attachCommentDirection(editor,state);if(prompt)schedulePromptNative(editor,state);else scheduleNative(editor,state);}
globalThis.__rtlCopilotRegisterEditor=registerEditor;
var queued=globalThis.__rtlCopilotPendingEditors||[];delete globalThis.__rtlCopilotPendingEditors;queued.forEach(registerEditor);
function activeNativeEditor(){if(ACTIVE_NATIVE&&NATIVE.has(ACTIVE_NATIVE)&&(!ACTIVE_NATIVE.hasTextFocus||ACTIVE_NATIVE.hasTextFocus()))return ACTIVE_NATIVE;var active=document.activeElement,dom=active&&active.closest&&active.closest('.monaco-editor');return dom&&dom.__rtlCopilotEditor||dom&&dom.closest('.interactive-input-editor')&&dom.closest('.interactive-input-editor').__rtlCopilotEditor||null;}
function setNativeManual(editor,d){var state=editor&&NATIVE.get(editor),position=editor&&editor.getPosition&&editor.getPosition();if(!state||!position||!state.prompt&&!CFG.fileManual)return false;state.manualLines.set(position.lineNumber,d);if(state.prompt){state.lineLocks.delete(position.lineNumber);state.lastPromptSignature='';schedulePromptNative(editor,state);}else renderNative(editor,state);return true;}
function fix(root){var base=root&&root.querySelectorAll?root:document;processLists(base);processTables(base);processInputs(base);processContent(base);}
function promptTarget(e){return e&&e.closest&&e.closest('.chat-input-part textarea,.interactive-input-part textarea,.comment-input textarea,.chat-input-part [contenteditable="true"],.interactive-input-part [contenteditable="true"],.chat-input-part .monaco-editor,.interactive-input-part .monaco-editor');}
var heldShift='';
function shiftSide(event){if(event.code==='ShiftLeft')return'ltr';if(event.code==='ShiftRight')return'rtl';if(event.key==='Shift'&&event.location===1)return'ltr';if(event.key==='Shift'&&event.location===2)return'rtl';return'';}
function applyManualShortcut(event,d){var nativeEditor=activeNativeEditor();if(nativeEditor&&setNativeManual(nativeEditor,d)){event.preventDefault();event.stopPropagation();return true;}if(!CFG.promptRtl)return false;var target=promptTarget(event.target);if(!target)return false;event.preventDefault();event.stopPropagation();var owner=directionOwner(target)||target;manualState(owner,d,function(value){setInputDir(target,value,true);});return true;}
function manualDirection(event){var side=shiftSide(event);if(side)heldShift=side;var completesChord=!!side||(event.key==='Control'||event.code==='ControlLeft'||event.code==='ControlRight')&&event.shiftKey;if(!completesChord||!heldShift||!event.ctrlKey||!event.shiftKey||event.altKey||event.metaKey)return;var d=heldShift;heldShift='';applyManualShortcut(event,d);}
function manualDirectionUp(event){if(event.code==='ShiftLeft'||event.code==='ShiftRight'||event.key==='Shift')heldShift='';}
var pending=new Set(),timer=0;
function flush(){timer=0;var items=Array.from(pending);pending.clear();items.forEach(fix);}
function schedule(n){var e=n&&n.nodeType===1?n:n&&n.parentElement;if(!e)return;if(e.closest&&e.closest('.monaco-editor')&&!e.closest('.find-widget,.simple-find-part'))return;pending.add(e);if(!timer){timer=1;queueMicrotask(flush);}}
function init(){fix(document);document.addEventListener('input',function(e){schedule(e.target);},true);document.addEventListener('keydown',manualDirection,true);document.addEventListener('keyup',manualDirectionUp,true);if(CFG.observe&&document.body){new MutationObserver(function(ms){ms.forEach(function(m){schedule(m.target);m.addedNodes.forEach(schedule);});}).observe(document.body,{childList:true,subtree:true,characterData:true});}setTimeout(function(){fix(document);},1500);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
`;
}

function buildPatchBlock(rawOptions = {}) {
    const css = buildCss(rawOptions).replace(/<\/style/gi, '<\\/style');
    return `${PATCH_START}\n<!-- RTL-COPILOT-VERSION: ${VERSION} -->\n<style id="rtl-copilot-css">\n${css}\n</style>\n<script id="rtl-copilot-runtime" src="./${RUNTIME_NAME}"></script>\n${PATCH_END}`;
}

function markerState(html) {
    const starts = (html.match(/<!-- RTL-COPILOT:START -->/g) || []).length;
    const ends = (html.match(/<!-- RTL-COPILOT:END -->/g) || []).length;
    if (starts === 0 && ends === 0) return 'absent';
    if (starts === 1 && ends === 1 && html.indexOf(PATCH_START) < html.indexOf(PATCH_END)) return 'valid';
    return 'invalid';
}

function applyPatchToHtml(html, rawOptions = {}) {
    const state = markerState(html);
    if (state === 'invalid') throw new Error('RTL patch markers are malformed; restore the original workbench first.');
    const block = buildPatchBlock(rawOptions);
    if (state === 'valid') {
        const start = html.indexOf(PATCH_START);
        const end = html.indexOf(PATCH_END) + PATCH_END.length;
        return html.slice(0, start) + block + html.slice(end);
    }
    if (html.includes('</head>')) return html.replace('</head>', `${block}\n</head>`);
    if (html.includes('</html>')) return html.replace('</html>', `${block}\n</html>`);
    throw new Error('Workbench HTML has no closing head or html tag.');
}

function removePatchFromHtml(html) {
    const state = markerState(html);
    if (state === 'absent') return html;
    if (state === 'invalid') throw new Error('RTL patch markers are malformed; refusing unsafe removal.');
    const start = html.indexOf(PATCH_START);
    const end = html.indexOf(PATCH_END) + PATCH_END.length;
    let restored = html.slice(0, start) + html.slice(end);
    if (restored[start] === '\n') restored = restored.slice(0, start) + restored.slice(start + 1);
    return restored;
}

function patchedVersion(html) {
    const match = html.match(/<!--\s*RTL-COPILOT-VERSION:\s*([0-9][\d.]*)/);
    return match ? match[1] : '0';
}

function checksum(content) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    return crypto.createHash('sha256').update(bytes).digest('base64').replace(/=+$/g, '');
}

function checksumKey(appBase, htmlPath, checksums = {}) {
    const relative = path.relative(appBase, htmlPath).split(path.sep).join('/');
    if (relative === '..' || relative.startsWith('../')) throw new Error('Checksum target is outside app base.');
    const candidates = [relative, relative.replace(/^out\//, '')];
    const matches = new Set();
    for (const candidate of candidates) if (Object.prototype.hasOwnProperty.call(checksums, candidate)) matches.add(candidate);
    if (matches.size !== 1) throw new Error(matches.size ? 'Checksum key is ambiguous.' : 'Checksum key was not found in product.json.');
    return [...matches][0];
}

function updateWorkbenchChecksum(product, appBase, htmlPath, htmlContent) {
    if (!product || typeof product !== 'object') throw new Error('Invalid product.json data.');
    const checksums = product.checksums;
    if (!checksums || typeof checksums !== 'object' || Array.isArray(checksums)) throw new Error('product.json has no valid checksums map.');
    const key = checksumKey(appBase, htmlPath, checksums);
    const updated = { ...product, checksums: { ...checksums, [key]: checksum(htmlContent) } };
    return { product: updated, key, hash: updated.checksums[key] };
}

function applyEditorBridge(source) {
    if (typeof source !== 'string') throw new Error('Invalid workbench JavaScript source.');
    if (source.includes(EDITOR_BRIDGE)) return source;
    const clean = removeEditorBridge(source);
    const patterns = [
        /this\._codeEditorService\.addCodeEditor\(this\)(?=;|})/g,
        /([A-Za-z_$][\w$]*)\.addCodeEditor\(this\)(?=;|})/g,
    ];
    for (const pattern of patterns) {
        const matches = [...clean.matchAll(pattern)];
        if (matches.length === 0) continue;
        if (matches.length !== 1) throw new Error('CodeEditorWidget registration anchor is ambiguous.');
        const match = matches[0];
        const at = match.index + match[0].length;
        return `${clean.slice(0, at)}${EDITOR_BRIDGE}${clean.slice(at)}`;
    }
    throw new Error('Compatible CodeEditorWidget registration anchor was not found.');
}

function removeEditorBridge(source) {
    return typeof source === 'string' ? source.replaceAll(EDITOR_BRIDGE, '').replaceAll(LEGACY_EDITOR_BRIDGE, '') : source;
}

function editorBridgeState(source) {
    const count = typeof source === 'string'
        ? source.split(EDITOR_BRIDGE).length - 1 + source.split(LEGACY_EDITOR_BRIDGE).length - 1
        : 0;
    return count === 0 ? 'absent' : count === 1 ? 'valid' : 'invalid';
}

module.exports = {
    AREA_DEFINITIONS,
    EDITOR_BRIDGE,
    PATCH_END,
    PATCH_START,
    RUNTIME_NAME,
    VERSION,
    applyPatchToHtml,
    applyEditorBridge,
    buildCss,
    buildPatchBlock,
    buildRuntime,
    checksum,
    checksumKey,
    markerState,
    normalizeOptions,
    patchedVersion,
    removePatchFromHtml,
    removeEditorBridge,
    editorBridgeState,
    updateWorkbenchChecksum,
};
