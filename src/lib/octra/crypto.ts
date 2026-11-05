/**
 * OctraChat Crypto Core
 * ------------------------------------------------------------------
 * Implements the same cryptographic primitives used by Octra network
 * (https://github.com/octra-labs/webcli/blob/main/crypto_utils.hpp):
 *
 *   - Ed25519 signing keypairs (TweetNaCl)
 *   - Octra address format: "oct" + base58(sha256(pubkey)).padStart(44,"1")
 *   - Ed25519 secret -> Curve25519 secret conversion (libsodium-compatible)
 *   - Curve25519 ECDH shared-secret derivation
 *   - XSalsa20-Poly1305 (crypto_box / crypto_secretbox) for E2E messages
 *   - Ed25519 sign / verify for circle membership proofs
 *   - AES-256-GCM via Web Crypto for wallet-at-rest PIN encryption
 *   - PBKDF2-HMAC-SHA256 for PIN -> AES key (300_000 iters)
 *   - BIP-39 mnemonic generation and validation
 *
 * Everything here is deterministic and lives entirely client-side.
 * No private material ever leaves the browser.
 */

import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";
import * as bs58 from "bs58";
import * as bip39 from "bip39";

/** Bytes / Base64 / Hex helpers ------------------------------------------- */

export type Bytes = Uint8Array;

export function bytesToHex(b: Bytes): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Bytes {
  if (hex.length % 2 !== 0) throw new Error("invalid hex length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToB64(b: Bytes): string {
  return encodeBase64(b);
}

export function b64ToBytes(s: string): Bytes {
  return decodeBase64(s);
}

export function utf8ToBytes(s: string): Bytes {
  return new TextEncoder().encode(s);
}

export function bytesToUtf8(b: Bytes): string {
  return new TextDecoder().decode(b);
}

export function randomBytes(n: number): Bytes {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export async function sha256Async(data: Bytes | string): Promise<Bytes> {
  const bytes = typeof data === "string" ? utf8ToBytes(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

export async function sha512Async(data: Bytes | string): Promise<Bytes> {
  const bytes = typeof data === "string" ? utf8ToBytes(data) : data;
  const digest = await crypto.subtle.digest("SHA-512", bytes);
  return new Uint8Array(digest);
}

/** Base58 (matches Octra webcli) ----------------------------------------- */

export function base58Encode(b: Bytes): string {
  return bs58.default.encode(b);
}

export function base58Decode(s: string): Bytes {
  return bs58.default.decode(s);
}

/** Octra address ---------------------------------------------------------
 *  oct + base58(sha256(ed25519_pubkey)).padStart(44, "1")   -> 47 chars
 */

const ADDRESS_PREFIX = "oct";
const ADDRESS_PAYLOAD_LEN = 44;

export async function addressFromPubkey(pubkey: Bytes): Promise<string> {
  const h = await sha256Async(pubkey);
  const b58 = base58Encode(h);
  const padded = b58.padStart(ADDRESS_PAYLOAD_LEN, "1");
  return ADDRESS_PREFIX + padded.slice(0, ADDRESS_PAYLOAD_LEN);
}

export function isValidOctraAddress(addr: string): boolean {
  if (!addr) return false;
  if (!addr.startsWith(ADDRESS_PREFIX)) return false;
  const payload = addr.slice(ADDRESS_PREFIX.length);
  if (payload.length !== ADDRESS_PAYLOAD_LEN) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(payload);
}

/** Mnemonic / keypair ----------------------------------------------------
 *  BIP-39 mnemonic → 64-byte master_seed (PBKDF2-HMAC-SHA512, 2048 iters)
 *  → Octra custom HD derivation:
 *      hd_version 2, index 0: ed_seed = HMAC-SHA512("Octra seed", master_seed)[0:32]
 *      hd_version 2, index N>0: ed_seed = HMAC-SHA512("Octra seed", master_seed || N_le32)[0:32]
 *      hd_version 1, index 0: ed_seed = master_seed[0:32]
 *  This matches the Octra webcli wallet.hpp `derive_hd_seed` exactly.
 */

const OCTRA_HD_KEY = "Octra seed";
const DEFAULT_HD_VERSION = 2;
const DEFAULT_HD_INDEX = 0;

export interface EdKeyPair {
  seed: Bytes;
  secretKey: Bytes;
  publicKey: Bytes;
}

export function generateMnemonic(strength: 128 | 256 = 256): string {
  // Octra webcli uses 12-word mnemonics (strength 128). We default to 24-word
  // (strength 256) for better security; both are valid per BIP-39.
  return bip39.generateMnemonic(strength);
}

export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic.trim());
}

/** Octra HD derivation — faithful port of `derive_hd_seed` from crypto_utils.hpp */
export async function deriveHdSeed(
  masterSeed: Bytes,
  index: number = DEFAULT_HD_INDEX,
  hdVersion: 1 | 2 = DEFAULT_HD_VERSION
): Promise<Bytes> {
  const keyBytes = utf8ToBytes(OCTRA_HD_KEY);

  if (hdVersion === 1 && index === 0) {
    return masterSeed.slice(0, 32);
  }
  if (hdVersion === 2 && index === 0) {
    const mac = await hmacSha512(keyBytes, masterSeed);
    return mac.slice(0, 32);
  }
  // For any other index (or v1 idx>0, v2 idx>0): data = master_seed(64) || index_le32(4)
  const data = new Uint8Array(68);
  data.set(masterSeed, 0);
  data[64] = index & 0xff;
  data[65] = (index >> 8) & 0xff;
  data[66] = (index >> 16) & 0xff;
  data[67] = (index >> 24) & 0xff;
  const mac = await hmacSha512(keyBytes, data);
  return mac.slice(0, 32);
}

/** HMAC-SHA512 via Web Crypto */
export async function hmacSha512(key: Bytes, data: Bytes): Promise<Bytes> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data);
  return new Uint8Array(sig);
}

