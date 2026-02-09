const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const PEER_OPTS = IS_LOCAL
  ? { host: 'localhost', port: 9000, path: '/myapp' }
  : {}; // uses default PeerJS cloud server

function handleData(state, data, fromConn, deps) {
  console.log('[data] received from', fromConn.peer, ':', typeof data, data);
  if (data.type === 'location') {
    state.locations.set(data.peerId, data);
    deps.renderPeers();
  } else if (data.type === 'peers') {
    for (const loc of data.locations) {
      state.locations.set(loc.peerId, loc);
    }
    deps.renderPeers();
    // Connect to each peer we're not already connected to
    if (data.peerIds) {
      for (const pid of data.peerIds) {
        if (pid !== state.peer.id && !state.connections.has(pid)) {
          console.log('[mesh] connecting to peer:', pid);
          const conn = state.peer.connect(pid, { reliable: true });
          setupConnection(conn, state, deps);
        }
      }
    }
  } else if (data.type === 'peer-left') {
    state.locations.delete(data.peerId);
    deps.renderPeers();
  } else if (data.type === 'new-greeter') {
    // Greeter is leaving gracefully, trigger promotion
    console.log('[mesh] received new-greeter signal');
  }
}

function setupConnection(conn, state, deps) {
  conn.on('open', () => {
    console.log('[mesh] connection open with:', conn.peer);
    state.connections.set(conn.peer, conn);
    // If we're the greeter, send the peer list to the new joiner
    if (state.isCreator) {
      conn.send({
        type: 'peers',
        locations: Array.from(state.locations.values()),
        peerIds: [...state.connections.keys()].filter(pid => pid !== conn.peer),
      });
      if (state.myLocation) {
        conn.send({ ...state.myLocation, type: 'location' });
      }
    }
  });

  conn.on('data', (data) => handleData(state, data, conn, deps));

  conn.on('error', (err) => {
    console.error('[mesh] connection error with', conn.peer, ':', err);
  });

  conn.on('close', () => {
    console.log('[mesh] connection closed:', conn.peer);
    const disconnectedPeerId = conn.peer;
    state.connections.delete(disconnectedPeerId);
    state.locations.delete(disconnectedPeerId);
    deps.renderPeers();
    maybePromoteToGreeter(disconnectedPeerId, state, deps);
  });
}

function maybePromoteToGreeter(disconnectedPeerId, state, deps, retries = 0) {
  const greeterId = deps.peerIdFor(state.code);
  if (disconnectedPeerId !== greeterId) return;
  if (state.isCreator) return; // already the greeter

  console.log('[mesh] greeter disconnected, checking promotion');

  // Collect remaining peer IDs (our own + all connected)
  const candidates = [state.peer.id, ...state.connections.keys()].sort();
  console.log('[mesh] promotion candidates:', candidates, 'my id:', state.peer.id);

  if (candidates[0] !== state.peer.id) {
    console.log('[mesh] not first candidate, skipping promotion');
    return;
  }

  console.log('[mesh] promoting self to greeter');
  state.isCreator = true;

  // Create a second Peer object for discovery
  state.greeterPeer = new Peer(greeterId, PEER_OPTS);

  state.greeterPeer.on('open', () => {
    console.log('[mesh] greeter peer registered:', greeterId);
  });

  state.greeterPeer.on('connection', (conn) => {
    console.log('[mesh] greeter: incoming connection from:', conn.peer);
    setupConnection(conn, state, deps);
  });

  state.greeterPeer.on('error', (err) => {
    console.error('[mesh] greeter peer error:', err.type, err);
    if (err.type === 'unavailable-id' && retries < 3) {
      console.log('[mesh] greeter ID still held, retrying in 2s (attempt', retries + 1, ')');
      state.greeterPeer.destroy();
      state.greeterPeer = null;
      setTimeout(() => maybePromoteToGreeter(disconnectedPeerId, state, deps, retries + 1), 2000);
    }
  });
}

function setupBeforeUnload(state) {
  const handler = () => {
    if (state.isCreator && state.connections.size > 0) {
      broadcast(state, { type: 'new-greeter' });
    }
    if (state.greeterPeer) state.greeterPeer.destroy();
    if (state.peer) state.peer.destroy();
  };
  state.beforeUnloadHandler = handler;
  window.addEventListener('beforeunload', handler);
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
  const { state, showToast, showScreen, initMap, startGeo, startCompass, beaconCodeEl, createBtn, joinBtn, beaconScreen, generateCode, peerIdFor } = deps;

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
    setupConnection(conn, state, deps);
  });

  state.peer.on('disconnected', () => {
    console.warn('[create] peer disconnected from signaling server');
  });

  state.peer.on('error', (err) => {
    console.error('[create] peer error:', err.type, err);
    showToast(`Peer error: ${err.type}`, true);
    createBtn.disabled = joinBtn.disabled = false;
  });

  setupBeforeUnload(state);
}

export function joinChannel(deps) {
  const { state, showToast, showScreen, initMap, startGeo, startCompass, beaconCodeEl, createBtn, joinBtn, beaconScreen, generateCode, peerIdFor, CHANNEL_CODE_LENGTH } = deps;

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
    setupConnection(conn, state, deps);

    conn.on('open', () => {
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
  });

  // Accept incoming connections from other mesh peers
  state.peer.on('connection', (conn) => {
    console.log('[join] incoming connection from:', conn.peer);
    setupConnection(conn, state, deps);
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

  setupBeforeUnload(state);
}

export function leaveChannel(deps) {
  const { state, stopOrientation, cleanupMap, createBtn, joinBtn, showScreen, welcomeScreen } = deps;

  // Remove beforeunload since we're cleaning up gracefully
  if (state.beforeUnloadHandler) {
    window.removeEventListener('beforeunload', state.beforeUnloadHandler);
    state.beforeUnloadHandler = null;
  }

  // If we're the greeter and have connections, signal handoff
  if (state.isCreator && state.connections.size > 0) {
    broadcast(state, { type: 'new-greeter' });
  }

  if (state.geoWatchId != null) {
    navigator.geolocation.clearWatch(state.geoWatchId);
    state.geoWatchId = null;
  }
  stopOrientation();
  if (state.greeterPeer) {
    state.greeterPeer.destroy();
    state.greeterPeer = null;
  }
  if (state.peer) {
    state.peer.destroy();
    state.peer = null;
  }
  state.connections.clear();
  state.locations.clear();
  state.myLocation = null;
  state.isCreator = false;
  cleanupMap();
  createBtn.disabled = joinBtn.disabled = false;
  showScreen(welcomeScreen);
}
