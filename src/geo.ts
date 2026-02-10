import { state } from "./state";
import { broadcastMyLocation } from "./state";
import { showToast } from "./ui";
import { renderPeers } from "./map";

const GEO_MAX_AGE_MS = 2000;
const ORIENTATION_THROTTLE_MS = 500;
const HEADING_SMOOTHING = 0.25;

let currentHeading: number | null = null;
let orientationListening = false;
let lastOrientationBroadcast = 0;

function smoothHeading(raw: number): number {
  if (currentHeading == null) return raw;
  let diff = raw - currentHeading;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return ((currentHeading + HEADING_SMOOTHING * diff) % 360 + 360) % 360;
}

function onLocationChange(): void {
  if (!state.myLocation) return;
  state.myLocation.heading = currentHeading;
  state.myLocation.timestamp = Date.now();
  broadcastMyLocation();
  renderPeers();
}

function onOrientation(e: DeviceOrientationEvent): void {
  let raw: number | null = null;
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

function listenOrientation(): void {
  window.addEventListener("deviceorientationabsolute", onOrientation as EventListener, true);
  window.addEventListener("deviceorientation", onOrientation, true);
  orientationListening = true;
}

export function startGeo(): void {
  if (!state.myLocation) {
    state.myLocation = {
      peerId: state.peer?.id ?? "",
      name: state.name,
      lat: 0,
      lng: 0,
      heading: currentHeading,
      timestamp: Date.now(),
    };
    renderPeers();
  }

  if (!navigator.geolocation) {
    showToast("Geolocation not supported — using placeholder", true);
    return;
  }
  state.geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      state.myLocation!.peerId = state.peer?.id ?? "";
      state.myLocation!.name = state.name;
      state.myLocation!.lat = pos.coords.latitude;
      state.myLocation!.lng = pos.coords.longitude;
      onLocationChange();
    },
    (err) => {
      console.warn("[geo] error:", err.code, err.message);
      broadcastMyLocation();
    },
    { enableHighAccuracy: true, maximumAge: GEO_MAX_AGE_MS },
  );
}

export function startCompass(): void {
  const DOE = DeviceOrientationEvent as unknown as DeviceOrientationEventWithPermission;
  if (typeof DeviceOrientationEvent !== "undefined" &&
      typeof DOE.requestPermission === "function") {
    DOE.requestPermission!()
      .then((perm: string) => { if (perm === "granted") listenOrientation(); })
      .catch(() => {});
  } else {
    listenOrientation();
  }
}

export function stopOrientation(): void {
  if (!orientationListening) return;
  window.removeEventListener("deviceorientationabsolute", onOrientation as EventListener, true);
  window.removeEventListener("deviceorientation", onOrientation, true);
  orientationListening = false;
  currentHeading = null;
}
