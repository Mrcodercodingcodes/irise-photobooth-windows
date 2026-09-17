# iRISE Photobooth — Homeserver Remote Deployment
## What your homeserver laptop needs to run the print server 20km+ away

---

## 1. Software Prerequisites

Install all of the following **once** on the homeserver laptop.

### Node.js (v18 or higher)
Download from https://nodejs.org — choose the LTS version.

```powershell
# Verify after install
node --version   # should print v18.x.x or higher
npm --version
```

### PM2 (persistent process manager)
```powershell
npm install -g pm2
```

### Git (optional but recommended for updates)
Download from https://git-scm.com

### A printer driver
The homeserver must be on the **same LAN** as the printer, with the printer driver installed and set as Default Printer in Windows. Remote printing (from an external cloud server) will NOT work — the server must physically be on the same network as the printer.

---

## 2. Exact Files Needed on the Homeserver

You do NOT need to copy the entire project. Here is the **minimum set of files and folders** required:

```
iRISE Photobooth 5/
│
├── print-server.js           ← The server itself
├── package.json              ← Dependency manifest
├── package-lock.json         ← Exact dependency versions (important!)
├── ecosystem.config.js       ← PM2 config
│
├── lib/                      ← Required server modules
│   ├── skinStore.js
│   └── slotDetection.js
│
├── public/                   ← Static files served by the server
│   ├── photobooth.html       ← Main app (opened on the event laptop)
│   ├── view.html             ← Guest QR scan viewer
│   ├── admin.html            ← Admin panel
│   ├── index.html
│   ├── style.css
│   ├── manifest.json
│   ├── sw.js
│   ├── legacy/raw26/design-metadata.json
│   ├── *.png                 ← ALL design skin PNGs (design*.png, raw*.png)
│   ├── css/                  ← All CSS files
│   ├── js/                   ← All JS modules
│   └── skins/                ← All skin packs (upload via admin if added)
│
├── logs/                     ← Auto-created by PM2
├── temp_uploads/             ← Auto-created on first run
├── temp_prints/              ← Auto-created on first run
├── exports/                  ← Auto-created on first run
└── private_videos/           ← Auto-created on first run
```

> ⚠️ **Do NOT copy `node_modules/`** — it's hundreds of megabytes. Just copy the files above, then run `npm install` on the homeserver to rebuild it.

### Easiest Way to Transfer Files

**Option A — USB drive:**
1. Copy the entire project folder to a USB drive (skip `node_modules/`)
2. Paste on homeserver
3. Run `npm install`

**Option B — Git:**
```powershell
# On homeserver (one-time setup)
git clone https://github.com/YOUR_REPO iRISE-Photobooth
cd iRISE-Photobooth
npm install
```

**Option C — GitHub/zip:** Compress and share via Google Drive, then extract on homeserver.

---

## 3. Network Requirements

### For the Cloudflare Tunnel to work from 20km away:

| Requirement | Details |
|---|---|
| **Internet connection** | Any broadband/WiFi. Even mobile hotspot works. |
| **Outbound port 443** | Almost always open — Cloudflare uses HTTPS |
| **No port forwarding needed** | Cloudflare tunnel punches through NAT automatically |
| **No static IP needed** | The tunnel handles it |

The homeserver just needs to have internet access. The Cloudflare tunnel creates an encrypted outbound connection from your server to Cloudflare's edge — guests connect to Cloudflare, Cloudflare forwards to your server. **You never expose any ports directly.**

### For printing to work:

| Requirement | Details |
|---|---|
| **Printer** | Must be on the same LAN as the homeserver (USB or WiFi printer) |
| **Printer driver** | Installed on the homeserver, set as Default Printer |
| **Windows Print Spooler** | Must be running (it always is by default) |

---

## 4. First-Time Setup on Homeserver

