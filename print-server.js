const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const sharp = require('sharp');
const QRCode = require('qrcode');
const os = require('os');
const crypto = require('crypto');
const { detectSlots } = require('./lib/slotDetection');
const skinStore = require('./lib/skinStore');
const { Tunnel } = require('cloudflared');

// Load simple KEY=VALUE settings for local Windows installs without adding a
// runtime dependency. Existing process environment variables always win.
function loadLocalEnv() {
    const envFile = path.join(__dirname, '.env');
    if (!fs.existsSync(envFile)) return;

    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!match || process.env[match[1]] !== undefined) continue;

        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[match[1]] = value;
    }
}

loadLocalEnv();


// Provide FFmpeg with the exact path to the static binary
ffmpeg.setFfmpegPath(ffmpegStatic);

const app = express();
app.disable('x-powered-by');
const configuredPort = Number.parseInt(process.env.PORT || '8080', 10);
const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
    ? configuredPort
    : 8080;

// Setup directories for receiving raw video files and exports
const uploadDir = path.join(__dirname, 'temp_uploads');
const exportDir = path.join(__dirname, 'exports');
const tempDir = path.join(__dirname, 'temp_prints');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir);
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

// Videos now live outside public/ so old session exports aren't blanket-served
// to anyone who guesses/finds a URL. A dedicated route below serves them instead.
const videoDir = path.join(__dirname, 'private_videos');
if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir);

// ==========================================
// CONFIGURATION
// ==========================================

const FIREBASE_VIEW_URL = 'https://irise-photobooth.web.app/view';
const FIREBASE_ORIGINS = new Set([
    new URL(FIREBASE_VIEW_URL).origin,
    'https://irise-photobooth.firebaseapp.com'
]);
const CONFIG_FILE = path.join(__dirname, '.tunnel-config.json');

let PUBLIC_URL = '';
try {
    if (fs.existsSync(CONFIG_FILE)) {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        if (saved && saved.publicUrl) PUBLIC_URL = saved.publicUrl;
    }
} catch (e) {}

// Quick-tunnel hostnames are generated per run and must never be reused after
// a restart. The new tunnel URL is published only after cloudflared starts.
let discardSavedTunnelUrl = false;
try {
    if (PUBLIC_URL && new URL(PUBLIC_URL).hostname.toLowerCase().endsWith('.trycloudflare.com')) {
        PUBLIC_URL = '';
        discardSavedTunnelUrl = true;
    }
} catch (e) {
    PUBLIC_URL = '';
    discardSavedTunnelUrl = true;
}

function persistPublicUrl() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ publicUrl: PUBLIC_URL }, null, 2));
    } catch (e) {}
}
if (discardSavedTunnelUrl) persistPublicUrl();

function isTrustedOrigin(origin) {
    if (!origin) return true;
    try {
        const parsed = new URL(origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        if (FIREBASE_ORIGINS.has(parsed.origin)) return true;
        if (normalizeViewerBase(PUBLIC_URL) === parsed.origin) return true;
        if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return true;
        return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname);
    } catch (e) {
        return false;
    }
}

function requireTrustedOrigin(req, res, next) {
    const origin = req.get('origin');
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(req.hostname);
    if ((!origin && localHost) || isTrustedOrigin(origin)) return next();
    return res.status(403).json({ error: 'Untrusted request origin' });
}

const getBaseUrl = () => new URL(FIREBASE_VIEW_URL).origin;

function isSafeSkinReference(value) {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= 120
        && path.basename(value) === value
        && /^[A-Za-z0-9._-]+$/.test(value);
}

// Resolves a "skin" reference from the frontend into {designPath, rawPath}.
// Checks active skins and automatically creates an emergency fallback frame
// if no skin PNG file exists on the server.
function resolveSkinPaths(skinRef) {
    const requested = (skinRef && skinRef !== 'undefined' && skinRef !== 'null') ? String(skinRef) : '';
    const clean = isSafeSkinReference(requested) ? requested : '';

    if (clean) {
        const skin = skinStore.getSkin(clean);
        if (skin && fs.existsSync(skin.designPath)) {
            return {
                designPath: skin.designPath,
                rawPath: skin.rawPath,
                slots: skin.slots,
                qrCode: skin.qrCode || null
            };
        }

        // Direct check in public/skins/{clean}/design.png
        const directSkinPath = path.join(__dirname, 'public', 'skins', clean, 'design.png');
        if (fs.existsSync(directSkinPath)) {
            return {
                designPath: directSkinPath,
                rawPath: path.join(__dirname, 'public', 'skins', clean, 'raw.png'),
                slots: null,
                qrCode: null
            };
        }

        // Legacy path: a bare filename directly in public/
        const legacyDesignPath = path.join(__dirname, 'public', clean);
        if (fs.existsSync(legacyDesignPath)) {
            const legacyRawPath = path.join(__dirname, 'public', clean.replace('design', 'raw'));
            return { designPath: legacyDesignPath, rawPath: legacyRawPath, slots: null, qrCode: null };
        }
    }

    // Search any available installed skin in public/skins/
    const skins = skinStore.listSkins();
    for (const s of skins) {
        const full = skinStore.getSkin(s.id);
        if (full && fs.existsSync(full.designPath)) {
            return {
                designPath: full.designPath,
                rawPath: full.rawPath,
                slots: full.slots,
                qrCode: full.qrCode || null
            };
        }
    }

    // Emergency fail-safe: create a neutral fallback PNG outside the active skin catalog
    // so FFmpeg NEVER crashes without reintroducing a removed preset.
    const fallbackDir = path.join(__dirname, 'public', 'fallback');
    if (!fs.existsSync(fallbackDir)) fs.mkdirSync(fallbackDir, { recursive: true });
    const fallbackDesign = path.join(fallbackDir, 'design.png');
    if (!fs.existsSync(fallbackDesign)) {
        try {
            sharp({
                create: {
                    width: 618,
                    height: 1842,
                    channels: 4,
                    background: { r: 250, g: 246, b: 238, alpha: 1 }
                }
            }).png().toFile(fallbackDesign);
        } catch (e) {}
    }
    return {
        designPath: fallbackDesign,
        rawPath: fallbackDesign,
        slots: null,
        qrCode: null
    };
}

