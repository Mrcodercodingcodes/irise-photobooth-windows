import { logTerminal } from './api.js?v=20260916-9';

const MEDIAPIPE_VERSION = '1.0.1';
const WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const INFERENCE_INTERVAL_MS = 120;

const LEFT_IRIS_CENTER = 468;
const RIGHT_IRIS_CENTER = 473;
const LEFT_EYE_CORNERS = [33, 133];
const RIGHT_EYE_CORNERS = [362, 263];

function midpoint(a, b) {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function validPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function getEyeCenters(landmarks) {
  if (!landmarks || landmarks.length === 0) return { left: null, right: null };
  const left = validPoint(landmarks[LEFT_IRIS_CENTER])
    ? landmarks[LEFT_IRIS_CENTER]
    : midpoint(landmarks[LEFT_EYE_CORNERS[0]], landmarks[LEFT_EYE_CORNERS[1]]);
  const right = validPoint(landmarks[RIGHT_IRIS_CENTER])
    ? landmarks[RIGHT_IRIS_CENTER]
    : midpoint(landmarks[RIGHT_EYE_CORNERS[0]], landmarks[RIGHT_EYE_CORNERS[1]]);
  return { left, right };
}

function getEyeFocusPoint(landmarks) {
  const { left, right } = getEyeCenters(landmarks);

  if (!left) return right;
  if (!right) return left;

  // Focusing between both eyes places the marker on the nose bridge.
  // Target whichever iris is closer to the center of the frame instead.
  return Math.abs(left.x - 0.5) <= Math.abs(right.x - 0.5) ? left : right;
}

class EyeFocusTracker {
  constructor() {
    this.video = null;
    this.container = null;
    this.target = null;
    this.landmarker = null;
    this.rafId = null;
    this.running = false;
    this.lastVideoTime = -1;
    this.lastInferenceAt = 0;
    this.lastTrack = null;
    this.focusPromise = null;
    this.loggedFocusSupport = false;
  }

  attach({ video, container, target }) {
    this.stop();
    this.video = video;
    this.container = container;
    this.target = target;
    this.running = Boolean(video && container && target);
    if (!this.running) return;

    logTerminal('Starting MediaPipe eye focus tracker...', 'info');
    this.loop();
    this.initialize();
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.landmarker && typeof this.landmarker.close === 'function') {
      try { this.landmarker.close(); } catch (e) {}
    }
    this.landmarker = null;
    this.lastTrack = null;
    this.focusPromise = null;
    this.hideTarget();
  }

  async initialize() {
    try {
      const { FaceLandmarker, FilesetResolver } = await import(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`
      );
      if (!this.running) return;

      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
      let landmarker;
      try {
        landmarker = await FaceLandmarker.createFromOptions(vision, this.options('GPU'));
      } catch (gpuError) {
        landmarker = await FaceLandmarker.createFromOptions(vision, this.options('CPU'));
      }

      if (!this.running) {
        if (landmarker && typeof landmarker.close === 'function') landmarker.close();
        return;
      }

      this.landmarker = landmarker;
      logTerminal('MediaPipe eye focus tracking is ready.', 'success');
    } catch (error) {
      logTerminal(`MediaPipe eye focus unavailable: ${error.message}`, 'warn');
      this.hideTarget();
    }
  }

  options(delegate) {
    return {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    };
  }

  loop = () => {
    if (!this.running) return;

    const now = performance.now();
    if (
      this.landmarker &&
      this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      this.video.videoWidth > 0 &&
      this.video.currentTime !== this.lastVideoTime &&
      now - this.lastInferenceAt >= INFERENCE_INTERVAL_MS
    ) {
      this.lastVideoTime = this.video.currentTime;
      this.lastInferenceAt = now;
      try {
        const result = this.landmarker.detectForVideo(this.video, now);
        const landmarks = result?.faceLandmarks?.[0];
        const eyes = getEyeCenters(landmarks);
        const eye = getEyeFocusPoint(landmarks);
        if (eye) {
          const eyeSpacing = eyes.left && eyes.right ? Math.abs(eyes.right.x - eyes.left.x) : null;
          this.showTarget(eye.x, eye.y, eyeSpacing);
        }
        else this.hideTarget();
      } catch (error) {
        logTerminal(`Eye focus frame skipped: ${error.message}`, 'warn');
        this.landmarker = null;
      }
    }

    this.applyContinuousFocus();
    this.rafId = requestAnimationFrame(this.loop);
  };

  applyContinuousFocus() {
    const track = this.video?.srcObject?.getVideoTracks?.()[0];
    if (!track || track === this.lastTrack || this.focusPromise) return;
    this.lastTrack = track;

    try {
      const capabilities = track.getCapabilities?.();
      const modes = capabilities?.focusMode;
      if (!Array.isArray(modes) || !modes.includes('continuous')) return;
      this.focusPromise = track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] })
        .then(() => {
          if (!this.loggedFocusSupport) {
            logTerminal('Camera continuous autofocus enabled.', 'info');
            this.loggedFocusSupport = true;
          }
        })
        .catch(() => {})
        .finally(() => { this.focusPromise = null; });
    } catch (error) {}
  }

  showTarget(x, y, eyeSpacing = null) {
    if (!this.target || !this.container) return;

    const bounds = this.container.getBoundingClientRect();
    const videoWidth = this.video.videoWidth;
    const videoHeight = this.video.videoHeight;
    if (!bounds.width || !bounds.height || !videoWidth || !videoHeight) return;

    const mirrored = this.video.style.transform.includes('-1');
    const sourceX = mirrored ? 1 - x : x;
    const containerAspect = bounds.width / bounds.height;
    const videoAspect = videoWidth / videoHeight;
    const objectFit = getComputedStyle(this.video).objectFit;
    const scale = objectFit === 'cover'
      ? Math.max(bounds.width / videoWidth, bounds.height / videoHeight)
      : Math.min(bounds.width / videoWidth, bounds.height / videoHeight);
    const drawnWidth = videoWidth * scale;
    const drawnHeight = videoHeight * scale;
    const offsetX = (bounds.width - drawnWidth) / 2;
    const offsetY = (bounds.height - drawnHeight) / 2;
    const markerSize = Number.isFinite(eyeSpacing)
      ? Math.max(16, Math.min(32, eyeSpacing * drawnWidth * 0.38))
      : 24;

    // Keep the marker aligned with the rendered video, including letterboxing.
    const left = offsetX + sourceX * drawnWidth;
    const top = offsetY + y * drawnHeight;
    if (!Number.isFinite(left) || !Number.isFinite(top) || !containerAspect || !videoAspect) return;

    this.target.style.left = `${left}px`;
    this.target.style.top = `${top}px`;
    this.target.style.width = `${markerSize}px`;
    this.target.style.height = `${markerSize}px`;
    this.target.classList.add('visible');
  }

  hideTarget() {
    if (this.target) this.target.classList.remove('visible');
  }
}

export const eyeFocusTracker = new EyeFocusTracker();
