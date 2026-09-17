# iRISE Photobooth setup guide

This is a local Node.js server for the iRISE photobooth. The Windows setup includes the server, the frontend, FFmpeg, Sharp, QR generation, and the Cloudflare quick-tunnel dependency.

## Windows quick start

1. Install [Node.js LTS](https://nodejs.org/) if it is not already installed.
2. Clone or download this repository. Keep the project in a normal local folder such as `C:\iRISE Photobooth`.
3. Double-click `setup.bat`. It installs the exact versions in `package-lock.json` and creates a local `.env` file.
4. Optional: edit `.env` and set a permanent `ADMIN_PASSWORD`.
5. Double-click `start.bat`.
6. Open the booth in Chrome at [http://localhost:8080/photobooth.html](http://localhost:8080/photobooth.html).

The guest retrieval page is [http://localhost:8080/](http://localhost:8080/), and the skin manager is [http://localhost:8080/admin.html](http://localhost:8080/admin.html).

## Configuration

`.env` is local-only and is intentionally excluded from Git. Available settings are documented in `.env.example`:

- `PORT` — server port; defaults to `8080`.
- `ADMIN_PASSWORD` — password for the skin manager. If blank, a temporary password is generated and printed at startup.
- `DISABLE_TUNNEL` — set to `true` to disable automatic Cloudflare quick-tunnel startup.
- `VIDEO_CONCURRENCY` — maximum number of simultaneous video exports; defaults to `2`.

Do not copy `credentials.json`, service-account JSON files, `.env`, `.tunnel-config.json`, `sessions.json`, or generated videos into GitHub. The server creates its runtime folders automatically.

## Printer and camera

- Set the photo printer as the Windows default printer.
- Allow camera and microphone access for `localhost` in Chrome.
- The print endpoint uses Windows PowerShell's `Start-Process -Verb Print` command.
- Test a normal Windows print before running an event.

## Cloudflare tunnel

The server starts a temporary Cloudflare tunnel automatically unless `DISABLE_TUNNEL=true`. The public URL is printed in the server window and is used for guest QR links.

If the tunnel cannot connect, the booth still works locally. Check the server output, internet connection, Windows Firewall, and antivirus rules.

## Developer commands

```powershell
npm ci                 # clean install from the lockfile
npm run verify:install # verify native/runtime dependencies
npm start              # run the server
npm run dev            # restart on server-file changes
npm run check          # syntax checks used by GitHub Actions
npm run build          # static-site build check
```

PM2 is optional for a permanently supervised installation:

```powershell
npm install -g pm2
npm run pm2:start
npm run pm2:logs
```

## Optional Firebase hosting

The `public/` folder is also configured for Firebase Hosting. Deploying it requires the Firebase CLI and access to the project:

```powershell
npm install -g firebase-tools
firebase login
firebase deploy --only hosting
```

The local print server and Firebase Hosting are separate: Firebase serves the static frontend, while the local server handles camera uploads, processing, printing, storage, and QR links.