export async function mnemonicToSeed(mnemonic: string): Promise<Bytes> {
  // bip39.mnemonicToSeed uses PBKDF2-HMAC-SHA512, 2048 iters, salt "mnemonic" —
  // identical to Octra's `mnemonic_to_seed`.
  const seed = await bip39.mnemonicToSeed(mnemonic.trim());
  return new Uint8Array(seed);
}

export async function deriveEdKeyPairFromMnemonic(
  mnemonic: string,
  hdIndex: number = DEFAULT_HD_INDEX,
  hdVersion: 1 | 2 = DEFAULT_HD_VERSION
): Promise<EdKeyPair> {
  const masterSeed = await mnemonicToSeed(mnemonic);
  const edSeed = await deriveHdSeed(masterSeed, hdIndex, hdVersion);
  const kp = nacl.sign.keyPair.fromSeed(edSeed);
  return { seed: edSeed, secretKey: kp.secretKey, publicKey: kp.publicKey };
}

export function edKeypairFromSeed(seed: Bytes): EdKeyPair {
  const kp = nacl.sign.keyPair.fromSeed(seed);
  return { seed, secretKey: kp.secretKey, publicKey: kp.publicKey };
}

/** Import wallet directly from a base64-encoded 32-byte Ed25519 seed
 *  (the `priv_b64` field in Octra's wallet.json / .oct file).
 */
export function edKeypairFromPrivKeyB64(privB64: string): EdKeyPair {
  const seed = b64ToBytes(privB64.trim());
  if (seed.length !== 32 && seed.length !== 64) {
    throw new Error("Invalid private key length (expected 32 or 64 bytes)");
  }
  // If 64 bytes, the first 32 are the seed; verify the pubkey suffix matches.
  const actualSeed = seed.length === 64 ? seed.slice(0, 32) : seed;
  const kp = nacl.sign.keyPair.fromSeed(actualSeed);
  if (seed.length === 64) {
    const providedPub = seed.slice(32);
    for (let i = 0; i < 32; i++) {
      if (providedPub[i] !== kp.publicKey[i]) {
        throw new Error("Private key public suffix mismatch");
      }
    }
  }
  return { seed: actualSeed, secretKey: kp.secretKey, publicKey: kp.publicKey };
}

export interface Identity {
  mnemonic: string;
  edSeed: Bytes;
  edSecretKey: Bytes;
  edPublicKey: Bytes;
  address: string;
  curveSecretKey: Bytes;
  curvePublicKey: Bytes;
}

/**
 * Convert an Ed25519 secret seed to a Curve25519 secret scalar.
 * Algorithm (libsodium crypto_sign_ed25519_sk_to_curve25519):
 *   - Take SHA-512(edSeed)[0:32]
 *   - Clamp: scalar[0]  &= 248
 *            scalar[31] &= 127
 *            scalar[31] |= 64
 */
export async function edSeedToCurveSecret(edSeed: Bytes): Promise<Bytes> {
  const h = await sha512Async(edSeed);
  const scalar = h.slice(0, 32);
  scalar[0] &= 248;
  scalar[31] &= 127;
  scalar[31] |= 64;
  return scalar;
}

export async function deriveCurveKeyPairFromEdSeed(
  edSeed: Bytes
): Promise<{ secretKey: Bytes; publicKey: Bytes }> {
  const secretKey = await edSeedToCurveSecret(edSeed);
  const publicKey = nacl.scalarMult.base(secretKey);
  return { secretKey, publicKey };
}