function normalizePublicUrl(url) {
    const value = (url || '').trim().replace(/\/$/, '');
    if (!value) return '';

    try {
        const parsed = new URL(value);
        const host = parsed.hostname.toLowerCase();
        const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
        const isPrivateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
        return parsed.protocol === 'https:' && !isLocalHost && !isPrivateIp ? parsed.origin : '';
    } catch (e) {
        return '';
    }
}

function getRequestBaseUrl(req) {
    const protocol = String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
    const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    if (!host || !['http', 'https'].includes(protocol)) return '';

    try {
        return new URL(`${protocol}://${host}`).origin;
    } catch (e) {
        return '';
    }
}

function normalizeViewerBase(value) {
    try {
        const parsed = new URL((value || '').trim());
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : '';
    } catch (e) {
        return '';
    }
}

async function generateLocalLink(sessionId, req, requestedBase = '') {
    const requestBase = getRequestBaseUrl(req);
    const publicBase = normalizeViewerBase(PUBLIC_URL);
    const viewerBase = normalizeViewerBase(requestedBase);
    const isLocalRequest = requestBase && ['localhost', '127.0.0.1', '::1'].includes(new URL(requestBase).hostname);
    const isKnownViewerBase = viewerBase && (viewerBase === requestBase || viewerBase === publicBase);
    const isKnownRequestBase = requestBase && (isLocalRequest || requestBase === publicBase);
    const baseUrl = (isKnownViewerBase && viewerBase) || (isLocalRequest && publicBase) || (isKnownRequestBase && requestBase) || publicBase || getBaseUrl() || `http://localhost:${port}`;
    const viewerUrl = `${baseUrl}/view.html`;
    return sessionId ? `${viewerUrl}?id=${encodeURIComponent(sessionId)}` : viewerUrl;
}

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors({
    origin(origin, callback) {
        callback(null, isTrustedOrigin(origin));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-admin-token']
}));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
});
app.use(bodyParser.json({ limit: '25mb' }));
app.use(bodyParser.urlencoded({ limit: '1mb', extended: false }));

// Endpoint to get config dynamically
app.get('/config', (req, res) => {
    res.json({ publicUrl: PUBLIC_URL });
});

// Endpoint to update config dynamically
app.post('/update-config', requireTrustedOrigin, (req, res) => {
    if (!req.body) return res.status(400).json({ error: 'No request body' });

    const { publicUrl } = req.body;
    if (publicUrl !== undefined) {
        PUBLIC_URL = normalizePublicUrl(publicUrl);
        persistPublicUrl();
        console.log(`[iRISE] PUBLIC_URL updated to: ${PUBLIC_URL}`);
        res.json({ success: true, publicUrl: PUBLIC_URL });
    } else {
        res.status(400).json({ error: 'Missing publicUrl' });
    }
});

// Health check endpoint — kiosk pings this to verify the homeserver is reachable
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        server: 'iRISE Photobooth Print Server',
        uptime: Math.floor(process.uptime()),
        publicUrl: PUBLIC_URL || null,
        videoQueue: { active: activeVideoJobs, queued: videoQueueDepth(), concurrency: VIDEO_CONCURRENCY },
        timestamp: new Date().toISOString()
    });
});

app.get('/queue', (req, res) => {
    res.json({ active: activeVideoJobs, queued: videoQueueDepth(), concurrency: VIDEO_CONCURRENCY });
});


// ==========================================
// ADMIN AUTH (for the skin-management UI)
// ==========================================
// Set a real password via env var before exposing this server past localhost.
// Falls back to a generated one printed at boot so it's never silently blank.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_ADMIN_TOKENS = 100;
const adminTokens = new Map(); // token -> expiry, cleared on restart
const loginAttempts = new Map(); // client -> recent attempt timestamps

function requireAdmin(req, res, next) {
    if (!isTrustedOrigin(req.get('origin'))) return res.status(403).json({ error: 'Untrusted request origin' });
    const token = req.get('x-admin-token');
    const expiresAt = token && adminTokens.get(token);
    if (expiresAt && expiresAt > Date.now()) return next();
    if (token) adminTokens.delete(token);
    res.status(401).json({ error: 'Unauthorized' });
}

