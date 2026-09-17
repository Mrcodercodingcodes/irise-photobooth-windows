const sharp = require('sharp');
const path = require('path');

async function analyzeDesign(filename) {
  console.log('\n=== ' + filename + ' ===');
  const img = sharp(path.join(__dirname, 'public', filename));
  const { data, info } = await img.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  console.log('Dimensions: ' + w + ' x ' + h);
  
  let holes = [];
  let inHole = false;
  let holeStart = 0;
  
  for (let y = 0; y < h; y++) {
    let rowTransparent = 0;
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a < 128) rowTransparent++;
    }
    if (rowTransparent > w * 0.3) {
      if (!inHole) { inHole = true; holeStart = y; }
    } else {
      if (inHole) {
        inHole = false;
        holes.push({ startY: holeStart, endY: y - 1, h: y - holeStart });
      }
    }
  }
  if (inHole) holes.push({ startY: holeStart, endY: h - 1, h: h - holeStart });
  
  console.log('Found ' + holes.length + ' transparent regions');
  
  const slots = [];
  for (const hole of holes) {
    let minX = w, maxX = 0;
    for (let y = hole.startY; y <= hole.endY; y++) {
      for (let x = 0; x < w; x++) {
        const a = data[(y * w + x) * 4 + 3];
        if (a < 128) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    const slot = { x: minX, y: hole.startY, w: maxX - minX + 1, h: hole.h };
    slots.push(slot);
    console.log('  Slot: x:' + slot.x + ' y:' + slot.y + ' w:' + slot.w + ' h:' + slot.h);
  }
  return slots;
}

async function main() {
  const results = {};
  for (const f of ['legacy/raw26/design26_1.png', 'legacy/raw26/design26_2.png']) {
    results[f] = await analyzeDesign(f);
  }
  
  // Also check raw files
  for (const f of ['legacy/raw26/raw26_1.png', 'legacy/raw26/raw26_2.png', 'legacy/raw26/raw26_3.png']) {
    const m = await sharp(path.join(__dirname, 'public', f)).metadata();
    console.log('\n' + f + ': ' + m.width + 'x' + m.height);
  }
  
  console.log('\n=== Corrected CUSTOM_DESIGNS ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