```powershell
# 1. Navigate to project folder
cd "C:\iRISE Photobooth 5"

# 2. Install Node dependencies (only needed once, or after npm updates)
npm install

# 3. Start the server with PM2
npm run pm2:start

# 4. Check it's running and get the tunnel URL
pm2 logs irise-photobooth --lines 30
# Look for: >>> PUBLIC URL: https://xxxx.trycloudflare.com

# 5. Persist across reboots (run as Administrator)
pm2 save
pm2 startup
# Follow the instructions it prints
```

---

## 5. What Stays on the Event Laptop (20km away)

The event laptop where guests take photos only needs a **browser**. Open:

```
http://localhost:8080/photobooth.html     (if running server locally)
— or —
https://xxxx.trycloudflare.com/photobooth.html  (if homeserver is remote)
```

If the server is running at home, **all** of the following happen remotely:
- FFmpeg video compositing
- Photo strip printing (via the homeserver's connected printer — note: printer must be at homeserver location)
- QR code generation
- Video/photo storage

> ⚠️ **Important caveat on remote printing:** If the printer is at the EVENT venue (not at home), the homeserver cannot print to it across the internet. In that scenario, run the server locally on the event laptop as well, and only use the homeserver for storage/QR/tunnel relay.

---

## 6. Recommended Remote Setup

```
Event venue (20km away)            Your home
──────────────────────             ──────────────────────────────
Event laptop (browser only)        Homeserver laptop
  └─ opens photobooth.html    →    └─ print-server.js (PM2)
  └─ captures photos/video         └─ FFmpeg compositing
  └─ submits to server        →    └─ private_videos/ storage
                                   └─ Cloudflare tunnel (auto)
                                   └─ Printer (for prints sent home)

Guests' phones
  └─ scan QR → Firebase viewer
  └─ Firebase fetches video from tunnel URL
```

---

## 7. Checking Server Status Remotely

You can SSH into the homeserver from the event venue:

```powershell
# From event laptop (if SSH is enabled on homeserver)
ssh username@homeserver-local-ip

# Then check PM2
pm2 status
pm2 logs irise-photobooth --lines 50
```

Or install **Tailscale** on both laptops for a secure VPN — then you always have a stable `homeserver.tailnet.ts.net` address regardless of where you both are.

---

## 8. Keeping the Tunnel URL Stable

The free Cloudflare tunnel URL changes every restart. To get a permanent URL:

### Option A — Named Cloudflare Tunnel (free, requires domain)
```powershell
# On homeserver
cloudflared tunnel login
cloudflared tunnel create irise-photobooth
cloudflared tunnel route dns irise-photobooth photos.yourdomain.com
cloudflared tunnel run irise-photobooth
```

### Option B — Tailscale Funnel (free, no domain needed)
```powershell
# Install Tailscale on homeserver → https://tailscale.com
tailscale funnel 8080
# Gives you a stable https://homeserver.tailnet.ts.net URL
```

### Option C — Ngrok (simplest, has a free stable URL on paid plan)

---

## 9. Quick Homeserver Checklist

Before leaving for the event venue, verify on the homeserver:

- [ ] `pm2 status` shows `irise-photobooth` as **online**
- [ ] `pm2 logs` shows `>>> PUBLIC URL: https://...` 
- [ ] Copy that tunnel URL into photobooth Settings → **Tunnel / Public URL**
- [ ] Test the QR code with your phone while still at home
- [ ] Printer is on and shows as Default Printer
- [ ] Homeserver is plugged into power (not running on battery)
- [ ] Laptop lid close behavior set to **"Do nothing"** (Control Panel → Power Options)

---

## 10. Lid Close Setting (Critical!)

By default, Windows sleeps when you close the laptop lid. **This kills the server.**

Fix it permanently:

```
Control Panel → Power Options → Choose what closing the lid does
→ When I close the lid: Do Nothing  (for both Battery and Plugged in)
```

Or via PowerShell (run as Admin):

```powershell
powercfg -setacvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 000
powercfg -setdcvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 000
powercfg -SetActive SCHEME_CURRENT
```