app.post('/admin/login', requireTrustedOrigin, (req, res) => {
    const { password } = req.body || {};
    const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recentAttempts = (loginAttempts.get(clientKey) || []).filter(timestamp => now - timestamp < 15 * 60 * 1000);
    if (recentAttempts.length >= 10) {
        return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }
    recentAttempts.push(now);
    loginAttempts.set(clientKey, recentAttempts);

    const expected = Buffer.from(ADMIN_PASSWORD);
    const supplied = Buffer.from(typeof password === 'string' ? password : '');
    const passwordMatches = expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
    if (passwordMatches) {
        loginAttempts.delete(clientKey);
        const token = crypto.randomBytes(24).toString('base64url');
        if (adminTokens.size >= MAX_ADMIN_TOKENS) {
            const oldest = [...adminTokens.entries()].sort((a, b) => a[1] - b[1])[0];
            if (oldest) adminTokens.delete(oldest[0]);
        }
        adminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL_MS);
        return res.json({ success: true, token });
    }
    res.status(401).json({ error: 'Incorrect password' });
});

app.get('/admin/verify', requireAdmin, (req, res) => res.json({ valid: true }));

// ==========================================
// SESSION & UTILS
// ==========================================
let recentSessions = [];
let sessionDataStore = Object.create(null); // sessionId -> { qrBuffer, viewerUrl }

// Persist sessions so a restart doesn't invalidate QR codes / /sessions.
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
function loadPersistedSessions() {
    try {
        if (!fs.existsSync(SESSIONS_FILE)) return;
        const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
        if (Array.isArray(raw.recentSessions)) {
            recentSessions = raw.recentSessions.slice(-50);
        }
        if (raw.sessions && typeof raw.sessions === 'object') {
            for (const [id, s] of Object.entries(raw.sessions)) {
                if (!id || typeof s !== 'object') continue;
                sessionDataStore[id] = {
                    viewerUrl: s.viewerUrl || null,
                    qrBuffer: s.qrBase64 ? Buffer.from(s.qrBase64, 'base64') : null
                };
            }
        }
        console.log(`[iRISE] Restored ${recentSessions.length} sessions from disk.`);
    } catch (e) {
        console.log(`[iRISE] No sessions restored: ${e.message}`);
    }
}
let persistTimer = null;
function persistSessions() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        try {
            const sessions = {};
            for (const [id, s] of Object.entries(sessionDataStore)) {
                sessions[id] = {
                    viewerUrl: s.viewerUrl || null,
                    qrBase64: s.qrBuffer ? s.qrBuffer.toString('base64') : null
                };
            }
            fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ recentSessions, sessions }, null, 2));
        } catch (e) {}
    }, 500);
}
loadPersistedSessions();

// Bound FFmpeg concurrency: without this, 2-3 simultaneous /process-video
// calls each spawn libx264 and thrash the CPU, stalling all exports.
const VIDEO_CONCURRENCY = Math.max(1, parseInt(process.env.VIDEO_CONCURRENCY || '2', 10));
const VIDEO_QUEUE_MAX = 10;
let activeVideoJobs = 0;
const videoWaiters = [];
function videoQueueDepth() { return videoWaiters.length; }
function acquireVideoSlot() {
    if (activeVideoJobs < VIDEO_CONCURRENCY) {
        activeVideoJobs++;
        return Promise.resolve();
    }
    if (videoWaiters.length >= VIDEO_QUEUE_MAX) {
        const err = new Error('Video server busy — queue full, retry in a few seconds');
        err.status = 429;
        return Promise.reject(err);
    }
    return new Promise(resolve => videoWaiters.push(resolve));
}
function releaseVideoSlot() {
    activeVideoJobs = Math.max(0, activeVideoJobs - 1);
    const next = videoWaiters.shift();
    if (next) { activeVideoJobs++; next(); }
}

// QR code placement is defined by a red square in the raw blueprint. Older
// skins without a marker retain the historical bottom-right fallback.
async function getQrArea(templatePath, configuredArea = null, outputWidth = 0, outputHeight = 0) {
    try {
        const metadata = await sharp(templatePath).metadata();

        let area = configuredArea;
        if (!area) {
            try {
                area = (await detectSlots(templatePath)).qrCode;
            } catch (detectError) {
                console.warn(`[iRISE] QR marker detection skipped: ${detectError.message}`);
            }
        }

        if (!area) {
            const QR_SIZE = 80;
            const QR_PADDING = 25;
            area = {
                x: metadata.width - QR_SIZE - QR_PADDING,
                y: metadata.height - QR_SIZE - QR_PADDING,
                w: QR_SIZE,
                h: QR_SIZE
            };
            console.log(`[iRISE] QR placement: legacy bottom-right ${QR_SIZE}x${QR_SIZE} at (${area.x}, ${area.y})`);
        } else {
            console.log(`[iRISE] QR placement: red marker ${area.w}x${area.h} at (${area.x}, ${area.y})`);
        }

        const scaleX = outputWidth && metadata.width ? outputWidth / metadata.width : 1;
        const scaleY = outputHeight && metadata.height ? outputHeight / metadata.height : 1;
        return {
            x: Math.round(area.x * scaleX),
            y: Math.round(area.y * scaleY),
            w: Math.max(1, Math.round(area.w * scaleX)),
            h: Math.max(1, Math.round(area.h * scaleY))
        };
    } catch (err) {
        console.error('[iRISE] Error reading template metadata:', err);
        // Fallback for a typical 4x6 strip at 300dpi (1200x1800)
        return { x: 1115, y: 1715, w: 80, h: 80 };
    }
}



