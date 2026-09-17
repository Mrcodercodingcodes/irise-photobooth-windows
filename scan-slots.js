const path = require('path');
const { detectSlots } = require('./lib/slotDetection');

// Scan explicit blueprint paths, or all four active designs when no paths are given.
const DEFAULT_BLUEPRINTS = ['d1', 'd2', 'd3', 'd4']
    .map(id => path.join(__dirname, 'public', 'skins', id, 'raw.png'));

async function main() {
    const files = process.argv.slice(2).map(file => path.resolve(file));
    const inputs = files.length > 0 ? files : DEFAULT_BLUEPRINTS;

    let failed = false;
    for (const file of inputs) {
        try {
            const { width, height, slots } = await detectSlots(file);
            console.log(`${path.relative(process.cwd(), file)} — ${width}×${height}, ${slots.length} slots`);
            slots.forEach((slot, index) => {
                console.log(`  ${index + 1}: x:${slot.x}, y:${slot.y}, w:${slot.w}, h:${slot.h}`);
            });
        } catch (error) {
            failed = true;
            console.error(`[error] ${file}: ${error.message}`);
        }
    }

    if (failed) process.exitCode = 1;
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
