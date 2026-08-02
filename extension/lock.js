import {
  getBrowserCredentialStatus,
  verifyWithWindowsHello,
  windowsHelloError,
} from "./webauthn.js";

const EXPECTED_PROTOCOL_VERSION = 2;
const unlockButton = document.querySelector("#unlock-button");
const reloadButton = document.querySelector("#reload-extension-button");
const status = document.querySelector("#status");

function setStatus(message, type = "") {
  status.textContent = message;
  status.className = `status-line ${type}`.trim();
}

function showWorkerRecovery() {
  unlockButton.classList.add("hidden");
  reloadButton.classList.remove("hidden");
  setStatus("The lock screen and its background worker are different versions. Reload the extension to finish updating.", "error");
}

function isProtocolMismatch(error) {
  return error?.message === "Unknown request." || error?.message?.includes("different versions");
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
    if (isProtocolMismatch(error)) {
      showWorkerRecovery();
      return;
    }
    setStatus(windowsHelloError(error), "error");
  } finally {
    unlockButton.disabled = false;
  }
}

async function initialize() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "get-status" });
    if (!response?.ok) throw new Error(response?.message || "The profile state could not be read.");
    if (response.protocolVersion !== EXPECTED_PROTOCOL_VERSION) {
      showWorkerRecovery();
      return;
    }

    const credential = await getBrowserCredentialStatus();
    if (!response.locked) {
      setStatus("This profile is already unlocked.", "success");
      unlockButton.classList.add("hidden");
    } else if (!credential.enrolled) {
      setStatus("No Windows Hello credential is enrolled. Disable the extension to recover this profile, then set it up again while unlocked.", "error");
      unlockButton.disabled = true;
    } else if (credential.migrationRequired) {
      setStatus("Unlock once with your existing credential, then reconfigure Windows Hello in Settings.");
    }
  } catch (error) {
    if (isProtocolMismatch(error)) {
      showWorkerRecovery();
      return;
    }
    setStatus(error.message, "error");
    unlockButton.disabled = true;
  }
}

unlockButton.addEventListener("click", authenticate);
reloadButton.addEventListener("click", () => {
  reloadButton.disabled = true;
  setStatus("Reloading Chrome Hello Lock…", "success");
  chrome.runtime.reload();
});

await initialize();
