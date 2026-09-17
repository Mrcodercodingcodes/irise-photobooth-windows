/**
 * UI Dialogs & Toast Notification Manager
 */

let toastTimeout = null;

export function showToast(message, type = 'info', title = '') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  container.innerHTML = '';
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = title ? `${title}: ${message}` : message;

  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => {
      if (toast.parentElement) toast.parentElement.removeChild(toast);
    }, 300);
  }, 3500);
}

export function showConfirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop active';

    const panel = document.createElement('div');
    panel.className = 'modal-panel active';
    panel.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">${title}</h3>
      </div>
      <div class="modal-body">
        <p style="color: var(--theme-text-muted); font-size: 0.95rem;">${message}</p>
      </div>
      <div class="modal-footer">
        <button id="dialog-cancel-btn" class="btn btn-secondary">${cancelText}</button>
        <button id="dialog-confirm-btn" class="btn btn-primary">${confirmText}</button>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const cleanup = (result) => {
      panel.classList.remove('active');
      backdrop.classList.remove('active');
      setTimeout(() => {
        if (backdrop.parentElement) backdrop.parentElement.removeChild(backdrop);
        if (panel.parentElement) panel.parentElement.removeChild(panel);
        resolve(result);
      }, 200);
    };

    panel.querySelector('#dialog-cancel-btn').onclick = () => cleanup(false);
    panel.querySelector('#dialog-confirm-btn').onclick = () => cleanup(true);
    backdrop.onclick = () => cleanup(false);
  });
}

export function showDesignConfirmModal({ designA, designB, isDouble = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop active';

    const panel = document.createElement('div');
    panel.className = 'modal-panel active';
    panel.style.maxWidth = '460px';
    panel.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title" style="display:flex;align-items:center;gap:8px;">
          <span>🎞️</span>
          <span>Confirm Frame Designs</span>
        </h3>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px;">
        <p style="color: var(--theme-text-muted); font-size: 0.92rem; line-height: 1.45;">
          Your live video and photo strips will be rendered on the server using these frame designs:
        </p>

        <div style="display:flex;flex-direction:column;gap:10px;background:var(--theme-bg);padding:14px;border-radius:var(--theme-radius-md);border:1px solid var(--theme-surface-border);">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:0.85rem;font-weight:700;color:var(--theme-text-muted);text-transform:uppercase;letter-spacing:0.06em;">Strip A Design</span>
            <strong style="color:var(--theme-accent);font-size:0.95rem;">${designA?.name || 'Design 1 — UnknOwn'}</strong>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding-top:8px;border-top:1px dashed var(--theme-surface-border);">
            <span style="font-size:0.85rem;font-weight:700;color:var(--theme-text-muted);text-transform:uppercase;letter-spacing:0.06em;">Strip B Design</span>
            <strong style="color:var(--theme-accent);font-size:0.95rem;">${designB?.name || 'Design 1 — UnknOwn'}</strong>
          </div>
        </div>

        <div style="font-size:0.82rem;color:var(--theme-text-muted);display:flex;align-items:center;gap:6px;">
          <span>${isDouble ? '✨ Dual-Strip Mode: Both designs will be stitched side-by-side in your video!' : 'ℹ️ Single-Strip Mode'}</span>
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:space-between;gap:10px;">
        <button id="dialog-change-btn" class="btn btn-secondary" style="flex:1;">← Change Designs</button>
        <button id="dialog-confirm-render-btn" class="btn btn-primary" style="flex:1.3;">Confirm & Process 🚀</button>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const cleanup = (result) => {
      panel.classList.remove('active');
      backdrop.classList.remove('active');
      setTimeout(() => {
        if (backdrop.parentElement) backdrop.parentElement.removeChild(backdrop);
        if (panel.parentElement) panel.parentElement.removeChild(panel);
        resolve(result);
      }, 200);
    };

    panel.querySelector('#dialog-change-btn').onclick = () => cleanup(false);
    panel.querySelector('#dialog-confirm-render-btn').onclick = () => cleanup(true);
    backdrop.onclick = () => cleanup(false);
  });
}
