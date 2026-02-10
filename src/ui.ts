const TOAST_DURATION_MS = 3500;
const JUST_NOW_THRESHOLD_S = 5;
export const COORD_DECIMAL_PLACES = 5;

const $ = (sel: string) => document.querySelector(sel)!;

export const welcomeScreen = $("#welcome-screen") as HTMLElement;
export const beaconScreen = $("#beacon-screen") as HTMLElement;
export const nameDisplay = $("#name-display") as HTMLElement;
export const rerollBtn = $("#reroll-btn") as HTMLButtonElement;
export const codeInput = $("#code-input") as HTMLInputElement;
export const createBtn = $("#create-btn") as HTMLButtonElement;
export const joinBtn = $("#join-btn") as HTMLButtonElement;
export const copyBtn = $("#copy-btn") as HTMLButtonElement;
export const leaveBtn = $("#leave-btn") as HTMLButtonElement;
export const beaconCodeEl = $("#beacon-code") as HTMLElement;
export const peerListEl = $("#peer-list") as HTMLElement;
export const toastEl = $("#toast") as HTMLElement;

let toastTimer: ReturnType<typeof setTimeout>;
export function showToast(msg: string, isError = false): void {
  toastEl.textContent = msg;
  toastEl.className = "toast visible" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = "toast";
  }, TOAST_DURATION_MS);
}

export function showScreen(screen: HTMLElement): void {
  welcomeScreen.classList.remove("active");
  beaconScreen.classList.remove("active");
  screen.classList.add("active");
}

export function timeAgo(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < JUST_NOW_THRESHOLD_S) return "just now";
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

export function escapeHtml(str: string): string {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