export async function buildIdentityFromMnemonic(mnemonic: string): Promise<Identity> {
  const ed = await deriveEdKeyPairFromMnemonic(mnemonic);
  const address = await addressFromPubkey(ed.publicKey);
  const curve = await deriveCurveKeyPairFromEdSeed(ed.seed);
  return {
    mnemonic: mnemonic.trim(),
    edSeed: ed.seed,
    edSecretKey: ed.secretKey,
    edPublicKey: ed.publicKey,
    address,
    curveSecretKey: curve.secretKey,
    curvePublicKey: curve.publicKey,
  };
}

export async function buildIdentityFromEdSeed(edSeed: Bytes): Promise<Identity> {
  const ed = edKeypairFromSeed(edSeed);
  const address = await addressFromPubkey(ed.publicKey);
  const curve = await deriveCurveKeyPairFromEdSeed(ed.seed);
  return {
    mnemonic: "",
    edSeed: ed.seed,
    edSecretKey: ed.secretKey,
    edPublicKey: ed.publicKey,
    address,
    curveSecretKey: curve.secretKey,
    curvePublicKey: curve.publicKey,
  };
}

/** Build an Identity directly from a base64-encoded private key
 *  (the `priv_b64` field in Octra's wallet file — a 32-byte Ed25519 seed).
 */
export async function buildIdentityFromPrivKeyB64(privB64: string): Promise<Identity> {
  const ed = edKeypairFromPrivKeyB64(privB64);
  const address = await addressFromPubkey(ed.publicKey);
  const curve = await deriveCurveKeyPairFromEdSeed(ed.seed);
  return {
    mnemonic: "",
    edSeed: ed.seed,
    edSecretKey: ed.secretKey,
    edPublicKey: ed.publicKey,
    address,
    curveSecretKey: curve.secretKey,
    curvePublicKey: curve.publicKey,
  };
}

/** Curve25519 public key encoding for transport -------------------------- */

export function encodeCurvePub(pk: Bytes): string {
  return "cp_" + bytesToB64(pk);
}

export function decodeCurvePub(s: string): Bytes {
  if (!s.startsWith("cp_")) throw new Error("not a curve pub encoding");
  return b64ToBytes(s.slice(3));
}

/** ECDH shared secret ---------------------------------------------------- */

export function deriveSharedSecret(
  myCurveSecret: Bytes,
  theirCurvePublic: Bytes
): Bytes {
  return nacl.scalarMult(myCurveSecret, theirCurvePublic);
}

export function precomputeSharedKey(
  myCurveSecret: Bytes,
  theirCurvePublic: Bytes
): Bytes {
  return nacl.box.before(theirCurvePublic, myCurveSecret);
}

/** E2E message encryption ------------------------------------------------
 *  Uses crypto_box.after with a precomputed shared key (XSalsa20-Poly1305).
 */

export interface EncryptedPayload {
  c: string;
  n: string;
}

export function encryptMessage(
  plaintext: string,
  sharedKey: Bytes
): EncryptedPayload {
  const msg = utf8ToBytes(plaintext);
  const nonce = randomBytes(nacl.box.nonceLength);
  const box = nacl.box.after(msg, nonce, sharedKey);
  return { c: bytesToB64(box), n: bytesToB64(nonce) };
}

export function decryptMessage(
  payload: EncryptedPayload,
  sharedKey: Bytes
): string | null {
  try {
    const box = b64ToBytes(payload.c);
    const nonce = b64ToBytes(payload.n);
    const opened = nacl.box.open.after(box, nonce, sharedKey);
    if (!opened) return null;
    return bytesToUtf8(opened);
  } catch {
    return null;
  }
}

/** Group sender-key encryption (shared message key wrapped per recipient) */

export interface GroupEnvelope {
  body: string;
  bodyNonce: string;
  wraps: Record<string, { k: string; n: string }>;
}

export function encryptGroupMessage(
  plaintext: string,
  recipients: { curvePublic: Bytes }[]
): GroupEnvelope {
  const msg = utf8ToBytes(plaintext);
  const messageKey = randomBytes(nacl.secretbox.keyLength);
  const bodyNonce = randomBytes(nacl.secretbox.nonceLength);
  const body = nacl.secretbox(msg, bodyNonce, messageKey);

  const wraps: Record<string, { k: string; n: string }> = {};
  for (const r of recipients) {
    const eph = nacl.box.keyPair();
    const nonce = randomBytes(nacl.box.nonceLength);
    const wrapped = nacl.box(messageKey, nonce, r.curvePublic, eph.secretKey);
    wraps[encodeCurvePub(r.curvePublic)] = {
      k: bytesToB64(wrapped) + "." + bytesToB64(eph.publicKey),
      n: bytesToB64(nonce),
    };
  }

  return {
    body: bytesToB64(body),
    bodyNonce: bytesToB64(bodyNonce),
    wraps,
  };
}

