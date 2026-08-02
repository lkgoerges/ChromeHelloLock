import {
  browserWebAuthnAvailable,
  hasBrowserCredential,
  verifyWithWindowsHello,
  windowsHelloError,
} from "./webauthn.js";

const helloDot = document.querySelector("#hello-dot");
const helloLabel = document.querySelector("#hello-label");
const helloMessage = document.querySelector("#hello-message");
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
  helloDot.className = `status-dot ${available ? "available" : "error"}`;
  helloLabel.textContent = available
    ? enrolled
      ? "Ready — Windows Hello credential found"
      : "Ready — Windows Hello setup required"
    : "Unavailable in this Chrome version";
  setMessage(
    helloMessage,
    available
      ? enrolled
        ? "Chrome will request verification directly through Windows Hello."
        : "The first test creates a credential owned by this Chrome extension."
      : "Update Chrome to use browser-owned Windows Hello authentication.",
    available ? "" : "error",
  );
}

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  setMessage(helloMessage, "Waiting for Windows Hello…");

  try {
    const verification = await verifyWithWindowsHello();
    const response = await chrome.runtime.sendMessage({
      type: "windows-hello-verified",
      setupOnly: true,
    });
    if (!response?.ok) {
      setMessage(helloMessage, response?.message || "Verification was not completed.", "error");
      return;
    }
    helloDot.className = "status-dot available";
    helloLabel.textContent = "Ready — Windows Hello credential found";
    setMessage(
      helloMessage,
      verification.created
        ? "Chrome created the local Windows Hello credential. Setup is complete."
        : "Windows Hello verification succeeded.",
      "success",
    );
  } catch (error) {
    setMessage(helloMessage, windowsHelloError(error), "error");
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
