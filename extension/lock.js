const unlockButton = document.querySelector("#unlock-button");
const settingsButton = document.querySelector("#settings-button");
const status = document.querySelector("#status");

function setStatus(message, type = "") {
  status.textContent = message;
  status.className = `status-line ${type}`.trim();
}

async function authenticate() {
  unlockButton.disabled = true;
  setStatus("Waiting for Windows Hello…");

  try {
    const response = await chrome.runtime.sendMessage({ type: "authenticate" });
    if (!response?.ok) {
      setStatus(response?.message || "Authentication was not completed.", "error");
      return;
    }
    setStatus("Verified. Restoring your tabs…", "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    unlockButton.disabled = false;
  }
}

unlockButton.addEventListener("click", authenticate);
settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

const { locked } = await chrome.runtime.sendMessage({ type: "get-status" });
if (!locked) {
  setStatus("This profile is already unlocked.", "success");
  unlockButton.classList.add("hidden");
}
