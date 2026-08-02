import {
  browserWebAuthnAvailable,
  enrollWithWindowsHello,
  getBrowserCredentialStatus,
  verifyWithWindowsHello,
  windowsHelloError,
} from "./webauthn.js";

const helloDot = document.querySelector("#hello-dot");
const helloLabel = document.querySelector("#hello-label");
const helloMessage = document.querySelector("#hello-message");
const enrollButton = document.querySelector("#enroll-button");
const testButton = document.querySelector("#test-button");
const lockOnStartup = document.querySelector("#lock-on-startup");
const autoLock = document.querySelector("#auto-lock");
const saveButton = document.querySelector("#save-button");
const saveMessage = document.querySelector("#save-message");

let credentialState = { enrolled: false, migrationRequired: false };

function setMessage(element, message, type = "") {
  element.textContent = message;
  element.className = `status-line ${type}`.trim();
}

function renderCredentialState(available) {
  helloDot.className = `status-dot ${available ? "available" : "error"}`;
  helloLabel.textContent = !available
    ? "Unavailable in this Chrome version"
    : credentialState.migrationRequired
      ? "Update required — reconfigure Windows Hello"
      : credentialState.enrolled
        ? "Ready — secure credential enrolled"
        : "Ready — setup required";
  enrollButton.textContent = credentialState.enrolled ? "Reconfigure Windows Hello" : "Set up Windows Hello";
  enrollButton.disabled = !available;
  testButton.disabled = !available || !credentialState.enrolled;
}

async function checkWindowsHello() {
  const available = browserWebAuthnAvailable();
  credentialState = available ? await getBrowserCredentialStatus() : credentialState;
  renderCredentialState(available);
  setMessage(
    helloMessage,
    !available
      ? "Update Chrome to use browser-owned Windows Hello authentication."
      : credentialState.migrationRequired
        ? "Your existing credential can unlock once, but reconfiguration is required for cryptographic assertion verification."
        : credentialState.enrolled
          ? "Chrome Hello Lock verifies each fresh challenge and Windows Hello signature locally."
          : "Setup creates a private credential in Windows Hello and stores only its public verification data here.",
    available ? "" : "error",
  );
}

enrollButton.addEventListener("click", async () => {
  enrollButton.disabled = true;
  testButton.disabled = true;
  setMessage(helloMessage, "Waiting for Windows Hello…");

  try {
    credentialState = await enrollWithWindowsHello();
    renderCredentialState(true);
    setMessage(
      helloMessage,
      "Windows Hello setup is complete. Future unlocks will verify a fresh signed challenge.",
      "success",
    );
  } catch (error) {
    setMessage(helloMessage, windowsHelloError(error), "error");
    renderCredentialState(true);
  }
});

testButton.addEventListener("click", async () => {
  enrollButton.disabled = true;
  testButton.disabled = true;
  setMessage(helloMessage, "Waiting for Windows Hello…");

  try {
    const verification = await verifyWithWindowsHello();
    setMessage(
      helloMessage,
      verification.migrationRequired
        ? "Verification succeeded, but reconfiguration is still required."
        : "Windows Hello verification and signature validation succeeded.",
      verification.migrationRequired ? "" : "success",
    );
  } catch (error) {
    setMessage(helloMessage, windowsHelloError(error), "error");
  } finally {
    renderCredentialState(true);
  }
});

saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  setMessage(saveMessage, "Saving…");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "save-settings",
      settings: {
        lockOnStartup: lockOnStartup.checked,
        autoLockMinutes: Number(autoLock.value),
      },
    });
    if (!response?.ok) throw new Error(response?.message || "Settings could not be saved.");
    setMessage(saveMessage, "Settings saved.", "success");
  } catch (error) {
    setMessage(saveMessage, error.message, "error");
  } finally {
    saveButton.disabled = false;
  }
});

try {
  const [{ settings }] = await Promise.all([
    chrome.runtime.sendMessage({ type: "get-settings" }),
    checkWindowsHello(),
  ]);
  lockOnStartup.checked = settings.lockOnStartup;
  autoLock.value = String(settings.autoLockMinutes);
} catch (error) {
  setMessage(helloMessage, error.message, "error");
  enrollButton.disabled = true;
  testButton.disabled = true;
  saveButton.disabled = true;
}
