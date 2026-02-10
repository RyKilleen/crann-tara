import type { AppState, PeerMessage } from "./types";

export const state: AppState = {
  name: "",
  code: "",
  isCreator: false,
  peer: null,
  greeterPeer: null,
  connections: new Map(),
  locations: new Map(),
  geoWatchId: null,
  myLocation: null,
  visibilityHandler: null,
  beforeUnloadHandler: null,
};

export function broadcast(msg: PeerMessage): void {
  for (const conn of state.connections.values()) {
    conn.send(msg);
  }
}

export function broadcastMyLocation(): void {
  if (!state.myLocation) return;
  broadcast({ ...state.myLocation, type: "location" });
}
