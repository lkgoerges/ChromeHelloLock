# Chrome Hello Lock privacy notice

Effective date: October 4, 2026. Applies to version 0.5.0.

## Purpose and limits

Chrome Hello Lock is a local privacy guard for a Chrome profile. It discourages casual access while sharing a PC. It is not encryption, a Windows account lock, or a hardened security boundary. Anyone using the same Windows account can disable or remove it. Chrome’s extensions page deliberately remains accessible for recovery.

Locking redirects interrupted tabs to the extension’s lock screen. Unlock restores URLs, not unsaved form input or other page state. Save work before locking. Existing background tabs may continue running, and browser history, bookmarks, downloads, other profiles, and other browsers are not protected by this extension.

## Data stored on your device

The extension uses Chrome’s local extension storage for settings, setup and notice acknowledgement, the enrolled credential’s identifier and public verification data, registration and verification timestamps, lock state, and interrupted tab URLs with save timestamps. URLs can contain sensitive information, including search terms or tokens.

Interrupted URLs remain across Chrome restarts and extension updates until the restoration pass finishes. Closed interrupted tabs can leave an unused restore target until that pass. If restoration fails, a tab may fall back to a new tab. The extension does not save a separate copy of page contents or form input.

Pending authentication challenges, tab-to-restore-target bindings, and protection-failure tab IDs use Chrome session storage and do not survive a full browser restart. Settings and interrupted URLs do not use Chrome sync storage.

## Windows Hello authentication

Chrome invokes Windows Hello using WebAuthn. Chrome Hello Lock receives credential identifiers, public verification data, and authentication assertions. It does not receive fingerprint or face data, your Windows PIN or password, or the private credential key. Authentication is verified locally; no native companion or remote authentication server is involved.

## Sharing and network access

The extension does not transmit stored URLs, authentication data, or settings to its developer or any server. It includes no analytics, advertising, telemetry, or remote executable code. Links to GitHub open only when you choose them; GitHub then handles that visit under its own policies. Restoring a tab loads its original website normally, and that website handles its own requests and data.

## Permissions

- **Tabs:** inspect tab URLs to redirect interrupted pages and restore them after unlock. This does not read page contents.
- **Storage:** retain settings, public verification data, lock state, and interrupted URLs locally; retain pending requests and bindings for the session.
- **Alarms:** run the optional re-lock timer.

The extension does not request website host permissions.

## Removal and recovery

Disable or remove Chrome Hello Lock at `chrome://extensions`. Disabling stops the guard but does not erase its saved local data. Removing the extension removes its Chrome extension storage. A Windows Hello passkey may remain and can be managed separately in Windows Settings. Disablement does not automatically restore interrupted pages; Back or browser history may help.

## Support and changes

Report issues through the [project issue tracker](https://github.com/lkgoerges/ChromeHelloLock/issues). Do not include private URLs, authentication payloads, or other sensitive information in a public issue. Material changes to local data handling will be reflected in this notice and the extension’s setup copy.
