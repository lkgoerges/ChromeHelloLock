# Chrome Hello Lock

Chrome Hello Lock is a small, local-first lock screen for a personal Chrome work profile. It protects active and newly opened tabs while locked, then uses Windows Hello—face, fingerprint, or PIN—to restore the tabs you were using.

![Status: early preview](https://img.shields.io/badge/status-early_preview-d7ff64?style=flat-square&labelColor=17181c)
![Platform: Windows 11](https://img.shields.io/badge/platform-Windows_11-68a7ff?style=flat-square&labelColor=17181c)

## What it does

- Locks active tabs in every Chrome window behind a dedicated lock screen.
- Protects tabs opened or activated while the profile is locked.
- Restores interrupted tabs after successful verification.
- Keeps restore targets across Chrome restarts, extension updates, and service-worker restarts.
- Authenticates locally through Chrome's built-in WebAuthn support and Windows Hello.
- Verifies the one-time challenge, extension origin, user-verification flags, relying-party binding, and assertion signature.
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
4. Chrome Hello Lock opens its settings page. Select **Set up Windows Hello** to enroll, then optionally test it.
5. Use the toolbar button whenever you want to lock the profile.

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

The private credential stays inside Windows Hello. The extension stores its credential ID and public verification key in `chrome.storage.local`; no server or external process participates in authentication. While locked, the original URLs of redirected tabs are also stored locally until restoration succeeds. Settings are deliberately inaccessible while locked so a guest cannot replace the enrolled credential.

## License

[MIT](LICENSE)
