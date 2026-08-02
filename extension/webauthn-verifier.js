const textDecoder = new TextDecoder("utf-8", { fatal: true });

export function encodeBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url value.");
  }

  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomChallenge() {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function parseClientData(encodedClientData, expected) {
  const clientDataBytes = decodeBase64Url(encodedClientData);
  let clientData;
  try {
    clientData = JSON.parse(textDecoder.decode(clientDataBytes));
  } catch {
    throw new Error("Windows Hello returned invalid client data.");
  }

  if (clientData.type !== expected.type) throw new Error("The Windows Hello ceremony type did not match.");
  if (clientData.challenge !== expected.challenge) throw new Error("The Windows Hello challenge did not match.");
  if (clientData.origin !== expected.origin) throw new Error("The Windows Hello origin did not match this extension.");
  if (clientData.crossOrigin === true || clientData.topOrigin !== undefined) {
    throw new Error("Cross-origin Windows Hello results are not accepted.");
  }

  return clientDataBytes;
}

function parseAuthenticatorData(encodedAuthenticatorData, expectedRpIdHash) {
  const authenticatorData = decodeBase64Url(encodedAuthenticatorData);
  if (authenticatorData.length < 37) throw new Error("Windows Hello returned incomplete authenticator data.");

  const rpIdHash = authenticatorData.slice(0, 32);
  if (expectedRpIdHash) {
    const expectedHash = decodeBase64Url(expectedRpIdHash);
    if (!constantTimeEqual(rpIdHash, expectedHash)) {
      throw new Error("The Windows Hello credential belongs to a different relying party.");
    }
  }

  const flags = authenticatorData[32];
  if ((flags & 0x01) === 0) throw new Error("Windows Hello did not confirm user presence.");
  if ((flags & 0x04) === 0) throw new Error("Windows Hello did not verify the current user.");

  const view = new DataView(authenticatorData.buffer, authenticatorData.byteOffset, authenticatorData.byteLength);
  return {
    bytes: authenticatorData,
    rpIdHash: encodeBase64Url(rpIdHash),
    signCount: view.getUint32(33, false),
  };
}

function algorithmParameters(coseAlgorithm) {
  if (coseAlgorithm === -7) {
    return {
      importAlgorithm: { name: "ECDSA", namedCurve: "P-256" },
      verifyAlgorithm: { name: "ECDSA", hash: "SHA-256" },
      ecdsa: true,
    };
  }
  if (coseAlgorithm === -257) {
    return {
      importAlgorithm: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      verifyAlgorithm: { name: "RSASSA-PKCS1-v1_5" },
      ecdsa: false,
    };
  }
  throw new Error("Windows Hello used an unsupported public-key algorithm.");
}

function derIntegerToFixed(bytes, size) {
  let offset = 0;
  while (offset < bytes.length - 1 && bytes[offset] === 0) offset += 1;
  const value = bytes.slice(offset);
  if (value.length > size) throw new Error("Windows Hello returned an invalid ECDSA signature.");
  const fixed = new Uint8Array(size);
  fixed.set(value, size - value.length);
  return fixed;
}

function derEcdsaToRaw(signature, size = 32) {
  if (signature.length === size * 2) return signature;
  if (signature.length < 8 || signature[0] !== 0x30) {
    throw new Error("Windows Hello returned an invalid ECDSA signature.");
  }

  let offset = 1;
  let sequenceLength = signature[offset++];
  if (sequenceLength & 0x80) {
    const lengthBytes = sequenceLength & 0x7f;
    if (lengthBytes < 1 || lengthBytes > 2 || offset + lengthBytes > signature.length) {
      throw new Error("Windows Hello returned an invalid ECDSA signature.");
    }
    sequenceLength = 0;
    for (let index = 0; index < lengthBytes; index += 1) sequenceLength = (sequenceLength << 8) | signature[offset++];
  }
  if (offset + sequenceLength !== signature.length || signature[offset++] !== 0x02) {
    throw new Error("Windows Hello returned an invalid ECDSA signature.");
  }

  const rLength = signature[offset++];
  if (!rLength || offset + rLength > signature.length) throw new Error("Windows Hello returned an invalid ECDSA signature.");
  const r = signature.slice(offset, offset + rLength);
  offset += rLength;
  if (signature[offset++] !== 0x02) throw new Error("Windows Hello returned an invalid ECDSA signature.");
  const sLength = signature[offset++];
  if (!sLength || offset + sLength !== signature.length) throw new Error("Windows Hello returned an invalid ECDSA signature.");
  const s = signature.slice(offset, offset + sLength);

  const raw = new Uint8Array(size * 2);
  raw.set(derIntegerToFixed(r, size), 0);
  raw.set(derIntegerToFixed(s, size), size);
  return raw;
}

function concatenate(left, right) {
  const output = new Uint8Array(left.length + right.length);
  output.set(left, 0);
  output.set(right, left.length);
  return output;
}

export async function validateRegistration(payload, expected) {
  if (!payload || typeof payload !== "object") throw new Error("Windows Hello did not return a registration result.");
  const credentialId = decodeBase64Url(payload.id);
  if (credentialId.length < 16 || credentialId.length > 1024) throw new Error("Windows Hello returned an invalid credential ID.");

  parseClientData(payload.clientDataJSON, {
    type: "webauthn.create",
    challenge: expected.challenge,
    origin: expected.origin,
  });
  const authenticator = parseAuthenticatorData(payload.authenticatorData);
  const parameters = algorithmParameters(payload.algorithm);
  const publicKeyBytes = decodeBase64Url(payload.publicKey);
  await crypto.subtle.importKey("spki", publicKeyBytes, parameters.importAlgorithm, false, ["verify"]);

  return {
    id: encodeBase64Url(credentialId),
    publicKey: encodeBase64Url(publicKeyBytes),
    algorithm: payload.algorithm,
    rpIdHash: authenticator.rpIdHash,
    signCount: authenticator.signCount,
    transports: (() => {
      const transports = Array.isArray(payload.transports)
        ? payload.transports.filter((transport) => ["internal", "hybrid", "usb", "ble", "nfc"].includes(transport))
        : [];
      return transports.length ? transports : ["internal"];
    })(),
    registeredAt: Date.now(),
  };
}

export async function validateAuthentication(payload, credentialState, expected) {
  if (!payload || typeof payload !== "object") throw new Error("Windows Hello did not return an authentication result.");
  const credentialId = decodeBase64Url(payload.id);
  if (!constantTimeEqual(credentialId, decodeBase64Url(credentialState.id))) {
    throw new Error("Windows Hello returned a different credential.");
  }

  const clientDataBytes = parseClientData(payload.clientDataJSON, {
    type: "webauthn.get",
    challenge: expected.challenge,
    origin: expected.origin,
  });
  const authenticator = parseAuthenticatorData(payload.authenticatorData, credentialState.rpIdHash);

  if (!credentialState.publicKey || !credentialState.algorithm) {
    return { signCount: authenticator.signCount, rpIdHash: authenticator.rpIdHash, legacy: true };
  }

  const parameters = algorithmParameters(credentialState.algorithm);
  const publicKey = await crypto.subtle.importKey(
    "spki",
    decodeBase64Url(credentialState.publicKey),
    parameters.importAlgorithm,
    false,
    ["verify"],
  );
  const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataBytes));
  const signedData = concatenate(authenticator.bytes, clientDataHash);
  let signature = decodeBase64Url(payload.signature);
  if (parameters.ecdsa) signature = derEcdsaToRaw(signature);

  const signatureValid = await crypto.subtle.verify(parameters.verifyAlgorithm, publicKey, signature, signedData);
  if (!signatureValid) throw new Error("The Windows Hello signature was invalid.");

  const previousCount = Number(credentialState.signCount) || 0;
  if (previousCount > 0 && authenticator.signCount > 0 && authenticator.signCount <= previousCount) {
    throw new Error("The Windows Hello signature counter did not advance.");
  }

  return { signCount: authenticator.signCount, rpIdHash: authenticator.rpIdHash, legacy: false };
}
