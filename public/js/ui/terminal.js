/**
 * In-Page Terminal & Server Diagnostics UI
 * Real-time logging console and print-server connection monitor.
 */

import { subscribeTerminalLogs, terminalLogs, logTerminal, checkServerHealth, updateServerConfig, getServerBase } from '../core/api.js?v=20260916-9';

class TerminalUI {
  constructor() {
    this.isOpen = false;
    this.drawer = null;
    this.statusBadge = null;
  }

  init() {
    this.render();
    this.bindEvents();
    this.startHealthCheck();
    
    subscribeTerminalLogs((entry) => {
      this.appendLogLine(entry);
    });

    logTerminal('Photobooth UI initialized. Ready for session.', 'success');
  }

  render() {
    const html = `
      <div id="terminal-drawer" class="terminal-drawer">
        <div class="terminal-header">
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="color: #FF5500; font-weight: 800;">⚡ SERVER & TERMINAL LOGS</span>
            <span id="server-health-indicator" style="font-size: 0.74rem; padding: 2px 8px; border-radius: 4px; background: rgba(255,85,0,0.15); color: #FFAA00;">
              Connecting to ${getServerBase()}...
            </span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="term-test-ping" class="btn btn-sm btn-secondary" style="padding: 4px 10px; font-size: 0.74rem;">Test Ping</button>
            <button id="term-clear-btn" class="btn btn-sm btn-ghost" style="padding: 4px 10px; font-size: 0.74rem; color: #FFF;">Clear</button>
            <button id="term-close-btn" class="btn btn-sm btn-ghost" style="padding: 4px 10px; font-size: 0.85rem; color: #FFF;">✕</button>
          </div>
        </div>
        <div id="terminal-body" class="terminal-body">
          <div class="terminal-line info">[SYSTEM] Console logger started. Target server: ${getServerBase()}</div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    this.drawer = document.getElementById('terminal-drawer');
    this.statusBadge = document.getElementById('server-health-indicator');
  }

  appendLogLine(entry) {
    const body = document.getElementById('terminal-body');
    if (!body) return;
    const line = document.createElement('div');
    line.className = `terminal-line ${entry.type}`;
    line.textContent = `[${entry.time}] ${entry.message}`;
    body.appendChild(line);
    // Avoid forced layout mid-capture when drawer is closed.
    if (this.isOpen) body.scrollTop = body.scrollHeight;
  }

  bindEvents() {
    document.getElementById('term-close-btn').onclick = () => this.toggle(false);
    document.getElementById('term-clear-btn').onclick = () => {
      const body = document.getElementById('terminal-body');
      if (body) body.innerHTML = '<div class="terminal-line info">[SYSTEM] Terminal logs cleared.</div>';
    };

    document.getElementById('term-test-ping').onclick = async () => {
      logTerminal('Pinging print server...', 'info');
      const health = await checkServerHealth();
      if (health.online) {
        logTerminal(`Server is ONLINE at ${getServerBase()}`, 'success');
      } else {
        logTerminal(`Server is OFFLINE at ${getServerBase()}. Start with "node print-server.js"`, 'error');
      }
    };

    // Toggle shortcut Ctrl+Shift+L
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key.toLowerCase() === 'l' || e.key === 't')) {
        e.preventDefault();
        this.toggle(!this.isOpen);
      }
    });
  }

  async startHealthCheck() {
    const runCheck = async () => {
      // Skip background ping mid-capture so fetch + DOM writes
      // never collide with the countdown's first second.
      if (window.__irise_capturing) return;
      const health = await checkServerHealth();
      const indicator = document.getElementById('server-health-indicator');
      const topbarStatus = document.getElementById('topbar-server-status');
      
      if (indicator) {
        if (health.online) {
          indicator.style.background = 'rgba(46, 196, 118, 0.2)';
          indicator.style.color = '#34D399';
          indicator.textContent = `🟢 Server Online (${getServerBase()})`;
        } else {
          indicator.style.background = 'rgba(239, 68, 68, 0.2)';
          indicator.style.color = '#F87171';
          indicator.textContent = `🔴 Offline (Port 8080)`;
        }
      }

      if (topbarStatus) {
        topbarStatus.style.color = health.online ? '#16A34A' : '#DC2626';
        topbarStatus.title = health.online ? `Server Connected (${getServerBase()})` : `Server Offline (Start print-server.js)`;
      }
    };

    runCheck();
    setInterval(runCheck, 6000);
  }

  toggle(show) {
    this.isOpen = (show !== undefined) ? show : !this.isOpen;
    if (this.drawer) {
      this.drawer.classList.toggle('active', this.isOpen);
    }
  }
}

export const terminalUI = new TerminalUI();
