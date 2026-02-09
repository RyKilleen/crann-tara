import {
  startGeo as _startGeo,
  startCompass as _startCompass,
  stopOrientation,
} from "./geo.js";
import {
  createChannel as _createChannel,
  joinChannel as _joinChannel,
  broadcastMyLocation as _broadcastMyLocation,
  leaveChannel as _leaveChannel,
} from "./peer.js";

const CHANNEL_CODE_LENGTH = 6;
const TOAST_DURATION_MS = 3500;
const JUST_NOW_THRESHOLD_S = 5;
const MAP_INITIAL_ZOOM = 2;
const MAP_MAX_ZOOM = 21;
const MAP_FIT_PADDING = [40, 40];
const MARKER_SIZE = 24;
const MARKER_SCALE_ZOOM_THRESHOLD = 17;
const MARKER_SCALE_FACTOR = 1.5;
const COORD_DECIMAL_PLACES = 5;

/* ───── Whimsical Name Generator ───── */
const ADJECTIVES = [
  "Swift", "Brave", "Cosmic", "Daring", "Eager", "Fierce", "Gentle", "Happy",
  "Icy", "Jolly", "Keen", "Lucky", "Mighty", "Noble", "Plucky", "Quick",
  "Radiant", "Sneaky", "Trusty", "Upbeat", "Vivid", "Wandering", "Wild",
  "Zany", "Bold", "Clever", "Dreamy", "Frosty", "Golden", "Hazy",
];

const NOUNS = [
  "Otter", "Falcon", "Fox", "Badger", "Crane", "Dolphin", "Eagle", "Ferret",
  "Gecko", "Heron", "Ibis", "Jackal", "Koala", "Lemur", "Moose", "Newt",
  "Osprey", "Panda", "Quail", "Raven", "Shark", "Tiger", "Urchin", "Viper",
  "Walrus", "Yak", "Zebra", "Lynx", "Owl", "Wolf",
];

function generateName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

/* ───── State ───── */
const state = {
  name: "",
  code: "",
  isCreator: false,
  peer: null,
  connections: new Map(),
  locations: new Map(),
  geoWatchId: null,
  myLocation: null,
};

let map = null;
const markers = new Map();
let userHasInteracted = false;
let programmaticMove = false;
let knownPeerIds = new Set();

/* ───── DOM refs ───── */
const $ = (sel) => document.querySelector(sel);
const welcomeScreen = $("#welcome-screen");
const beaconScreen = $("#beacon-screen");
const nameDisplay = $("#name-display");
const rerollBtn = $("#reroll-btn");
const codeInput = $("#code-input");
const createBtn = $("#create-btn");
const joinBtn = $("#join-btn");
const copyBtn = $("#copy-btn");
const leaveBtn = $("#leave-btn");
const beaconCodeEl = $("#beacon-code");
const peerListEl = $("#peer-list");
const toastEl = $("#toast");

/* ───── Utilities ───── */
const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(len = CHANNEL_CODE_LENGTH) {
  let code = "";
  const arr = crypto.getRandomValues(new Uint8Array(len));
  for (const b of arr) code += CHARSET[b % CHARSET.length];
  return code;
}

function peerIdFor(code) {
  return `way-${code}`;
}

let toastTimer;
function showToast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.className = "toast visible" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = "toast";
  }, TOAST_DURATION_MS);
}

function timeAgo(ts) {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < JUST_NOW_THRESHOLD_S) return "just now";
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

function showScreen(screen) {
  welcomeScreen.classList.remove("active");
  beaconScreen.classList.remove("active");
  screen.classList.add("active");
}

const ARROW_SVG_PATH = "M10 2 L16 16 L10 12 L4 16 Z";

function markerSizeForZoom(zoom) {
  if (zoom <= MARKER_SCALE_ZOOM_THRESHOLD) return MARKER_SIZE;
  const t = (zoom - MARKER_SCALE_ZOOM_THRESHOLD) / (MAP_MAX_ZOOM - MARKER_SCALE_ZOOM_THRESHOLD);
  return MARKER_SIZE * (1 + t * (MARKER_SCALE_FACTOR - 1));
}

function arrowSvg(color, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20"><path d="${ARROW_SVG_PATH}" fill="${color}" /></svg>`;
}

function accentColor(isSelf) {
  return isSelf ? "var(--accent)" : "var(--accent2)";
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

/* ───── Map ───── */
function initMap() {
  if (map) return;
  map = L.map("map").setView([0, 0], MAP_INITIAL_ZOOM);
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: MAP_MAX_ZOOM,
    },
  ).addTo(map);

  map.on("zoomstart", () => {
    if (!programmaticMove) userHasInteracted = true;
  });
  map.on("dragstart", () => {
    userHasInteracted = true;
  });
  map.on("zoomend", () => {
    renderPeers();
  });
}

function cleanupMap() {
  if (map) {
    map.remove();
    map = null;
  }
  markers.clear();
  userHasInteracted = false;
  knownPeerIds = new Set();
}

