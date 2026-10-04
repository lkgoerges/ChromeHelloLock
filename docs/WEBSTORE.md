# Chrome Web Store preparation

Version 0.5.0 is a draft package, not a published release. No submission or publication is performed by the packaging script.

## Build and verify

Run `npm test`, `npm run validate`, and `npm run package` on Windows with Node.js. Upload `artifacts/chrome-hello-lock-0.5.0-webstore.zip`, not the repository or a ZIP containing a top-level extension folder. Packaging checks resource references, exact filename casing, JavaScript syntax, and minimum permissions, then reads back every archived file. Fixed timestamps and ordinal ordering make repeated builds from identical sources reproducible.

The upload manifest omits `key`: the developer console rejects that field. The source manifest keeps its development key unchanged. Every other archived file matches its source; the archived manifest matches the generated upload manifest. To validate an extracted upload archive, run `node scripts/validate-extension.js <extracted-directory> --webstore`.

## Establish the store identity

1. In the developer console, choose **New item** and upload the ZIP as a draft. Do not submit it for review yet.
2. Open **Package → View public key**. Copy the public key and the draft’s item ID.
3. Use the store public key as `key` in a separate unpacked test copy, with PEM markers and line breaks removed. Confirm that copy’s extension ID matches the item ID. Never include the key in a store upload: the packaging script strips it automatically.
4. Test the packaged files under that store identity in a separate Chrome profile. An extracted upload ZIP without a key does not reliably match the store ID when loaded unpacked; add the public key only to the local test copy. Changing the extension ID changes its WebAuthn origin, so enroll a new Windows Hello credential there. Existing development credentials and local restore data do not migrate to a different extension ID. Unlock and restore your current profile before changing its development key.

The current key is only the stable development identity. Do not present the initial package as the final store-identity build.

## Listing draft

**Name:** Chrome Hello Lock

**Summary:** A local privacy guard for your Chrome profile. Unlock with Windows Hello.

**Description:**

Add a local lock screen to your Chrome profile when sharing your PC. Unlock with Windows Hello using a fingerprint, face, or Windows PIN. No companion installer, extension account, or authentication server is required.

Lock from the toolbar or with a configurable keyboard shortcut. Enable locking on Chrome startup and an optional re-lock timer. Interrupted tab URLs are stored locally so they can be restored after verification, including after Chrome restarts.

Save unsaved work before locking: unlocking restores URLs, not form input or page state. Chrome Hello Lock discourages casual access; it is not a security boundary. Chrome’s extensions page remains available for recovery, and anyone using the same Windows account can disable the extension. Use a Windows lock or separate Windows accounts for stronger protection.

Requires a compatible Chrome version on Windows with Windows Hello configured. Tested platform: Windows 11. No biometric data, Windows PIN, or private credential key is received by the extension.

## Privacy and reviewer notes

Use the published [privacy notice](https://github.com/lkgoerges/ChromeHelloLock/blob/main/docs/PRIVACY.md) as the privacy-policy link, and the [issue tracker](https://github.com/lkgoerges/ChromeHelloLock/issues) for support. Check these links are accessible before submission.

Single purpose: provide a local profile privacy guard authenticated by Windows Hello. Permissions: Tabs redirects/restores interrupted URLs; Storage retains local settings, credential public data, and recovery targets; Alarms supports the optional re-lock timer. No host permissions, analytics, remote code, or data transmission by the extension. The developer-console privacy declarations should disclose local URL handling; do not claim the extension does not handle user data merely because it stays local. Review each declaration against the current [user-data guidance](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

Reviewer steps: install on Windows with Windows Hello configured, acknowledge the setup notice, enroll and test a credential, open an ordinary page, lock from the toolbar, and unlock through the Windows prompt. Also verify `chrome://extensions` remains accessible and that credential replacement is denied while locked. No test account is needed.

## Remaining release checks

- Rebuild and test with the final store identity.
- Test cancellation, retry, restart while locked, multiple windows, re-lock timing, recovery, and the keyboard shortcut on the exact packaged build.
- Test keyboard navigation, high zoom, and Windows high-contrast mode.
- Create current screenshots and store artwork. Complete developer-account details and console declarations yourself; confirm any legal agreements personally.
- Use trusted testers before a public v1 release. Version 0.5.0 passing automated tests is not evidence of a completed Web Store review.

Chrome’s official [packaging guide](https://developer.chrome.com/docs/webstore/prepare) and [manifest-key guide](https://developer.chrome.com/docs/extensions/reference/manifest/key) describe the upload and stable-ID workflow.
