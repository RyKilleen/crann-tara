import type { Peer, DataConnection } from "peerjs";

export interface LocationData {
  peerId: string;
  name: string;
  lat: number;
  lng: number;
  heading: number | null;
  timestamp: number;
}

export type PeerView = LocationData & { isSelf: boolean };

export type PeerMessage =
  | ({ type: "location" } & LocationData)
  | { type: "peers"; locations: LocationData[]; peerIds?: string[] }
  | { type: "peer-left"; peerId: string }
  | { type: "new-greeter" };

export interface AppState {
  name: string;
  code: string;
  isCreator: boolean;
  peer: Peer | null;
  greeterPeer: Peer | null;
  connections: Map<string, DataConnection>;
  locations: Map<string, LocationData>;
  geoWatchId: number | null;
  myLocation: LocationData | null;
  visibilityHandler: (() => void) | null;
  beforeUnloadHandler: (() => void) | null;
}
