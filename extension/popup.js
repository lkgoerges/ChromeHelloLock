const stateTitle = document.querySelector("#state-title");
const stateOrb = document.querySelector("#state-orb");
const profileState = document.querySelector("#profile-state");
const primaryButton = document.querySelector("#primary-button");
const settingsButton = document.querySelector("#settings-button");
const status = document.querySelector("#status");

let locked = false;

function setStatus(message, type = "") {
  status.textContent = message;
  status.className = `status-line ${type}`.trim();
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "get-status" });
  locked = response.locked;
  stateTitle.textContent = locked ? "Profile locked" : "Profile unlocked";
  stateOrb.classList.toggle("locked", locked);
  profileState.textContent = response.settings.setupComplete ? "Windows Hello ready" : "Finish setup first";
  primaryButton.textContent = locked ? "Open unlock screen" : "Lock work profile";
  primaryButton.disabled = false;
}

primaryButton.addEventListener("click", async () => {
  primaryButton.disabled = true;
  setStatus(locked ? "Opening secure unlock…" : "Locking open windows…");

  try {
    const response = await chrome.runtime.sendMessage({ type: locked ? "open-lock-screen" : "lock" });
    if (!response?.ok) throw new Error(response?.message || "The action failed.");
    window.close();
  } catch (error) {
    setStatus(error.message, "error");
    primaryButton.disabled = false;
  }
});

settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh().catch((error) => {
  setStatus(error.message, "error");
  primaryButton.disabled = true;
});
