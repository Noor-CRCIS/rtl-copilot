'use strict';

// RTL-COPILOT fonts.js — cross-platform installed-font discovery with
// Persian-first ranking so the picker presents the most useful choices
// (and gives a sensible default) for RTL users.
// Pure Node module (no vscode dependency) so it can be required from
// extension.js, tests, and the packaging toolchain alike.

const { execFile } = require('node:child_process');
const os = require('os');

// Well-known Persian / Arabic fonts are ranked first so the picker presents
// the most useful choices (and gives a sensible default) for RTL users.
const PERSIAN_FONTS = [
    'Vazirmatn',
    'Vazir',
    'IRANSansX',
    'IRANSansFaNum',
    'IRANSans',
    'IRANYekanX',
    'IRANYekan',
    'IRAN Sans',
    'IRAN Sans X',
    'YekanBakh',
    'Yekan',
    'Shabnam',
    'Sahel',
    'Samim',
    'Noto Naskh Arabic',
    'Noto Sans Arabic',
    'Amiri',
    'IranNastaliq',
    'Gowun',
];

const COMMON_LATIN = new Set([
    'DejaVu Sans', 'DejaVu Serif', 'Noto Sans', 'Noto Serif', 'Liberation Sans',
    'Liberation Serif', 'Ubuntu', 'Cantarell', 'Inter', 'Roboto', 'Open Sans',
    'Tahoma', 'Segoe UI', 'Arial', 'Helvetica Neue',
]);

function run(cmd, args, timeout = 8000) {
    return new Promise(resolve => {
        execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => {
            if (err || typeof stdout !== 'string') return resolve('');
            resolve(stdout);
        });
    });
}

function uniqueSorted(families) {
    const seen = new Set();
    const out = [];
    for (const f of families) {
        const name = (f || '').trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push(name);
    }
    return out;
}

function rank(name) {
    const lower = name.toLowerCase();
    const idx = PERSIAN_FONTS.findIndex(f => lower === f.toLowerCase());
    if (idx !== -1) return 0; // known good Persian font → top
    if (COMMON_LATIN.has(name)) return 1; // neutral system Latin font
    if (/[\u0600-\u06FF]/.test(name)) return 2; // any Arabic-script named font
    return 3; // everything else
}

function sortForPicker(families) {
    return families
        .map(name => ({ name, key: rank(name) }))
        .sort((a, b) => a.key - b.key || a.name.localeCompare(b.name))
        .map(x => x.name);
}

async function listLinuxAndMac() {
    // fontconfig is available on most Linux desktops and macOS with fc installed.
    return uniqueSorted((await run('fc-list', ['--format=%{family}\n'])).split('\n'));
}

async function listWindows() {
    // Use .NET's InstalledFontCollection via PowerShell (available on all modern Windows).
    const script = [
        'Add-Type -AssemblyName System.Drawing;',
        "(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }",
    ].join(' ');
    return uniqueSorted((await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script])).split('\n'));
}

/**
 * List installed font family names, Persian/priority fonts first.
 * @returns {Promise<string[]>}
 */
async function listInstalledFonts() {
    try {
        const platform = process.platform;
        if (platform === 'win32') return sortForPicker(await listWindows());
        if (platform === 'darwin' || platform === 'linux') {
            const fc = await listLinuxAndMac();
            if (fc.length) return sortForPicker(fc);
            // macOS without fontconfig: fall back to system_profiler (slow) → best effort.
            if (platform === 'darwin') {
                const out = await run('system_profiler', ['SPFontsDataType', '-json']);
                try {
                    const parsed = JSON.parse(out);
                    const items = parsed?.SPFontsDataType || [];
                    const names = items.flatMap(i => i?._name ? [i._name] : (i?.fonts || []));
                    if (names.length) return sortForPicker(uniqueSorted(names));
                } catch { /* ignore */ }
            }
            return [];
        }
    } catch { /* ignore */ }
    return [];
}

/**
 * Pick a sensible default family: the first installed Persian font, else an
 * installed system UI font, else null.
 * @param {string[]} families
 * @returns {string|null}
 */
function defaultFamily(families) {
    if (!Array.isArray(families) || !families.length) return null;
    const seen = new Set(families.map(f => f.toLowerCase()));
    for (const f of PERSIAN_FONTS) {
        if (seen.has(f.toLowerCase())) return f;
    }
    // prefer a Latin UI font over nothing
    const latin = families.find(f => COMMON_LATIN.has(f) || rank(f) === 1);
    return latin || families[0] || null;
}

module.exports = {
    PERSIAN_FONTS,
    listInstalledFonts,
    defaultFamily,
    sortForPicker,
};
