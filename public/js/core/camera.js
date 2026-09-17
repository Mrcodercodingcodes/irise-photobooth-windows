/**
 * Camera Stream & Device Manager
 * Handles hardware camera streams, resolution selection, mirroring, and clean lifecycle.
 */

class CameraManager {
  constructor() {
    this.stream = null;
    this.videoElement = null;
    this.currentDeviceId = localStorage.getItem('irise_camera_id') || null;
    // 720p default: slot photos are ~1114x348, 1080p/4K only adds
    // decode + encode cost during simultaneous preview + MediaRecorder.
    this.targetResolution = parseInt(localStorage.getItem('irise_resolution') || '1280', 10);
    this.isMirrored = localStorage.getItem('irise_mirror') !== 'false';
  }

  setVideoElement(videoEl) {
    this.videoElement = videoEl;
    if (this.videoElement) {
      this.videoElement.style.transform = this.isMirrored ? 'scaleX(-1)' : 'scaleX(1)';
    }
  }

  setMirror(mirrored) {
    this.isMirrored = mirrored;
    localStorage.setItem('irise_mirror', String(mirrored));
    if (this.videoElement) {
      this.videoElement.style.transform = mirrored ? 'scaleX(-1)' : 'scaleX(1)';
    }
  }

  setResolution(width) {
    this.targetResolution = parseInt(width, 10);
    localStorage.setItem('irise_resolution', String(this.targetResolution));
    return this.startCamera();
  }

  setDeviceId(deviceId) {
    this.currentDeviceId = deviceId;
    localStorage.setItem('irise_camera_id', deviceId);
    return this.startCamera();
  }

  stopStream() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {
          console.error('Error stopping track:', e);
        }
      });
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  }

  async getDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'videoinput');
    } catch (err) {
      console.error('Failed to list video devices:', err);
      return [];
    }
  }

  async startCamera(options = {}) {
    this.stopStream();

    const idealWidth = this.targetResolution;
    const idealHeight = Math.round(idealWidth * 0.75); // 4:3 default

    const constraints = {
      audio: false,
      video: {
        width: { ideal: idealWidth },
        height: { ideal: idealHeight },
        frameRate: { ideal: 30 }
      }
    };

    if (this.currentDeviceId && !options.ignoreSavedCamera) {
      constraints.video.deviceId = { exact: this.currentDeviceId };
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (this.videoElement) {
        this.videoElement.srcObject = this.stream;
        await this.videoElement.play();
      }
      return { success: true, stream: this.stream };
    } catch (err) {
      console.warn('Initial camera constraint failed, falling back to default videoinput:', err);
      if (constraints.video.deviceId) {
        // Fallback without exact deviceId
        try {
          delete constraints.video.deviceId;
          this.stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (this.videoElement) {
            this.videoElement.srcObject = this.stream;
            await this.videoElement.play();
          }
          return { success: true, stream: this.stream };
        } catch (fallbackErr) {
          console.error('Camera fallback failed:', fallbackErr);
          return { success: false, error: fallbackErr };
        }
      }
      return { success: false, error: err };
    }
  }
}

export const cameraManager = new CameraManager();
