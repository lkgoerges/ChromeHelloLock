const HOST_NAME = "com.lkgsoft.chrome_hello_lock";
const LOCK_URL = chrome.runtime.getURL("lock.html");
const SETTINGS_URL = chrome.runtime.getURL("settings.html");
const AUTO_LOCK_ALARM = "auto-lock";

const DEFAULT_SETTINGS = Object.freeze({
  setupComplete: false,
  lockOnStartup: true,
  autoLockMinutes: 0,
});

let enforcementQueue = Promise.resolve();
let nativePort = null;
const nativeRequests = new Map();

function enqueue(task) {
  enforcementQueue = enforcementQueue.then(task, task);
  return enforcementQueue;
}

async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
}

async function isLocked() {
  const session = await chrome.storage.session.get("locked");
  if (typeof session.locked === "boolean") {
    return session.locked;
  }

  const settings = await getSettings();
  const locked = settings.setupComplete && settings.lockOnStartup;
  await chrome.storage.session.set({ locked });
  await updateAction(locked);
  return locked;
}

async function updateAction(locked) {
  await chrome.action.setBadgeText({ text: locked ? "LOCK" : "" });
  if (locked) {
    await chrome.action.setBadgeBackgroundColor({ color: "#D94B4B" });
    await chrome.action.setTitle({ title: "Chrome Hello Lock — locked" });
  } else {
    await chrome.action.setTitle({ title: "Chrome Hello Lock — unlocked" });
  }
}

function isLockPage(url) {
  return typeof url === "string" && (url === LOCK_URL || url.startsWith(`${LOCK_URL}#`));
}

function isAllowedWhileLocked(url) {
  return isLockPage(url) || url === SETTINGS_URL || url?.startsWith(`${SETTINGS_URL}#`);
}

function recoverableUrl(tab) {
  const url = tab.pendingUrl || tab.url || "chrome://newtab/";
  return isAllowedWhileLocked(url) ? null : url;
}

async function rememberTab(tab) {
  const url = recoverableUrl(tab);
  if (!url) return;

  const { returnTargets = {} } = await chrome.storage.session.get("returnTargets");
  if (!returnTargets[String(tab.id)]) {
    returnTargets[String(tab.id)] = { url, windowId: tab.windowId };
    await chrome.storage.session.set({ returnTargets });
  }
}

async function protectTab(tabId, { includeBackground = false } = {}) {
  if (!(await isLocked())) return;

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }

  if ((!tab.active && !includeBackground) || isAllowedWhileLocked(tab.pendingUrl || tab.url)) return;

  await rememberTab(tab);
  try {
    await chrome.tabs.update(tabId, { url: LOCK_URL });
  } catch (error) {
    console.warn("Chrome Hello Lock could not protect tab", tabId, error);
  }
}

async function protectActiveTabs() {
  const tabs = await chrome.tabs.query({ active: true });
  await Promise.all(tabs.map((tab) => protectTab(tab.id, { includeBackground: true })));
}

async function lockProfile() {
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  await chrome.storage.session.set({ locked: true });
  await updateAction(true);
  await protectActiveTabs();
}

async function restoreRedirectedTabs() {
  const { returnTargets = {} } = await chrome.storage.session.get("returnTargets");
  await chrome.storage.session.remove("returnTargets");

  await Promise.all(
    Object.entries(returnTargets).map(async ([tabId, target]) => {
      try {
        await chrome.tabs.update(Number(tabId), { url: target.url });
      } catch {
        // The tab may have been closed while the profile was locked.
      }
    }),
  );
}

async function scheduleAutoLock() {
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  const { autoLockMinutes } = await getSettings();
  if (autoLockMinutes > 0) {
    await chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: autoLockMinutes });
  }
}

async function unlockProfile() {
  await chrome.storage.session.set({ locked: false });
  await updateAction(false);
  await restoreRedirectedTabs();
  await scheduleAutoLock();
}

function disconnectNativePort(port, reason) {
  if (nativePort === port) nativePort = null;

  for (const [requestId, pending] of nativeRequests) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
    nativeRequests.delete(requestId);
  }
}

