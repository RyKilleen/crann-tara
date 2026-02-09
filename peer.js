const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const PEER_OPTS = IS_LOCAL
  ? { host: 'localhost', port: 9000, path: '/myapp' }
  : {}; // uses default PeerJS cloud server

function handleData(state, data, fromConn, deps) {
  console.log('[data] received from', fromConn.peer, ':', typeof data, data);
  if (data.type === 'location') {
    state.locations.set(data.peerId, data);
    if (state.isCreator) {
      for (const [pid, conn] of state.connections) {
        if (pid !== fromConn.peer) {
          conn.send(data);
        }
      }
    }
    deps.renderPeers();
  } else if (data.type === 'peers') {
    for (const loc of data.locations) {
      state.locations.set(loc.peerId, loc);
    }
    deps.renderPeers();
  } else if (data.type === 'peer-left') {
    state.locations.delete(data.peerId);
    deps.renderPeers();
  }
}

export function broadcast(state, msg) {
  for (const conn of state.connections.values()) {
    conn.send(msg);
  }
}

export function broadcastMyLocation(state) {
  if (!state.myLocation) return;
  broadcast(state, { ...state.myLocation, type: 'location' });
}

export function createChannel(deps) {
  const { state, showToast, showScreen, initMap, startGeo, startCompass, renderPeers, beaconCodeEl, createBtn, joinBtn, beaconScreen, generateCode, peerIdFor } = deps;

  state.code = generateCode();
  state.isCreator = true;

  createBtn.disabled = joinBtn.disabled = true;

  const peerId = peerIdFor(state.code);
  console.log('[create] registering peer:', peerId, 'opts:', PEER_OPTS);
  state.peer = new Peer(peerId, PEER_OPTS);

  state.peer.on('open', (id) => {
    console.log('[create] peer open with id:', id);
    beaconCodeEl.textContent = state.code;
    showScreen(beaconScreen);
    initMap();
    startGeo();
    startCompass();

    showToast('Beacon lit');
  });

  state.peer.on('connection', (conn) => {
    console.log('[create] incoming connection from:', conn.peer);
    conn.on('open', () => {
      console.log('[create] connection open with:', conn.peer);
      state.connections.set(conn.peer, conn);
      conn.send({
        type: 'peers',
        locations: Array.from(state.locations.values()),
      });
      if (state.myLocation) {
        conn.send({ ...state.myLocation, type: 'location' });
      }
    });

    conn.on('data', (data) => handleData(state, data, conn, deps));

    conn.on('error', (err) => {
      console.error('[create] connection error with', conn.peer, ':', err);
    });

    conn.on('close', () => {
      console.log('[create] connection closed:', conn.peer);
      state.connections.delete(conn.peer);
      state.locations.delete(conn.peer);
      broadcast(state, { type: 'peer-left', peerId: conn.peer });
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

export function joinChannel(deps) {
  const { state, showToast, showScreen, initMap, startGeo, startCompass, renderPeers, beaconCodeEl, createBtn, joinBtn, beaconScreen, generateCode, peerIdFor, CHANNEL_CODE_LENGTH } = deps;

  const code = deps.codeInput.value.trim().toUpperCase();
  if (code.length !== CHANNEL_CODE_LENGTH) { showToast(`Enter a ${CHANNEL_CODE_LENGTH}-character code`, true); return; }
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
      beaconCodeEl.textContent = state.code;
      showScreen(beaconScreen);
      initMap();
      startGeo();
      startCompass();

      showToast('Answered the call');
      if (state.myLocation) {
        conn.send({ ...state.myLocation, type: 'location' });
      }
    });

    conn.on('data', (data) => handleData(state, data, conn, deps));

    conn.on('error', (err) => {
      console.error('[join] connection error:', err);
    });

    conn.on('close', () => {
      showToast('Host disconnected', true);
      deps.leaveChannel();
    });
  });

  state.peer.on('disconnected', () => {
    console.warn('[join] peer disconnected from signaling server');
  });

  state.peer.on('error', (err) => {
    console.error('[join] peer error:', err.type, err);
    if (err.type === 'peer-unavailable') {
      showToast('Beacon not found', true);
    } else {
      showToast(`Peer error: ${err.type}`, true);
    }
    createBtn.disabled = joinBtn.disabled = false;
  });
}

export function leaveChannel(deps) {
  const { state, stopOrientation, cleanupMap, createBtn, joinBtn, showScreen, welcomeScreen } = deps;

  if (state.geoWatchId != null) {
    navigator.geolocation.clearWatch(state.geoWatchId);
    state.geoWatchId = null;
  }
  stopOrientation();
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
