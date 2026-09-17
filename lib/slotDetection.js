const sharp = require('sharp');

// A pixel counts as "slot space" (i.e. where a photo goes) if it's either:
//   - transparent (alpha < ALPHA_THRESHOLD), or
//   - near-white (r,g,b all > WHITE_THRESHOLD) and opaque
// Everything else (black / colored art) counts as "design space".
const ALPHA_THRESHOLD = 128;
const WHITE_THRESHOLD = 235;
const MIN_ROW_FRACTION = 0.15; // row must be >=15% slot-pixels to count as "inside a slot band"
const MIN_SLOT_AREA = 400; // px^2 — filters out tiny noise blobs
const RED_THRESHOLD = 180;
const RED_CHANNEL_MAX = 120;
const MIN_QR_MARKER_SIZE = 12;
const MIN_QR_MARKER_AREA = 144;

function isSlotPixel(data, idx) {
    const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
    if (a < ALPHA_THRESHOLD) return true;
    return r > WHITE_THRESHOLD && g > WHITE_THRESHOLD && b > WHITE_THRESHOLD;
}

function isQrMarkerPixel(data, idx) {
    const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
    return a >= ALPHA_THRESHOLD &&
        r >= RED_THRESHOLD &&
        g <= RED_CHANNEL_MAX &&
        b <= RED_CHANNEL_MAX &&
        r > g * 1.5 &&
        r > b * 1.5;
}

/**
 * Finds the largest near-square connected red component in a raw blueprint.
 * A red square is the QR placement marker: its bounding box is the exact
 * position and size used when rendering the QR code.
 */
function detectQrCodeFromPixels(data, width, height, channels) {
    const visited = new Uint8Array(width * height);
    const candidates = [];
    const neighbors = [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0],             [1, 0],
        [-1, 1],  [0, 1],  [1, 1]
    ];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const start = y * width + x;
            if (visited[start] || !isQrMarkerPixel(data, start * channels)) continue;

            visited[start] = 1;
            const stack = [start];
            let pixelCount = 0;
            let minX = x, maxX = x, minY = y, maxY = y;

            while (stack.length) {
                const current = stack.pop();
                const currentX = current % width;
                const currentY = Math.floor(current / width);
                pixelCount++;
                minX = Math.min(minX, currentX);
                maxX = Math.max(maxX, currentX);
                minY = Math.min(minY, currentY);
                maxY = Math.max(maxY, currentY);

                for (const [dx, dy] of neighbors) {
                    const nextX = currentX + dx;
                    const nextY = currentY + dy;
                    if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
                    const next = nextY * width + nextX;
                    if (visited[next] || !isQrMarkerPixel(data, next * channels)) continue;
                    visited[next] = 1;
                    stack.push(next);
                }
            }

            const markerWidth = maxX - minX + 1;
            const markerHeight = maxY - minY + 1;
            const markerArea = markerWidth * markerHeight;
            const aspect = markerWidth / markerHeight;
            const isNearSquare = aspect >= 0.75 && aspect <= 1.333;
            const enoughPixels = pixelCount >= Math.max(16, Math.floor(Math.min(markerWidth, markerHeight) * 0.2));

            if (
                isNearSquare &&
                enoughPixels &&
                markerWidth >= MIN_QR_MARKER_SIZE &&
                markerHeight >= MIN_QR_MARKER_SIZE &&
                markerArea >= MIN_QR_MARKER_AREA
            ) {
                candidates.push({
                    x: minX,
                    y: minY,
                    w: markerWidth,
                    h: markerHeight,
                    squareError: Math.abs(1 - aspect),
                    area: markerArea
                });
            }
        }
    }

    candidates.sort((a, b) => (b.area - a.area) || (a.squareError - b.squareError));
    if (!candidates.length) return null;

    const { x, y, w, h } = candidates[0];
    return { x, y, w, h };
}

/**
 * Detects photo-slot rectangles in a raw blueprint image.
 * White or transparent regions = slots. Everything else = design space.
 *
 * Two-pass approach:
 *  1. Scan rows to find vertical bands that contain slot pixels (handles
 *     the common "stacked strip" layout cheaply).
 *  2. Within each band, find the tight horizontal bounds of slot pixels
 *     to get an accurate x/w per slot.
 *
 * This is a heuristic, not a perfect segmentation — for irregular/rotated
 * layouts, returned slots should be treated as a starting point for the
 * admin UI to confirm/adjust, not ground truth.
 *
 * @param {string|Buffer} input - path to image or image buffer
 * @returns {Promise<{width:number, height:number, slots:Array<{x:number,y:number,w:number,h:number}>, qrCode:?{x:number,y:number,w:number,h:number}}>}
 */
async function detectSlots(input) {
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;

    // Pass 1: per-row slot-pixel fraction, to find vertical bands
    const rowIsSlot = new Array(height).fill(false);
    for (let y = 0; y < height; y++) {
        let count = 0;
        const rowStart = y * width * channels;
        for (let x = 0; x < width; x++) {
            if (isSlotPixel(data, rowStart + x * channels)) count++;
        }
        rowIsSlot[y] = (count / width) >= MIN_ROW_FRACTION;
    }

    // Group consecutive slot-rows into bands
    const bands = [];
    let inBand = false, bandStart = 0;
    for (let y = 0; y < height; y++) {
        if (rowIsSlot[y] && !inBand) { inBand = true; bandStart = y; }
        else if (!rowIsSlot[y] && inBand) { inBand = false; bands.push([bandStart, y - 1]); }
    }
    if (inBand) bands.push([bandStart, height - 1]);

    // Pass 2: within each band, find tight x-bounds (and re-tighten y-bounds)
    const slots = [];
    for (const [bandTop, bandBottom] of bands) {
        let minX = width, maxX = -1, minY = height, maxY = -1;
        for (let y = bandTop; y <= bandBottom; y++) {
            const rowStart = y * width * channels;
            let rowHasSlot = false;
            for (let x = 0; x < width; x++) {
                if (isSlotPixel(data, rowStart + x * channels)) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    rowHasSlot = true;
                }
            }
            if (rowHasSlot) {
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        if (maxX <= minX || maxY <= minY) continue;
        const w = maxX - minX + 1;
        const h = maxY - minY + 1;
        if (w * h < MIN_SLOT_AREA) continue;
        slots.push({ x: minX, y: minY, w, h });
    }

    // Sort top-to-bottom, then left-to-right (natural reading order for strips/grids)
    slots.sort((a, b) => (a.y - b.y) || (a.x - b.x));

    const qrCode = detectQrCodeFromPixels(data, width, height, channels);
    return { width, height, slots, qrCode };
}

module.exports = { detectSlots, detectQrCodeFromPixels };
