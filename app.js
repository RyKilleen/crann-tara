// Use local PeerJS server on localhost, cloud server otherwise
const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const PEER_OPTS = IS_LOCAL
  ? { host: 'localhost', port: 9000, path: '/myapp' }
  : {}; // uses default PeerJS cloud server

/* ───── State ───── */
const state = {
  name: '',
  code: '',
  isCreator: false,
  peer: null,
  connections: new Map(),   // peerId -> DataConnection
  locations: new Map(),     // peerId -> { peerId, name, lat, lng, heading, timestamp }
  geoWatchId: null,
  myLocation: null,
};

let map = null;
const markers = new Map(); // peerId -> L.marker

/* ───── DOM refs ───── */
const $ = (sel) => document.querySelector(sel);
const welcomeScreen = $('#welcome-screen');
const channelScreen = $('#channel-screen');
const nameInput = $('#name-input');
const codeInput = $('#code-input');
const createBtn = $('#create-btn');
const joinBtn = $('#join-btn');
const copyBtn = $('#copy-btn');
const leaveBtn = $('#leave-btn');
const channelCodeEl = $('#channel-code');
const peerListEl = $('#peer-list');
const toastEl = $('#toast');

/* ───── Utilities ───── */
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/1/O/0

function generateCode(len = 6) {
  let code = '';
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
  toastEl.className = 'toast visible' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 3500);
}

function timeAgo(ts) {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

function showScreen(screen) {
  welcomeScreen.classList.remove('active');
  channelScreen.classList.remove('active');
  screen.classList.add('active');
}

/* ───── Geolocation & Orientation ───── */
let currentHeading = null;

function startGeo() {
  // Initialize with a placeholder so the app works even without geo
  if (!state.myLocation) {
    state.myLocation = {
      peerId: state.peer?.id,
      name: state.name,
      lat: 0,
      lng: 0,
      heading: currentHeading,
      timestamp: Date.now(),
    };
    renderPeers();
  }

  if (!navigator.geolocation) {
    showToast('Geolocation not supported — using placeholder', true);
    return;
  }
  state.geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      state.myLocation = {
        peerId: state.peer?.id,
        name: state.name,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        heading: currentHeading,
        timestamp: Date.now(),
      };
      broadcastMyLocation();
      renderPeers();
    },
    (err) => {
      console.warn('[geo] error:', err.code, err.message);
      // Still broadcast placeholder so peers see us
      broadcastMyLocation();
    },
    { enableHighAccuracy: true, maximumAge: 2000 }
  );
}

function startCompass() {
  // iOS 13+
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then((perm) => { if (perm === 'granted') listenOrientation(); })
      .catch(() => {});
  } else {
    listenOrientation();
  }
}

function listenOrientation() {
  // Prefer absolute orientation
  window.addEventListener('deviceorientationabsolute', onOrientation, true);
  window.addEventListener('deviceorientation', onOrientation, true);
}

function onOrientation(e) {
  if (e.webkitCompassHeading != null) {
    currentHeading = e.webkitCompassHeading;
  } else if (e.absolute && e.alpha != null) {
    currentHeading = (360 - e.alpha) % 360;
  } else if (e.alpha != null) {
    currentHeading = (360 - e.alpha) % 360;
  }
}

