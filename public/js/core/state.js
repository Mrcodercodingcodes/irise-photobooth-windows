/**
 * Central State Store for iRISE Photobooth
 */

export const CONFIG = {
  TOTAL_SHOTS: 8,
  MAX_SELECT: 4,
  DEFAULT_TIMER_SECONDS: 3
};

/**
 * Generate clean 5-character alphanumeric uppercase code (e.g. K7X9P)
 */
export function generateSessionCode(length = 5) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

class StateStore {
  constructor() {
    this.reset();
  }

  reset() {
    // Revoke any previous object URLs to prevent memory leaks
    if (this.photos) {
      this.photos.forEach(p => {
        if (p && p.url && p.url.startsWith('blob:')) {
          URL.revokeObjectURL(p.url);
        }
      });
    }

    this.stage = 'vf'; // 'vf' | 'sel' | 'pr'
    this.photos = []; // [{ id, dataUrl, blob, burst: [] }]
    this.selected = []; // indices into photos for Strip A
    this.selectedStrip2 = []; // indices into photos for Strip B
    this.allBursts = []; // burst clips per shot
    this.selectedBursts = []; // selected burst clips
    this.stripACopies = 1;
    this.stripBCopies = 1;
    this.printCopies = 1;
    this.stripADesignIdx = 0;
    this.stripBDesignIdx = 0;
    this.customDesigns = [];
    this.sessionId = generateSessionCode(5);
    this.videoProcessing = false;
    this.capturing = false;
  }

  setStage(stage) {
    this.stage = stage;
  }
}

export const appState = new StateStore();
