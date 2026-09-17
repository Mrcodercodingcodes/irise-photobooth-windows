# iRISE Photobooth

Windows-first local photobooth server for camera capture, video processing, printing, skin management, and QR-based guest sharing.

## Download and run on Windows

Requirements: Windows 10/11 and Node.js LTS 20 or newer.

```powershell
git clone <your-github-repository-url>
cd "iRISE Photobooth 5"
```

Then double-click `setup.bat`, followed by `start.bat`.

Open the booth at:

- `http://localhost:8080/photobooth.html` — operator booth
- `http://localhost:8080/` — guest media retrieval page
- `http://localhost:8080/admin.html` — skin manager

The setup script runs `npm ci`, so a fresh clone uses the committed lockfile and receives the same dependency tree as the packaged project. FFmpeg, Sharp, and the Cloudflare quick-tunnel binary are installed through npm.

## Configuration

Setup creates `.env` from `.env.example`. Set `ADMIN_PASSWORD` before exposing the server beyond the local machine. Leave `DISABLE_TUNNEL=true` when a public guest link is not needed.

Runtime output is kept out of the repository: uploads, processed videos, print files, logs, sessions, tunnel state, credentials, and other machine-local data are ignored by Git.

## Verification

```powershell
npm ci
npm run verify:install
npm run check
npm run build
```

GitHub Actions runs the same checks on every push and pull request.

## Optional deployment

For static frontend hosting, the repository includes `firebase.json` and the existing Firebase deployment notes. The local Node server is still required for printing, video processing, local storage, and the automatic tunnel.

See [SETUP_GUIDE.md](SETUP_GUIDE.md) for printer setup, tunnel troubleshooting, PM2, and Firebase deployment.

## Security

Never commit service-account keys, `.env`, tunnel state, or captured guest media. If a credential file has ever been pushed to a remote repository, revoke and replace that credential immediately; deleting the file in a later commit is not enough.