/* ───── PeerJS — Create Channel ───── */
function createChannel() {
  const name = nameInput.value.trim();
  if (!name) { showToast('Please enter your name', true); return; }
  state.name = name;
  state.code = generateCode();
  state.isCreator = true;

  createBtn.disabled = joinBtn.disabled = true;

  const peerId = peerIdFor(state.code);
  console.log('[create] registering peer:', peerId, 'opts:', PEER_OPTS);
  state.peer = new Peer(peerId, PEER_OPTS);

  state.peer.on('open', (id) => {
    console.log('[create] peer open with id:', id);
    channelCodeEl.textContent = state.code;
    showScreen(channelScreen);
    initMap();
    startGeo();
    startCompass();
    showToast('Channel created');
  });

  state.peer.on('connection', (conn) => {
    console.log('[create] incoming connection from:', conn.peer);
    conn.on('open', () => {
      console.log('[create] connection open with:', conn.peer);
      state.connections.set(conn.peer, conn);
      // Send current peer states
      conn.send({
        type: 'peers',
        locations: Array.from(state.locations.values()),
      });
      // Also send creator's own location
      if (state.myLocation) {
        conn.send({ ...state.myLocation, type: 'location' });
      }
    });

    conn.on('data', (data) => handleData(data, conn));

    conn.on('error', (err) => {
      console.error('[create] connection error with', conn.peer, ':', err);
    });

    conn.on('close', () => {
      console.log('[create] connection closed:', conn.peer);
      state.connections.delete(conn.peer);
      state.locations.delete(conn.peer);
      broadcast({ type: 'peer-left', peerId: conn.peer });
      renderPeers();
    });
  });

  state.peer.on('disconnected', () => {
    console.warn('[create] peer disconnected from signaling server');
  });

  state.peer.on('error', (err) => {
    console.error('[create] peer error:', err.type, err);
    showToast(`Peer error: ${err.type}`, true);
    createBtn.disabled = joinBtn.disabled = false;
  });
}

/* ───── PeerJS — Join Channel ───── */
function joinChannel() {
  const name = nameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();
  if (!name) { showToast('Please enter your name', true); return; }
  if (code.length !== 6) { showToast('Enter a 6-character code', true); return; }
  state.name = name;
  state.code = code;
  state.isCreator = false;

  createBtn.disabled = joinBtn.disabled = true;

  const joinerId = 'way-j-' + generateCode();
  state.peer = new Peer(joinerId, PEER_OPTS);

  state.peer.on('open', (id) => {
    console.log('[join] peer open with id:', id);
    console.log('[join] connecting to:', peerIdFor(code));
    const conn = state.peer.connect(peerIdFor(code), { reliable: true });

    conn.on('open', () => {
      console.log('[join] connection open to:', conn.peer);
      state.connections.set(conn.peer, conn);
      channelCodeEl.textContent = state.code;
      showScreen(channelScreen);
      initMap();
      startGeo();
      startCompass();
      showToast('Joined channel');
      // Send my location immediately if available
      if (state.myLocation) {
        conn.send({ ...state.myLocation, type: 'location' });
      }
    });

    conn.on('data', (data) => handleData(data, conn));

    conn.on('error', (err) => {
      console.error('[join] connection error:', err);
    });

    conn.on('close', () => {
      showToast('Host disconnected', true);
      leaveChannel();
    });
  });

  state.peer.on('disconnected', () => {
    console.warn('[join] peer disconnected from signaling server');
  });

  state.peer.on('error', (err) => {
    console.error('[join] peer error:', err.type, err);
    if (err.type === 'peer-unavailable') {
      showToast('Channel not found', true);
    } else {
      showToast(`Peer error: ${err.type}`, true);
    }
    createBtn.disabled = joinBtn.disabled = false;
  });
}

/* ───── Message Handling ───── */
function handleData(data, fromConn) {
  console.log('[data] received from', fromConn.peer, ':', typeof data, data);
  if (data.type === 'location') {
    state.locations.set(data.peerId, data);
    // Creator relays to all other peers
    if (state.isCreator) {
      for (const [pid, conn] of state.connections) {
        if (pid !== fromConn.peer) {
          conn.send(data);
        }
      }
    }
    renderPeers();
  } else if (data.type === 'peers') {
    for (const loc of data.locations) {
      state.locations.set(loc.peerId, loc);
    }
    renderPeers();
  } else if (data.type === 'peer-left') {
    state.locations.delete(data.peerId);
    renderPeers();
  }
}

function broadcast(msg) {
  for (const conn of state.connections.values()) {
    conn.send(msg);
  }
}

function broadcastMyLocation() {
  if (!state.myLocation) return;
  const msg = { ...state.myLocation, type: 'location' };
  console.log('[broadcast] sending location, connections:', state.connections.size, 'msg:', JSON.stringify(msg));
  if (state.isCreator) {
    // Creator: send to all joiners
    broadcast(msg);
  } else {
    // Joiner: send to creator
    for (const conn of state.connections.values()) {
      conn.send(msg);
    }
  }
}

