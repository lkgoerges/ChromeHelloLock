import {
  randomChallenge,
  validateAuthentication,
  validateRegistration,
} from "./webauthn-verifier.js";

const LOCK_URL = chrome.runtime.getURL("lock.html");
const SETTINGS_URL = chrome.runtime.getURL("settings.html");
const POPUP_URL = chrome.runtime.getURL("popup.html");
const EXTENSION_ORIGIN = `chrome-extension://${chrome.runtime.id}`;
const AUTO_LOCK_ALARM = "auto-lock";
const LOCK_STATE_KEY = "lockStateV1";
const CREDENTIAL_KEY = "browserWebAuthnCredential";
const BINDINGS_KEY = "tabTargetBindings";
const CEREMONY_KEY = "pendingWebAuthnCeremony";
const CEREMONY_LIFETIME_MS = 70_000;

const DEFAULT_SETTINGS = Object.freeze({
  setupComplete: false,
  lockOnStartup: true,
  autoLockMinutes: 0,
});

let enforcementQueue = Promise.resolve();

function enqueue(task) {
  const result = enforcementQueue.then(task, task);
  enforcementQueue = result.catch(() => {});
  return result;
}

async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
}

function normalizeLockState(value) {
  const phase = ["unlocked", "locked", "restoring"].includes(value?.phase) ? value.phase : "unlocked";
  const targets = value?.targets && typeof value.targets === "object" && !Array.isArray(value.targets)
    ? value.targets
    : {};
  return { phase, targets };
}

async function getLockState() {
  const stored = await chrome.storage.local.get(LOCK_STATE_KEY);
  if (stored[LOCK_STATE_KEY]) return normalizeLockState(stored[LOCK_STATE_KEY]);

  const legacy = await chrome.storage.session.get(["locked", "returnTargets"]);
  const settings = await getSettings();
  const state = {
    phase: (legacy.locked ?? (settings.setupComplete && settings.lockOnStartup)) ? "locked" : "unlocked",
    targets: {},
  };

  for (const [tabId, target] of Object.entries(legacy.returnTargets || {})) {
    if (typeof target?.url !== "string") continue;
    const token = randomChallenge();
    state.targets[token] = { url: target.url, savedAt: Date.now() };
    try {
      const tab = await chrome.tabs.get(Number(tabId));
      if (isLockPage(tab.pendingUrl || tab.url)) await chrome.tabs.update(tab.id, { url: `${LOCK_URL}#${token}` });
    } catch {
      // A legacy redirected tab may already have been closed.
    }
  }

  await chrome.storage.local.set({ [LOCK_STATE_KEY]: state });
  await chrome.storage.session.remove(["locked", "returnTargets"]);
  return state;
}

async function setLockState(state) {
  const normalized = normalizeLockState(state);
  await chrome.storage.local.set({ [LOCK_STATE_KEY]: normalized });
  return normalized;
}

async function isLocked() {
  return (await getLockState()).phase === "locked";
}

async function updateAction(locked, warning = false) {
  await chrome.action.setBadgeText({ text: warning ? "!" : locked ? "LOCK" : "" });
  if (warning) {
    await chrome.action.setBadgeBackgroundColor({ color: "#E39A32" });
    await chrome.action.setTitle({ title: "Chrome Hello Lock — some tabs could not be protected" });
  } else if (locked) {
    await chrome.action.setBadgeBackgroundColor({ color: "#D94B4B" });
    await chrome.action.setTitle({ title: "Chrome Hello Lock — locked" });
  } else {
    await chrome.action.setTitle({ title: "Chrome Hello Lock — unlocked" });
  }
}

function isLockPage(url) {
  return typeof url === "string" && (url === LOCK_URL || url.startsWith(`${LOCK_URL}#`));
}

