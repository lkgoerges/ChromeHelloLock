import {
  getBrowserCredentialStatus,
  verifyWithWindowsHello,
  windowsHelloError,
} from "./webauthn.js";

const unlockButton = document.querySelector("#unlock-button");
const status = document.querySelector("#status");

function setStatus(message, type = "") {
  status.textContent = message;
  status.className = `status-line ${type}`.trim();
}

async function authenticate() {
  unlockButton.disabled = true;
  setStatus("Waiting for Windows Hello…");

  try {
    const response = await verifyWithWindowsHello();
    setStatus(
      response.migrationRequired
        ? "Verified. Your tabs are being restored; reconfigure Windows Hello in Settings afterward."
        : "Verified. Restoring your tabs…",
      "success",
    );
  } catch (error) {
    setStatus(windowsHelloError(error), "error");
  } finally {
    unlockButton.disabled = false;
  }
}

unlockButton.addEventListener("click", authenticate);

try {
  const [{ locked }, credential] = await Promise.all([
    chrome.runtime.sendMessage({ type: "get-status" }),
    getBrowserCredentialStatus(),
  ]);
  if (!locked) {
    setStatus("This profile is already unlocked.", "success");
    unlockButton.classList.add("hidden");
  } else if (!credential.enrolled) {
    setStatus("No Windows Hello credential is enrolled. Disable the extension to recover this profile, then set it up again while unlocked.", "error");
    unlockButton.disabled = true;
  } else if (credential.migrationRequired) {
    setStatus("Unlock once with your existing credential, then reconfigure Windows Hello in Settings.");
  }
} catch (error) {
  setStatus(error.message, "error");
  unlockButton.disabled = true;
}
