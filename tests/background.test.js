import assert from "node:assert/strict";
import test from "node:test";

const id = "bodeojcofhnjbhebeapdokhabmimcjmm";
const origin = `chrome-extension://${id}/`;
let fixtureNumber = 0;

function event() {
  const listeners = [];
  return { addListener(listener) { listeners.push(listener); }, emit(...args) { for (const listener of listeners) listener(...args); } };
}

function storage(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      if (typeof keys === "string") return structuredClone({ [keys]: data[keys] });
      const defaults = Array.isArray(keys) ? Object.fromEntries(keys.map(key => [key, undefined])) : keys;
      return structuredClone(Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, key in data ? data[key] : value])));
    },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const key of typeof keys === "string" ? [keys] : keys) delete data[key]; },
    async setAccessLevel() {},
  };
}

async function fixture({ locked = false, enrolled = true, accepted = true, urls = ["https://example.com/private"] } = {}) {
  const local = storage({
    setupComplete: enrolled, lockOnStartup: true, autoLockMinutes: 0,
    disclosureAcceptedV1: accepted,
    browserWebAuthnCredential: enrolled ? { id: "credential", publicKey: "public", algorithm: -7 } : undefined,
    lockStateV1: { phase: locked ? "locked" : "unlocked", targets: {} },
  });
  const tabs = new Map(urls.map((url, index) => [index + 1, { id: index + 1, active: true, url }]));
  const updates = [], badges = [];
  let optionsOpened = 0;
  const mock = {
    storage: { local, session: storage() },
    runtime: {
      id, getURL: name => origin + name,
      onMessage: event(), onInstalled: event(), onStartup: event(),
      async openOptionsPage() { optionsOpened++; },
    },
    tabs: {
      onCreated: event(), onActivated: event(), onUpdated: event(), onRemoved: event(),
      async get(tabId) { if (!tabs.has(tabId)) throw new Error("Tab closed."); return structuredClone(tabs.get(tabId)); },
      async query(query) { return [...tabs.values()].filter(tab => !query.active || tab.active); },
      async update(tabId, change) { updates.push([tabId, change]); Object.assign(tabs.get(tabId), change); },
      async create(change) { const tab = { id: tabs.size + 1, active: true, ...change }; tabs.set(tab.id, tab); mock.tabs.onCreated.emit(tab); return tab; },
      async goBack() {},
    },
    action: { async setBadgeText(value) { badges.push(value.text); }, async setBadgeBackgroundColor() {}, async setTitle() {} },
    alarms: { onAlarm: event(), async clear() {}, async create() {} },
    commands: { onCommand: event() },
  };
  globalThis.chrome = mock;
  await import(`../extension/background.js?fixture=${fixtureNumber++}`);
  function sender(page = "popup", overrides = {}) { return { id, url: `${origin}${page}.html`, frameId: 0, tab: { id: 1 }, documentId: page, ...overrides }; }
  async function message(type, page = "popup", extra = {}, overrides = {}) {
    return new Promise(resolve => mock.runtime.onMessage.emit({ type, ...extra }, sender(page, overrides), resolve));
  }
  await message("get-status"); // Drains the initialization queue.
  return { mock, local, tabs, updates, badges, message, optionsOpened: () => optionsOpened };
}

test("background protection and recovery regression suite", async t => {
  try {
    await t.test("only the narrow management and shortcuts pages are exempt", async () => {
      const urls = ["chrome://extensions/", "chrome://extensions/?id=abc", "chrome://extensions/shortcuts", "chrome://extensions", "chrome://settings/", "chrome://history/", "chrome://extensions/not-recovery", "https://extensions/", "https://example.com/chrome://extensions/"];
      const f = await fixture({ locked: true, urls });
      for (let index = 0; index < urls.length; index++) {
        assert.equal(f.tabs.get(index + 1).url.startsWith(origin + "lock.html#"), index >= 4);
      }
      assert.equal(Object.keys(f.local.data.lockStateV1.targets).length, 5);
    });
    await t.test("recovery opens a management tab without unlocking or allowing credential changes", async () => {
      const f = await fixture({ locked: true });
      assert.equal((await f.message("open-extension-management", "lock")).ok, true);
      await f.message("get-status");
      assert.equal(f.tabs.get(2).url, "chrome://extensions/");
      assert.equal(f.local.data.lockStateV1.phase, "locked");
      assert.equal((await f.message("begin-registration", "settings")).ok, false);
      assert.equal((await f.message("save-settings", "settings", { settings: { lockOnStartup: false } })).ok, false);
      assert.equal((await f.message("accept-disclosure", "settings")).ok, false);
    });
    await t.test("untrusted senders and subframes cannot open recovery or acknowledge notice", async () => {
      const f = await fixture();
      for (const type of ["open-extension-management", "accept-disclosure", "lock", "begin-authentication"]) {
        assert.equal((await f.message(type, "settings", {}, { id: "other-extension" })).ok, false);
        assert.equal((await f.message(type, "settings", {}, { frameId: 1 })).ok, false);
      }
    });
    await t.test("enrollment requires persisted acknowledgement, not only a UI checkbox", async () => {
      const f = await fixture({ accepted: false, enrolled: false });
      assert.match((await f.message("begin-registration", "settings")).message, /acknowledge/);
      assert.equal((await f.message("accept-disclosure", "popup")).ok, false);
      assert.equal((await f.message("accept-disclosure", "settings")).ok, true);
      assert.equal((await f.message("begin-registration", "settings")).ok, true);
    });
    await t.test("existing locked installs can authenticate without a new acknowledgement", async () => {
      const f = await fixture({ locked: true, accepted: false });
      assert.equal((await f.message("begin-authentication", "lock")).ok, true);
      assert.equal((await f.message("get-status")).locked, true);
    });
    await t.test("shortcut locks through the queue and is idempotent", async () => {
      const f = await fixture();
      f.mock.commands.onCommand.emit("lock-profile");
      await f.message("get-status");
      assert.equal(f.local.data.lockStateV1.phase, "locked");
      assert.equal(f.updates.length, 1);
      f.mock.commands.onCommand.emit("lock-profile");
      await f.message("get-status");
      assert.equal(f.updates.length, 1);
      assert.deepEqual(Object.values(f.local.data.lockStateV1.targets).map(target => target.url), ["https://example.com/private"]);
    });
    await t.test("shortcut before setup opens settings without locking", async () => {
      const f = await fixture({ enrolled: false });
      f.mock.commands.onCommand.emit("lock-profile");
      await f.message("get-status");
      assert.equal(f.optionsOpened(), 1);
      assert.equal(f.local.data.lockStateV1.phase, "unlocked");
    });
    await t.test("startup still locks existing enrolled profiles and preserves recovery", async () => {
      const f = await fixture({ accepted: false, urls: ["https://example.com", "chrome://extensions/"] });
      f.mock.runtime.onStartup.emit();
      await f.message("get-status");
      assert.equal(f.tabs.get(1).url.startsWith(origin + "lock.html#"), true);
      assert.equal(f.tabs.get(2).url, "chrome://extensions/");
      assert.equal(f.local.data.lockStateV1.phase, "locked");
    });
  } finally {
    delete globalThis.chrome;
  }
});