function connectNativeHost() {
  if (nativePort) return nativePort;

  const port = chrome.runtime.connectNative(HOST_NAME);
  nativePort = port;

  port.onMessage.addListener((message) => {
    const requestId = message?.requestId;
    const pending = requestId ? nativeRequests.get(requestId) : null;
    if (!pending) return;

    clearTimeout(pending.timeout);
    nativeRequests.delete(requestId);
    pending.resolve(message);
  });

  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message || "The Windows Hello companion disconnected.";
    disconnectNativePort(port, reason);
  });

  return port;
}

function sendNativeRequest(action, payload = {}, timeoutMs = 15_000) {
  const requestId = crypto.randomUUID();
  const port = connectNativeHost();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      nativeRequests.delete(requestId);
      reject(new Error("The Windows Hello companion did not respond in time."));
    }, timeoutMs);

    nativeRequests.set(requestId, { resolve, reject, timeout });

    try {
      port.postMessage({ requestId, action, ...payload });
    } catch (error) {
      clearTimeout(timeout);
      nativeRequests.delete(requestId);
      reject(error);
    }
  });
}

async function authenticateWithWindowsHello() {
  const response = await sendNativeRequest(
    "authenticate",
    {
      message: "Unlock your Chrome work profile",
    },
    120_000,
  );

  if (!response?.verified) {
    return {
      ok: false,
      result: response?.result || "Unavailable",
      message: response?.message || "Windows Hello did not verify your identity.",
    };
  }

  await chrome.storage.local.set({ setupComplete: true });
  await unlockProfile();
  return { ok: true, verified: true, result: response.result };
}

async function nativeStatus() {
  try {
    return await sendNativeRequest("status");
  } catch (error) {
    return {
      ok: false,
      available: false,
      availability: "HostNotInstalled",
      message: error.message,
    };
  }
}

async function handleMessage(message) {
  switch (message?.type) {
    case "get-status": {
      const settings = await getSettings();
      return { ok: true, locked: await isLocked(), settings };
    }
    case "get-native-status":
      return nativeStatus();
    case "authenticate":
      try {
        return await authenticateWithWindowsHello();
      } catch (error) {
        return { ok: false, message: error.message };
      }
    case "lock":
      await lockProfile();
      return { ok: true, locked: true };
    case "open-lock-screen": {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id) await protectTab(activeTab.id, { includeBackground: true });
      return { ok: true };
    }
    case "get-settings":
      return { ok: true, settings: await getSettings() };
    case "save-settings": {
      const autoLockMinutes = Number(message.settings?.autoLockMinutes);
      const settings = {
        lockOnStartup: Boolean(message.settings?.lockOnStartup),
        autoLockMinutes: [0, 5, 15, 30, 60].includes(autoLockMinutes) ? autoLockMinutes : 0,
      };
      await chrome.storage.local.set(settings);
      if (!(await isLocked())) await scheduleAutoLock();
      return { ok: true, settings: { ...(await getSettings()), ...settings } };
    }
    default:
      return { ok: false, message: "Unknown request." };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse, (error) => sendResponse({ ok: false, message: error.message }));
  return true;
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) enqueue(() => protectTab(tab.id, { includeBackground: true }));
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  enqueue(() => protectTab(tabId, { includeBackground: true }));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === "loading")) {
    enqueue(() => protectTab(tabId));
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    const { returnTargets = {} } = await chrome.storage.session.get("returnTargets");
    if (returnTargets[String(tabId)]) {
      delete returnTargets[String(tabId)];
      await chrome.storage.session.set({ returnTargets });
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) enqueue(lockProfile);
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  enqueue(async () => {
    const existing = await chrome.storage.local.get(DEFAULT_SETTINGS);
    await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...existing });

    if (reason === "install") {
      await chrome.storage.session.set({ locked: false });
      await updateAction(false);
      await chrome.runtime.openOptionsPage();
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => {
    const settings = await getSettings();
    if (settings.setupComplete && settings.lockOnStartup) {
      await lockProfile();
    } else {
      await chrome.storage.session.set({ locked: false });
      await updateAction(false);
    }
  });
});

enqueue(async () => updateAction(await isLocked()));