function lockToken(url) {
  if (!isLockPage(url)) return null;
  try {
    const token = new URL(url).hash.slice(1);
    return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

async function getBindings() {
  const stored = await chrome.storage.session.get(BINDINGS_KEY);
  return stored[BINDINGS_KEY] && typeof stored[BINDINGS_KEY] === "object" ? stored[BINDINGS_KEY] : {};
}

async function setBinding(tabId, token) {
  const bindings = await getBindings();
  bindings[String(tabId)] = token;
  await chrome.storage.session.set({ [BINDINGS_KEY]: bindings });
}

async function removeBinding(tabId) {
  const bindings = await getBindings();
  if (bindings[String(tabId)]) {
    delete bindings[String(tabId)];
    await chrome.storage.session.set({ [BINDINGS_KEY]: bindings });
  }
}

async function recordProtectionFailure(tabId) {
  const stored = await chrome.storage.session.get("protectionFailures");
  const failures = new Set(Array.isArray(stored.protectionFailures) ? stored.protectionFailures : []);
  failures.add(tabId);
  await chrome.storage.session.set({ protectionFailures: [...failures] });
  await updateAction(true, true);
}

async function protectTab(tabId, { includeBackground = false } = {}) {
  const state = await getLockState();
  if (state.phase !== "locked") return { protected: false };

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { protected: false };
  }

  if (!tab.active && !includeBackground) return { protected: false };
  const currentUrl = tab.pendingUrl || tab.url || "chrome://newtab/";
  if (isLockPage(currentUrl)) {
    const token = lockToken(currentUrl);
    if (token && state.targets[token]) await setBinding(tabId, token);
    return { protected: true };
  }

  const bindings = await getBindings();
  const boundToken = bindings[String(tabId)];
  const existingToken = boundToken && state.targets[boundToken] ? boundToken : null;
  const token = existingToken || randomChallenge();
  if (!existingToken) {
    state.targets[token] = { url: currentUrl, savedAt: Date.now() };
    await setLockState(state);
  }
  await setBinding(tabId, token);

  try {
    await chrome.tabs.update(tabId, { url: `${LOCK_URL}#${token}` });
    return { protected: true };
  } catch (error) {
    if (!existingToken) {
      const latestState = await getLockState();
      delete latestState.targets[token];
      await setLockState(latestState);
      await removeBinding(tabId);
    }
    await recordProtectionFailure(tabId);
    console.warn("Chrome Hello Lock could not protect tab", tabId, error);
    return { protected: false, error };
  }
}

async function protectActiveTabs() {
  const tabs = await chrome.tabs.query({ active: true });
  const failures = [];
  for (const tab of tabs) {
    if (!tab.id) continue;
    const result = await protectTab(tab.id, { includeBackground: true });
    if (result.error) failures.push(tab.id);
  }
  return failures;
}

async function lockProfile() {
  const settings = await getSettings();
  const credential = (await chrome.storage.local.get(CREDENTIAL_KEY))[CREDENTIAL_KEY];
  if (!settings.setupComplete || !credential?.id) throw new Error("Set up Windows Hello before locking this profile.");

  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  const state = await getLockState();
  state.phase = "locked";
  await setLockState(state);
  await chrome.storage.session.set({ protectionFailures: [] });
  await updateAction(true);
  const failures = await protectActiveTabs();
  return { failures };
}

async function restoreRedirectedTabs() {
  const state = await getLockState();
  if (state.phase === "locked") return;

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    const currentUrl = tab.pendingUrl || tab.url;
    if (!isLockPage(currentUrl)) continue;
    const token = lockToken(currentUrl);
    const target = token ? state.targets[token] : null;
    try {
      if (target?.url) {
        await chrome.tabs.update(tab.id, { url: target.url });
      } else {
        await chrome.tabs.goBack(tab.id);
      }
    } catch {
      try {
        await chrome.tabs.update(tab.id, { url: "chrome://newtab/" });
      } catch {
        // The tab may have closed during restoration.
      }
    }
  }

  await setLockState({ phase: "unlocked", targets: {} });
  await chrome.storage.session.remove([BINDINGS_KEY, "protectionFailures"]);
}

async function scheduleAutoLock() {
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  const { autoLockMinutes, setupComplete } = await getSettings();
  if (setupComplete && autoLockMinutes > 0) {
    await chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: autoLockMinutes });
  }
}

async function unlockProfile() {
  const state = await getLockState();
  state.phase = "restoring";
  await setLockState(state);
  await updateAction(false);
  await restoreRedirectedTabs();
  await scheduleAutoLock();
}

function pageKind(sender) {
  if (sender.id !== chrome.runtime.id || !sender.url) return null;
  if (sender.frameId !== undefined && sender.frameId !== 0) return null;
  if (isLockPage(sender.url)) return "lock";
  if (sender.url === SETTINGS_URL) return "settings";
  if (sender.url === POPUP_URL) return "popup";
  return null;
}

function requirePage(sender, allowedKinds) {
  const kind = pageKind(sender);
  if (!kind || !allowedKinds.includes(kind)) throw new Error("This request came from an untrusted extension page.");
  return kind;
}