function createMarkerIcon(heading, isSelf, size = MARKER_SIZE) {
  const rotation = heading != null ? Math.round(heading) : 0;
  return L.divIcon({
    className: "",
    html: `<div class="map-marker" style="transform: rotate(${rotation}deg)">${arrowSvg(accentColor(isSelf), size)}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/* ───── Rendering ───── */
function updateMapMarkers(locations) {
  if (!map) return;

  const activePeerIds = new Set(locations.map((l) => l.peerId));

  for (const [pid, marker] of markers) {
    if (!activePeerIds.has(pid)) {
      map.removeLayer(marker);
      markers.delete(pid);
    }
  }

  const bounds = [];

  for (const loc of locations) {
    if (loc.lat === 0 && loc.lng === 0) continue;
    const latlng = [loc.lat, loc.lng];
    bounds.push(latlng);
    const isSelf = loc.isSelf || false;
    const size = markerSizeForZoom(map.getZoom());
    const icon = createMarkerIcon(loc.heading, isSelf, size);

    if (markers.has(loc.peerId)) {
      const m = markers.get(loc.peerId);
      m.setLatLng(latlng);
      m.setIcon(icon);
    } else {
      const m = L.marker(latlng, { icon })
        .bindTooltip(escapeHtml(loc.name) + (isSelf ? " (you)" : ""), {
          permanent: false,
          direction: "top",
        })
        .addTo(map);
      markers.set(loc.peerId, m);
    }
  }

  const currentPeerIds = new Set(locations.map((l) => l.peerId));
  const hasNewPeer = [...currentPeerIds].some((id) => !knownPeerIds.has(id));
  knownPeerIds = currentPeerIds;

  if (bounds.length > 0 && (!userHasInteracted || hasNewPeer)) {
    programmaticMove = true;
    if (bounds.length === 1) {
      map.setView(bounds[0], MAP_MAX_ZOOM);
    } else {
      map.fitBounds(bounds, {
        padding: MAP_FIT_PADDING,
        maxZoom: MAP_MAX_ZOOM,
      });
    }
    programmaticMove = false;
  }
}

function renderPeerCards(locations) {
  peerListEl.innerHTML = locations
    .map((loc) => {
      const headingDeg = loc.heading != null ? Math.round(loc.heading) : null;
      const arrowRotation = headingDeg != null ? headingDeg : 0;
      const isSelf = loc.isSelf || false;

      return `
      <div class="peer-card${isSelf ? " self" : ""}">
        <div class="peer-compass">
          <span class="arrow" style="transform: rotate(${arrowRotation}deg)"
                title="${headingDeg != null ? headingDeg + "°" : "no heading"}">
            ${arrowSvg(accentColor(isSelf))}
          </span>
        </div>
        <div class="peer-info">
          <div class="peer-name">
            ${escapeHtml(loc.name)}${isSelf ? '<span class="you-badge">(you)</span>' : ""}
          </div>
          <div class="peer-coords">${loc.lat === 0 && loc.lng === 0 ? "awaiting location..." : `${loc.lat.toFixed(COORD_DECIMAL_PLACES)}, ${loc.lng.toFixed(COORD_DECIMAL_PLACES)}`}</div>
        </div>
        <div class="peer-meta">
          ${headingDeg != null ? `<div class="peer-heading">${headingDeg}°</div>` : ""}
          <div class="peer-time">${timeAgo(loc.timestamp)}</div>
        </div>
      </div>`;
    })
    .join("");
}

function renderPeers() {
  const all = [];
  if (state.myLocation) all.push({ ...state.myLocation, isSelf: true });
  for (const loc of state.locations.values()) {
    if (loc.peerId !== state.peer?.id) all.push(loc);
  }

  if (all.length === 0) {
    peerListEl.innerHTML =
      '<p class="empty-state">Waiting for others to answer...</p>';
    return;
  }

  updateMapMarkers(all);
  renderPeerCards(all);
}

/* ───── Module wrappers ───── */
function broadcastMyLocation() {
  _broadcastMyLocation(state);
}

function startGeo() {
  _startGeo(state, { broadcastMyLocation, renderPeers, showToast });
}

function startCompass() {
  _startCompass();
}

const peerDeps = () => ({
  state,
  showToast,
  showScreen,
  initMap,
  startGeo,
  startCompass,
  renderPeers,
  beaconCodeEl,
  beaconScreen,
  createBtn,
  joinBtn,
  codeInput,
  generateCode,
  peerIdFor,
  CHANNEL_CODE_LENGTH,
  leaveChannel,
  stopOrientation,
  cleanupMap,
  welcomeScreen,
});

function createChannel() {
  _createChannel(peerDeps());
}

function joinChannel() {
  _joinChannel(peerDeps());
}

function leaveChannel() {
  _leaveChannel(peerDeps());
}

/* ───── Auto-generate name on load ───── */
state.name = generateName();
nameDisplay.textContent = state.name;

/* ───── Event Listeners ───── */
createBtn.addEventListener("click", createChannel);
joinBtn.addEventListener("click", joinChannel);
leaveBtn.addEventListener("click", leaveChannel);

rerollBtn.addEventListener("click", () => {
  state.name = generateName();
  nameDisplay.textContent = state.name;
});

copyBtn.addEventListener("click", () => {
  navigator.clipboard
    .writeText(state.code)
    .then(() => showToast("Beacon code copied"))
    .catch(() => showToast("Copy failed", true));
});

codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
});
