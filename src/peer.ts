import { Peer, type DataConnection } from "peerjs";
import type { PeerMessage } from "./types";
import { state, broadcast } from "./state";
import { showToast, showScreen, beaconCodeEl, beaconScreen, createBtn, joinBtn, codeInput, welcomeScreen } from "./ui";
import { generateCode, peerIdFor, CHANNEL_CODE_LENGTH, isValidCode } from "./util";
import { startGeo, startCompass, stopOrientation } from "./geo";
import { initMap, cleanupMap, renderPeers } from "./map";

const IS_LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const PEER_OPTS: { host?: string; port?: number; path?: string } = IS_LOCAL
  ? { host: "localhost", port: 9000, path: "/myapp" }
  : {};

function handleData(data: PeerMessage, fromConn: DataConnection): void {
  console.log("[data] received from", fromConn.peer, ":", typeof data, data);
  if (data.type === "location") {
    state.locations.set(data.peerId, data);
    renderPeers();
  } else if (data.type === "peers") {
    for (const loc of data.locations) {
      state.locations.set(loc.peerId, loc);
    }
    renderPeers();
    if (data.peerIds) {
      for (const pid of data.peerIds) {
        if (pid !== state.peer!.id && !state.connections.has(pid)) {
          console.log("[mesh] connecting to peer:", pid);
          const conn = state.peer!.connect(pid, { reliable: true });
          setupConnection(conn);
        }
      }
    }
  } else if (data.type === "peer-left") {
    state.locations.delete(data.peerId);
    renderPeers();
  } else if (data.type === "new-greeter") {
    console.log("[mesh] received new-greeter signal");
  }
}

function setupConnection(conn: DataConnection): void {
  conn.on("open", () => {
    console.log("[mesh] connection open with:", conn.peer);
    state.connections.set(conn.peer, conn);
    if (state.isCreator) {
      conn.send({
        type: "peers",
        locations: Array.from(state.locations.values()),
        peerIds: [...state.connections.keys()].filter(pid => pid !== conn.peer),
      });
      if (state.myLocation) {
        conn.send({ ...state.myLocation, type: "location" });
      }
    }
  });

  conn.on("data", (data) => handleData(data as PeerMessage, conn));

  conn.on("error", (err) => {
    console.error("[mesh] connection error with", conn.peer, ":", err);
  });

  conn.on("close", () => {
    console.log("[mesh] connection closed:", conn.peer);
    const disconnectedPeerId = conn.peer;
    state.connections.delete(disconnectedPeerId);
    state.locations.delete(disconnectedPeerId);
    renderPeers();
    maybePromoteToGreeter(disconnectedPeerId);
  });
}

function maybePromoteToGreeter(disconnectedPeerId: string, retries = 0): void {
  const greeterId = peerIdFor(state.code);
  if (disconnectedPeerId !== greeterId) return;
  if (state.isCreator) return;

  console.log("[mesh] greeter disconnected, checking promotion");

  const candidates = [state.peer!.id, ...state.connections.keys()].sort();
  console.log("[mesh] promotion candidates:", candidates, "my id:", state.peer!.id);

  if (candidates[0] !== state.peer!.id) {
    console.log("[mesh] not first candidate, skipping promotion");
    return;
  }

  console.log("[mesh] promoting self to greeter");
  state.isCreator = true;

  state.greeterPeer = new Peer(greeterId, PEER_OPTS);

  state.greeterPeer.on("open", () => {
    console.log("[mesh] greeter peer registered:", greeterId);
  });

  state.greeterPeer.on("disconnected", () => {
    console.warn("[mesh] greeter disconnected from signaling, reconnecting…");
    state.greeterPeer!.reconnect();
  });

  state.greeterPeer.on("connection", (conn) => {
    console.log("[mesh] greeter: incoming connection from:", conn.peer);
    setupConnection(conn);
  });

  state.greeterPeer.on("error", (err) => {
    console.error("[mesh] greeter peer error:", err.type, err);
    if (err.type === "unavailable-id" && retries < 3) {
      console.log("[mesh] greeter ID still held, retrying in 2s (attempt", retries + 1, ")");
      state.greeterPeer!.destroy();
      state.greeterPeer = null;
      setTimeout(() => maybePromoteToGreeter(disconnectedPeerId, retries + 1), 2000);
    }
  });
}