const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const extension = path.extname(path.basename(file.originalname || '')).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
        cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024,
        fieldSize: 10 * 1024 * 1024,
        files: 16,
        fields: 20,
        parts: 40,
        headerPairs: 2000
    }
});

// ==========================================
// SKINS API
// ==========================================
// A "skin" is a raw.png (white/transparent = photo slot, everything else =
// design space) + design.png (the matching art overlay) + detected slot
// rectangles. Public listing is read-only; creating/deleting requires the
// admin token from /admin/login.

const skinUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 25 * 1024 * 1024,
        files: 2,
        fields: 10,
        parts: 20,
        headerPairs: 2000
    }
});

function removeUploadedFiles(files) {
    for (const file of files || []) {
        if (file?.path) {
            try { fs.unlinkSync(file.path); } catch (e) {}
        }
    }
}

function handleVideoUpload(req, res, next) {
    upload.any()(req, res, (err) => {
        if (err) {
            removeUploadedFiles(req.files);
            return next(err);
        }
        next();
    });
}

function validateSlotArray(slots, width, height, label) {
    if (!Array.isArray(slots) || slots.length === 0 || slots.length > 32) {
        throw new Error(`${label} must contain between 1 and 32 slots`);
    }
    return slots.map((slot) => {
        const values = ['x', 'y', 'w', 'h'].map(key => Number(slot?.[key]));
        if (values.some(value => !Number.isInteger(value))) {
            throw new Error(`${label} contains non-integer slot bounds`);
        }
        const [x, y, w, h] = values;
        if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > width || y + h > height) {
            throw new Error(`${label} contains out-of-bounds slot bounds`);
        }
        return { x, y, w, h };
    });
}

// Public: list all enabled skins for the picker UI
app.get('/skins', (req, res) => {
    const all = skinStore.listSkins();
    const visible = req.query.all === 'true' ? all : all.filter(s => s.enabled);
    res.json(visible);
});

// Admin: analyze an uploaded raw+design pair and return detected slots,
// WITHOUT saving anything yet — lets the admin UI show a preview to confirm.
app.post('/admin/skins/preview', requireAdmin, skinUpload.fields([{ name: 'raw', maxCount: 1 }, { name: 'design', maxCount: 1 }]), async (req, res) => {
    try {
        const rawFile = req.files?.raw?.[0];
        const designFile = req.files?.design?.[0];
        if (!rawFile || !designFile) return res.status(400).json({ error: 'Both raw and design images are required' });

        const { width, height, slots, qrCode } = await detectSlots(rawFile.buffer);
        if (slots.length === 0) {
            return res.status(422).json({ error: 'No photo slots detected — check that slot areas in the raw image are pure white or transparent' });
        }

        // Return everything as base64 so the admin UI can preview without a second round-trip
        res.json({
            width,
            height,
            slots,
            qrCode,
            rawPreview: `data:${rawFile.mimetype};base64,${rawFile.buffer.toString('base64')}`,
            designPreview: `data:${designFile.mimetype};base64,${designFile.buffer.toString('base64')}`
        });
    } catch (err) {
        console.error('[iRISE] Skin preview error:', err);
        res.status(500).json({ error: 'Failed to analyze images' });
    }
});

// Admin: confirm and save a new skin. Expects the same files again plus the
// (possibly admin-adjusted) slot rectangles and a display name.
app.post('/admin/skins', requireAdmin, skinUpload.fields([{ name: 'raw', maxCount: 1 }, { name: 'design', maxCount: 1 }]), async (req, res) => {
    try {
        const rawFile = req.files?.raw?.[0];
        const designFile = req.files?.design?.[0];
        const { name, width, height } = req.body;
        let slots;
        try {
            slots = JSON.parse(req.body.slots || '[]');
        } catch (e) {
            return res.status(400).json({ error: 'Invalid slots JSON' });
        }

        if (!rawFile || !designFile) return res.status(400).json({ error: 'Both raw and design images are required' });
        if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
        if (!Array.isArray(slots) || slots.length === 0) return res.status(400).json({ error: 'At least one slot is required' });

        let qrCode = null;
        try {
            qrCode = JSON.parse(req.body.qrCode || 'null');
        } catch (e) {
            return res.status(400).json({ error: 'Invalid QR code marker JSON' });
        }
        if (qrCode && (!Number.isFinite(qrCode.x) || !Number.isFinite(qrCode.y) || !Number.isFinite(qrCode.w) || !Number.isFinite(qrCode.h) || qrCode.x < 0 || qrCode.y < 0 || qrCode.w <= 0 || qrCode.h <= 0)) {
            return res.status(400).json({ error: 'Invalid QR code marker bounds' });
        }

        const id = skinStore.createSkin({
            name: name.trim(),
            rawBuffer: rawFile.buffer,
            designBuffer: designFile.buffer,
            slots,
            width: parseInt(width, 10),
            height: parseInt(height, 10),
            qrCode
        });

        console.log(`[iRISE] Skin created: ${id} (${slots.length} slots)`);
        res.json({ success: true, id });
    } catch (err) {
        console.error('[iRISE] Skin create error:', err);
        res.status(500).json({ error: 'Failed to save skin' });
    }
});

