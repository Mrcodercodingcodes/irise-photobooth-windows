// One-time migration: converts the old hardcoded raw##_#.png / design##_#.png
// pairs (previously wired into CUSTOM_DESIGNS in photobooth.html) into the
// new public/skins/<id>/ folder format. Safe to re-run — skips pairs that
// don't exist and won't duplicate an already-migrated skin.
//
// Usage: node migrate-legacy-skins.js

const fs = require('fs');
const path = require('path');
const { createSkin, listSkins } = require('./lib/skinStore');
const { detectSlots } = require('./lib/slotDetection');

const PUBLIC_DIR = path.join(__dirname, 'public');
const LEGACY_RAW26_DIR = path.join(PUBLIC_DIR, 'legacy', 'raw26');

// [rawFile, designFile, displayName]
const LEGACY_PAIRS = [
    [path.join(LEGACY_RAW26_DIR, 'raw26_1.png'), path.join(LEGACY_RAW26_DIR, 'design26_1.png'), 'Back to School — Design 1'],
    [path.join(LEGACY_RAW26_DIR, 'raw26_2.png'), path.join(LEGACY_RAW26_DIR, 'design26_2.png'), 'Back to School — Design 2'],
    [path.join(LEGACY_RAW26_DIR, 'raw26_3.png'), path.join(LEGACY_RAW26_DIR, 'design26_3.png'), 'Back to School — Design 3'],
    ['raw46.png', 'design46_1.png', 'Classic 4-Up']
];
const REMOVED_PRESETS = new Set([
    'Back to School — Design 1',
    'Back to School — Design 2',
    'Back to School — Design 3',
    'Classic 4-Up'
]);

async function main() {
    const already = new Set(listSkins().map(s => s.name));

    for (const [rawFile, designFile, name] of LEGACY_PAIRS) {
        if (REMOVED_PRESETS.has(name)) {
            console.log(`[skip] ${name} — archived and excluded from the active catalog`);
            continue;
        }
        const rawPath = path.isAbsolute(rawFile) ? rawFile : path.join(PUBLIC_DIR, rawFile);
        const designPath = path.isAbsolute(designFile) ? designFile : path.join(PUBLIC_DIR, designFile);

        if (!fs.existsSync(rawPath) || !fs.existsSync(designPath)) {
            console.log(`[skip] ${name} — missing ${!fs.existsSync(rawPath) ? path.basename(rawPath) : path.basename(designPath)}`);
            continue;
        }
        if (already.has(name)) {
            console.log(`[skip] ${name} — already migrated`);
            continue;
        }

        const rawBuffer = fs.readFileSync(rawPath);
        const designBuffer = fs.readFileSync(designPath);
        const { width, height, slots } = await detectSlots(rawPath);

        if (slots.length === 0) {
            console.log(`[warn] ${name} — no slots detected, skipping`);
            continue;
        }

        const id = createSkin({ name, rawBuffer, designBuffer, slots, width, height });
        console.log(`[ok]   ${name} -> skins/${id}/ (${slots.length} slots)`);
    }

    console.log('\nDone. Legacy raw26/design26 files are kept under public/legacy/raw26.');
}

main().catch(e => { console.error(e); process.exit(1); });
