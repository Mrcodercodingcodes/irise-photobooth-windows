const fs = require('fs');
const path = require('path');

const requiredPackages = [
    'express',
    'body-parser',
    'cors',
    'multer',
    'fluent-ffmpeg',
    'qrcode',
    'sharp'
];

for (const packageName of requiredPackages) {
    try {
        require.resolve(packageName);
    } catch (error) {
        console.error(`[setup] Missing package: ${packageName}`);
        process.exitCode = 1;
    }
}

try {
    require('sharp');
} catch (error) {
    console.error(`[setup] Sharp native runtime is not loadable: ${error.message}`);
    process.exitCode = 1;
}

const ffmpegPath = require('ffmpeg-static');
if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    console.error(`[setup] FFmpeg binary is missing: ${ffmpegPath || 'no path returned'}`);
    process.exitCode = 1;
}

const cloudflaredBinary = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
const cloudflaredPath = path.join(process.cwd(), 'node_modules', 'cloudflared', 'bin', cloudflaredBinary);
if (!fs.existsSync(cloudflaredPath)) {
    console.error(`[setup] Cloudflare tunnel binary is missing: ${cloudflaredPath}`);
    process.exitCode = 1;
}

if (process.exitCode) {
    process.exit(1);
}

console.log('[setup] All required Node packages and native binaries are installed.');
