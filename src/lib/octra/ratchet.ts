/**
 * Double Ratchet + X3DH — Forward Secrecy & Post-Compromise Security
 * ------------------------------------------------------------------
 * Implements Signal's Double Ratchet algorithm adapted for OctraChat:
 *
 *   - X3DH initial setup: derive root key from identity + ephemeral ECDH
 *   - Symmetric ratchet: chain key advances per message (forward secrecy)
 *   - DH ratchet: new Curve25519 keypair per round (post-compromise security)
 *   - Old keys securely wiped after use
 *
 * This means:
 *   ✓ Compromising a key today does NOT decrypt yesterday's messages
 *   ✓ Compromising a key today only exposes future messages until next ratchet
 *   ✓ Each message has a unique key that is deleted after use
 */

import nacl from "tweetnacl";
import {
  Bytes,
  bytesToB64,
  b64ToBytes,
  utf8ToBytes,
  bytesToUtf8,
  randomBytes,
  precomputeSharedKey,
  type Identity,
} from "./crypto";

// ─── KDF helpers ──────────────────────────────────────────

const KDF_RK_INFO = "OctraChat_RootKey";
const KDF_CK_INFO = "OctraChat_ChainKey";
const KDF_MK_INFO = "OctraChat_MessageKey";

async function hkdfExtract(salt: Bytes, ikm: Bytes): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, ikm);
  return new Uint8Array(sig);
}

async function hkdfExpand(prk: Bytes, info: string, length: number): Promise<Bytes> {
  const blocks: Bytes[] = [];
  let prev: Bytes = new Uint8Array(0);
  let t = new Uint8Array(0);
  while (t.length < length) {
    const input = new Uint8Array(prev.length + info.length);
    input.set(prev, 0);
    input.set(utf8ToBytes(info), prev.length);
    const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    prev = new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
    blocks.push(prev);
    t = new Uint8Array(blocks.reduce((sum, b) => sum + b.length, 0));
    const merged = new Uint8Array(t.length);
    let off = 0;
    for (const b of blocks) { merged.set(b, off); off += b.length; }
    t = merged;
  }
  return t.slice(0, length);
}

async function hkdf(ikm: Bytes, salt: Bytes, info: string, length: number): Promise<Bytes> {
  const prk = await hkdfExtract(salt, ikm);
  return hkdfExpand(prk, info, length);
}

