/**
 * Stealth Addressing for OctraChat DMs
 * ------------------------------------------------------------------
 * Mirrors Octra's stealth-transaction flow but applied to messages.
 *
 * Sender flow (sending an anonymous DM):
 *   1. Generate ephemeral Curve25519 keypair (ephSec, ephPub)
 *   2. shared = ECDH(ephSec, receiverCurvePub)
 *   3. viewTag = HMAC-SHA256(receiverCurvePub || ephPub)[0:2]
 *   4. ciphertext = secretbox(message, nonce, shared)
 *   5. Publish { ephPub, viewTag, nonce, ciphertext } to stealth pool
 *
 * Receiver flow (scanning for messages intended for them):
 *   1. For each output: compute expected viewTag =
 *      HMAC-SHA256(myCurvePub || ephPub)[0:2]
 *   2. Skip if mismatch (massively cuts decrypt attempts)
 *   3. shared = ECDH(myCurveSec, ephPub)
 *   4. plaintext = secretbox.open(ciphertext, nonce, shared)
 *      -- if MAC valid, message was for us.
 *
 * This is exactly the CryptoNote / Monero one-time address pattern.
 */

import nacl from "tweetnacl";
import {
  Bytes,
  b64ToBytes,
  bytesToB64,
  utf8ToBytes,
  bytesToUtf8,
  randomBytes,
  sha256Async,
  precomputeSharedKey,
  encodeCurvePub,
} from "./crypto";

export interface StealthOutput {
  /** Ephemeral Curve25519 public key (base64, 32 bytes) */
  ephPub: string;
  /** 2-byte view tag (base64) for fast filtering */
  tag: string;
  /** 24-byte nonce (base64) */
  nonce: string;
  /** Ciphertext (base64) */
  ct: string;
  /** Optional sender identity (Octra address) — empty for fully anonymous */
  from?: string;
  /** Optional circle hint */
  hint?: string;
  /** Unix ms timestamp */
  ts: number;
}

export interface SealedStealthMessage {
  text: string;
  from: string;
  ts: number;
}

async function computeViewTag(
  receiverCurvePub: Bytes,
  ephPub: Bytes
): Promise<Bytes> {
  const combined = new Uint8Array(receiverCurvePub.length + ephPub.length);
  combined.set(receiverCurvePub, 0);
  combined.set(ephPub, receiverCurvePub.length);
  const h = await sha256Async(combined);
  return h.slice(0, 2);
}

export async function sealStealthMessage(
  plaintext: string,
  receiverCurvePub: Bytes,
  fromAddress?: string
): Promise<StealthOutput> {
  const eph = nacl.box.keyPair();
  const shared = precomputeSharedKey(eph.secretKey, receiverCurvePub);
  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const msg = utf8ToBytes(
    JSON.stringify({
      text: plaintext,
      from: fromAddress ?? "",
      ts: Date.now(),
    } satisfies SealedStealthMessage)
  );
  const ct = nacl.secretbox(msg, nonce, shared);
  const tag = await computeViewTag(receiverCurvePub, eph.publicKey);
  return {
    ephPub: bytesToB64(eph.publicKey),
    tag: bytesToB64(tag),
    nonce: bytesToB64(nonce),
    ct: bytesToB64(ct),
    from: fromAddress,
    ts: Date.now(),
  };
}

export async function tryOpenStealthOutput(
  output: StealthOutput,
  myCurveSec: Bytes,
  myCurvePub: Bytes
): Promise<SealedStealthMessage | null> {
  try {
    const ephPub = b64ToBytes(output.ephPub);
    // View-tag fast filter
    const expectedTag = await computeViewTag(myCurvePub, ephPub);
    const actualTag = b64ToBytes(output.tag);
    if (expectedTag.length !== actualTag.length) return null;
    let tagMatch = true;
    for (let i = 0; i < expectedTag.length; i++) {
      if (expectedTag[i] !== actualTag[i]) {
        tagMatch = false;
        break;
      }
    }
    if (!tagMatch) return null;

    const shared = precomputeSharedKey(myCurveSec, ephPub);
    const nonce = b64ToBytes(output.nonce);
    const ct = b64ToBytes(output.ct);
    const opened = nacl.secretbox.open(ct, nonce, shared);
    if (!opened) return null;
    const payload = JSON.parse(bytesToUtf8(opened)) as SealedStealthMessage;
    return payload;
  } catch {
    return null;
  }
}

function hexFromBytes(b: Bytes): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function stealthCircleId(
  receiverCurvePub: Bytes,
  ephPub: Bytes
): Promise<string> {
  const combined = new Uint8Array(receiverCurvePub.length + ephPub.length);
  combined.set(receiverCurvePub, 0);
  combined.set(ephPub, receiverCurvePub.length);
  const h = await sha256Async(combined);
  return "stealth_" + hexFromBytes(h).slice(0, 16);
}

export { encodeCurvePub };
