import {
  browserWebAuthnAvailable,
  hasBrowserCredential,
  verifyWithWindowsHello,
  windowsHelloError,
} from "./webauthn.js";

const nativeDot = document.querySelector("#native-dot");
const nativeLabel = document.querySelector("#native-label");
const nativeMessage = document.querySelector("#native-message");
const testButton = document.querySelector("#test-button");
const lockOnStartup = document.querySelector("#lock-on-startup");
const autoLock = document.querySelector("#auto-lock");
const saveButton = document.querySelector("#save-button");
const saveMessage = document.querySelector("#save-message");

function setMessage(element, message, type = "") {
  element.textContent = message;
  element.className = `status-line ${type}`.trim();
}

async function checkWindowsHello() {
  const available = browserWebAuthnAvailable();
  const enrolled = available && (await hasBrowserCredential());
  nativeDot.className = `status-dot ${available ? "available" : "error"}`;
  nativeLabel.textContent = available
    ? enrolled
      ? "Ready — Windows Hello credential found"
      : "Ready — Windows Hello setup required"
    : "Unavailable in this Chrome version";
  setMessage(
    nativeMessage,
    available
      ? enrolled
        ? "Chrome will request verification directly; no companion is used."
        : "The first test creates a credential owned by this Chrome extension."
      : "Update Chrome to use browser-owned Windows Hello authentication.",
    available ? "" : "error",
  );
}

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  setMessage(nativeMessage, "Waiting for Windows Hello…");

  try {
    const verification = await verifyWithWindowsHello();
    const response = await chrome.runtime.sendMessage({
      type: "windows-hello-verified",
      setupOnly: true,
    });
    if (!response?.ok) {
      setMessage(nativeMessage, response?.message || "Verification was not completed.", "error");
      return;
    }
    nativeDot.className = "status-dot available";
    nativeLabel.textContent = "Ready — Windows Hello credential found";
    setMessage(
      nativeMessage,
      verification.created
        ? "Chrome created the local Windows Hello credential. Setup is complete."
        : "Windows Hello verification succeeded.",
      "success",
    );
  } catch (error) {
    setMessage(nativeMessage, windowsHelloError(error), "error");
  } finally {
    testButton.disabled = false;
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

const [{ settings }] = await Promise.all([
  chrome.runtime.sendMessage({ type: "get-settings" }),
  checkWindowsHello(),
]);

lockOnStartup.checked = settings.lockOnStartup;
autoLock.value = String(settings.autoLockMinutes);