function ceremonyOwner(sender) {
  return `${sender.tab?.id ?? "extension"}:${sender.documentId ?? sender.url}`;
}

async function credentialStatus() {
  const stored = (await chrome.storage.local.get(CREDENTIAL_KEY))[CREDENTIAL_KEY];
  return {
    enrolled: Boolean(stored?.id),
    migrationRequired: Boolean(stored?.id && (!stored.publicKey || !stored.algorithm)),
    registeredAt: stored?.registeredAt || null,
  };
}

async function beginCeremony(kind, sender) {
  const page = requirePage(sender, kind === "registration" ? ["settings"] : ["lock", "settings"]);
  if (kind === "registration" && (await isLocked())) {
    throw new Error("Unlock the profile before changing its Windows Hello credential.");
  }

  const credential = (await chrome.storage.local.get(CREDENTIAL_KEY))[CREDENTIAL_KEY];
  if (kind === "authentication" && !credential?.id) {
    throw new Error("No Windows Hello credential is enrolled. Recovery is required.");
  }

  const owner = ceremonyOwner(sender);
  const stored = await chrome.storage.session.get(CEREMONY_KEY);
  const pending = stored[CEREMONY_KEY];
  if (pending && pending.expiresAt > Date.now()) {
    if (pending.owner === owner && pending.kind === kind) {
      return {
        challenge: pending.challenge,
        credential: kind === "authentication" ? { id: credential.id, transports: credential.transports } : undefined,
      };
    }

    let ownerStillOpen = true;
    if (Number.isInteger(pending.tabId)) {
      try {
        await chrome.tabs.get(pending.tabId);
      } catch {
        ownerStillOpen = false;
      }
      if (pending.tabId === sender.tab?.id && pending.documentId !== sender.documentId) ownerStillOpen = false;
    }
    if (ownerStillOpen) throw new Error("Windows Hello is already open in another Chrome window.");
  }

  const ceremony = {
    kind,
    owner,
    page,
    tabId: sender.tab?.id,
    documentId: sender.documentId,
    challenge: randomChallenge(),
    expiresAt: Date.now() + CEREMONY_LIFETIME_MS,
  };
  await chrome.storage.session.set({ [CEREMONY_KEY]: ceremony });
  return {
    challenge: ceremony.challenge,
    credential: kind === "authentication" ? { id: credential.id, transports: credential.transports } : undefined,
  };
}

async function consumeCeremony(kind, sender) {
  requirePage(sender, kind === "registration" ? ["settings"] : ["lock", "settings"]);
  const stored = await chrome.storage.session.get(CEREMONY_KEY);
  const ceremony = stored[CEREMONY_KEY];
  if (!ceremony || ceremony.kind !== kind || ceremony.owner !== ceremonyOwner(sender)) {
    throw new Error("The Windows Hello request was not started by this page.");
  }
  await chrome.storage.session.remove(CEREMONY_KEY);
  if (ceremony.expiresAt <= Date.now()) throw new Error("The Windows Hello request expired. Try again.");
  return ceremony;
}

async function finishRegistration(result, sender) {
  const ceremony = await consumeCeremony("registration", sender);
  if (await isLocked()) throw new Error("The profile was locked before Windows Hello setup completed.");
  const credential = await validateRegistration(result, {
    challenge: ceremony.challenge,
    origin: EXTENSION_ORIGIN,
  });
  await chrome.storage.local.set({
    [CREDENTIAL_KEY]: credential,
    setupComplete: true,
  });
  return { enrolled: true, migrationRequired: false, registeredAt: credential.registeredAt };
}

async function finishAuthentication(result, sender) {
  const ceremony = await consumeCeremony("authentication", sender);
  const stored = await chrome.storage.local.get(CREDENTIAL_KEY);
  const credential = stored[CREDENTIAL_KEY];
  if (!credential?.id) throw new Error("The enrolled Windows Hello credential is missing.");

  const verification = await validateAuthentication(result, credential, {
    challenge: ceremony.challenge,
    origin: EXTENSION_ORIGIN,
  });
  await chrome.storage.local.set({
    [CREDENTIAL_KEY]: {
      ...credential,
      rpIdHash: credential.rpIdHash || verification.rpIdHash,
      signCount: verification.signCount,
      lastVerifiedAt: Date.now(),
    },
  });

  if (await isLocked()) await unlockProfile();
  return { verified: true, migrationRequired: verification.legacy };
}

