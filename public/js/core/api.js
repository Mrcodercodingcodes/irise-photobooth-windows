/**
 * Client API & Terminal Debug Manager
 * Handles communications with the local print/video server with auto-fallback.
 *
 * SERVER ROUTING ARCHITECTURE:
 *   Local server  (getServerUrl)      → skins, config, health — always localhost:8080
 *   Video server  (getReachableVideoServerBase)                → healthy homeserver, else localhost
 *
 * Set irise_homeserver_url in Settings → Operator to offload FFmpeg video processing
 * to a homeserver with fast internet, so guests' QR scan retrieves the processed
 * video from there instead of the slow venue connection.
 */

// ─────────────────────────────────────────────────────────────────────────────
// TERMINAL DEBUG LOG STORE
// ─────────────────────────────────────────────────────────────────────────────

export const terminalLogs = [];
const logListeners = new Set();

export function logTerminal(message, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const entry = { time, message, type };
  terminalLogs.push(entry);
  if (terminalLogs.length > 200) terminalLogs.shift();
  console.log(`[iRISE ${type.toUpperCase()}] ${message}`);
  for (const listener of logListeners) {
    try { listener(entry, terminalLogs); } catch (e) {}
  }
}

export function subscribeTerminalLogs(callback) {
  logListeners.add(callback);
  return () => logListeners.delete(callback);
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN STATIC PRESET DESIGNS (fallback when server is offline)
// ─────────────────────────────────────────────────────────────────────────────

export const STATIC_PRESET_DESIGNS = [
  {
    id: 'd1',
    name: 'Design 1 — UnknOwn',
    bg: 'skins/d1/raw.png',
    fg: 'skins/d1/design.png',
    slots: [
      { x: 69, y: 369,  w: 493, h: 322 },
      { x: 69, y: 728,  w: 493, h: 322 },
      { x: 69, y: 1087, w: 493, h: 322 },
      { x: 69, y: 1446, w: 493, h: 322 }
    ]
  },
  {
    id: 'd2',
    name: 'Design 2 — UnknOwn',
    bg: 'skins/d2/raw.png',
    fg: 'skins/d2/design.png',
    slots: [
      { x: 62, y: 134,  w: 494, h: 321 },
      { x: 62, y: 492,  w: 494, h: 321 },
      { x: 62, y: 850,  w: 494, h: 321 },
      { x: 62, y: 1208, w: 494, h: 322 }
    ]
  },
  {
    id: 'd3',
    name: 'Design 3 — UnknOwn',
    bg: 'skins/d3/raw.png',
    fg: 'skins/d3/design.png',
    slots: [
      { x: 62, y: 357,  w: 494, h: 321 },
      { x: 62, y: 710,  w: 493, h: 331 },
      { x: 62, y: 1067, w: 494, h: 322 },
      { x: 62, y: 1412, w: 494, h: 322 }
    ]
  },
  {
    id: 'd4',
    name: 'Design 4 — UnknOwn',
    bg: 'skins/d4/raw.png',
    fg: 'skins/d4/design.png',
    slots: [
      { x: 59, y: 157,  w: 494, h: 322 },
      { x: 59, y: 516,  w: 494, h: 322 },
      { x: 59, y: 875,  w: 494, h: 322 },
      { x: 59, y: 1235, w: 494, h: 322 }
    ]
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SERVER URL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Local server base — skins, config, health. Use the current local port when served locally. */
export function getServerBase() {
  const origin = window.location.origin;
  const localHosts = ['localhost', '127.0.0.1', '::1'];
  if (localHosts.includes(window.location.hostname) && window.location.port === '5500') {
    return 'http://localhost:8080';
  }
  return localHosts.includes(window.location.hostname) ? origin : 'http://localhost:8080';
}

export function getServerUrl(path = '') {
  const base = getServerBase();
  return `${base}${path.startsWith('/') ? path : '/' + path}`;
}

/**
 * Homeserver base URL for FFmpeg video processing.
 * When irise_homeserver_url is set, video uploads go to the remote homeserver
 * (e.g. https://xxxx.trycloudflare.com) so the processed video is served from
 * there — bypassing slow venue internet for guest QR retrieval.
 * Falls back to local server when not set.
 */
export function getVideoServerBase() {
  const homeserver = (localStorage.getItem('irise_homeserver_url') || '').trim().replace(/\/$/, '');
  return homeserver || getServerBase();
}

export function getVideoServerUrl(path = '') {
  const base = getVideoServerBase();
  return `${base}${path.startsWith('/') ? path : '/' + path}`;
}

export function getLocalVideoServerBase() {
  return getServerBase();
}

/** True when a separate homeserver is configured for video offloading */
export function hasHomeserver() {
  return !!(localStorage.getItem('irise_homeserver_url') || '').trim();
}

/** Use the homeserver only when it responds; otherwise keep the session local. */
export async function getReachableVideoServerBase() {
  if (!hasHomeserver()) return getLocalVideoServerBase();

  const homeserver = getVideoServerBase();
  const health = await checkHomeserverHealth();
  if (health.online) return homeserver;

  logTerminal(`Homeserver unavailable (${health.reason || 'no response'}). Using localhost for this session.`, 'warn');
  return getLocalVideoServerBase();
}

/** Prefer the homeserver or the public URL reported by the local print-server for guest QR links. */
export async function getVideoViewerBase(videoServerBase) {
  const selectedBase = (videoServerBase || '').replace(/\/$/, '');
  const homeserverBase = getVideoServerBase();
  const isLocalBase = (base) => {
    try {
      return ['localhost', '127.0.0.1', '::1'].includes(new URL(base).hostname);
    } catch (e) {
      return true;
    }
  };
  if (hasHomeserver() && selectedBase === homeserverBase && !isLocalBase(selectedBase)) return selectedBase;

  const localHealth = await checkServerHealth();
  const tunnelBase = (localHealth.publicUrl || '').trim().replace(/\/$/, '');
  if (localHealth.online && tunnelBase && !isLocalBase(tunnelBase)) return tunnelBase;

  // Settings can retain the print-server's tunnel URL while its config endpoint
  // is temporarily unavailable. Never prefer that cached value over an online
  // server explicitly reporting that it has no active public route.
  const savedTunnelBase = (localStorage.getItem('irise_public_url') || '').trim().replace(/\/$/, '');
  if (!localHealth.online && savedTunnelBase && !isLocalBase(savedTunnelBase)) return savedTunnelBase;

  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVER API CALLS
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchSkinDesigns() {
  logTerminal('Fetching skin designs from local server...', 'info');
  try {
    const res = await fetch(getServerUrl('/skins'), { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const skins = await res.json();
    if (!Array.isArray(skins) || skins.length === 0) throw new Error('Empty skin array');
    logTerminal(`Loaded ${skins.length} designs from server.`, 'success');
    return skins.map(s => ({
      id: s.id,
      name: s.name,
      bg: s.rawUrl.startsWith('http') ? s.rawUrl : getServerUrl(s.rawUrl),
      fg: s.designUrl.startsWith('http') ? s.designUrl : getServerUrl(s.designUrl),
      slots: s.slots,
      qrCode: s.qrCode || null
    }));
  } catch (err) {
    logTerminal(`Skin fetch failed (${err.message}). Using built-in presets.`, 'warn');
    return [...STATIC_PRESET_DESIGNS];
  }
}

export async function checkServerHealth() {
  try {
    const res = await fetch(getServerUrl('/config'), { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      return { online: true, publicUrl: data.publicUrl || '' };
    }
  } catch (e) {}
  return { online: false, publicUrl: '' };
}

/** Ping the homeserver to verify it's reachable from the kiosk */
export async function checkHomeserverHealth() {
  if (!hasHomeserver()) return { online: false, reason: 'not configured' };
  try {
    const res = await fetch(getVideoServerUrl('/health'), { signal: AbortSignal.timeout(5000) });
    if (res.ok) return { online: true, ...(await res.json()) };
  } catch (e) {
    return { online: false, reason: e.message };
  }
  return { online: false, reason: 'unreachable' };
}

export async function updateServerConfig(publicUrl) {
  logTerminal(`Updating server public URL: ${publicUrl || '(empty)'}`, 'info');
  try {
    const res = await fetch(getServerUrl('/update-config'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicUrl }),
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) logTerminal('Server configuration updated.', 'success');
    return res.ok;
  } catch (err) {
    logTerminal(`Config update failed: ${err.message}`, 'error');
    return false;
  }
}

/**
 * Send burst videos + skins to the video server (homeserver or local) for FFmpeg compositing.
 * When a homeserver is configured, files are uploaded there via tunnel so the processed
 * video is served from the homeserver's fast connection — not the venue's slow internet.
 */
export async function processVideoSession({ sessionId, burstBlobs, skinId, skinIdB, slots, slotsB, mirror = false, isDouble = false, photoBlob = null, serverBase = '', viewerBase = '' }) {
  const base = (serverBase || getVideoServerBase()).replace(/\/$/, '');
  const target = `${base}/process-video`;
  const isRemote = hasHomeserver() && base === getVideoServerBase();
  logTerminal(
    `Uploading to ${isRemote ? '🏠 homeserver' : '💻 local server'} for FFmpeg compositing...`,
    'info'
  );

  const formData = new FormData();
  formData.append('sessionId', sessionId);
  if (viewerBase) formData.append('viewerBase', viewerBase);
  formData.append('skin', skinId || '');
  formData.append('skinB', skinIdB || skinId || '');
  formData.append('slots', JSON.stringify(slots || []));
  if (slotsB) formData.append('slotsB', JSON.stringify(slotsB));
  formData.append('mirror', String(mirror));
  formData.append('isDouble', String(isDouble));

  if (photoBlob) {
    formData.append('photo', photoBlob, `${sessionId}.png`);
  }

  burstBlobs.forEach((blob, idx) => {
    formData.append('bursts', blob, `burst_${idx}.webm`);
  });

  try {
    const res = await fetch(target, { method: 'POST', body: formData });
    if (!res.ok) {
      const errText = await res.text();
      logTerminal(`Video processing error: ${errText}`, 'error');
      throw new Error(`Video processing failed: ${res.status} - ${errText}`);
    }
    const result = await res.json();
    logTerminal(`✅ Video composite ready! ${result.url ? `URL: ${result.url}` : ''}`, 'success');
    return result;
  } catch (e) {
    logTerminal(`Video processing request failed: ${e.message}`, 'error');
    throw e;
  }
}
