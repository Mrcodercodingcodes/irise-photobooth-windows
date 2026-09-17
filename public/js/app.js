/**
 * iRISE Photobooth // Optical Lab Edition
 * Orchestrates stages, capture loop, dual strip rendering, and scientific telemetry workflow.
 */

import { CONFIG, appState, generateSessionCode } from './core/state.js?v=20260916-4';
import { themeManager } from './core/theme-manager.js';
import { cameraManager } from './core/camera.js';
import { soundFx } from './core/audio.js';
import { videoRecorder } from './core/recorder.js';
import { eyeFocusTracker } from './core/eyeFocus.js?v=20260916-9';
import { fetchSkinDesigns, processVideoSession, getReachableVideoServerBase, getVideoViewerBase, logTerminal } from './core/api.js?v=20260917-1';
import { renderSingleStrip, buildPrintSheets } from './core/renderer.js?v=20260917-1';
import { showToast, showDesignConfirmModal } from './ui/dialogs.js';
import { settingsUI } from './ui/settings.js?v=20260916-9';
import { terminalUI } from './ui/terminal.js?v=20260916-9';

const SCIENTIFIC_PROMPTS = [
  'Calibrating subject... Strike a baseline pose!',
  'Thermal spike detected! Activate high energy!',
  'Hypothesis confirmed: Looking brilliant!',
  'Quantum entanglement test: Get together!',
  'Reversing polarity: Change your angle!',
  'Peak particle excitement! Maximum joy!',
  'Photon flux overload! Give us your best lab face!',
  'Grand Finale: Full fusion celebration!'
];

class PhotoboothApp {
  constructor() {
    this.elements = {};
    this.videoServerBase = null;
    this.videoViewerBase = null;
  }

  async init() {
    this.cacheElements();
    settingsUI.init();
    terminalUI.init();
    cameraManager.setVideoElement(this.elements.camVideo);

    this.bindDOMEvents();
    this.buildShotList();
    this.setStage('vf');
    this.updateAudioButtonState();

    // Update session counter display
    const count = parseInt(localStorage.getItem('irise_session_count') || '1', 10);
    if (this.elements.sessionNumber) this.elements.sessionNumber.textContent = count;

    logTerminal('Initializing optical sensor and skin catalog...', 'info');
    await Promise.all([
      cameraManager.startCamera(),
      this.loadSkins()
    ]);
    eyeFocusTracker.attach({
      video: this.elements.camVideo,
      container: this.elements.chalkboard,
      target: this.elements.eyeFocusTarget
    });

    // Warm heavy subsystems OFF the capture critical path so shot 1
    // doesn't pay AudioContext creation + MediaRecorder probing mid-countdown.
    try { soundFx.ensureContext(); } catch (e) {}
    try { videoRecorder.warmup(); } catch (e) {}
    const warmOnce = () => {
      try { soundFx.ensureContext(); } catch (e) {}
      try { videoRecorder.warmup(); } catch (e) {}
    };
    window.addEventListener('pointerdown', warmOnce, { once: true });
    window.addEventListener('keydown', warmOnce, { once: true });
    if (this.elements.startBtn) {
      this.elements.startBtn.addEventListener('pointerenter', warmOnce, { once: true });
    }
  }

