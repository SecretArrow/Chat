/**
 * Wallet manager — create / import / unlock Octra wallets.
 * ------------------------------------------------------------------
 * Mirrors the Octra webcli flow:
 *   - generate 24-word mnemonic
 *   - derive Ed25519 + Curve25519 keys
 *   - compute oct... address
 *   - encrypt the entire identity with a PIN using AES-256-GCM + PBKDF2
 *   - persist encrypted blob to IndexedDB
 *
 * The decrypted Identity lives in memory only for the duration of a
 * session. Re-locking wipes the in-memory key material.
 */

import {
  generateMnemonic,
  validateMnemonic,
  buildIdentityFromMnemonic,
  buildIdentityFromPrivKeyB64,
  edKeypairFromSeed,
  encryptWithPin,
  decryptWithPin,
  validatePin,
  bytesToB64,
  b64ToBytes,
  type Identity,
  type EncryptedBlob,
} from "./crypto";
import {
  saveWallet,
  getWallet,
  getDefaultWallet,
  listWallets,
  deleteWallet,
  type WalletRecord,
} from "./db";

export interface SerializedIdentity {
  mnemonic: string;
  edSeedB64: string;
  address: string;
  edPubB64: string;
  curveSecB64: string;
  curvePubB64: string;
}

export async function createNewWallet(
  label: string,
  pin: string
): Promise<{ identity: Identity; record: WalletRecord }> {
  const mnemonic = generateMnemonic(256);
  return importFromMnemonic(mnemonic, label, pin);
}

export async function importFromMnemonic(
  mnemonic: string,
  label: string,
  pin: string
): Promise<{ identity: Identity; record: WalletRecord }> {
  const trimmed = mnemonic.trim();
  if (!validateMnemonic(trimmed)) {
    throw new Error("Invalid mnemonic — check the words and order");
  }
  const pinCheck = validatePin(pin);
  if (!pinCheck.ok) {
    throw new Error(pinCheck.reason ?? "Invalid PIN");
  }

  const identity = await buildIdentityFromMnemonic(trimmed);
  const record = await persistIdentity(identity, label, pin);
  return { identity, record };
}

/** Import a wallet directly from a base64-encoded 32-byte Ed25519 seed
 *  (the `priv_b64` field from Octra webcli's wallet file).
 *  The mnemonic field will be empty since we don't have it.
 */
export async function importFromPrivKey(
  privKeyB64: string,
  label: string,
  pin: string
): Promise<{ identity: Identity; record: WalletRecord }> {
  const trimmed = privKeyB64.trim();
  const pinCheck = validatePin(pin);
  if (!pinCheck.ok) {
    throw new Error(pinCheck.reason ?? "Invalid PIN");
  }

  const identity = await buildIdentityFromPrivKeyB64(trimmed);
  const record = await persistIdentity(identity, label, pin);
  return { identity, record };
}

export async function persistIdentity(
  identity: Identity,
  label: string,
  pin: string
): Promise<WalletRecord> {
  const serialized: SerializedIdentity = {
    mnemonic: identity.mnemonic,
    edSeedB64: bytesToB64(identity.edSeed),
    address: identity.address,
    edPubB64: bytesToB64(identity.edPublicKey),
    curveSecB64: bytesToB64(identity.curveSecretKey),
    curvePubB64: bytesToB64(identity.curvePublicKey),
  };
  const encryptedBlob = await encryptWithPin(JSON.stringify(serialized), pin);

  // Mark previously-default wallets as non-default if this one is the new default
  const existing = await listWallets();
  const isDefault = existing.length === 0;

  const record: WalletRecord = {
    id: identity.address,
    address: identity.address,
    encryptedBlob,
    createdAt: Date.now(),
    label,
    isDefault,
  };
  await saveWallet(record);
  return record;
}

export async function unlockWallet(
  address: string,
  pin: string
): Promise<Identity> {
  const record = await getWallet(address);
  if (!record) throw new Error("Wallet not found");
  const json = await decryptWithPin(record.encryptedBlob, pin);
  const s = JSON.parse(json) as SerializedIdentity;

  const edSeed = b64ToBytes(s.edSeedB64);
  const ed = edKeypairFromSeed(edSeed);
  return {
    mnemonic: s.mnemonic,
    edSeed,
    edSecretKey: ed.secretKey,
    edPublicKey: ed.publicKey,
    address: s.address,
    curveSecretKey: b64ToBytes(s.curveSecB64),
    curvePublicKey: b64ToBytes(s.curvePubB64),
  };
}

export async function setDefaultWallet(address: string): Promise<void> {
  const all = await listWallets();
  for (const w of all) {
    if (w.id !== address && w.isDefault) {
      await saveWallet({ ...w, isDefault: false });
    } else if (w.id === address && !w.isDefault) {
      await saveWallet({ ...w, isDefault: true });
    }
  }
}

export async function removeWallet(address: string): Promise<void> {
  await deleteWallet(address);
}

export { getDefaultWallet, listWallets };
