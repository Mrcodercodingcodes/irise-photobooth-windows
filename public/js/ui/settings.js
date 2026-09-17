/**
 * Settings & Operator Panel UI
 */

import { cameraManager } from '../core/camera.js';
import { themeManager, THEME_REGISTRY } from '../core/theme-manager.js';
import { updateServerConfig, checkHomeserverHealth } from '../core/api.js?v=20260916-9';
import { showToast, showConfirmDialog } from './dialogs.js';

class SettingsUI {
  constructor() {
    this.panel = null;
    this.backdrop = null;
    this.activeTab = 'capture';
  }

  init() {
    this.render();
    this.bindEvents();
    this.populateThemes();
    this.populateCameras();
  }

  render() {
    const html = `
      <div id="settings-backdrop" class="modal-backdrop"></div>
      <div id="settings-panel" class="modal-panel">
        <div class="modal-header">
          <h3 class="modal-title" id="settings-title-text">Settings</h3>
          <button id="settings-close-btn" class="modal-close-btn">&times;</button>
        </div>
        
        <div class="modal-body">
          <div class="tabs-header">
            <button class="tab-btn active" data-tab="capture">Capture Engine</button>
            <button class="tab-btn" data-tab="operator">Operator Dashboard</button>
            <button class="tab-btn" data-tab="theme">Theme & Skins</button>
          </div>

          <!-- Capture Settings Tab -->
          <div id="tab-capture" class="tab-pane active">
            <div class="setting-row">
              <div>
                <div class="setting-label">Countdown Timer</div>
                <div class="setting-sublabel">Seconds before each photo</div>
              </div>
              <select id="setting-timer" class="form-select">
                <option value="3" selected>3 Seconds</option>
                <option value="5">5 Seconds</option>
                <option value="10">10 Seconds</option>
              </select>
            </div>

            <div class="setting-row">
              <div>
                <div class="setting-label">Mirror Preview</div>
                <div class="setting-sublabel">Flip viewfinder horizontally</div>
              </div>
              <input type="checkbox" id="setting-mirror" checked style="width: 20px; height: 20px; accent-color: var(--theme-accent);">
            </div>

            <div class="setting-row">
              <div>
                <div class="setting-label">Camera Source</div>
                <div class="setting-sublabel">Select hardware capture device</div>
              </div>
              <select id="setting-camera" class="form-select" style="max-width: 180px;"></select>
            </div>

            <div class="setting-row">
              <div>
                <div class="setting-label">Resolution</div>
                <div class="setting-sublabel">Capture frame dimension</div>
              </div>
              <select id="setting-resolution" class="form-select">
                <option value="3840">4K (Ultra HD)</option>
                <option value="1920">1080p (Full HD)</option>
                <option value="1280" selected>720p (Performance)</option>
              </select>
            </div>
          </div>

          <!-- Operator Settings Tab -->
          <div id="tab-operator" class="tab-pane">
            <div class="setting-row">
              <div>
                <div class="setting-label">Sessions Today</div>
                <div class="setting-sublabel">Completed photobooth sessions</div>
              </div>
              <span id="setting-session-count" style="font-size: 1.25rem; font-weight: 700; color: var(--theme-accent);">1</span>
            </div>

            <div class="setting-row" style="flex-direction: column; align-items: flex-start;">
              <div class="setting-label">Public Tunnel URL (Cloudflare)</div>
              <div class="setting-sublabel">QR codes point guests here. Auto-detected if tunnel is running.</div>
              <input type="text" id="setting-public-url" class="form-input" style="width: 100%; margin-top: 6px;" placeholder="https://xxxx.trycloudflare.com">
            </div>

            <div class="setting-row" style="flex-direction: column; align-items: flex-start;">
              <div style="display:flex;align-items:center;gap:8px;">
                <div class="setting-label" style="margin:0;">🏠 Homeserver URL</div>
                <span id="homeserver-status-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ccc;" title="Not tested"></span>
              </div>
              <div class="setting-sublabel">Offload FFmpeg video processing to your homeserver (fast home internet). Leave blank to process locally.</div>
              <div style="display:flex;gap:8px;width:100%;margin-top:6px;">
                <input type="text" id="setting-homeserver-url" class="form-input" style="flex:1;" placeholder="https://xxxx.trycloudflare.com">
                <button type="button" id="setting-homeserver-test-btn" class="btn btn-secondary btn-sm" style="white-space:nowrap;">Test Connection</button>
              </div>
              <div id="homeserver-test-result" style="font-size:0.78rem;margin-top:4px;color:var(--theme-text-muted);"></div>
            </div>

            <div class="setting-row">
              <div class="setting-label">Fullscreen Mode</div>
              <button id="setting-fullscreen-btn" class="btn btn-secondary btn-sm">Toggle Fullscreen</button>
            </div>

            <div class="setting-row">
              <div class="setting-label">System Cache</div>
              <button id="setting-purge-cache-btn" class="btn btn-secondary btn-sm">Purge Cache</button>
            </div>
          </div>

          <!-- Theme & Skin Switcher Tab -->
          <div id="tab-theme" class="tab-pane">
            <div class="setting-row" style="flex-direction: column; align-items: flex-start;">
              <div class="setting-label">Modular CSS Theme Skin</div>
              <div class="setting-sublabel" style="margin-bottom: 8px;">Select or hot-swap the visual skin of the entire photobooth</div>
              <select id="setting-theme-select" class="form-select" style="width: 100%;"></select>
            </div>
            <div style="font-size: 0.8rem; color: var(--theme-text-muted); margin-top: 12px; line-height: 1.4;">
              * Skins are completely modular. Add any .css file into <code>public/css/themes/</code> to insert new visual styles.
            </div>
          </div>

        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    this.panel = document.getElementById('settings-panel');
    this.backdrop = document.getElementById('settings-backdrop');
  }

  populateThemes() {
    const select = document.getElementById('setting-theme-select');
    if (!select) return;
    select.innerHTML = '';
    const current = themeManager.getCurrentTheme();

    THEME_REGISTRY.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      if (t.id === current) opt.selected = true;
      select.appendChild(opt);
    });

    select.onchange = (e) => {
      themeManager.applyTheme(e.target.value);
      showToast(`Applied ${e.target.selectedOptions[0].textContent}`, 'success');
    };
  }

  async populateCameras() {
    const select = document.getElementById('setting-camera');
    if (!select) return;
    select.innerHTML = '';

    const devices = await cameraManager.getDevices();
    devices.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Camera ${i + 1}`;
      if (d.deviceId === cameraManager.currentDeviceId) opt.selected = true;
      select.appendChild(opt);
    });

    select.onchange = (e) => {
      cameraManager.setDeviceId(e.target.value);
      showToast('Camera switched', 'info');
    };
  }

  bindEvents() {
    document.getElementById('settings-close-btn').onclick = () => this.toggle(false);
    this.backdrop.onclick = () => this.toggle(false);

    // Tab switching
    this.panel.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        const tab = btn.dataset.tab;
        this.panel.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        this.panel.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
      };
    });

    // Mirror toggle
    const mirrorCheck = document.getElementById('setting-mirror');
    mirrorCheck.checked = cameraManager.isMirrored;
    mirrorCheck.onchange = (e) => cameraManager.setMirror(e.target.checked);

    // Resolution toggle
    const resSelect = document.getElementById('setting-resolution');
    resSelect.value = String(cameraManager.targetResolution);
    resSelect.onchange = (e) => cameraManager.setResolution(e.target.value);

    // Tunnel config (QR + Firebase viewer routing)
    const tunnelInput = document.getElementById('setting-public-url');
    tunnelInput.value = localStorage.getItem('irise_public_url') || '';
    tunnelInput.onchange = async (e) => {
      const val = (e.target.value || '').trim();
      localStorage.setItem('irise_public_url', val);
      await updateServerConfig(val);
      showToast('Cloudflare tunnel URL updated', 'success');
    };

    // Homeserver URL (video processing offload)
    const homeserverInput = document.getElementById('setting-homeserver-url');
    const homeserverTestBtn = document.getElementById('setting-homeserver-test-btn');
    const homeserverResult = document.getElementById('homeserver-test-result');
    const homeserverDot = document.getElementById('homeserver-status-dot');
    if (homeserverInput) {
      homeserverInput.value = localStorage.getItem('irise_homeserver_url') || '';
      homeserverInput.onchange = (e) => {
        const val = (e.target.value || '').trim().replace(/\/$/, '');
        localStorage.setItem('irise_homeserver_url', val);
        if (homeserverDot) homeserverDot.style.background = '#ccc';
        if (homeserverResult) homeserverResult.textContent = val ? 'Saved. Click Test Connection to verify.' : 'Cleared — using local server for video.';
        showToast(val ? 'Homeserver URL saved' : 'Homeserver cleared — using local', 'success');
      };
    }
    if (homeserverTestBtn) {
      homeserverTestBtn.onclick = async () => {
        const val = (homeserverInput?.value || '').trim();
        if (!val) {
          if (homeserverResult) homeserverResult.textContent = 'No URL set — enter a homeserver URL first.';
          return;
        }
        localStorage.setItem('irise_homeserver_url', val.replace(/\/$/, ''));
        if (homeserverResult) homeserverResult.textContent = '⏳ Pinging homeserver...';
        if (homeserverDot) homeserverDot.style.background = '#f59e0b';
        homeserverTestBtn.disabled = true;
        try {
          const { checkHomeserverHealth } = await import('../core/api.js?v=20260916-9');
          const result = await checkHomeserverHealth();
          if (result.online) {
            if (homeserverDot) homeserverDot.style.background = '#22c55e';
            if (homeserverResult) homeserverResult.textContent = `✅ Connected! Homeserver is online. Videos will be processed there.`;
            showToast('Homeserver reachable ✅', 'success');
          } else {
            if (homeserverDot) homeserverDot.style.background = '#ef4444';
            if (homeserverResult) homeserverResult.textContent = `❌ Unreachable: ${result.reason || 'no response'}. Check the URL and tunnel.`;
            showToast('Homeserver unreachable', 'error');
          }
        } catch (err) {
          if (homeserverDot) homeserverDot.style.background = '#ef4444';
          if (homeserverResult) homeserverResult.textContent = `❌ Error: ${err.message}`;
        } finally {
          homeserverTestBtn.disabled = false;
        }
      };
    }

    // Fullscreen toggle
    document.getElementById('setting-fullscreen-btn').onclick = () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen();
      }
    };

    // Purge cache
    document.getElementById('setting-purge-cache-btn').onclick = async () => {
      const ok = await showConfirmDialog({
        title: 'Purge System Cache?',
        message: 'This will clear service worker cache and reload the application.'
      });
      if (ok) {
        try {
          const cacheKeys = await caches.keys();
          await Promise.all(cacheKeys.map(k => caches.delete(k)));
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map(r => r.unregister()));
          showToast('Cache cleared. Reloading...', 'success');
          setTimeout(() => location.reload(true), 600);
        } catch (e) {
          showToast('Failed to clear cache', 'error');
        }
      }
    };

    // Global Keybindings
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key.toLowerCase() === 'm' || e.key === ';' || e.key === ':')) {
        e.preventDefault();
        this.toggle(!this.panel.classList.contains('active'));
      }
    });
  }

  toggle(show) {
    if (this.panel) this.panel.classList.toggle('active', show);
    if (this.backdrop) this.backdrop.classList.toggle('active', show);
    if (show) {
      document.getElementById('setting-session-count').textContent = localStorage.getItem('irise_session_count') || '1';
      this.populateCameras();
    }
  }
}

export const settingsUI = new SettingsUI();