  cacheElements() {
    this.elements = {
      appContainer: document.getElementById('app-container'),
      stageVf: document.getElementById('stage-vf'),
      stageSel: document.getElementById('stage-sel'),
      stagePr: document.getElementById('stage-pr'),

      camVideo: document.getElementById('cam-video'),
      eyeFocusTarget: document.getElementById('eye-focus-target'),
      capCanvas: document.getElementById('capture-canvas'),
      labTablet: document.getElementById('lab-tablet'),
      chalkboard: document.getElementById('chalkboard'),
      shutterEl: document.getElementById('shutter-flash'),
      cdownOverlay: document.getElementById('cdown-overlay'),
      cdownNumber: document.getElementById('cdown-number'),
      cdownCircleBar: document.getElementById('cdown-circle-bar'),
      cdownPrompt: document.getElementById('cdown-prompt'),
      captureInstructions: document.getElementById('capture-instructions'),
      instructionText: document.getElementById('instruction-text'),
      statusDot: document.getElementById('topbar-server-status'),
      sessionNumber: document.getElementById('session-number'),

      startBtn: document.getElementById('start-btn'),
      noCamBtn: document.getElementById('noCam'),
      backToVfBtn: document.getElementById('back-to-vf-btn'),
      shotList: document.getElementById('shot-list'),
      
      photoGrid: document.getElementById('photo-grid'),
      proceedBtn: document.getElementById('proceed-btn'),
      selCount: document.getElementById('sel-count'),
      
      stripAPreview: document.getElementById('strip-a-canvas'),
      stripBPreview: document.getElementById('strip-b-canvas'),
      stripADesignSwitch: document.getElementById('strip-a-design-switch'),
      stripBDesignSwitch: document.getElementById('strip-b-design-switch'),
      printBtn: document.getElementById('print-btn'),
      resetBtn: document.getElementById('reset-btn'),
      saveVideoBtn: document.getElementById('save-video-btn'),
      qrLockedSection: document.getElementById('qr-locked-section'),
      qrUnlockedSection: document.getElementById('qr-unlocked-section'),
      unlockQrTriggerBtn: document.getElementById('unlock-qr-trigger-btn'),
      qrcodeBox: document.getElementById('qrcode'),
      copyCodeBtn: document.getElementById('copy-code-btn'),
      sessionCodeDisplay: document.getElementById('session-code-display'),
      copiesMinusBtn: document.getElementById('copies-minus-btn'),
      copiesPlusBtn: document.getElementById('copies-plus-btn'),
      copiesCountDisplay: document.getElementById('copies-count-display'),
      
      audioToggleBtn: document.getElementById('audio-toggle-btn'),
      audioIcon: document.getElementById('audio-icon-svg'),
      audioLabel: document.getElementById('audio-label'),
      settingsBtn: document.getElementById('settings-btn'),
      terminalToggleBtn: document.getElementById('terminal-toggle-btn')
    };
  }

  bindDOMEvents() {
    this.elements.startBtn.onclick = () => {
      try { soundFx.ensureContext(); } catch (e) {}
      try { videoRecorder.warmup(); } catch (e) {}
      soundFx.playClick();
      this.startCaptureSequence();
    };

    this.elements.proceedBtn.onclick = () => {
      soundFx.playClick();
      this.proceedToPrint();
    };

    this.elements.printBtn.onclick = () => {
      soundFx.playClick();
      this.handlePrint();
    };

    this.elements.resetBtn.onclick = () => {
      soundFx.playClick();
      this.resetSession();
    };

    this.elements.settingsBtn.onclick = () => {
      soundFx.playClick();
      settingsUI.toggle(true);
    };

    if (this.elements.terminalToggleBtn) {
      this.elements.terminalToggleBtn.onclick = () => {
        soundFx.playClick();
        terminalUI.toggle();
      };
    }

    if (this.elements.audioToggleBtn) {
      this.elements.audioToggleBtn.onclick = () => {
        const isMuted = soundFx.toggleMute();
        this.updateAudioButtonState();
        showToast(isMuted ? 'Acoustics muted' : 'Acoustics enabled', 'info');
      };
    }

    if (this.elements.copiesMinusBtn) {
      this.elements.copiesMinusBtn.onclick = () => {
        soundFx.playClick();
        appState.printCopies = Math.max(1, (appState.printCopies || 1) - 1);
        if (this.elements.copiesCountDisplay) {
          this.elements.copiesCountDisplay.textContent = appState.printCopies;
        }
      };
    }

    if (this.elements.copiesPlusBtn) {
      this.elements.copiesPlusBtn.onclick = () => {
        soundFx.playClick();
        appState.printCopies = Math.min(10, (appState.printCopies || 1) + 1);
        if (this.elements.copiesCountDisplay) {
          this.elements.copiesCountDisplay.textContent = appState.printCopies;
        }
      };
    }

    if (this.elements.copyCodeBtn) {
      this.elements.copyCodeBtn.onclick = () => this.handleCopyCode();
    }

    if (this.elements.noCamBtn) {
      this.elements.noCamBtn.onclick = () => {
        soundFx.playClick();
        logTerminal('Recalibrating camera sensor stream...', 'info');
        cameraManager.startCamera({ ignoreSavedCamera: true });
      };
    }

    if (this.elements.backToVfBtn) {
      this.elements.backToVfBtn.onclick = () => {
        soundFx.playClick();
        this.setStage('vf');
      };
    }

    if (this.elements.saveVideoBtn) {
      this.elements.saveVideoBtn.onclick = (e) => this.handleSaveVideo(e);
    }

    if (this.elements.unlockQrTriggerBtn) {
      this.elements.unlockQrTriggerBtn.onclick = (e) => this.handleSaveVideo(e);
    }

    const chargeRail = document.getElementById('charge-rail-wrap');
    if (chargeRail) {
      chargeRail.onclick = () => {
        if (appState.photos.length > 0 && !appState.capturing) {
          soundFx.playClick();
          this.setStage('sel');
        }
      };
    }

    const stripAClick = document.getElementById('strip-a-clickable');
    const stripBClick = document.getElementById('strip-b-clickable');
    if (stripAClick) {
      stripAClick.onclick = () => {
        soundFx.playClick();
        this.setStage('sel');
      };
    }
    if (stripBClick) {
      stripBClick.onclick = () => {
        soundFx.playClick();
        this.setStage('sel');
      };
    }

    // Global keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      // Spacebar capture trigger
      if (e.code === 'Space') {
        if (appState.stage === 'vf' && !appState.capturing && !this.elements.startBtn.disabled) {
          e.preventDefault();
          this.startCaptureSequence();
        }
      }
      
      // Number keys 1-8 for specimen selection in Stage 2
      if (appState.stage === 'sel' && e.key >= '1' && e.key <= '8') {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < appState.photos.length) {
          const card = this.elements.photoGrid.children[idx];
          if (card) this.togglePhotoSelection(idx, card);
        }
      }

