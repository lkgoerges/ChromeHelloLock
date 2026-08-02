# Chrome Hello Lock

Chrome Hello Lock is a small, local-first lock screen for a personal Chrome work profile. It protects active and newly opened tabs while locked, then uses Windows Hello—face, fingerprint, or PIN—to restore the tabs you were using.

![Status: early preview](https://img.shields.io/badge/status-early_preview-d7ff64?style=flat-square&labelColor=17181c)
![Platform: Windows 11](https://img.shields.io/badge/platform-Windows_11-68a7ff?style=flat-square&labelColor=17181c)

## What it does

- Locks active tabs in every Chrome window behind a dedicated lock screen.
- Protects tabs opened or activated while the profile is locked.
- Restores interrupted tabs after successful verification.
- Authenticates locally through Chrome's built-in WebAuthn support and Windows Hello.
- Locks automatically when Chrome starts, with an optional re-lock timer.
- Stores no biometric data, Windows PIN, account, or password.

This is intentionally a personal privacy guard, not a hardened security boundary. Someone with access to the Windows account can disable an unpacked extension or remove its local files.

## Requirements

- Windows 11, build 22000 or newer.
- Google Chrome.
- Windows Hello configured for the current Windows account.

## Install from source

1. Open `chrome://extensions` in the work profile.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose the repository's `extension` folder.
4. Chrome Hello Lock opens its settings page. Select **Test Windows Hello** to complete setup.
5. Use the toolbar button whenever you want to lock the profile.

The extension contains a fixed public key, giving unpacked installations the stable ID `bodeojcofhnjbhebeapdokhabmimcjmm`. Chrome isolates its WebAuthn credential under that extension origin.

## Development

Validate the extension JavaScript and manifest:

```powershell
.\scripts\validate.ps1
```

## Architecture

```text
Chrome extension service worker
  ├─ tracks locked state in chrome.storage.session
  ├─ redirects active/new tabs to lock.html
  └─ accepts a successful result only from lock.html or settings.html
          │
          ▼
Visible Chrome extension page
  └─ calls navigator.credentials with user verification required
          │
          ▼
Chrome WebAuthn → Windows Hello → verified / not verified
```

The private credential stays inside Windows Hello. The extension stores only its public identifier in `chrome.storage.local`; no server or external process participates in authentication.

## License

[MIT](LICENSE)
