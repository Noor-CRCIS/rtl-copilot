'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
    const { marked } = await import('marked');
    const manifest = require('./package.json');
    assert.match(manifest.displayName, /VS Code/);
    assert.match(manifest.displayName, /Copilot/);
    assert.match(manifest.displayName, /AI Chat/);
    assert.equal(manifest.name, 'rtl-copilot', 'keep installed extension identity');
    assert.equal(manifest.publisher, 'rtl-tools', 'do not silently change publisher');
    for (const name of ['README.md', 'CHANGELOG.md']) {
        const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
        assert.match(source, /<h1 align="right" dir="rtl">&#x2067;/, name);
        assert.doesNotMatch(source, /[\u202a-\u202e\u2066-\u2069]/u, 'bidi controls must be visible entities in source');
        assert.doesNotMatch(source, /<script\b|<style\b|\bstyle=/i, 'do not depend on stripped scripts/styles');
        const html = marked.parse(source);
        assert.match(html, /<h1 align="right"/);
        assert.match(html, /<h2 align="right"/);
        assert.doesNotMatch(html, /<(?:div|table|th|td|ul|ol|li|pre)\b/, 'avoid layout dependent on inherited alignment');
        // VS Code Details removes dir; explicit align must still be present.
        // This only models removal of dir/style, not the full VS Code sanitizer.
        const withoutDirection = html.replace(/\s(?:dir|style)="[^"]*"/g, '');
        const blocks = [...withoutDirection.matchAll(/<(h[1-6]|p)\b([^>]*)>/g)];
        assert.ok(blocks.length > 10, 'document must retain its content');
        for (const [, tag, attributes] of blocks) {
            assert.match(attributes, /\balign="right"/, `${name}: explicit alignment on ${tag}`);
        }
        const isolated = [...withoutDirection.matchAll(/<(h[1-6]|p)\b[^>]*>(.*?)<\/\1>/gs)];
        assert.equal(isolated.length, blocks.length);
        for (const [, tag, content] of isolated) {
            assert.match(content, /^(?:&#x2067;|&#x2066;)[\s\S]*&#x2069;$/, `${name}: ${tag} has a balanced text isolate`);
            assert.equal((content.match(/&#x206[679];/g) || []).length, 2, 'one isolate pair per block');
            if (/[\u0600-\u06ff]/u.test(content)) assert.ok(content.startsWith('&#x2067;'), 'Persian block must use RLI');
        }
        for (const [, code] of source.matchAll(/<code>(.*?)<\/code>/gs)) {
            assert.doesNotMatch(code, /&#x206[679];/, 'copied code must not contain isolation controls');
        }
        assert.doesNotMatch(withoutDirection, /\bdir=/);
        for (const match of source.matchAll(/href="([^"]+)"/g)) {
            assert.ok(match[1].startsWith('https://'), 'portable HTTPS documentation links');
        }
        if (name === 'README.md') {
            assert.ok(source.length < 10500, 'Details should be concise and user-facing');
            assert.doesNotMatch(source, /npm ci|npm test|queueMicrotask|checksum را|رفع قطعی/);
            assert.match(source, /فایل‌های داخلی/);
            assert.ok(source.includes(`rtl-copilot-${manifest.version}.vsix`));
        } else {
            assert.ok(source.includes(`>نسخهٔ ${manifest.version}`) || source.includes(`>&#x2067;نسخهٔ ${manifest.version}`));
        }
    }
    console.log('RELEASE_DOCS_RENDER_TESTS_OK');
}
main().catch(error => { console.error(error); process.exitCode = 1; });