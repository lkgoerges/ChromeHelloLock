# Chrome Hello Lock

Chrome Hello Lock is a small, local-first privacy guard for your Chrome profile. It redirects active and newly opened tabs while locked, then uses Windows Hello—face, fingerprint, or PIN—to restore interrupted pages.

![Status: early preview](https://img.shields.io/badge/status-early_preview-d7ff64?style=flat-square&labelColor=17181c)
![Platform: Windows 11](https://img.shields.io/badge/platform-Windows_11-68a7ff?style=flat-square&labelColor=17181c)

## What it does

- Locks active tabs in every Chrome window behind a dedicated lock screen.
- Protects tabs opened or activated while the profile is locked.
- Restores interrupted tabs after successful verification.
- Keeps restore targets across Chrome restarts, extension updates, and service-worker restarts.
- Detects a stale background worker and can reload an unpacked extension directly from the lock screen.
- Authenticates locally through Chrome's built-in WebAuthn support and Windows Hello.
- Verifies the one-time challenge, extension origin, user-verification flags, relying-party binding, and assertion signature.
- Locks automatically when Chrome starts, with an optional re-lock timer.
- Stores no biometric data, Windows PIN, account, or password.

This is intentionally a personal privacy guard, not a hardened security boundary. Chrome’s extensions page remains accessible for recovery, so anyone using this Windows account can disable or remove the extension. Lock Windows or use separate Windows accounts for stronger protection. Locking navigates away from pages: save forms and other unsaved work first. Unlock restores URLs, not unsaved page state.

## Requirements

- Windows 11, build 22000 or newer.
- Google Chrome.
- Windows Hello configured for the current Windows account.

## Install from source

1. Open `chrome://extensions` in the Chrome profile you want to protect.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose the repository's `extension` folder.
4. Read and acknowledge the setup notice. Select **Set up Windows Hello** to enroll, then optionally test it.
5. Use the toolbar button or **Ctrl+Shift+L** to lock the profile. If another extension uses this shortcut, configure it at `chrome://extensions/shortcuts`.

The extension contains a fixed public key, giving unpacked installations the stable ID `bodeojcofhnjbhebeapdokhabmimcjmm`. Chrome isolates its WebAuthn credential under that extension origin.

## Development

Validate the extension JavaScript and manifest:

```powershell
.\scripts\validate.ps1
```

Run the security-critical WebAuthn verification tests:

```powershell
npm test
```

Create a reproducible Web Store ZIP and SHA-256 checksum (Windows with Node.js):

```powershell
npm run package
```

The package contains only validated bundled extension resources, with `manifest.json` at the ZIP root. Entry order and timestamps are fixed. The build reads the ZIP back and compares every file against the source. See [Web Store preparation](docs/WEBSTORE.md) and the [privacy notice](docs/PRIVACY.md).

## Architecture

```text
Chrome extension service worker
  ├─ serializes lock and tab events through one state queue
  ├─ persists lock state and tokenized restore targets locally
  ├─ redirects active/new tabs to lock.html#<restore-token>
  └─ issues and consumes short-lived, single-page WebAuthn challenges
          │
          ▼
Visible Chrome extension page
  └─ calls navigator.credentials with the issued challenge and user verification required
          │
          ▼
Chrome WebAuthn → Windows Hello → signed assertion
          │
          ▼
Service worker validates challenge, origin, RP binding, UV flags, and signature
```

The private credential stays inside Windows Hello. The extension stores its credential ID and public verification key in `chrome.storage.local`; no server or external process participates in authentication. Original URLs are stored locally across restarts until the restoration pass finishes. If a page cannot be restored, it may fall back to a new tab; browser history may help recover it. Settings and credential replacement are blocked while locked. Only Chrome’s extensions-management and shortcuts pages are intentionally exempt from tab redirection, for recovery.

## License

[MIT](LICENSE)
