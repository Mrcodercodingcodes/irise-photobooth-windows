const fs = require('fs');
const path = require('path');

const SKINS_DIR = path.join(__dirname, '..', 'public', 'skins');

function ensureSkinsDir() {
    if (!fs.existsSync(SKINS_DIR)) fs.mkdirSync(SKINS_DIR, { recursive: true });
}

function slugify(name) {
    return String(name)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'skin';
}

function skinDir(id) {
    return path.join(SKINS_DIR, id);
}

// Cache sync FS reads: listSkins()/getSkin() are called on every
// /skins hit and every /process-video + /print. Without this each call
// does readdirSync + statSync per dir + readFileSync per meta, blocking
// the event loop while FFmpeg uploads are in flight.
let listCache = { data: null, at: 0 };
const LIST_TTL_MS = 5000;
const metaCache = new Map(); // id -> { mtimeMs, meta }

function readMetaCached(id) {
    const metaPath = path.join(skinDir(id), 'meta.json');
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(metaPath).mtimeMs; } catch (e) { metaCache.delete(id); throw e; }
    const hit = metaCache.get(id);
    if (hit && hit.mtimeMs === mtimeMs) return hit.meta;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    metaCache.set(id, { mtimeMs, meta });
    return meta;
}

function invalidateSkinCache(id) {
    listCache = { data: null, at: 0 };
    if (id) metaCache.delete(id);
    else metaCache.clear();
}

/** Returns list of skin summaries (id, name, width, height, slotCount, thumbnail paths). */
function listSkins() {
    const now = Date.now();
    if (listCache.data && (now - listCache.at) < LIST_TTL_MS) return listCache.data;
    ensureSkinsDir();
    const ids = fs.readdirSync(SKINS_DIR).filter(f => {
        const full = path.join(SKINS_DIR, f);
        return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'meta.json'));
    });

    const result = ids
        .map(id => {
            try {
                const meta = readMetaCached(id);
                return {
                    id,
                    name: meta.name || id,
                    width: meta.width,
                    height: meta.height,
                    slots: meta.slots,
                    qrCode: meta.qrCode || null,
                    enabled: meta.enabled !== false,
                    createdAt: meta.createdAt,
                    rawUrl: `/skins/${id}/raw.png`,
                    designUrl: `/skins/${id}/design.png`
                };
            } catch (e) {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    listCache = { data: result, at: Date.now() };
    return result;
}

function readMeta(id) {
    return readMetaCached(id);
}

function getSkin(id) {
    if (!id || id.includes('..') || id.includes('/')) return null;
    const dir = skinDir(id);
    if (!fs.existsSync(path.join(dir, 'meta.json'))) return null;
    const meta = readMetaCached(id);
    return {
        id,
        ...meta,
        rawPath: path.join(dir, 'raw.png'),
        designPath: path.join(dir, 'design.png')
    };
}

/**
 * Creates a new skin folder from raw/design buffers + confirmed slot data.
 * Returns the created skin's id.
 */
function createSkin({ name, rawBuffer, designBuffer, slots, width, height, qrCode }) {
    ensureSkinsDir();

    let id = slugify(name);
    let suffix = 2;
    while (fs.existsSync(skinDir(id))) {
        id = `${slugify(name)}-${suffix++}`;
    }

    const dir = skinDir(id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'raw.png'), rawBuffer);
    fs.writeFileSync(path.join(dir, 'design.png'), designBuffer);

    const meta = {
        name: name || id,
        width,
        height,
        slots,
        qrCode: qrCode || null,
        enabled: true,
        createdAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

    invalidateSkinCache();
    return id;
}

function deleteSkin(id) {
    const skin = getSkin(id);
    if (!skin) return false;
    fs.rmSync(skinDir(id), { recursive: true, force: true });
    invalidateSkinCache(id);
    return true;
}

function setSkinEnabled(id, enabled) {
    const skin = getSkin(id);
    if (!skin) return false;
    const metaPath = path.join(skinDir(id), 'meta.json');
    const meta = readMeta(id);
    meta.enabled = !!enabled;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    invalidateSkinCache(id);
    return true;
}

module.exports = { listSkins, getSkin, createSkin, deleteSkin, setSkinEnabled, SKINS_DIR };
