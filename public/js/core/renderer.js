/**
 * Canvas Rendering & Print Composer Engine
 * High-performance slot rendering, offscreen caching, and print sheet generation.
 */

import { logTerminal } from './api.js?v=20260916-9';

// In-memory image cache
const imageCache = new Map();

export function createFallbackFrame(width = 600, height = 1800, isRaw = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (isRaw) {
    // Transparent or white slots
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  } else {
    // Ivory card background with subtle luxury frame
    ctx.fillStyle = '#FAF6EE';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#E8DCCB';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, width - 20, height - 20);
    
    // Bottom brand logo watermark
    ctx.fillStyle = '#FF5500';
    ctx.font = 'bold 28px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('iRISE PHOTOBOOTH', width / 2, height - 50);
  }
  return canvas;
}

export function loadImage(src, isRaw = false) {
  if (!src) return Promise.resolve(createFallbackFrame(600, 1800, isRaw));
  if (imageCache.has(src)) return Promise.resolve(imageCache.get(src));

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => {
      logTerminal(`Image load failed for "${src}". Using fallback frame.`, 'warn');
      const fallback = createFallbackFrame(600, 1800, isRaw);
      imageCache.set(src, fallback);
      resolve(fallback);
    };
    img.src = src;
  });
}

export function drawStripQr(ctx, canvas, qrCanvas) {
  if (!qrCanvas) return;

  const SCALE_FACTOR = 4;
  const QR_SIZE = 80 * SCALE_FACTOR;
  const QR_PADDING = 25 * SCALE_FACTOR;
  const qx = canvas.width - QR_SIZE - QR_PADDING;
  const qy = canvas.height - QR_SIZE - QR_PADDING;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(qx - (6 * SCALE_FACTOR), qy - (6 * SCALE_FACTOR), QR_SIZE + (12 * SCALE_FACTOR), QR_SIZE + (12 * SCALE_FACTOR));
  ctx.drawImage(qrCanvas, qx, qy, QR_SIZE, QR_SIZE);
  ctx.strokeStyle = '#E8DCCB';
  ctx.lineWidth = Math.max(1, 1.5 * SCALE_FACTOR);
  ctx.strokeRect(qx - (6 * SCALE_FACTOR), qy - (6 * SCALE_FACTOR), QR_SIZE + (12 * SCALE_FACTOR), QR_SIZE + (12 * SCALE_FACTOR));
}

export async function renderSingleStrip({ selectedPhotos, canvas, design, qrCanvas }) {
  if (!canvas || !selectedPhotos || selectedPhotos.length === 0) return null;

  const effectiveDesign = design || {
    name: 'Design 1 — UnknOwn',
    bg: '',
    fg: '',
    slots: [
      { x: 69, y: 369, w: 493, h: 322 },
      { x: 69, y: 728, w: 493, h: 322 },
      { x: 69, y: 1087, w: 493, h: 322 },
      { x: 69, y: 1446, w: 493, h: 322 }
    ]
  };

  const [bgImg, fgImg] = await Promise.all([
    loadImage(effectiveDesign.bg, true),
    loadImage(effectiveDesign.fg, false)
  ]);

  const baseW = bgImg.width || 600;
  const baseH = bgImg.height || 1800;
  const SCALE_FACTOR = 2; // High-DPI upscale
  const ctx = canvas.getContext('2d');

  canvas.width = baseW * SCALE_FACTOR;
  canvas.height = baseH * SCALE_FACTOR;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 1. Draw Background Frame
  ctx.fillStyle = '#FAF6EE';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);

  // 2. Draw Slot Photos
  const BLEED = 2 * SCALE_FACTOR;
  const slots = (effectiveDesign.slots && effectiveDesign.slots.length > 0) ? effectiveDesign.slots : [
    { x: 40, y: 60, w: baseW - 80, h: (baseH - 240) / 4 },
    { x: 40, y: 60 + (baseH - 200) / 4, w: baseW - 80, h: (baseH - 240) / 4 },
    { x: 40, y: 60 + ((baseH - 200) / 4) * 2, w: baseW - 80, h: (baseH - 240) / 4 },
    { x: 40, y: 60 + ((baseH - 200) / 4) * 3, w: baseW - 80, h: (baseH - 240) / 4 }
  ];

  for (let i = 0; i < Math.min(selectedPhotos.length, slots.length); i++) {
    const slot = slots[i];
    const photoSrc = selectedPhotos[i];
    if (!photoSrc) continue;

    try {
      const pImg = await loadImage(photoSrc);
      const iAspect = pImg.width / pImg.height;
      const targetW = (slot.w * SCALE_FACTOR) + BLEED * 2;
      const targetH = (slot.h * SCALE_FACTOR) + BLEED * 2;
      const sAspect = targetW / targetH;

      let sx = 0, sy = 0, sw = pImg.width, sh = pImg.height;
      if (iAspect > sAspect) {
        sw = pImg.height * sAspect;
        sx = (pImg.width - sw) / 2;
      } else {
        sh = pImg.width / sAspect;
        sy = (pImg.height - sh) / 2;
      }

      ctx.drawImage(
        pImg,
        sx, sy, sw, sh,
        (slot.x * SCALE_FACTOR) - BLEED,
        (slot.y * SCALE_FACTOR) - BLEED,
        targetW, targetH
      );
    } catch (e) {
      logTerminal(`Error drawing photo slot ${i + 1}: ${e.message}`, 'warn');
    }
  }

  // 3. Draw Foreground Overlay
  ctx.drawImage(fgImg, 0, 0, canvas.width, canvas.height);

  // 4. Draw QR Code
  if (qrCanvas) {
    drawStripQr(ctx, canvas, qrCanvas);
  }

  return canvas;
}

export function composePrintSheet(leftCanvas, rightCanvas) {
  const left = leftCanvas || rightCanvas;
  const right = rightCanvas || leftCanvas;
  if (!left || !right) return null;

  const sheet = document.createElement('canvas');
  sheet.width = left.width + right.width;
  sheet.height = Math.max(left.height, right.height);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  if (left) ctx.drawImage(left, 0, 0);
  if (right) ctx.drawImage(right, left.width, 0);

  return sheet;
}

export function buildPrintSheets({ stripACanvas, stripBCanvas, printCopies = 1, aCopies = 1, bCopies = 1 }) {
  const hasA = stripACanvas && stripACanvas.width > 0;
  const hasB = stripBCanvas && stripBCanvas.width > 0;
  const sheets = [];

  if (!hasA && !hasB) return sheets;

  const left = hasA ? stripACanvas : stripBCanvas;
  const right = hasB ? stripBCanvas : stripACanvas;

  const requestedCopies = Number.parseInt(printCopies || aCopies || 1, 10);
  const count = Number.isFinite(requestedCopies) ? Math.max(1, requestedCopies) : 1;

  // Each copy is one sheet; both strips are placed on every sheet.
  for (let i = 0; i < count; i++) {
    const sheet = composePrintSheet(left, right);
    if (sheet) sheets.push(sheet);
  }

  return sheets;
}