app.delete('/admin/skins/:id', requireAdmin, (req, res) => {
    const ok = skinStore.deleteSkin(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Skin not found' });
    res.json({ success: true });
});

app.patch('/admin/skins/:id', requireAdmin, (req, res) => {
    const ok = skinStore.setSkinEnabled(req.params.id, req.body?.enabled);
    if (!ok) return res.status(404).json({ error: 'Skin not found' });
    res.json({ success: true });
});

// ==========================================
// 1. PRINT ENDPOINT
// ==========================================
app.post('/print', requireTrustedOrigin, async (req, res) => {
    const { image, sessionId, skin, autoPrint } = req.body || {};
    console.log(`[iRISE] Print Request: session=${sessionId}, skin=${skin}, autoPrint=${autoPrint}`);

    if (typeof image !== 'string' || !image.startsWith('data:image/png;base64,')) {
        return res.status(400).send('No valid PNG image data');
    }
    if (sessionId !== undefined && sessionId !== null && sessionId !== '' && !/^[A-Za-z0-9_-]{1,64}$/.test(String(sessionId))) {
        return res.status(400).send('Invalid session ID');
    }

    try {
        const base64Data = image.slice('data:image/png;base64,'.length);
        const fileName = `print_${Date.now()}.png`;
        const filePath = path.join(tempDir, fileName);

        let imageBuffer = Buffer.from(base64Data, 'base64');

        const { designPath: skinPath, rawPath, qrCode } = resolveSkinPaths(skin);
        let session = sessionDataStore[sessionId];

        if (!session) {
            console.log(`[iRISE] No session found for ${sessionId}, generating a default QR...`);
            const fallbackUrl = await generateLocalLink(sessionId, req);
            const qrBuffer = await QRCode.toBuffer(fallbackUrl, {
                margin: 2,
                color: { dark: '#ff4d00', light: '#ffffff' }
            });
            session = { qrBuffer, viewerUrl: fallbackUrl };
        }

        // Apply Design Overlay FIRST (to make sure graphics are on top)
        if (fs.existsSync(skinPath)) {
            console.log(`[iRISE] Applying Design Overlay to Print...`);
            imageBuffer = await sharp(imageBuffer)
                .composite([{ input: skinPath }])
                .toBuffer();
        }

        if (session && session.qrBuffer) {
            console.log(`[iRISE] Applying QR code...`);
            const outputMetadata = await sharp(imageBuffer).metadata();
            let redArea = await getQrArea(rawPath, qrCode, outputMetadata.width, outputMetadata.height);

            console.log(`[iRISE] Final QR Placement: x:${redArea.x}, y:${redArea.y}, size:${redArea.w}x${redArea.h}`);

            const qrResized = await sharp(session.qrBuffer)
                .resize(redArea.w, redArea.h)
                .toBuffer();

            imageBuffer = await sharp(imageBuffer)
                .composite([{ input: qrResized, left: redArea.x, top: redArea.y }])
                .toBuffer();

            console.log(`[iRISE] QR code successfully applied.`);
        }

        await fs.promises.writeFile(filePath, imageBuffer);
        console.log(`[iRISE] Print saved to: ${fileName}`);

        // Send back the final image with the QR code so the user can download IT
        const qrImageBase64 = imageBuffer.toString('base64');
        res.json({ success: true, qrImage: `data:image/png;base64,${qrImageBase64}` });

        const shouldPrint = req.body.autoPrint !== false; // defaults to true if undefined

        if (shouldPrint) {
            // Detect OS and use the correct print command
            const isMac = process.platform === 'darwin';
            const cmd = isMac
                ? `lp "${filePath}"`
                : `powershell -Command "Start-Process -FilePath '${filePath}' -Verb Print -WindowStyle Hidden"`;

            exec(cmd, (error) => {
                if (error) {
                    console.error('[iRISE] Print command failed:', error);
                } else {
                    console.log(`[iRISE] Successfully sent to ${isMac ? 'Mac' : 'Windows'} printer queue.`);
                }
            });
        } else {
            console.log(`[iRISE] Print skipped because autoPrint is false.`);
        }
    } catch (err) {
        console.error('[iRISE] Print Processing Error:', err);
        res.status(500).send('Processing failed');
    }
});

// ==========================================
// 2. FFMPEG VIDEO PROCESSING ENDPOINT
// ==========================================
app.post('/process-video', requireTrustedOrigin, handleVideoUpload, async (req, res) => {
    const cleanupUploads = () => {
        removeUploadedFiles(req.files);
    };
    let slotAcquired = false;
    const releaseOnce = () => { if (slotAcquired) { slotAcquired = false; releaseVideoSlot(); } };
    req.on('close', () => { if (!res.writableFinished) releaseOnce(); });
    try {
        const { skin, skinB, slots, slotsB, mirror, sessionId, ffmpegPreset, ffmpegCrf, isDouble, viewerBase } = req.body || {};
        const bursts = req.files ? req.files.filter(f => f.fieldname === 'bursts') : [];
        const photoFile = req.files ? req.files.find(f => f.fieldname === 'photo') : null;

        if (!bursts || bursts.length === 0) return res.status(400).send('No video files provided');
        if (bursts.length > 8 || (req.files || []).some(file => !['bursts', 'photo'].includes(file.fieldname)) || (req.files || []).filter(file => file.fieldname === 'photo').length > 1) {
            cleanupUploads();
            return res.status(400).send('Invalid video upload fields');
        }
        if (!slots) return res.status(400).send('No slot coordinates provided');
        if (sessionId !== undefined && sessionId !== null && sessionId !== '' && !/^[A-Za-z0-9_-]{1,64}$/.test(String(sessionId))) {
            cleanupUploads();
            return res.status(400).send('Invalid session ID');
        }

        let slotData;
        let slotDataB;
        try {
            slotData = JSON.parse(slots);
            slotDataB = slotsB ? JSON.parse(slotsB) : slotData;
        } catch (parseError) {
            cleanupUploads();
            return res.status(400).send('Invalid slot coordinates');
        }

        const isDoubleStrip = isDouble === 'true';
        const skinInfo = resolveSkinPaths(skin);
        const skinInfoB = resolveSkinPaths(skinB || skin);
        const skinPath = skinInfo.designPath.replace(/\\/g, '/');
        const skinPathB = skinInfoB.designPath.replace(/\\/g, '/');

        let sWidth = 0;
        let sHeight = 0;
        try {
            const skinMeta = await sharp(skinPath).metadata();
            sWidth = skinMeta.width || 0;
            sHeight = skinMeta.height || 0;
        } catch (metadataError) {}
        if (!sWidth || !sHeight) {
            sWidth = 300;
            sHeight = 900;
        }

        try {
            slotData = validateSlotArray(slotData, sWidth, sHeight, 'slots');
            slotDataB = isDoubleStrip ? validateSlotArray(slotDataB, sWidth, sHeight, 'slotsB') : slotData;
        } catch (validationError) {
            cleanupUploads();
            return res.status(400).send(validationError.message);
        }

        try {
            await acquireVideoSlot();
        } catch (qErr) {
            cleanupUploads();
            return res.status(qErr.status || 429).json({ error: qErr.message });
        }
        slotAcquired = true;
        console.log(`[iRISE] Video job ${sessionId || '(no id)'} started (active=${activeVideoJobs}, queued=${videoQueueDepth()})`);

        // videoDir is declared once near the top of the file (private_videos/,
        // outside public/, served via the dedicated /videos/:file route below)

        const outputFileName = sessionId ? `${sessionId}.mp4` : `iRISE_Export_${Date.now()}.mp4`;
        const outputPath = path.join(videoDir, outputFileName).replace(/\\/g, '/');

        const sortedBursts = bursts.sort((a, b) => {
            const indexA = parseInt(a.originalname.match(/burst_(\d+)/)?.[1] || 0);
            const indexB = parseInt(b.originalname.match(/burst_(\d+)/)?.[1] || 0);
            return indexA - indexB;
        });

        let command = ffmpeg();

        // 1. Input 0 is the left SKIN (determines the video resolution)
        command.input(skinPath);
        if (isDoubleStrip) {
            command.input(skinPathB);
        }

        // 2. Remaining inputs are the sorted bursts
        sortedBursts.forEach(file => command.input(file.path.replace(/\\/g, '/')));

        let filterParts = [];
        const hflip = (mirror === 'true') ? 'hflip,' : '';

        let activeSlots = [...slotData];
        if (isDoubleStrip) {
            // Add the right strip's own slots shifted by the skin width.
            slotDataB.forEach(s => {
                activeSlots.push({
                    x: s.x + sWidth,
                    y: s.y,
                    w: s.w,
                    h: s.h
                });
            });
        }

        // Step A: Prepare a video stream for EVERY active slot (both Strip A and Strip B)
        // If there are 8 slots and 4 bursts, slot 0 and slot 4 both map to burst 0, scaled to their own slot dimensions.
        let overlayInputs = [];
        activeSlots.forEach((s, i) => {
            const burstIdx = (i % sortedBursts.length) + (isDoubleStrip ? 2 : 1);
            const slotStreamLabel = `v_slot_${i}`;
            filterParts.push(`[${burstIdx}:v]${hflip}scale=${s.w}:${s.h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${s.w}:${s.h}[${slotStreamLabel}]`);
            overlayInputs.push(slotStreamLabel);
        });

        // Step B: Build the composition
        // Start with a BLACK background of the correct composite canvas size
        if (isDoubleStrip) {
            // Pad the left skin, place the right skin, then split into black video base + final skin overlay.
            filterParts.push(`[0:v]pad=${sWidth * 2}:${sHeight}:0:0:color=black@0[left_pad];[left_pad][1:v]overlay=${sWidth}:0,split=2[bg_tiled1][bg_tiled2];[bg_tiled1]drawbox=c=black:t=fill[blackbg]`);
        } else {
            // Single strip
            filterParts.push(`[0:v]split=2[skin1][skin2];[skin1]drawbox=c=black:t=fill[blackbg]`);
        }

        let lastLabel = 'blackbg';
        activeSlots.forEach((s, i) => {
            if (i < overlayInputs.length) {
                const inputLabel = `[${overlayInputs[i]}]`;
                const nextLabel = `vidbg${i}`;
                filterParts.push(`[${lastLabel}]${inputLabel}overlay=${s.x}:${s.y}[${nextLabel}]`);
                lastLabel = nextLabel;
            }
        });

        // Step D: OVERLAY THE SKIN LAST (So graphics are on top)
        if (isDoubleStrip) {
            filterParts.push(`[${lastLabel}][bg_tiled2]overlay=0:0[final_composition]`);
        } else {
            filterParts.push(`[${lastLabel}][skin2]overlay=0:0[final_composition]`);
        }

        command
            .complexFilter([
                filterParts.join('; ') + `;[final_composition]format=yuv420p[final]`
            ])
            .map('[final]');

        const allowedPresets = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium']);
        const preset = allowedPresets.has(String(ffmpegPreset)) ? String(ffmpegPreset) : 'veryfast';
        const parsedCrf = Number(ffmpegCrf);
        const crf = Number.isInteger(parsedCrf) && parsedCrf >= 0 && parsedCrf <= 51 ? String(parsedCrf) : '18';

        command.outputOptions([
            '-c:v libx264',
            '-profile:v high',
            '-level:v 4.1',
            '-pix_fmt yuv420p',
            `-crf ${crf}`,
            `-preset ${preset}`,
            '-tune zerolatency',
            '-movflags +faststart',
            '-threads 0'
        ]);

        command.save(outputPath)
            .on('start', (commandLine) => {
                console.log(`[iRISE] FFmpeg started with command: ${commandLine}`);
            })
            .on('progress', (progress) => {
                if (progress.percent) {
                    console.log(`[iRISE] FFmpeg processing: ${Math.round(progress.percent)}% done`);
                }
            })
            .on('end', async () => {
                console.log(`[iRISE] Video exported successfully: ${outputFileName}`);
                const sessionUrl = `/videos/${outputFileName}`;

                // Save photo strip alongside the video if uploaded
                if (photoFile) {
                    const outputPhotoName = outputFileName.replace(/\.[^/.]+$/, "") + ".png";
                    const outputPhotoPath = path.join(videoDir, outputPhotoName);
                    try {
                        fs.copyFileSync(photoFile.path, outputPhotoPath);
                        console.log(`[iRISE] Photo strip saved to: ${outputPhotoName}`);
                    } catch (err) {
                        console.error('[iRISE] Error copying photo strip:', err);
                    }
                }

                // 4. Generate QR link based on the viewer page
                const viewerUrl = await generateLocalLink(sessionId, req, viewerBase);
                let qrBuffer = null;
                if (viewerUrl) {
                    qrBuffer = await QRCode.toBuffer(viewerUrl, {
                        margin: 2,
                        color: { dark: '#ff4d00', light: '#ffffff' }
                    });
                }

                if (sessionId) {
                    sessionDataStore[sessionId] = {
                        qrBuffer: qrBuffer,
                        viewerUrl: viewerUrl
                    };
                }

                recentSessions.push({ id: sessionId || Date.now(), url: sessionUrl, viewerUrl, timestamp: new Date() });
                if (recentSessions.length > 50) recentSessions.shift();
                persistSessions();

                // Clean up all temporary uploaded files
                removeUploadedFiles(req.files);

                releaseOnce();
                if (!res.writableFinished) res.json({ success: true, url: sessionUrl, viewerUrl: viewerUrl });
            })
            .on('error', (err) => {
                console.error('[iRISE] FFmpeg error:', err.message);

                // Clean up all temporary uploaded files on error
                removeUploadedFiles(req.files);

                releaseOnce();
                if (!res.writableFinished) res.status(500).json({ error: 'Video processing failed' });
            });

    } catch (error) {
        console.error('[iRISE] Server Error:', error);
        releaseOnce();
        cleanupUploads();
        if (!res.writableFinished) res.status(500).json({ error: error.message });
    }
});

// Periodic cleanup of stale temporary files (older than 2 hours)
function cleanupTempFiles() {
    const maxAgeMs = 2 * 60 * 60 * 1000;
    const now = Date.now();
    [uploadDir, tempDir].forEach(dir => {
        if (!fs.existsSync(dir)) return;
        fs.readdir(dir, (err, files) => {
            if (err) return;
            files.forEach(file => {
                const fp = path.join(dir, file);
                fs.stat(fp, (sErr, stats) => {
                    if (!sErr && (now - stats.mtimeMs) > maxAgeMs) {
                        try { fs.unlinkSync(fp); } catch (e) { }
                    }
                });
            });
        });
    });
}
setInterval(cleanupTempFiles, 30 * 60 * 1000);

const staticOpts = { maxAge: '1h', etag: true };
app.use(express.static(path.join(__dirname, 'public'), staticOpts));
app.use('/public', express.static(path.join(__dirname, 'public'), staticOpts));
app.use('/exports', express.static(exportDir, staticOpts));

// Videos are served explicitly from private_videos/ (outside public/) rather
// than via blanket static middleware, so old exports aren't listable/guessable
// by anyone browsing the site — only reachable if you already have the exact
// session filename (e.g. from a QR code or the /sessions list).
app.get('/videos/:file', (req, res) => {
    const file = req.params.file;
    if (!file || path.basename(file) !== file || !/^[A-Za-z0-9._-]+\.(mp4|png)$/i.test(file)) return res.status(400).end();
    const filePath = path.join(videoDir, file);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
});

app.get('/sessions', requireAdmin, (req, res) => res.json(recentSessions));

app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof SyntaxError && err.status === 400 && Object.prototype.hasOwnProperty.call(err, 'body')) {
        return res.status(400).json({ error: 'Invalid JSON request body' });
    }
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: 'Upload rejected: request limits exceeded' });
    }
    console.error('[iRISE] Request error:', err.message);
    res.status(500).json({ error: 'Request failed' });
});

