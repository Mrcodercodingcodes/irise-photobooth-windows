/**
 * MediaRecorder & Video Burst Engine
 * Safely buffers video chunks with automatic garbage collection of Object URLs.
 */

class VideoRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this._cachedMime = null;
    this._mimeProbed = false;
  }

  isSupported() {
    return typeof MediaRecorder !== 'undefined';
  }

  // Probe + cache the best mime once, off the capture critical path.
  // Previously this ran 4x isTypeSupported() inside every shot's first frame.
  getMime() {
    if (this._mimeProbed) return this._cachedMime;
    this._mimeProbed = true;
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
      this._cachedMime = '';
      return this._cachedMime;
    }
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ];
    this._cachedMime = mimeTypes.find(type => {
      try { return MediaRecorder.isTypeSupported(type); } catch (e) { return false; }
    }) || '';
    return this._cachedMime;
  }

  // Call on Start-button hover / first gesture so encoder probing + JIT
  // happens before the countdown, not inside its first second.
  warmup() {
    try { this.getMime(); } catch (e) {}
  }

  start(stream, options = {}) {
    if (!stream || this.isRecording) return false;

    this.recordedChunks = [];
    const selectedMime = this.getMime();
    const recorderOptions = selectedMime ? { mimeType: selectedMime } : {};
    
    if (options.videoBitsPerSecond) {
      recorderOptions.videoBitsPerSecond = options.videoBitsPerSecond;
    }

    try {
      this.mediaRecorder = new MediaRecorder(stream, recorderOptions);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };
      this.mediaRecorder.start(100); // 100ms timeslices
      this.isRecording = true;
      return true;
    } catch (err) {
      console.error('Failed to start MediaRecorder:', err);
      return false;
    }
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || !this.isRecording) {
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = () => {
        const mime = this.mediaRecorder.mimeType || 'video/webm';
        const blob = new Blob(this.recordedChunks, { type: mime });
        this.isRecording = false;
        this.recordedChunks = [];
        resolve(blob);
      };

      try {
        this.mediaRecorder.stop();
      } catch (e) {
        this.isRecording = false;
        resolve(null);
      }
    });
  }
}

export const videoRecorder = new VideoRecorder();