async function cancelCeremony(sender) {
  requirePage(sender, ["lock", "settings"]);
  const stored = await chrome.storage.session.get(CEREMONY_KEY);
  if (stored[CEREMONY_KEY]?.owner === ceremonyOwner(sender)) await chrome.storage.session.remove(CEREMONY_KEY);
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "get-status": {
      requirePage(sender, ["lock", "settings", "popup"]);
      const settings = await getSettings();
      return { ok: true, locked: await isLocked(), settings, credential: await credentialStatus() };
    }
    case "credential-status":
      requirePage(sender, ["lock", "settings", "popup"]);
      return { ok: true, credential: await credentialStatus() };
    case "begin-registration": {
      const result = await beginCeremony("registration", sender);
      return { ok: true, ...result };
    }
    case "finish-registration":
      return { ok: true, credential: await finishRegistration(message.result, sender) };
    case "begin-authentication": {
      const result = await beginCeremony("authentication", sender);
      return { ok: true, ...result };
    }
    case "finish-authentication":
      return { ok: true, ...(await finishAuthentication(message.result, sender)) };
    case "cancel-webauthn":
      await cancelCeremony(sender);
      return { ok: true };
    case "lock": {
      requirePage(sender, ["popup"]);
      const { failures } = await lockProfile();
      return failures.length
        ? { ok: false, locked: true, partial: true, message: `${failures.length} tab(s) could not be protected. Close them before leaving the PC.` }
        : { ok: true, locked: true };
    }
    case "open-lock-screen": {
      requirePage(sender, ["popup"]);
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = activeTab?.id ? await protectTab(activeTab.id, { includeBackground: true }) : null;
      return result?.error
        ? { ok: false, message: "The active tab could not be redirected to the unlock screen." }
        : { ok: true };
    }
    case "get-settings":
      requirePage(sender, ["settings"]);
      return { ok: true, settings: await getSettings() };
    case "save-settings": {
      requirePage(sender, ["settings"]);
      if (await isLocked()) throw new Error("Unlock the profile before changing its settings.");
      const autoLockMinutes = Number(message.settings?.autoLockMinutes);
      const settings = {
        lockOnStartup: Boolean(message.settings?.lockOnStartup),
        autoLockMinutes: [0, 5, 15, 30, 60].includes(autoLockMinutes) ? autoLockMinutes : 0,
      };
      await chrome.storage.local.set(settings);
      await scheduleAutoLock();
      return { ok: true, settings: await getSettings() };
    }
    default:
      return { ok: false, message: "Unknown request." };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  enqueue(() => handleMessage(message, sender)).then(
    sendResponse,
    (error) => sendResponse({ ok: false, message: error?.message || "The request failed." }),
  );
  return true;
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) enqueue(() => protectTab(tab.id, { includeBackground: true }));
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  enqueue(() => protectTab(tabId, { includeBackground: true }));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === "loading")) enqueue(() => protectTab(tabId));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(() => removeBinding(tabId));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) enqueue(lockProfile);
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  enqueue(async () => {
    const existing = await chrome.storage.local.get(DEFAULT_SETTINGS);
    await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...existing });
    if (reason === "install") {
      await setLockState({ phase: "unlocked", targets: {} });
      await updateAction(false);
      await chrome.runtime.openOptionsPage();
      return;
    }

    const state = await getLockState();
    if (state.phase === "restoring") await restoreRedirectedTabs();
    if (state.phase === "locked") await protectActiveTabs();
    await updateAction(state.phase === "locked");
  });
});

chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => {
    await chrome.storage.session.remove([BINDINGS_KEY, CEREMONY_KEY, "protectionFailures"]);
    let state = await getLockState();
    if (state.phase === "restoring") {
      await restoreRedirectedTabs();
      state = await getLockState();
    }
    const settings = await getSettings();
    if (settings.setupComplete && (state.phase === "locked" || settings.lockOnStartup)) {
      await lockProfile();
    } else {
      if (state.targets && Object.keys(state.targets).length) {
        await setLockState({ phase: "restoring", targets: state.targets });
        await restoreRedirectedTabs();
      }
      await updateAction(false);
    }
  });
});

enqueue(async () => {
  await chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  const state = await getLockState();
  if (state.phase === "restoring") {
    await restoreRedirectedTabs();
  } else if (state.phase === "locked") {
    const failures = await protectActiveTabs();
    await updateAction(true, failures.length > 0);
  } else {
    await updateAction(false);
  }
});
