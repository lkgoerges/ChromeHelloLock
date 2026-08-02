import { decodeBase64Url, encodeBase64Url } from "./webauthn-verifier.js";

function randomBytes(length = 32) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function browserWebAuthnAvailable() {
  return Boolean(window.PublicKeyCredential && navigator.credentials);
}

export async function getBrowserCredentialStatus() {
  const response = await chrome.runtime.sendMessage({ type: "credential-status" });
  if (!response?.ok) throw new Error(response?.message || "Credential status could not be read.");
  return response.credential;
}

function requireWebAuthn() {
  if (!browserWebAuthnAvailable()) {
    throw new Error("This Chrome version does not support Windows Hello from extension pages.");
  }
}

async function cancelCeremony() {
  try {
    await chrome.runtime.sendMessage({ type: "cancel-webauthn" });
  } catch {
    // The ceremony expires automatically if the page closes or the worker restarts.
  }
}

export async function enrollWithWindowsHello() {
  requireWebAuthn();
  const begin = await chrome.runtime.sendMessage({ type: "begin-registration" });
  if (!begin?.ok) throw new Error(begin?.message || "Windows Hello setup could not start.");

  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: decodeBase64Url(begin.challenge),
        rp: { name: "Chrome Hello Lock" },
        user: {
          id: randomBytes(),
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

    if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAttestationResponse)) {
      throw new Error("Chrome did not return a Windows Hello credential.");
    }

    const publicKey = credential.response.getPublicKey?.();
    const algorithm = credential.response.getPublicKeyAlgorithm?.();
    const authenticatorData = credential.response.getAuthenticatorData?.();
    if (!publicKey || !authenticatorData || ![-7, -257].includes(algorithm)) {
      throw new Error("This Chrome version cannot export the Windows Hello public key needed for secure verification.");
    }

    const finish = await chrome.runtime.sendMessage({
      type: "finish-registration",
      result: {
        id: encodeBase64Url(credential.rawId),
        publicKey: encodeBase64Url(publicKey),
        algorithm,
        transports: credential.response.getTransports?.() || ["internal"],
        clientDataJSON: encodeBase64Url(credential.response.clientDataJSON),
        authenticatorData: encodeBase64Url(authenticatorData),
      },
    });
    if (!finish?.ok) throw new Error(finish?.message || "Windows Hello setup could not be verified.");
    return finish.credential;
  } catch (error) {
    await cancelCeremony();
    throw error;
  }
}

export async function verifyWithWindowsHello() {
  requireWebAuthn();
  const begin = await chrome.runtime.sendMessage({ type: "begin-authentication" });
  if (!begin?.ok) throw new Error(begin?.message || "Windows Hello verification could not start.");

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: decodeBase64Url(begin.challenge),
        allowCredentials: [
          {
            type: "public-key",
            id: decodeBase64Url(begin.credential.id),
            transports: begin.credential.transports || ["internal"],
          },
        ],
        userVerification: "required",
        timeout: 60_000,
      },
    });

    if (!(assertion instanceof PublicKeyCredential) || !(assertion.response instanceof AuthenticatorAssertionResponse)) {
      throw new Error("Windows Hello did not return a verification result.");
    }

    const finish = await chrome.runtime.sendMessage({
      type: "finish-authentication",
      result: {
        id: encodeBase64Url(assertion.rawId),
        clientDataJSON: encodeBase64Url(assertion.response.clientDataJSON),
        authenticatorData: encodeBase64Url(assertion.response.authenticatorData),
        signature: encodeBase64Url(assertion.response.signature),
      },
    });
    if (!finish?.ok) throw new Error(finish?.message || "Windows Hello verification was rejected.");
    return finish;
  } catch (error) {
    await cancelCeremony();
    throw error;
  }
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