const server = app.listen(port, '0.0.0.0', () => {
    console.log(`\n========================================`);
    console.log(`iRISE PHOTOBOOTH: HYBRID SERVER`);
    console.log(`Status: ACTIVE`);
    console.log(`Port: ${port}`);
    console.log(`========================================\n`);

    if (process.env.ADMIN_PASSWORD) {
        console.log(`[iRISE] Admin panel password loaded from ADMIN_PASSWORD env var.`);
    } else {
        console.log(`[iRISE] No ADMIN_PASSWORD set — generated one for this session:`);
        console.log(`[iRISE]   >>> ${ADMIN_PASSWORD} <<<`);
        console.log(`[iRISE] This changes every restart. Set ADMIN_PASSWORD in your environment to keep it stable.\n`);
    }

    if (process.env.DISABLE_TUNNEL === 'true') {
        console.log(`[iRISE] Cloudflare Tunnel disabled (DISABLE_TUNNEL=true).`);
        return;
    }

    // Auto-start Cloudflare Tunnel using the `cloudflared` npm package directly
    // (a real dependency with the binary installed at `npm install` time) —
    // no more `npx untun@latest` fetching+running something fresh on every
    // boot, which was unreliable on some Windows setups.
    console.log(`[iRISE] Starting Cloudflare Tunnel automatically...`);

    let tunnel;
    let autoTunnelUrl = '';
    try {
        tunnel = Tunnel.quick(`http://localhost:${port}`);
    } catch (err) {
        console.log(`[iRISE] Could not start Cloudflare Tunnel: ${err.message}`);
        console.log(`[iRISE] The photobooth will still work locally at http://localhost:${port} — QR codes for phones just won't work without a tunnel.`);
        return;
    }

    const tunnelTimeout = setTimeout(() => {
        console.log(`[iRISE] Tunnel is taking a while to connect — this can happen on slower networks. Still trying...`);
    }, 15000);

    tunnel.on('url', (url) => {
        clearTimeout(tunnelTimeout);
        autoTunnelUrl = url;
        PUBLIC_URL = url;
        persistPublicUrl();
        console.log(`\n>>> [SUCCESS] Cloudflare Tunnel established!`);
        console.log(`>>> PUBLIC URL: ${PUBLIC_URL}\n`);
    });

    tunnel.on('error', (err) => {
        clearTimeout(tunnelTimeout);
        console.log(`[iRISE] Tunnel error: ${err.message}`);
        console.log(`[iRISE] The photobooth will still work locally at http://localhost:${port} — QR codes for phones just won't work until the tunnel reconnects.`);
    });

    tunnel.on('exit', (code) => {
        clearTimeout(tunnelTimeout);
        // The npm wrapper can emit a URL before cloudflared finishes starting.
        // If its process exits, remove that dead URL so QR codes never encode it.
        if (autoTunnelUrl && PUBLIC_URL === autoTunnelUrl) {
            PUBLIC_URL = '';
            persistPublicUrl();
            console.log('[iRISE] Cloudflare Tunnel stopped; cleared its expired public URL.');
        }
        if (code !== 0 && !PUBLIC_URL) {
            console.log(`[iRISE] Cloudflare Tunnel exited before connecting (code ${code}).`);
            console.log(`[iRISE] The photobooth still works locally at http://localhost:${port} — QR codes for phones just won't work without a tunnel.`);
            console.log(`[iRISE] If this keeps happening: check your internet connection, or that nothing (firewall/antivirus) is blocking cloudflared.exe.`);
        } else {
            console.log(`[Tunnel] Process exited with code ${code}`);
        }
    });
});

// Increase timeout for large video uploads
server.timeout = 300000; // 5 minutes
