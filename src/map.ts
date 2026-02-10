import L from "leaflet";
import type { PeerView } from "./types";
import { state } from "./state";
import { peerListEl, escapeHtml, timeAgo, COORD_DECIMAL_PLACES } from "./ui";

const MAP_INITIAL_ZOOM = 2;
const MAP_MAX_ZOOM = 21;
const MAP_FIT_PADDING: [number, number] = [40, 40];
const MARKER_SIZE = 24;
const MARKER_SCALE_ZOOM_THRESHOLD = 17;
const MARKER_SCALE_FACTOR = 1.5;
const ARROW_SVG_PATH = "M10 2 L16 16 L10 12 L4 16 Z";

export const mapState = {
  map: null as L.Map | null,
  markers: new Map<string, L.Marker>(),
  userHasInteracted: false,
  programmaticMove: false,
  peersFittedOnMap: new Set<string>(),
};

function markerSizeForZoom(zoom: number): number {
  if (zoom <= MARKER_SCALE_ZOOM_THRESHOLD) return MARKER_SIZE;
  const t = (zoom - MARKER_SCALE_ZOOM_THRESHOLD) / (MAP_MAX_ZOOM - MARKER_SCALE_ZOOM_THRESHOLD);
  return MARKER_SIZE * (1 + t * (MARKER_SCALE_FACTOR - 1));
}

function arrowSvg(color: string, size = 20): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20"><path d="${ARROW_SVG_PATH}" fill="${color}" /></svg>`;
}

function accentColor(isSelf: boolean): string {
  return isSelf ? "var(--accent)" : "var(--accent2)";
}

function createMarkerIcon(heading: number | null, isSelf: boolean, size = MARKER_SIZE): L.DivIcon {
  const rotation = heading != null ? Math.round(heading) : 0;
  return L.divIcon({
    className: "",
    html: `<div class="map-marker" style="transform: rotate(${rotation}deg)">${arrowSvg(accentColor(isSelf), size)}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function initMap(): void {
  if (mapState.map) return;
  mapState.map = L.map("map").setView([0, 0], MAP_INITIAL_ZOOM);
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: MAP_MAX_ZOOM,
    },
  ).addTo(mapState.map);

  mapState.map.on("zoomstart", () => {
    if (!mapState.programmaticMove) mapState.userHasInteracted = true;
  });
  mapState.map.on("dragstart", () => {
    mapState.userHasInteracted = true;
  });
  mapState.map.on("zoomend", () => {
    renderPeers();
  });
}

export function cleanupMap(): void {
  if (mapState.map) {
    mapState.map.remove();
    mapState.map = null;
  }
  mapState.markers.clear();
  mapState.userHasInteracted = false;
  mapState.peersFittedOnMap = new Set();
}

function updateMapMarkers(locations: PeerView[]): void {
  const { map, markers } = mapState;
  if (!map) return;

  const activePeerIds = new Set(locations.map((l) => l.peerId));

  for (const [pid, marker] of markers) {
    if (!activePeerIds.has(pid)) {
      map.removeLayer(marker);
      markers.delete(pid);
    }
  }

  const bounds: L.LatLngTuple[] = [];

  for (const loc of locations) {
    if (loc.lat === 0 && loc.lng === 0) continue;
    const latlng: L.LatLngTuple = [loc.lat, loc.lng];
    bounds.push(latlng);
    const size = markerSizeForZoom(map.getZoom());
    const icon = createMarkerIcon(loc.heading, loc.isSelf, size);

    if (markers.has(loc.peerId)) {
      const m = markers.get(loc.peerId)!;
      m.setLatLng(latlng);
      m.setIcon(icon);
    } else {
      const m = L.marker(latlng, { icon })
        .bindTooltip(escapeHtml(loc.name) + (loc.isSelf ? " (you)" : ""), {
          permanent: false,
          direction: "top",
        })
        .addTo(map);
      markers.set(loc.peerId, m);
    }
  }

  const currentFitted = new Set(bounds.length > 0
    ? locations.filter((l) => l.lat !== 0 || l.lng !== 0).map((l) => l.peerId)
    : []
  );
  const hasNewFittedPeer = [...currentFitted].some((id) => !mapState.peersFittedOnMap.has(id));
  mapState.peersFittedOnMap = currentFitted;

  if (bounds.length > 0 && (!mapState.userHasInteracted || hasNewFittedPeer)) {
    mapState.programmaticMove = true;
    if (bounds.length === 1) {
      map.setView(bounds[0], MAP_MAX_ZOOM);
    } else {
      map.fitBounds(bounds, {
        padding: MAP_FIT_PADDING,
        maxZoom: MAP_MAX_ZOOM,
      });
    }
    mapState.programmaticMove = false;
  }
}

function renderPeerCards(locations: PeerView[]): void {
  peerListEl.innerHTML = "";

  for (const loc of locations) {
    const headingDeg = loc.heading != null ? Math.round(loc.heading) : null;
    const arrowRotation = headingDeg != null ? headingDeg : 0;

    const card = document.createElement("div");
    card.className = "peer-card" + (loc.isSelf ? " self" : "");

    const compass = document.createElement("div");
    compass.className = "peer-compass";
    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.style.transform = `rotate(${arrowRotation}deg)`;
    arrow.title = headingDeg != null ? headingDeg + "°" : "no heading";
    arrow.innerHTML = arrowSvg(accentColor(loc.isSelf));
    compass.appendChild(arrow);

    const info = document.createElement("div");
    info.className = "peer-info";
    const nameEl = document.createElement("div");
    nameEl.className = "peer-name";
    nameEl.textContent = loc.name;
    if (loc.isSelf) {
      const badge = document.createElement("span");
      badge.className = "you-badge";
      badge.textContent = "(you)";
      nameEl.appendChild(badge);
    }
    const coords = document.createElement("div");
    coords.className = "peer-coords";
    coords.textContent = loc.lat === 0 && loc.lng === 0
      ? "awaiting location..."
      : `${loc.lat.toFixed(COORD_DECIMAL_PLACES)}, ${loc.lng.toFixed(COORD_DECIMAL_PLACES)}`;
    info.appendChild(nameEl);
    info.appendChild(coords);

    const meta = document.createElement("div");
    meta.className = "peer-meta";
    if (headingDeg != null) {
      const headingEl = document.createElement("div");
      headingEl.className = "peer-heading";
      headingEl.textContent = headingDeg + "°";
      meta.appendChild(headingEl);
    }
    const timeEl = document.createElement("div");
    timeEl.className = "peer-time";
    timeEl.textContent = timeAgo(loc.timestamp);
    meta.appendChild(timeEl);

    card.appendChild(compass);
    card.appendChild(info);
    card.appendChild(meta);
    peerListEl.appendChild(card);
  }
}

export function renderPeers(): void {
  const all: PeerView[] = [];
  if (state.myLocation) all.push({ ...state.myLocation, isSelf: true });
  for (const loc of state.locations.values()) {
    if (loc.peerId !== state.peer?.id) all.push({ ...loc, isSelf: false });
  }

  if (all.length === 0) {
    peerListEl.innerHTML =
      '<p class="empty-state">Waiting for others to answer...</p>';
    return;
  }

  updateMapMarkers(all);
  renderPeerCards(all);
}