      // Enter to proceed or print
      if (e.key === 'Enter') {
        if (appState.stage === 'sel' && !this.elements.proceedBtn.disabled) {
          this.proceedToPrint();
        }
      }
    });
  }

  updateAudioButtonState() {
    const iconSvg = document.getElementById('audio-icon-svg');
    const label = document.getElementById('audio-label');
    if (soundFx.isMuted) {
      if (iconSvg) {
        iconSvg.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`;
      }
      if (label) label.textContent = 'Muted';
    } else {
      if (iconSvg) {
        iconSvg.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>`;
      }
      if (label) label.textContent = 'Sound';
    }
  }

  async handleCopyCode() {
    if (!appState.sessionId) return;
    try {
      await navigator.clipboard.writeText(appState.sessionId);
      soundFx.playClick();
      showToast(`Session code [${appState.sessionId}] copied!`, 'success');
      if (this.elements.copyCodeBtn) {
        this.elements.copyCodeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg> Copied`;
        setTimeout(() => {
          if (this.elements.copyCodeBtn) {
            this.elements.copyCodeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
          }
        }, 2000);
      }
    } catch (e) {
      showToast(`Code: ${appState.sessionId}`, 'info');
    }
  }

  async loadSkins() {
    try {
      appState.customDesigns = await fetchSkinDesigns();
      this.buildDesignPickers();
      this.updateChalkboardAspect();
      logTerminal(`Registered ${appState.customDesigns.length} design templates.`, 'info');
    } catch (e) {
      logTerminal(`Skin loading error: ${e.message}`, 'error');
    }
  }

  buildDesignPickers() {
    const buildPicker = (container, stripKey) => {
      if (!container) return;
      container.innerHTML = '';
      appState.customDesigns.forEach((design, idx) => {
        const btn = document.createElement('button');
        const isActive = idx === (stripKey === 'a' ? appState.stripADesignIdx : appState.stripBDesignIdx);
        btn.type = 'button';
        btn.className = `strip-design-chip ${isActive ? 'active' : ''}`;
        
        // Big artistic SVG Watermark background (like Q reference) + Clean text
        btn.innerHTML = `
          <svg class="chip-watermark-svg" viewBox="0 0 100 100" aria-hidden="true">
            <text x="65" y="78" text-anchor="middle" font-family="'Space Grotesk', sans-serif" font-weight="900" font-size="90">${idx + 1}</text>
          </svg>
          <div class="chip-content">
            <span class="chip-idx">THEME 0${idx + 1}</span>
            <span class="chip-name">${design.name || `Design ${idx + 1}`}</span>
          </div>
        `;

        btn.onclick = () => {
          soundFx.playClick();
          if (stripKey === 'a') appState.stripADesignIdx = idx;
          else appState.stripBDesignIdx = idx;
          this.buildDesignPickers();
          this.renderCustomStrips();
        };
        container.appendChild(btn);
      });
    };

    buildPicker(this.elements.stripADesignSwitch, 'a');
    buildPicker(this.elements.stripBDesignSwitch, 'b');
  }

  updateChalkboardAspect() {
    const design = appState.customDesigns[appState.stripADesignIdx] || appState.customDesigns[0];
    if (design && design.slots && design.slots.length > 0) {
      const slot = design.slots[0];
      const cb = document.querySelector('.chalkboard');
      if (cb) {
        cb.style.setProperty('--chalkboard-aspect', `${slot.w} / ${slot.h}`);
      }
    }
  }

  setStage(stageName) {
    appState.setStage(stageName);
    this.elements.stageVf.classList.toggle('hidden', stageName !== 'vf');
    this.elements.stageSel.classList.toggle('hidden', stageName !== 'sel');
    this.elements.stagePr.classList.toggle('hidden', stageName !== 'pr');

    const botbar = document.querySelector('.botbar');
    if (botbar) {
      botbar.style.display = stageName === 'vf' ? 'grid' : 'none';
    }

    logTerminal(`Chamber transitioned to [${stageName.toUpperCase()}]`, 'info');
  }

  buildShotList() {
    this.elements.shotList.innerHTML = '';
    for (let i = 0; i < CONFIG.TOTAL_SHOTS; i++) {
      const dot = document.createElement('div');
      dot.className = 'shot-dot';
      dot.id = `shot-dot-${i}`;
      dot.textContent = String(i + 1).padStart(2, '0');
      dot.title = 'Click to choose photos';
      dot.onclick = () => {
        if (appState.photos.length > 0 && !appState.capturing) {
          soundFx.playClick();
          this.setStage('sel');
        }
      };
      this.elements.shotList.appendChild(dot);
    }
  }

  updateShotDots(currentIdx) {
    for (let i = 0; i < CONFIG.TOTAL_SHOTS; i++) {
      const dot = document.getElementById(`shot-dot-${i}`);
      if (!dot) continue;
      dot.classList.toggle('done', i < currentIdx);
      dot.classList.toggle('active', i === currentIdx);
    }
  }

  // ------------------------------------------------------------------------
  // QUANTUM CAPTURE SEQUENCE
  // ------------------------------------------------------------------------
  async startCaptureSequence() {
    if (appState.capturing) return;
    appState.capturing = true;
    window.__irise_capturing = true;
    // Ensure cold subsystems are ready BEFORE shot 1's first second.
    try { soundFx.ensureContext(); } catch (e) {}
    try { videoRecorder.warmup(); } catch (e) {}
    appState.photos = [];
    appState.allBursts = [];
    this.elements.startBtn.disabled = true;
    if (this.elements.chalkboard) this.elements.chalkboard.classList.add('capturing');
    if (this.elements.labTablet) this.elements.labTablet.classList.add('capturing');
    if (this.elements.captureInstructions) this.elements.captureInstructions.style.opacity = '0';

    const timerSelect = document.getElementById('setting-timer');
    const timerDuration = parseInt(timerSelect ? timerSelect.value : CONFIG.DEFAULT_TIMER_SECONDS, 10);
    logTerminal(`Initiating photon sequence (${CONFIG.TOTAL_SHOTS} frames, ${timerDuration}s telemetry cycle)...`, 'info');

    for (let shotIdx = 0; shotIdx < CONFIG.TOTAL_SHOTS; shotIdx++) {
      this.updateShotDots(shotIdx);
      const prompt = SCIENTIFIC_PROMPTS[shotIdx] || `Frame ${shotIdx + 1} of ${CONFIG.TOTAL_SHOTS}`;
      if (this.elements.instructionText) {
        this.elements.instructionText.textContent = prompt;
      }
      if (this.elements.cdownPrompt) {
        this.elements.cdownPrompt.textContent = prompt;
      }

      // Start burst recording, then yield so MediaRecorder encoder init
      // settles BEFORE the countdown ring starts animating. Previously both
      // collided in the same frame, janking every shot's first second.
      if (videoRecorder.isSupported() && cameraManager.stream) {
        videoRecorder.start(cameraManager.stream);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      }

      // Countdown with Circular Ring Animation
      await this.runCountdown(timerDuration);

      // Shutter Trigger & Capture Optical Frame
      await this.captureSingleFrame(shotIdx);

      // Stop burst recording
      if (videoRecorder.isRecording) {
        const burstBlob = await videoRecorder.stop();
        if (burstBlob) {
          appState.allBursts.push(burstBlob);
        }
      }

      // Brief pause between shots
      await new Promise(r => setTimeout(r, 600));
    }

    appState.capturing = false;
    window.__irise_capturing = false;
    this.elements.startBtn.disabled = false;
    if (this.elements.chalkboard) this.elements.chalkboard.classList.remove('capturing');
    if (this.elements.labTablet) this.elements.labTablet.classList.remove('capturing');
    if (this.elements.captureInstructions) this.elements.captureInstructions.style.opacity = '1';
    soundFx.playSuccess();
    logTerminal('All 8 specimen frames captured! Transitioning to analysis chamber.', 'success');
    this.setupSelectionStage();
  }

  runCountdown(seconds) {
    return new Promise((resolve) => {
      const startTime = performance.now();
      const durationMs = seconds * 1000;
      const maxOffset = 276.46; // 2 * PI * r (r=44)
      let lastSecondAnnounced = seconds;

      this.elements.cdownOverlay.classList.remove('hidden');
      this.elements.cdownNumber.textContent = String(seconds);
      if (this.elements.cdownCircleBar) {
        this.elements.cdownCircleBar.style.strokeDashoffset = '0';
      }
      soundFx.playCountdownTick();

      const updateFrame = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / durationMs, 1);
        const remainingSeconds = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));

        // Immediately update continuous smooth progress ring from millisecond 0
        if (this.elements.cdownCircleBar) {
          this.elements.cdownCircleBar.style.strokeDashoffset = String(maxOffset * progress);
        }

        // Trigger tick tone and digit change when integer second decrements
        if (remainingSeconds < lastSecondAnnounced && remainingSeconds > 0) {
          lastSecondAnnounced = remainingSeconds;
          this.elements.cdownNumber.textContent = String(remainingSeconds);
          soundFx.playCountdownTick();
        }

        if (elapsed < durationMs) {
          requestAnimationFrame(updateFrame);
        } else {
          this.elements.cdownOverlay.classList.add('hidden');
          soundFx.playCountdownFinal();
          resolve();
        }
      };

      requestAnimationFrame(updateFrame);
    });
  }

  captureSingleFrame(index) {
    return new Promise((resolve) => {
      const video = this.elements.camVideo;
      const canvas = this.elements.capCanvas;

      const targetW = video.videoWidth || (canvas.width > 300 ? canvas.width : 1280);
      const targetH = video.videoHeight || (canvas.height > 150 ? canvas.height : 720);
      // Reuse backing store: resizing every shot reallocates ~11MB and janks.
      if (canvas.width !== targetW) canvas.width = targetW;
      if (canvas.height !== targetH) canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // Mirror horizontally if enabled
      if (cameraManager.isMirrored) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Shutter flash animation & optical snap
      this.elements.shutterEl.classList.add('active');
      soundFx.playShutter();

      setTimeout(() => {
        this.elements.shutterEl.classList.remove('active');
      }, 110);

      canvas.toBlob((blob) => {
        if (!blob) { resolve(); return; }
        const url = URL.createObjectURL(blob);
        appState.photos.push({ id: index, url, blob });
        logTerminal(`Optical Frame ${index + 1} locked into matrix`, 'info');
        resolve();
      }, 'image/jpeg', 0.90);
    });
  }

  // ------------------------------------------------------------------------
  // SPECIMEN ANALYSIS & SELECTION STAGE
  // ------------------------------------------------------------------------
  setupSelectionStage() {
    this.setStage('sel');
    appState.selected = [];
    this.elements.proceedBtn.disabled = true;
    if (this.elements.selCount) this.elements.selCount.textContent = '0';
    this.elements.photoGrid.innerHTML = '';

    appState.photos.forEach((photo, idx) => {
      const card = document.createElement('div');
      card.className = 'photo-card';
      card.setAttribute('role', 'listitem');
      card.setAttribute('aria-label', `Specimen Sample ${idx + 1}`);
      card.innerHTML = `
        <img src="${photo.url}" alt="Sample ${idx + 1}" loading="lazy">
        <div class="specimen-tag">SAMPLE #${String(idx + 1).padStart(2, '0')}</div>
        <div class="photo-card-badge" id="badge-${idx}"></div>
      `;

      card.onclick = () => this.togglePhotoSelection(idx, card);
      this.elements.photoGrid.appendChild(card);
    });
  }

  togglePhotoSelection(idx, card) {
    const selIndex = appState.selected.indexOf(idx);
    const badge = card.querySelector('.photo-card-badge');

    if (selIndex > -1) {
      appState.selected.splice(selIndex, 1);
      badge.classList.remove('visible');
      badge.textContent = '';
      card.classList.remove('selected');
      soundFx.playDeselect();
    } else {
      if (appState.selected.length >= CONFIG.MAX_SELECT) {
        showToast(`Synthesis capacity reached: max ${CONFIG.MAX_SELECT} samples`, 'info');
        return;
      }
      appState.selected.push(idx);
      // Play ascending harmonic chord step (0 to 3)
      soundFx.playSelect(appState.selected.length - 1);
    }

    // Refresh all badge order numbers
    appState.photos.forEach((_, i) => {
      const b = document.getElementById(`badge-${i}`);
      const c = this.elements.photoGrid.children[i];
      const order = appState.selected.indexOf(i);
      if (order > -1 && b) {
        b.textContent = `#${order + 1}`;
        b.classList.add('visible');
        if (c) c.classList.add('selected');
      } else if (b) {
        b.classList.remove('visible');
        if (c) c.classList.remove('selected');
      }
    });

    const count = appState.selected.length;
    if (this.elements.selCount) this.elements.selCount.textContent = String(count);
    this.elements.proceedBtn.disabled = count < CONFIG.MAX_SELECT;

    if (count === CONFIG.MAX_SELECT) {
      soundFx.playSuccess();
    }
  }

  // ------------------------------------------------------------------------
  // PHYSICAL SYNTHESIS & DOSSIER ARCHIVE STAGE
  // ------------------------------------------------------------------------
  async proceedToPrint() {
    this.setStage('pr');
    appState.sessionId = generateSessionCode(5);
    this.videoServerBase = await getReachableVideoServerBase();
    this.videoViewerBase = await getVideoViewerBase(this.videoServerBase);

    // Map selected burst clips
    appState.selectedBursts = appState.selected.map(idx => appState.allBursts[idx]).filter(Boolean);

    // Ensure QR card starts in fun locked state before design confirmation
    if (this.elements.qrLockedSection) this.elements.qrLockedSection.classList.remove('hidden');
    if (this.elements.qrUnlockedSection) this.elements.qrUnlockedSection.classList.add('hidden');

    await this.generateQrCode();
    this.buildDesignPickers();
    await this.renderCustomStrips();

    // Increment session counter & update display
    const currentCount = parseInt(localStorage.getItem('irise_session_count') || '0', 10) + 1;
    localStorage.setItem('irise_session_count', String(currentCount));
    if (this.elements.sessionNumber) this.elements.sessionNumber.textContent = currentCount;
    logTerminal(`Experiment Session #${currentCount} [Code: ${appState.sessionId}] synthesized. Ready for physical transfer.`, 'success');
  }

  async generateQrCode() {
    const qrContainer = this.elements.qrcodeBox;
    if (!qrContainer) return;
    qrContainer.innerHTML = '';

    const viewerBase = (this.videoViewerBase || '').replace(/\/$/, '');
    if (!viewerBase) {
      logTerminal('QR withheld: no public homeserver or active print-server tunnel URL is available.', 'error');
      showToast('Guest QR unavailable: check the print-server Cloudflare tunnel.', 'error');
      return;
    }
    const targetUrl = `${viewerBase}/view.html?id=${encodeURIComponent(appState.sessionId)}`;

    if (typeof QRCode !== 'undefined') {
      new QRCode(qrContainer, {
        text: targetUrl,
        width: 140,
        height: 140,
        colorDark: '#1A1410',
        colorLight: '#FFFFFF',
        correctLevel: QRCode.CorrectLevel.M
      });
      logTerminal(`QR Code Generated → ${targetUrl}`, 'info');
    }

    if (this.elements.sessionCodeDisplay) {
      this.elements.sessionCodeDisplay.textContent = appState.sessionId;
    }
  }

  async renderCustomStrips() {
    let selectedPhotoUrls = appState.selected.map(i => appState.photos[i]?.url).filter(Boolean);
    
    // Fallback if testing directly without shots
    if (selectedPhotoUrls.length === 0 && appState.photos.length > 0) {
      selectedPhotoUrls = appState.photos.slice(0, 4).map(p => p.url);
    }

    const qrCanvas = this.elements.qrcodeBox ? this.elements.qrcodeBox.querySelector('canvas') : null;
    const designA = appState.customDesigns[appState.stripADesignIdx] || appState.customDesigns[0];
    const designB = appState.customDesigns[appState.stripBDesignIdx] || appState.customDesigns[0];

    logTerminal(`Synthesizing Strip A [${designA?.name || 'Default'}] & Strip B [${designB?.name || 'Default'}]...`, 'info');

    if (this.elements.stripAPreview) {
      await renderSingleStrip({
        selectedPhotos: selectedPhotoUrls,
        canvas: this.elements.stripAPreview,
        design: designA,
        qrCanvas
      });
    }

    if (this.elements.stripBPreview) {
      await renderSingleStrip({
        selectedPhotos: selectedPhotoUrls,
        canvas: this.elements.stripBPreview,
        design: designB,
        qrCanvas
      });
    }

    logTerminal('Optical strips synthesized successfully.', 'success');
  }

  async handlePrint() {
    logTerminal('Initializing physical print synthesis dialog...', 'info');
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast('Pop-up blocked. Allow pop-ups to print.', 'error');
      return;
    }

    const sheets = buildPrintSheets({
      stripACanvas: this.elements.stripAPreview,
      stripBCanvas: this.elements.stripBPreview,
      printCopies: appState.printCopies || 1
    });

    if (sheets.length === 0) {
      printWindow.close();
      logTerminal('Print cancelled: no exposure sheets found', 'warn');
      return;
    }

    const sheetImages = sheets.map(sheet => `<img class="print-sheet" src="${sheet.toDataURL('image/png')}" alt="">`).join('');

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Specimen Print - iRISE Optical Lab</title>
      <style>
        @page { margin: 0; size: 4in 6in; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 4in; height: 6in; background: #fff; overflow: hidden; }
        .print-sheet {
          width: 4in;
          height: 6in;
          object-fit: contain;
          object-position: center;
          display: block;
          page-break-after: always;
          break-after: page;
        }
        .print-sheet:last-child { page-break-after: auto; break-after: auto; }
      </style>
    </head><body>
      ${sheetImages}
      <script>
        const imgs = Array.from(document.images);
        Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; }))).then(() => {
          window.print();
          setTimeout(() => window.close(), 500);
        });
      <\/script>
    </body></html>`);
    printWindow.document.close();
    logTerminal('Physical synthesis dialog deployed.', 'success');
  }

  async handleSaveVideo(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (appState.videoProcessing) return;

    if (appState.selectedBursts.length === 0) {
      logTerminal('No video burst telemetry recorded for this session.', 'warn');
      showToast('No video bursts recorded for this session', 'info');
      return;
    }

    const designA = appState.customDesigns[appState.stripADesignIdx] || appState.customDesigns[0];
    const designB = appState.customDesigns[appState.stripBDesignIdx] || appState.customDesigns[0];
    const isDifferentDesign = designA && designB && (designA.id !== designB.id);
    const isDouble = isDifferentDesign;

    // Confirmatory Strip Selection Check
    const confirmed = await showDesignConfirmModal({
      designA,
      designB,
      isDouble
    });

    if (!confirmed) {
      logTerminal('Video compilation paused: Operator choosing to adjust strip designs.', 'info');
      showToast('Adjust your frame designs above, then click Process when ready!', 'info');
      return;
    }

    appState.videoProcessing = true;
    const btn = this.elements.saveVideoBtn;
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span>⏳ Compiling Live Telemetry (FFmpeg)...</span>`;
    }

    showToast('Compiling composite video telemetry...', 'info');

    try {
      let photoBlob = null;
      const canvasA = this.elements.stripAPreview;
      const canvasB = this.elements.stripBPreview;

      if (isDouble && canvasA && canvasB) {
        const combined = document.createElement('canvas');
        combined.width = canvasA.width + canvasB.width;
        combined.height = Math.max(canvasA.height, canvasB.height);
        const ctx = combined.getContext('2d');
        ctx.drawImage(canvasA, 0, 0);
        ctx.drawImage(canvasB, canvasA.width, 0);
        photoBlob = await new Promise(r => combined.toBlob(r, 'image/png'));
        logTerminal(`Double-exposure mode: synthesizing [${designA.name}] + [${designB.name}]`, 'info');
      } else if (canvasA) {
        photoBlob = await new Promise(r => canvasA.toBlob(r, 'image/png'));
      }

      const res = await processVideoSession({
        sessionId: appState.sessionId,
        serverBase: this.videoServerBase,
        viewerBase: this.videoViewerBase,
        burstBlobs: appState.selectedBursts,
        skinId: designA ? designA.id : 'd1',
        skinIdB: designB ? designB.id : (designA ? designA.id : 'd1'),
        slots: designA ? designA.slots : [],
        slotsB: designB ? designB.slots : (designA ? designA.slots : []),
        mirror: cameraManager.isMirrored,
        isDouble,
        photoBlob
      });

      // Unlock the QR code display with celebratory pop
      if (this.elements.qrLockedSection) this.elements.qrLockedSection.classList.add('hidden');
      if (this.elements.qrUnlockedSection) {
        this.elements.qrUnlockedSection.classList.remove('hidden');
        this.elements.qrUnlockedSection.style.animation = 'unlock-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
      }
      soundFx.playSuccess();

      showToast('Live video developed & QR code unlocked!', 'success');
      logTerminal(`Video ready: ${res.url || res.viewerUrl || 'Done'}`, 'success');
    } catch (err) {
      console.error('Video processing error:', err);
      showToast(`Video processing failed: ${err.message}`, 'error');
      logTerminal(`Failed to compile video: ${err.message}`, 'error');
    } finally {
      appState.videoProcessing = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  }

  resetSession() {
    logTerminal('Resetting chamber for new experiment...', 'info');
    appState.reset();
    this.videoServerBase = null;
    this.videoViewerBase = null;
    if (this.elements.qrLockedSection) this.elements.qrLockedSection.classList.remove('hidden');
    if (this.elements.qrUnlockedSection) this.elements.qrUnlockedSection.classList.add('hidden');
    if (this.elements.copiesCountDisplay) {
      this.elements.copiesCountDisplay.textContent = '1';
    }
    this.buildShotList();
    this.setStage('vf');
    cameraManager.startCamera();
  }
}

// Bootstrap on DOM load
window.addEventListener('DOMContentLoaded', () => {
  const app = new PhotoboothApp();
  app.init();
});