/* ───── Leave / Cleanup ───── */
function leaveChannel() {
  if (state.geoWatchId != null) {
    navigator.geolocation.clearWatch(state.geoWatchId);
    state.geoWatchId = null;
  }
  if (state.peer) {
    state.peer.destroy();
    state.peer = null;
  }
  state.connections.clear();
  state.locations.clear();
  state.myLocation = null;
  cleanupMap();
  createBtn.disabled = joinBtn.disabled = false;
  showScreen(welcomeScreen);
}

/* ───── Map ───── */
function initMap() {
  if (map) return;
  map = L.map('map').setView([0, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);
}

function cleanupMap() {
  if (map) {
    map.remove();
    map = null;
  }
  markers.clear();
}

function createMarkerIcon(heading, isSelf) {
  const rotation = heading != null ? Math.round(heading) : 0;
  return L.divIcon({
    className: '',
    html: `<div class="map-marker${isSelf ? ' self' : ''}" style="transform: rotate(${rotation}deg)">➤</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

/* ───── Rendering ───── */
function renderPeers() {
  // Collect all locations including self
  const all = [];
  if (state.myLocation) all.push({ ...state.myLocation, isSelf: true });
  for (const loc of state.locations.values()) {
    if (loc.peerId !== state.peer?.id) all.push(loc);
  }

  if (all.length === 0) {
    peerListEl.innerHTML = '<p class="empty-state">Waiting for peers to join...</p>';
    return;
  }

  // Update map markers
  if (map) {
    const activePeerIds = new Set(all.map((l) => l.peerId));

    // Remove markers for peers that left
    for (const [pid, marker] of markers) {
      if (!activePeerIds.has(pid)) {
        map.removeLayer(marker);
        markers.delete(pid);
      }
    }

    const bounds = [];

    for (const loc of all) {
      if (loc.lat === 0 && loc.lng === 0) continue; // skip placeholder
      const latlng = [loc.lat, loc.lng];
      bounds.push(latlng);
      const isSelf = loc.isSelf || false;
      const icon = createMarkerIcon(loc.heading, isSelf);

      if (markers.has(loc.peerId)) {
        const m = markers.get(loc.peerId);
        m.setLatLng(latlng);
        m.setIcon(icon);
      } else {
        const m = L.marker(latlng, { icon })
          .bindTooltip(escapeHtml(loc.name) + (isSelf ? ' (you)' : ''), { permanent: false, direction: 'top' })
          .addTo(map);
        markers.set(loc.peerId, m);
      }
    }

    if (bounds.length > 0) {
      if (bounds.length === 1) {
        map.setView(bounds[0], 19);
      } else {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 19 });
      }
    }
  }

  // Peer list cards
  peerListEl.innerHTML = all.map((loc) => {
    const headingDeg = loc.heading != null ? Math.round(loc.heading) : null;
    const arrowRotation = headingDeg != null ? headingDeg : 0;
    const isSelf = loc.isSelf || false;

    return `
      <div class="peer-card${isSelf ? ' self' : ''}">
        <div class="peer-compass">
          <span class="arrow" style="transform: rotate(${arrowRotation}deg)"
                title="${headingDeg != null ? headingDeg + '°' : 'no heading'}">➤</span>
        </div>
        <div class="peer-info">
          <div class="peer-name">
            ${escapeHtml(loc.name)}${isSelf ? '<span class="you-badge">(you)</span>' : ''}
          </div>
          <div class="peer-coords">${loc.lat === 0 && loc.lng === 0 ? 'awaiting location...' : `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`}</div>
        </div>
        <div class="peer-meta">
          ${headingDeg != null ? `<div class="peer-heading">${headingDeg}°</div>` : ''}
          <div class="peer-time">${timeAgo(loc.timestamp)}</div>
        </div>
      </div>`;
  }).join('');
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ───── Event Listeners ───── */
createBtn.addEventListener('click', createChannel);
joinBtn.addEventListener('click', joinChannel);
leaveBtn.addEventListener('click', leaveChannel);

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(state.code)
    .then(() => showToast('Code copied'))
    .catch(() => showToast('Copy failed', true));
});

// Allow Enter to trigger actions
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createBtn.click();
});
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

// Refresh time-ago every 5 seconds
setInterval(renderPeers, 5000);
