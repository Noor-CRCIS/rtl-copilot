'use strict';

(function () {
    const RTL = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    const LATIN = /[A-Za-z\u00C0-\u024F]/;
    const LEAF_SELECTOR = 'p,blockquote,h1,h2,h3,h4,h5,h6,dt,dd,figcaption';
    const SKIP_SELECTOR = 'pre,code,.vscode-code-block,.katex,.katex-display,math,svg,canvas,[aria-hidden="true"]';

    function readConfig() {
        const marker = document.getElementById('rtl-copilot-preview-config');
        if (!marker) return { enabled: true, mode: 'auto', lists: true, tables: true };
        try {
            return JSON.parse(decodeURIComponent(marker.dataset.config || ''));
        } catch {
            return { enabled: true, mode: 'auto', lists: true, tables: true };
        }
    }

    // Legacy block-direction policy. A changing word majority can change dir;
    // CSS plaintext supplies the browser's Unicode paragraph bidi behavior.
    function paragraphDirection(value, mode) {
        const words = (value || '').trim().split(/\s+/);
        let rtlWords = 0;
        let latinWords = 0;
        for (const word of words) {
            let hasRtl = false;
            let hasLatin = false;
            for (const char of word) {
                if (RTL.test(char) && /\p{L}/u.test(char)) hasRtl = true;
                else if (LATIN.test(char)) hasLatin = true;
            }
            if (hasRtl) rtlWords += 1;
            else if (hasLatin) latinWords += 1;
        }
        if (mode === 'forceRtl' && rtlWords) return 'rtl';
        return rtlWords > latinWords ? 'rtl' : 'ltr';
    }

    function isDirectoryTree(value) {
        const text = value || '';
        const glyphCount = (text.match(/[├└│]──/g) || []).length;
        const lines = text.split(/\r?\n/);
        let treeLines = 0;
        let pathLines = 0;
        let contentLines = 0;
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || /^[-*+]\s*$/.test(line) || /^[-*_]{3,}$/.test(line)) continue;
            contentLines += 1;
            if (/[├└│]──|^[│├└]/.test(line)) treeLines += 1;
            if (/(?:^|\s)[\w.@+~-]+(?:\/[\w.@+~-]+)+\/?(?:\s|$)/.test(line)
                || /(?:^|\s)[\w.@+~-]+\/(?:\s|$)/.test(line)) pathLines += 1;
        }
        return glyphCount >= 2 || (contentLines >= 2 && (treeLines >= 2 || (treeLines >= 1 && pathLines >= 1)));
    }

    function applyDirection(element, direction) {
        if (element.dataset.rtlcPreviewDir === direction && element.getAttribute('dir') === direction) return;
        element.dataset.rtlcPreviewDir = direction;
        element.setAttribute('dir', direction);
    }

    function clear(root) {
        root.querySelectorAll('[data-rtlc-preview-dir]').forEach(element => {
            delete element.dataset.rtlcPreviewDir;
            element.removeAttribute('dir');
        });
        root.querySelectorAll('[data-rtlc-preview-tree]').forEach(element => delete element.dataset.rtlcPreviewTree);
        root.querySelectorAll('[data-rtlc-preview-table]').forEach(element => delete element.dataset.rtlcPreviewTable);
    }

    function applyPolicy() {
        const root = document.querySelector('.markdown-body');
        if (!root) return;
        const config = readConfig();
        if (!config.enabled) {
            clear(root);
            return;
        }

        root.querySelectorAll(LEAF_SELECTOR).forEach(element => {
            if (element.closest(SKIP_SELECTOR)) return;
            const value = (element.innerText || element.textContent || '').trim();
            if (isDirectoryTree(value)) {
                element.dataset.rtlcPreviewTree = '1';
                applyDirection(element, 'ltr');
                return;
            }
            delete element.dataset.rtlcPreviewTree;
            applyDirection(element, paragraphDirection(value, config.mode));
        });

        if (config.lists) {
            root.querySelectorAll('ul,ol').forEach(list => {
                if (list.closest(SKIP_SELECTOR)) return;
                applyDirection(list, paragraphDirection(list.innerText || list.textContent || '', config.mode));
            });
        }

        if (config.tables) {
            root.querySelectorAll('table').forEach(table => {
                table.dataset.rtlcPreviewTable = '1';
                table.querySelectorAll('th,td').forEach(cell => {
                    applyDirection(cell, paragraphDirection(cell.innerText || cell.textContent || '', config.mode));
                });
            });
        }
    }

    applyPolicy();
    window.addEventListener('vscode.markdown.updateContent', applyPolicy);
})();
