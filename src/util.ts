export const CHANNEL_CODE_LENGTH = 6;
export const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const VALID_CODE_RE = /^[A-HJ-NP-Z2-9]+$/;

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

export function generateName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

export function generateCode(len = CHANNEL_CODE_LENGTH): string {
  let code = "";
  const arr = crypto.getRandomValues(new Uint8Array(len));
  for (const b of arr) code += CHARSET[b % CHARSET.length];
  return code;
}

export function peerIdFor(code: string): string {
  return `way-${code}`;
}

export function isValidCode(code: string): boolean {
  return code.length === CHANNEL_CODE_LENGTH && VALID_CODE_RE.test(code);
}