export function decryptGroupMessage(
  env: GroupEnvelope,
  myCurveSecret: Bytes,
  myCurvePublic: Bytes
): string | null {
  const myKey = encodeCurvePub(myCurvePublic);
  const wrap = env.wraps[myKey];
  if (!wrap) return null;
  try {
    const [wrappedB64, ephPubB64] = wrap.k.split(".");
    const wrapped = b64ToBytes(wrappedB64);
    const ephPub = b64ToBytes(ephPubB64);
    const nonce = b64ToBytes(wrap.n);
    const messageKey = nacl.box.open(wrapped, nonce, ephPub, myCurveSecret);
    if (!messageKey) return null;
    const body = b64ToBytes(env.body);
    const bodyNonce = b64ToBytes(env.bodyNonce);
    const opened = nacl.secretbox.open(body, bodyNonce, messageKey);
    if (!opened) return null;
    return bytesToUtf8(opened);
  } catch {
    return null;
  }
}

/** Ed25519 sign / verify ------------------------------------------------- */

export function signBytes(data: Bytes, edSecretKey: Bytes): Bytes {
  return nacl.sign.detached(data, edSecretKey);
}

export function verifySignature(
  signature: Bytes,
  data: Bytes,
  edPublicKey: Bytes
): boolean {
  return nacl.sign.detached.verify(data, signature, edPublicKey);
}

export function signUtf8(message: string, edSecretKey: Bytes): string {
  return bytesToB64(signBytes(utf8ToBytes(message), edSecretKey));
}

export function verifyUtf8(
  signatureB64: string,
  message: string,
  edPublicKey: Bytes
): boolean {
  try {
    return verifySignature(b64ToBytes(signatureB64), utf8ToBytes(message), edPublicKey);
  } catch {
    return false;
  }
}

/** Wallet-at-rest PIN encryption (AES-256-GCM via Web Crypto) ------------- */

const PBKDF2_ITERATIONS = 300_000;
const PBKDF2_SALT_LEN = 16;
const AES_IV_LEN = 12;

async function derivePinKey(pin: string, salt: Bytes): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    utf8ToBytes(pin),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export interface EncryptedBlob {
  ct: string;
  iv: string;
  salt: string;
  it: number;
}

export async function encryptWithPin(
  plaintext: string,
  pin: string
): Promise<EncryptedBlob> {
  const salt = randomBytes(PBKDF2_SALT_LEN);
  const iv = randomBytes(AES_IV_LEN);
  const key = await derivePinKey(pin, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    utf8ToBytes(plaintext)
  );
  return {
    ct: bytesToB64(new Uint8Array(ct)),
    iv: bytesToB64(iv),
    salt: bytesToB64(salt),
    it: PBKDF2_ITERATIONS,
  };
}

export async function decryptWithPin(
  blob: EncryptedBlob,
  pin: string
): Promise<string> {
  const salt = b64ToBytes(blob.salt);
  const iv = b64ToBytes(blob.iv);
  const key = await derivePinKey(pin, salt);
  const ct = b64ToBytes(blob.ct);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return bytesToUtf8(new Uint8Array(pt));
}

export function validatePin(pin: string): { ok: boolean; reason?: string } {
  if (pin.length < 8) return { ok: false, reason: "PIN must be at least 8 characters" };
  if (pin.length > 64) return { ok: false, reason: "PIN must be at most 64 characters" };
  if (pin.length < 15) {
    const hasLetter = /[a-zA-Z]/.test(pin);
    const hasDigit = /[0-9]/.test(pin);
    const hasSpecial = /[^a-zA-Z0-9]/.test(pin);
    if (!(hasLetter && hasDigit && hasSpecial)) {
      return {
        ok: false,
        reason: "PIN under 15 chars must include a letter, digit, and special character",
      };
    }
  }
  return { ok: true };
}

/** Deterministic circle / conversation IDs ------------------------------- */

export async function deriveCircleId(
  participantCurvePubs: Bytes[]
): Promise<string> {
  const sorted = [...participantCurvePubs].map((p) => bytesToB64(p)).sort();
  const joined = sorted.join("|");
  const h = await sha256Async(joined);
  return "circ_" + base58Encode(h).slice(0, 22);
}

export async function deriveRoomId(name: string, salt: Bytes): Promise<string> {
  const part1 = utf8ToBytes("room:" + name + ":");
  const combined = new Uint8Array(part1.length + salt.length);
  combined.set(part1, 0);
  combined.set(salt, part1.length);
  const h = await sha256Async(combined);
  return "room_" + base58Encode(h).slice(0, 22);
}