function setupVisibilityReconnect(): void {
  const handler = () => {
    if (document.visibilityState !== "visible") return;
    if (state.peer?.disconnected) {
      console.warn("[visibility] peer disconnected, reconnecting…");
      state.peer.reconnect();
    }
    if (state.greeterPeer?.disconnected) {
      console.warn("[visibility] greeter peer disconnected, reconnecting…");
      state.greeterPeer.reconnect();
    }
  };
  state.visibilityHandler = handler;
  document.addEventListener("visibilitychange", handler);
}

function setupBeforeUnload(): void {
  const handler = () => {
    if (state.isCreator && state.connections.size > 0) {
      broadcast({ type: "new-greeter" });
    }
    if (state.greeterPeer) state.greeterPeer.destroy();
    if (state.peer) state.peer.destroy();
  };
  state.beforeUnloadHandler = handler;
  window.addEventListener("beforeunload", handler);
}

function enterBeacon(): void {
  beaconCodeEl.textContent = state.code;
  showScreen(beaconScreen);
  initMap();
  startGeo();
  startCompass();
}

function initPeer(peerId: string, onError?: (err: { type: string }) => boolean): Peer {
  const peer = new Peer(peerId, PEER_OPTS);

  peer.on("connection", (conn) => {
    console.log("[mesh] incoming connection from:", conn.peer);
    setupConnection(conn);
  });

  peer.on("disconnected", () => {
    console.warn("[peer] disconnected from signaling, reconnecting…");
    peer.reconnect();
  });

  peer.on("error", (err) => {
    console.error("[peer] error:", err.type, err);
    const handled = onError?.(err) ?? false;
    if (!handled) {
      showToast(`Peer error: ${err.type}`, true);
    }
    createBtn.disabled = joinBtn.disabled = false;
  });

  setupBeforeUnload();
  setupVisibilityReconnect();

  return peer;
}

export function createChannel(): void {
  state.code = generateCode();
  state.isCreator = true;
  createBtn.disabled = joinBtn.disabled = true;

  const peerId = peerIdFor(state.code);
  console.log("[create] registering peer:", peerId, "opts:", PEER_OPTS);
  state.peer = initPeer(peerId);

  state.peer.on("open", (id) => {
    console.log("[create] peer open with id:", id);
    enterBeacon();
    showToast("Beacon lit");
  });
}

export function joinChannel(): void {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length !== CHANNEL_CODE_LENGTH) {
    showToast(`Enter a ${CHANNEL_CODE_LENGTH}-character code`, true);
    return;
  }
  if (!isValidCode(code)) {
    showToast("Invalid beacon code", true);
    return;
  }
  state.code = code;
  state.isCreator = false;
  createBtn.disabled = joinBtn.disabled = true;

  const joinerId = "way-j-" + generateCode();
  state.peer = initPeer(joinerId, (err) => {
    if (err.type === "peer-unavailable") {
      showToast("Beacon not found", true);
      return true;
    }
    return false;
  });

  state.peer.on("open", (id) => {
    console.log("[join] peer open with id:", id);
    console.log("[join] connecting to:", peerIdFor(code));
    const conn = state.peer!.connect(peerIdFor(code), { reliable: true });
    setupConnection(conn);

    conn.on("open", () => {
      enterBeacon();
      showToast("Answered the call");
      if (state.myLocation) {
        conn.send({ ...state.myLocation, type: "location" });
      }
    });
  });
}

export function leaveChannel(): void {
  if (state.visibilityHandler) {
    document.removeEventListener("visibilitychange", state.visibilityHandler);
    state.visibilityHandler = null;
  }
  if (state.beforeUnloadHandler) {
    window.removeEventListener("beforeunload", state.beforeUnloadHandler);
    state.beforeUnloadHandler = null;
  }

  if (state.isCreator && state.connections.size > 0) {
    broadcast({ type: "new-greeter" });
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
