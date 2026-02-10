import { state } from "./state";
import { generateName } from "./util";
import { nameDisplay, createBtn, joinBtn, leaveBtn, rerollBtn, copyBtn, codeInput } from "./ui";
import { showToast } from "./ui";
import { createChannel, joinChannel, leaveChannel } from "./peer";

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
