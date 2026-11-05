/**
 * Verify the correct Octra key derivation using mnemonic + private key + expected address.
 *
 * Octra webcli flow (from wallet.hpp create_wallet + derive_hd_seed):
 *   1. mnemonic → mnemonic_to_seed (PBKDF2-HMAC-SHA512, 2048 iters, salt "mnemonic") → 64-byte master_seed
 *   2. master_seed → derive_hd_seed(master_seed, index=0, hd_version=2)
 *      = HMAC-SHA512(key="Octra seed", data=master_seed)[0:32]   → 32-byte ed_seed
 *   3. ed_seed → crypto_sign_seed_keypair → pubkey
 *   4. pubkey → sha256 → base58 → padStart(44,'1') → "oct" + ... → address
 *
 * The provided private key should be the ed_seed from step 2.
 * The provided address should match step 4.
 */

import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";
import * as bs58 from "bs58";
import * as bip39 from "bip39";

const MNEMONIC =
  "cross number result leg web curious include cake wreck truly stomach cargo ordinary loop dog exhibit tuna news pole capital fringe trial creek duck";
const PRIV_KEY_B64 = "XcxHYHpg8ppVnkRLuPnb6THiMb6w0DqWJdDh9IKa20w=";
const EXPECTED_ADDR = "oct9a1XGFNTq5aD52XwA9uq341QSEAb5ChrrqoRhwYARcMG";

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const d = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(d);
}

function hex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
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

async function pbkdf2Sha512(password: string, salt: string, iters: number, len: number): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: iters, hash: "SHA-512" },
    baseKey,
    len * 8
  );
  return new Uint8Array(bits);
}

function addressFromPubkey(pubkey: Uint8Array): Promise<string> {
  return (async () => {
    const h = await sha256(pubkey);
    const b58 = bs58.default.encode(h);
    return "oct" + b58.padStart(44, "1");
  })();
}

async function main() {
  console.log("=== Verify Octra key derivation ===\n");
  console.log("Mnemonic:", MNEMONIC.slice(0, 50), "...");
  console.log("Expected private key (b64):", PRIV_KEY_B64);
  console.log("Expected address:", EXPECTED_ADDR);
  console.log();

  // Validate mnemonic
  const valid = bip39.validateMnemonic(MNEMONIC);
  console.log("Mnemonic valid (bip39 lib):", valid);

  // Step 1: mnemonic → master_seed (64 bytes)
  // Octra's mnemonic_to_seed uses PBKDF2-HMAC-SHA512, 2048 iters, salt "mnemonic"
  // Standard BIP-39 uses the same. Let's compute both ways.
  const bip39Seed = await bip39.mnemonicToSeed(MNEMONIC); // returns Buffer
  const octraSeed = await pbkdf2Sha512(MNEMONIC, "mnemonic", 2048, 64);

  console.log("\nbip39.mnemonicToSeed (hex):", hex(new Uint8Array(bip39Seed)));
  console.log("octra pbkdf2 (hex)        :", hex(octraSeed));
  console.log("Match:", hex(new Uint8Array(bip39Seed)) === hex(octraSeed));

  const masterSeed = octraSeed; // 64 bytes

  // Step 2: Octra HD derivation
  // hd_version 1, index 0: hd_seed = master_seed[0:32]
  // hd_version 2, index 0: hd_seed = HMAC-SHA512("Octra seed", master_seed)[0:32]
  const v1HdSeed = masterSeed.slice(0, 32);
  const v2HdSeed = (await hmacSha512(new TextEncoder().encode("Octra seed"), masterSeed)).slice(0, 32);

  const privKeyBytes = decodeBase64(PRIV_KEY_B64);

  console.log("\n--- HD derivation comparison ---");
  console.log("Provided priv key (hex):", hex(privKeyBytes));
  console.log("v1 hd_seed (hex)       :", hex(v1HdSeed));
  console.log("v2 hd_seed (hex)       :", hex(v2HdSeed));
  console.log("v1 match:", hex(privKeyBytes) === hex(v1HdSeed));
  console.log("v2 match:", hex(privKeyBytes) === hex(v2HdSeed));

  // Step 3-4: For each candidate hd_seed, derive address
  const candidates = [
    ["v1 hd_seed", v1HdSeed],
    ["v2 hd_seed", v2HdSeed],
    ["provided priv key", privKeyBytes],
    ["master_seed[0:32] (= v1)", masterSeed.slice(0, 32)],
  ] as const;

  console.log("\n--- Address derivation for each candidate ---");
  for (const [label, candidate] of candidates) {
    const kp = nacl.sign.keyPair.fromSeed(candidate);
    const addr = await addressFromPubkey(kp.publicKey);
    const match = addr === EXPECTED_ADDR;
    console.log(`  [${label}]`);
    console.log(`    ed_seed   : ${hex(candidate)}`);
    console.log(`    pubkey    : ${hex(kp.publicKey)}`);
    console.log(`    pubkey b64: ${encodeBase64(kp.publicKey)}`);
    console.log(`    address   : ${addr}`);
    console.log(`    MATCH     : ${match ? "✓ YES" : "✗ no"}`);
  }

  // Also try: maybe the priv key is the 64-byte expanded secret key, but truncated?
  // (Already covered — priv key is 32 bytes)

  // Summary
  console.log("\n=== Summary ===");
  const v2Addr = await addressFromPubkey(nacl.sign.keyPair.fromSeed(v2HdSeed).publicKey);
  const v1Addr = await addressFromPubkey(nacl.sign.keyPair.fromSeed(v1HdSeed).publicKey);
  const privAddr = await addressFromPubkey(nacl.sign.keyPair.fromSeed(privKeyBytes).publicKey);
  console.log("v1 derivation address:", v1Addr, v1Addr === EXPECTED_ADDR ? "✓" : "");
  console.log("v2 derivation address:", v2Addr, v2Addr === EXPECTED_ADDR ? "✓" : "");
  console.log("priv key direct addr  :", privAddr, privAddr === EXPECTED_ADDR ? "✓" : "");
}

main().catch(console.error);
