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

async function checkNativeHost() {
  const response = await chrome.runtime.sendMessage({ type: "get-native-status" });
  nativeDot.className = `status-dot ${response?.available ? "available" : "error"}`;
  nativeLabel.textContent = response?.available
    ? response.availability === "NeedsEnrollment"
      ? "Ready — Windows Hello setup required"
      : "Ready — Windows Hello credential found"
    : response?.availability === "HostNotInstalled"
      ? "Companion not installed"
      : `Unavailable — ${response?.availability || "unknown"}`;

  if (response?.message) {
    setMessage(nativeMessage, response.message, response.available ? "" : "error");
  }
}

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  setMessage(nativeMessage, "Waiting for Windows Hello…");

  try {
    const response = await chrome.runtime.sendMessage({ type: "authenticate" });
    if (!response?.ok) {
      setMessage(nativeMessage, response?.message || "Verification was not completed.", "error");
      return;
    }
    nativeDot.className = "status-dot available";
    nativeLabel.textContent = "Ready — Windows Hello credential found";
    setMessage(nativeMessage, "Windows Hello is connected. Setup is complete.", "success");
  } catch (error) {
    setMessage(nativeMessage, error.message, "error");
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
  checkNativeHost(),
]);

lockOnStartup.checked = settings.lockOnStartup;
autoLock.value = String(settings.autoLockMinutes);
