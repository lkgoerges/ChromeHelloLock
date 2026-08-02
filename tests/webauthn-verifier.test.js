import assert from "node:assert/strict";
import { test } from "node:test";

import {
  encodeBase64Url,
  validateAuthentication,
  validateRegistration,
} from "../extension/webauthn-verifier.js";

const encoder = new TextEncoder();
const origin = "chrome-extension://bodeojcofhnjbhebeapdokhabmimcjmm";

function clientData(type, challenge, override = {}) {
  return encodeBase64Url(encoder.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false, ...override })));
}

function authenticatorData({ flags = 0x05, count = 1 } = {}) {
  const bytes = new Uint8Array(37);
  crypto.getRandomValues(bytes.subarray(0, 32));
  bytes[32] = flags;
  new DataView(bytes.buffer).setUint32(33, count, false);
  return bytes;
}

function trimInteger(bytes) {
  let offset = 0;
  while (offset < bytes.length - 1 && bytes[offset] === 0) offset += 1;
  let value = bytes.slice(offset);
  if (value[0] & 0x80) value = Uint8Array.from([0, ...value]);
  return value;
}

function rawEcdsaToDer(raw) {
  const r = trimInteger(raw.slice(0, raw.length / 2));
  const s = trimInteger(raw.slice(raw.length / 2));
  const length = 2 + r.length + 2 + s.length;
  return Uint8Array.from([0x30, length, 0x02, r.length, ...r, 0x02, s.length, ...s]);
}

async function fixture() {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  const credentialId = crypto.getRandomValues(new Uint8Array(32));
  const registrationChallenge = "registration-challenge";
  const registrationAuthData = authenticatorData({ count: 0 });
  const credential = await validateRegistration(
    {
      id: encodeBase64Url(credentialId),
      publicKey: encodeBase64Url(publicKey),
      algorithm: -7,
      transports: ["internal", "invalid-transport"],
      clientDataJSON: clientData("webauthn.create", registrationChallenge),
      authenticatorData: encodeBase64Url(registrationAuthData),
    },
    { challenge: registrationChallenge, origin },
  );

  const authenticationChallenge = "authentication-challenge";
  const authenticationClientData = encoder.encode(JSON.stringify({
    type: "webauthn.get",
    challenge: authenticationChallenge,
    origin,
    crossOrigin: false,
  }));
  const authenticationAuthData = registrationAuthData.slice();
  new DataView(authenticationAuthData.buffer).setUint32(33, 1, false);
  const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", authenticationClientData));
  const signedData = new Uint8Array(authenticationAuthData.length + clientHash.length);
  signedData.set(authenticationAuthData);
  signedData.set(clientHash, authenticationAuthData.length);
  const rawSignature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, signedData));

  return {
    credential,
    expected: { challenge: authenticationChallenge, origin },
    payload: {
      id: encodeBase64Url(credentialId),
      clientDataJSON: encodeBase64Url(authenticationClientData),
      authenticatorData: encodeBase64Url(authenticationAuthData),
      signature: encodeBase64Url(rawEcdsaToDer(rawSignature)),
    },
  };
}

test("validates a challenge-bound, user-verified ECDSA assertion", async () => {
  const { credential, expected, payload } = await fixture();
  assert.deepEqual(credential.transports, ["internal"]);
  const result = await validateAuthentication(payload, credential, expected);
  assert.equal(result.legacy, false);
  assert.equal(result.signCount, 1);
});

test("rejects an assertion for a different challenge", async () => {
  const { credential, expected, payload } = await fixture();
  await assert.rejects(
    validateAuthentication(payload, credential, { ...expected, challenge: "different" }),
    /challenge did not match/,
  );
});

test("rejects an assertion without the user-verification flag", async () => {
  const { credential, expected, payload } = await fixture();
  const bytes = Uint8Array.from(Buffer.from(payload.authenticatorData.replaceAll("-", "+").replaceAll("_", "/"), "base64"));
  bytes[32] = 0x01;
  await assert.rejects(
    validateAuthentication({ ...payload, authenticatorData: encodeBase64Url(bytes) }, credential, expected),
    /did not verify/,
  );
});

test("rejects a tampered assertion signature", async () => {
  const { credential, expected, payload } = await fixture();
  const signature = Uint8Array.from(Buffer.from(payload.signature.replaceAll("-", "+").replaceAll("_", "/"), "base64"));
  signature[signature.length - 1] ^= 0x01;
  await assert.rejects(
    validateAuthentication({ ...payload, signature: encodeBase64Url(signature) }, credential, expected),
    /signature was invalid/,
  );
});

test("validates a challenge-bound RS256 assertion", async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: Uint8Array.from([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  const id = crypto.getRandomValues(new Uint8Array(32));
  const registrationAuthData = authenticatorData({ count: 0 });
  const registrationChallenge = "rsa-registration";
  const credential = await validateRegistration(
    {
      id: encodeBase64Url(id),
      publicKey: encodeBase64Url(publicKey),
      algorithm: -257,
      transports: [],
      clientDataJSON: clientData("webauthn.create", registrationChallenge),
      authenticatorData: encodeBase64Url(registrationAuthData),
    },
    { challenge: registrationChallenge, origin },
  );

  const challenge = "rsa-authentication";
  const authenticationClientData = encoder.encode(JSON.stringify({ type: "webauthn.get", challenge, origin }));
  const authenticationAuthData = registrationAuthData.slice();
  const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", authenticationClientData));
  const signedData = new Uint8Array(authenticationAuthData.length + clientHash.length);
  signedData.set(authenticationAuthData);
  signedData.set(clientHash, authenticationAuthData.length);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, signedData);

  const result = await validateAuthentication(
    {
      id: encodeBase64Url(id),
      clientDataJSON: encodeBase64Url(authenticationClientData),
      authenticatorData: encodeBase64Url(authenticationAuthData),
      signature: encodeBase64Url(signature),
    },
    credential,
    { challenge, origin },
  );
  assert.equal(result.legacy, false);
  assert.deepEqual(credential.transports, ["internal"]);
});
