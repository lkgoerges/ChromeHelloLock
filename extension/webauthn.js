const CREDENTIAL_KEY = "browserWebAuthnCredential";

function randomBytes(length = 32) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function browserWebAuthnAvailable() {
  return Boolean(window.PublicKeyCredential && navigator.credentials);
}

export async function hasBrowserCredential() {
  const stored = await chrome.storage.local.get(CREDENTIAL_KEY);
  return Boolean(stored[CREDENTIAL_KEY]?.id);
}

export async function verifyWithWindowsHello() {
  if (!browserWebAuthnAvailable()) {
    throw new Error("This Chrome version does not support Windows Hello from extension pages.");
  }

  const stored = await chrome.storage.local.get(CREDENTIAL_KEY);
  const credentialState = stored[CREDENTIAL_KEY];
  return credentialState?.id ? getAssertion(credentialState) : createCredential();
}

async function createCredential() {
  const userId = randomBytes();
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(),
      rp: {
        name: "Chrome Hello Lock",
      },
      user: {
        id: userId,
        name: "local-user",
        displayName: "Windows user",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "discouraged",
        userVerification: "required",
      },
      attestation: "none",
      timeout: 60_000,
    },
  });

  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("Chrome did not return a Windows Hello credential.");
  }

  await chrome.storage.local.set({
    [CREDENTIAL_KEY]: {
      id: encodeBase64Url(new Uint8Array(credential.rawId)),
    },
  });

  return { created: true };
}

async function getAssertion(credentialState) {
  let credentialId;
  try {
    credentialId = decodeBase64Url(credentialState.id);
  } catch {
    await chrome.storage.local.remove(CREDENTIAL_KEY);
    throw new Error("The saved Windows Hello credential was invalid. Try again to create a new one.");
  }

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(),
      allowCredentials: [
        {
          type: "public-key",
          id: credentialId,
          transports: ["internal"],
        },
      ],
      userVerification: "required",
      timeout: 60_000,
    },
  });

  if (!(assertion instanceof PublicKeyCredential)) {
    throw new Error("Windows Hello did not return a verification result.");
  }

  return { created: false };
}

export function windowsHelloError(error) {
  if (error?.name === "NotAllowedError") {
    return "Windows Hello was canceled, timed out, or could not use the selected authenticator.";
  }
  if (error?.name === "InvalidStateError") {
    return "Windows Hello already has a conflicting credential for this extension.";
  }
  return error?.message || "Windows Hello could not verify the current user.";
}