async function hmacSha256(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

// ─── Secure wipe ──────────────────────────────────────────

function secureWipe(b: Bytes): void {
  if (!b) return;
  for (let i = 0; i < b.length; i++) b[i] = 0;
}

// ─── Ratchet state ────────────────────────────────────────

export interface RatchetState {
  rootKey: Bytes;           // 32 bytes — ratchets with DH exchanges
  sendChainKey: Bytes;      // 32 bytes — current send chain
  recvChainKey: Bytes | null; // 32 bytes — current receive chain
  ourDhPub: Bytes;          // 32 bytes — our current DH ratchet public
  ourDhSec: Bytes;          // 32 bytes — our current DH ratchet secret
  theirDhPub: Bytes | null; // 32 bytes — their current DH ratchet public
  sendN: number;            // messages sent in current chain
  recvN: number;            // messages received in current chain
  previousSendChains: PreviousChain[];
  createdAt: number;
}

interface PreviousChain {
  counter: number;
  chainKey: Bytes;
}

// ─── X3DH initial setup ───────────────────────────────────

/**
 * X3DH-style session initialization.
 * Alice (initiator) calls this with her identity + ephemeral + Bob's keys.
 * Returns the initial ratchet state with the first DH ratchet step performed.
 */
export async function x3dhInitiate(
  myIdentity: Identity,
  theirIdentityPub: Bytes, // their Curve25519 identity public
  theirSignedPreKey: Bytes // their Curve25519 signed prekey (or same as identity for simplified)
): Promise<{
  state: RatchetState;
  ephemeralPub: Bytes;      // send this to Bob so he can initialize
}> {
  // Generate ephemeral keypair
  const eph = nacl.box.keyPair();

  // DH1 = ECDH(IK_A, SPK_B)
  const dh1 = precomputeSharedKey(myIdentity.curveSecretKey, theirSignedPreKey);
  // DH2 = ECDH(EK_A, IK_B)
  const dh2 = precomputeSharedKey(eph.secretKey, theirIdentityPub);
  // DH3 = ECDH(EK_A, SPK_B)
  const dh3 = precomputeSharedKey(eph.secretKey, theirSignedPreKey);

  // Combine DH outputs
  const combined = new Uint8Array(dh1.length + dh2.length + dh3.length);
  combined.set(dh1, 0);
  combined.set(dh2, dh1.length);
  combined.set(dh3, dh1.length + dh2.length);

  // Derive initial root key via HKDF
  const salt = new Uint8Array(32); // zero salt
  const initialRootKey = await hkdf(combined, salt, KDF_RK_INFO, 32);

  // Secure wipe DH outputs
  secureWipe(dh1); secureWipe(dh2); secureWipe(dh3); secureWipe(combined);

  // ─── First DH ratchet step ───
  // Alice generates her first DH ratchet keypair and derives send chain
  const dhRatchet = nacl.box.keyPair();
  const dhOutput = precomputeSharedKey(dhRatchet.secretKey, theirSignedPreKey);
  const derived = await hkdf(dhOutput, initialRootKey, KDF_RK_INFO, 64);
  const rootKey = derived.slice(0, 32);
  const sendChainKey = derived.slice(32, 64);
  secureWipe(dhOutput); secureWipe(derived); secureWipe(initialRootKey);

  const state: RatchetState = {
    rootKey,
    sendChainKey,
    recvChainKey: null, // will be set when Bob sends a reply (with his DH key)
    ourDhPub: dhRatchet.publicKey,
    ourDhSec: dhRatchet.secretKey,
    theirDhPub: theirSignedPreKey,
    sendN: 0,
    recvN: 0,
    previousSendChains: [],
    createdAt: Date.now(),
  };

  return { state, ephemeralPub: eph.publicKey };
}

/**
 * X3DH session acceptance (Bob's side).
 * Bob receives Alice's ephemeral pub + identity pub.
 * Bob does NOT derive a send chain yet — he waits for Alice's first message
 * (which contains her DH ratchet pub) before he can send.
 */
export async function x3dhAccept(
  myIdentity: Identity,
  theirIdentityPub: Bytes,
  theirEphemeralPub: Bytes,
  mySignedPreKeySec: Bytes // Bob's signed prekey secret (or identity curve secret for simplified)
): Promise<RatchetState> {
  // DH1 = ECDH(SPK_B, IK_A) = ECDH(mySignedPreKeySec, theirIdentityPub)
  const dh1 = precomputeSharedKey(mySignedPreKeySec, theirIdentityPub);
  // DH2 = ECDH(IK_B, EK_A) = ECDH(myIdentity.curveSec, theirEphemeralPub)
  const dh2 = precomputeSharedKey(myIdentity.curveSecretKey, theirEphemeralPub);
  // DH3 = ECDH(SPK_B, EK_A) = ECDH(mySignedPreKeySec, theirEphemeralPub)
  const dh3 = precomputeSharedKey(mySignedPreKeySec, theirEphemeralPub);

  const combined = new Uint8Array(dh1.length + dh2.length + dh3.length);
  combined.set(dh1, 0);
  combined.set(dh2, dh1.length);
  combined.set(dh3, dh1.length + dh2.length);

  const salt = new Uint8Array(32);
  const rootKey = await hkdf(combined, salt, KDF_RK_INFO, 32);

  secureWipe(dh1); secureWipe(dh2); secureWipe(dh3); secureWipe(combined);

  // Bob does NOT generate a DH ratchet key yet.
  // His send chain is null until he receives Alice's first message
  // (which triggers a DH ratchet step, giving him a recv chain).
  // He can then generate his own DH key for sending.
  const state: RatchetState = {
    rootKey,
    sendChainKey: new Uint8Array(32), // placeholder — will be replaced on first send via DH ratchet
    recvChainKey: null,
    ourDhPub: myIdentity.curvePublicKey,
    ourDhSec: myIdentity.curveSecretKey,
    theirDhPub: null, // will be set when Alice's first message arrives
    sendN: 0,
    recvN: 0,
    previousSendChains: [],
    createdAt: Date.now(),
  };

  return state;
}

// ─── Ratchet operations ───────────────────────────────────

/**
 * Encrypt a message using the Double Ratchet.
 * Returns the encrypted payload + header (for sending).
 */
export async function ratchetEncrypt(
  state: RatchetState,
  plaintext: string
): Promise<{
  ciphertext: Bytes;
  header: RatchetHeader;
}> {
  // Derive message key from send chain
  const messageKey = await hmacSha256(state.sendChainKey, utf8ToBytes("mk_" + state.sendN));
  // Advance send chain
  const newChainKey = await hmacSha256(state.sendChainKey, utf8ToBytes("advance"));
  secureWipe(state.sendChainKey);
  state.sendChainKey = newChainKey;

  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(utf8ToBytes(plaintext), nonce, messageKey);

  const header: RatchetHeader = {
    dh: state.ourDhPub,
    prevN: state.previousSendChains.length > 0 ? state.previousSendChains[state.previousSendChains.length - 1].counter : 0,
    n: state.sendN,
  };

  state.sendN++;

  // Secure wipe message key (forward secrecy)
  secureWipe(messageKey);

  return {
    ciphertext: new Uint8Array([...nonce, ...box]),
    header,
  };
}

/**
 * Decrypt a message using the Double Ratchet.
 * Performs DH ratchet if the header contains a new DH key.
 */
export async function ratchetDecrypt(
  state: RatchetState,
  header: RatchetHeader,
  ciphertext: Bytes
): Promise<string | null> {
  // Check if this is a new DH ratchet key
  if (!state.theirDhPub || !bytesEqual(header.dh, state.theirDhPub)) {
    // DH ratchet step
    await dhRatchetStep(state, header.dh);
  }

  // Check if we need to catch up on missed messages
  if (header.n < state.recvN) {
    // Message from a previous chain — try to find it
    // (simplified: reject late messages)
    return null;
  }

  // Skip missed messages (advance recv chain)
  while (state.recvN < header.n) {
    const skippedKey = await hmacSha256(state.recvChainKey!, utf8ToBytes("mk_" + state.recvN));
    state.previousSendChains.push({ counter: state.recvN, chainKey: skippedKey });
    const newChain = await hmacSha256(state.recvChainKey!, utf8ToBytes("advance"));
    secureWipe(state.recvChainKey!);
    state.recvChainKey = newChain;
    state.recvN++;
  }

  // Derive message key
  const messageKey = await hmacSha256(state.recvChainKey!, utf8ToBytes("mk_" + state.recvN));
  const newChainKey = await hmacSha256(state.recvChainKey!, utf8ToBytes("advance"));
  if (state.recvChainKey) secureWipe(state.recvChainKey);
  state.recvChainKey = newChainKey;
  state.recvN++;

  // Extract nonce + box from ciphertext
  const nonce = ciphertext.slice(0, nacl.secretbox.nonceLength);
  const box = ciphertext.slice(nacl.secretbox.nonceLength);

  const opened = nacl.secretbox.open(box, nonce, messageKey);
  secureWipe(messageKey);

  if (!opened) return null;
  return bytesToUtf8(opened);
}

/**
 * DH ratchet step — generate new keypair, derive new root + chain keys.
 * This provides post-compromise security: even if old keys leak,
 * the new DH exchange heals the session.
 */
async function dhRatchetStep(state: RatchetState, theirNewDhPub: Bytes): Promise<void> {
  // Save current send chain as previous
  if (state.sendN > 0) {
    state.previousSendChains.push({ counter: state.sendN, chainKey: state.sendChainKey });
  }

  // DH with their new key (RECV step)
  const dhRecv = precomputeSharedKey(state.ourDhSec, theirNewDhPub);
  const recvDerived = await hkdf(dhRecv, state.rootKey, KDF_RK_INFO, 64);
  state.rootKey = recvDerived.slice(0, 32);
  state.recvChainKey = recvDerived.slice(32, 64);
  secureWipe(dhRecv); secureWipe(recvDerived);

  state.theirDhPub = theirNewDhPub;
  state.recvN = 0;

  // Generate new DH ratchet keypair
  const newDh = nacl.box.keyPair();
  secureWipe(state.ourDhSec);
  state.ourDhSec = newDh.secretKey;
  state.ourDhPub = newDh.publicKey;

  // DH with their key using our new key (SEND step)
  const dhSend = precomputeSharedKey(state.ourDhSec, state.theirDhPub);
  const sendDerived = await hkdf(dhSend, state.rootKey, KDF_RK_INFO, 64);
  state.rootKey = sendDerived.slice(0, 32);
  state.sendChainKey = sendDerived.slice(32, 64);
  secureWipe(dhSend); secureWipe(sendDerived);

  state.sendN = 0;
}

export interface RatchetHeader {
  dh: Bytes;       // sender's current DH ratchet public key
  prevN: number;   // length of previous chain
  n: number;       // message number in current chain
}

// ─── Serialization ────────────────────────────────────────

export function serializeRatchetState(state: RatchetState): string {
  return JSON.stringify({
    rootKey: bytesToB64(state.rootKey),
    sendChainKey: bytesToB64(state.sendChainKey),
    recvChainKey: state.recvChainKey ? bytesToB64(state.recvChainKey) : null,
    ourDhPub: bytesToB64(state.ourDhPub),
    ourDhSec: bytesToB64(state.ourDhSec),
    theirDhPub: state.theirDhPub ? bytesToB64(state.theirDhPub) : null,
    sendN: state.sendN,
    recvN: state.recvN,
    previousSendChains: state.previousSendChains.map((c) => ({
      counter: c.counter,
      chainKey: bytesToB64(c.chainKey),
    })),
    createdAt: state.createdAt,
  });
}

export function deserializeRatchetState(json: string): RatchetState {
  const o = JSON.parse(json);
  return {
    rootKey: b64ToBytes(o.rootKey),
    sendChainKey: b64ToBytes(o.sendChainKey),
    recvChainKey: o.recvChainKey ? b64ToBytes(o.recvChainKey) : null,
    ourDhPub: b64ToBytes(o.ourDhPub),
    ourDhSec: b64ToBytes(o.ourDhSec),
    theirDhPub: o.theirDhPub ? b64ToBytes(o.theirDhPub) : null,
    sendN: o.sendN,
    recvN: o.recvN,
    previousSendChains: o.previousSendChains.map((c: any) => ({
      counter: c.counter,
      chainKey: b64ToBytes(c.chainKey),
    })),
    createdAt: o.createdAt,
  };
}

// ─── Helpers ──────────────────────────────────────────────

function bytesEqual(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Securely wipe all keys in a ratchet state.
 * Call this when the session ends or is replaced.
 */
export function destroyRatchetState(state: RatchetState): void {
  secureWipe(state.rootKey);
  secureWipe(state.sendChainKey);
  if (state.recvChainKey) secureWipe(state.recvChainKey);
  secureWipe(state.ourDhSec);
  for (const c of state.previousSendChains) {
    secureWipe(c.chainKey);
  }
  state.previousSendChains = [];
}
