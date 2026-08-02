# Chrome Hello Lock

Chrome Hello Lock is a small, local-first lock screen for a personal Chrome work profile. It protects active and newly opened tabs while locked, then uses Windows Hello—face, fingerprint, or PIN—to restore the tabs you were using.

![Status: early preview](https://img.shields.io/badge/status-early_preview-d7ff64?style=flat-square&labelColor=17181c)
![Platform: Windows 11](https://img.shields.io/badge/platform-Windows_11-68a7ff?style=flat-square&labelColor=17181c)

## What it does

- Locks active tabs in every Chrome window behind a dedicated lock screen.
- Protects tabs opened or activated while the profile is locked.
- Restores interrupted tabs after successful verification.
- Authenticates locally through Windows Hello.
- Locks automatically when Chrome starts, with an optional re-lock timer.
- Stores no biometric data, Windows PIN, account, or password.

This is intentionally a personal privacy guard, not a hardened security boundary. Someone with access to the Windows account can disable an unpacked extension or remove its local files.

## Requirements

- Windows 11, build 22000 or newer.
- Google Chrome.
- Windows Hello configured for the current Windows account.
- PowerShell 5.1 or newer.

The installer downloads a local .NET 10 SDK into the ignored `.tools` directory if no SDK is installed. The published companion is self-contained, so the SDK is not needed after installation.

## Install from source

1. Open PowerShell in the repository folder and install the native companion:

   ```powershell
   .\scripts\install-host.ps1
   ```

2. Open `chrome://extensions` in the work profile.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the repository's `extension` folder.
5. Chrome Hello Lock opens its settings page. Select **Test Windows Hello** to complete setup.
6. Use the toolbar button whenever you want to lock the profile.

The extension contains a fixed public key, giving unpacked installations the stable ID `bodeojcofhnjbhebeapdokhabmimcjmm`. The native host accepts messages only from that extension origin.

## Development

Build the companion without installing it:

```powershell
dotnet build .\native-host\ChromeHelloLock.NativeHost.csproj --configuration Release
```

Validate the extension JavaScript and manifest:

```powershell
.\scripts\validate.ps1
```

Reinstall after native companion changes:

```powershell
.\scripts\install-host.ps1
```

## Architecture

```text
Chrome extension service worker
  ├─ tracks locked state in chrome.storage.session
  ├─ redirects active/new tabs to lock.html
  └─ sends a native message when unlock is requested
          │
          ▼
.NET native messaging host
  └─ invokes Windows UserConsentVerifier
          │
          ▼
Windows Hello → verified / not verified
```

Chrome and the native companion exchange one length-prefixed JSON message per authentication attempt. The extension only receives the result.

## Uninstall the companion

```powershell
.\scripts\uninstall-host.ps1
```

Then remove the extension from `chrome://extensions`.

## License

[MIT](LICENSE)
