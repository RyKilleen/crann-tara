const GEO_MAX_AGE_MS = 2000;
const ORIENTATION_THROTTLE_MS = 500;
const HEADING_SMOOTHING = 0.25; // EMA weight for new readings (lower = smoother)

let currentHeading = null;
let orientationListening = false;
let lastOrientationBroadcast = 0;

let _state = null;
let _callbacks = null;

function smoothHeading(raw) {
  if (currentHeading == null) return raw;
  let diff = raw - currentHeading;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return ((currentHeading + HEADING_SMOOTHING * diff) % 360 + 360) % 360;
}

function onLocationChange() {
  if (!_state.myLocation) return;
  _state.myLocation.heading = currentHeading;
  _state.myLocation.timestamp = Date.now();
  _callbacks.broadcastMyLocation();
  _callbacks.renderPeers();
}

function onOrientation(e) {
  let raw = null;
  if (e.webkitCompassHeading != null) {
    raw = e.webkitCompassHeading;
  } else if (e.alpha != null) {
    raw = (360 - e.alpha) % 360;
  }
  if (raw != null) {
    currentHeading = smoothHeading(raw);
  }
  const now = Date.now();
  if (now - lastOrientationBroadcast >= ORIENTATION_THROTTLE_MS) {
    lastOrientationBroadcast = now;
    onLocationChange();
  }
}

function listenOrientation() {
  window.addEventListener('deviceorientationabsolute', onOrientation, true);
  window.addEventListener('deviceorientation', onOrientation, true);
  orientationListening = true;
}

export function startGeo(state, callbacks) {
  _state = state;
  _callbacks = callbacks;

  if (!state.myLocation) {
    state.myLocation = {
      peerId: state.peer?.id,
      name: state.name,
      lat: 0,
      lng: 0,
      heading: currentHeading,
      timestamp: Date.now(),
    };
    callbacks.renderPeers();
  }

  if (!navigator.geolocation) {
    callbacks.showToast('Geolocation not supported — using placeholder', true);
    return;
  }
  state.geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      state.myLocation.peerId = state.peer?.id;
      state.myLocation.name = state.name;
      state.myLocation.lat = pos.coords.latitude;
      state.myLocation.lng = pos.coords.longitude;
      onLocationChange();
    },
    (err) => {
      console.warn('[geo] error:', err.code, err.message);
      callbacks.broadcastMyLocation();
    },
    { enableHighAccuracy: true, maximumAge: GEO_MAX_AGE_MS }
  );
}

export function startCompass() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then((perm) => { if (perm === 'granted') listenOrientation(); })
      .catch(() => {});
  } else {
    listenOrientation();
  }
}

export function stopOrientation() {
  if (!orientationListening) return;
  window.removeEventListener('deviceorientationabsolute', onOrientation, true);
  window.removeEventListener('deviceorientation', onOrientation, true);
  orientationListening = false;
  currentHeading = null;
}

export function getCurrentHeading() {
  return currentHeading;
}
