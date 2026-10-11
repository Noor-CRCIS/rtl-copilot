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
    assert.equal(manifest.publisher, 'Noor-CRCIS', 'publisher must match the Marketplace account');

    const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
    assert.match(readme, /^# راست‌چین هوشمند نور/m);
    assert.ok(readme.length < 10500, 'README should remain concise and user-facing');
    assert.ok(readme.includes(`rtl-copilot-${manifest.version}.vsix`));
    assert.match(readme, /## بیلد و ساخت فایل VSIX/);
    for (const command of ['npm ci', 'npm test', 'npm run package']) assert.ok(readme.includes(command));
    assert.match(readme, /## نصب و شروع کار/);
    assert.match(readme, /## تنظیم‌های اصلی/);
    assert.match(readme, /## پیش از فعال‌سازی بدانید/);
    assert.match(readme, /همهٔ کادرهای ورودی/);
    assert.doesNotMatch(readme, /[\u202a-\u202e\u2066-\u2069]/u, 'bidi controls must be visible entities in source');
    assert.doesNotMatch(readme, /<script\b|<style\b|\bstyle=/i, 'do not depend on stripped scripts/styles');
    for (const match of readme.matchAll(/\]\(([^)]+)\)/g)) {
        assert.ok(match[1].startsWith('https://') || match[1] === 'PUBLISHING.md', 'portable documentation links');
    }
    const readmeHtml = marked.parse(readme);
    assert.match(readmeHtml, /<h1/);
    assert.match(readmeHtml, /<h2/);

    const changelog = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /<h1 align="right" dir="rtl">&#x2067;/);
    assert.doesNotMatch(changelog, /[\u202a-\u202e\u2066-\u2069]/u, 'bidi controls must be visible entities in source');
    assert.doesNotMatch(changelog, /<script\b|<style\b|\bstyle=/i, 'do not depend on stripped scripts/styles');
    assert.ok(
        changelog.includes(`>نسخهٔ ${manifest.version}`) || changelog.includes(`>&#x2067;نسخهٔ ${manifest.version}`),
        'changelog must document current release',
    );
    const changelogHtml = marked.parse(changelog);
    assert.match(changelogHtml, /<h1 align="right"/);
    assert.match(changelogHtml, /<h2 align="right"/);
    assert.doesNotMatch(changelogHtml, /<(?:div|table|th|td|ul|ol|li|pre)\b/, 'avoid layout dependent on inherited alignment');

    // VS Code Details removes dir; explicit alignment and visible isolates must survive.
    const withoutDirection = changelogHtml.replace(/\s(?:dir|style)="[^"]*"/g, '');
    const blocks = [...withoutDirection.matchAll(/<(h[1-6]|p)\b([^>]*)>/g)];
    assert.ok(blocks.length > 10, 'changelog must retain its content');
    for (const [, tag, attributes] of blocks) {
        assert.match(attributes, /\balign="right"/, `CHANGELOG.md: explicit alignment on ${tag}`);
    }
    const isolated = [...withoutDirection.matchAll(/<(h[1-6]|p)\b[^>]*>(.*?)<\/\1>/gs)];
    assert.equal(isolated.length, blocks.length);
    for (const [, tag, content] of isolated) {
        assert.match(content, /^(?:&#x2067;|&#x2066;)[\s\S]*&#x2069;$/, `CHANGELOG.md: ${tag} has a balanced text isolate`);
        assert.equal((content.match(/&#x206[679];/g) || []).length, 2, 'one isolate pair per block');
        if (/[\u0600-\u06ff]/u.test(content)) assert.ok(content.startsWith('&#x2067;'), 'Persian block must use RLI');
    }
    assert.doesNotMatch(withoutDirection, /\bdir=/);
    for (const match of changelog.matchAll(/href="([^"]+)"/g)) {
        assert.ok(match[1].startsWith('https://'), 'portable HTTPS changelog links');
    }
    console.log('RELEASE_DOCS_RENDER_TESTS_OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
