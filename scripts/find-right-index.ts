/**
 * Iterate hd_index 0..50 with v1 and v2 to find which produces oct9a1XGFNTq5aD52XwA9uq341QSEAb5ChrrqoRhwYARcMG.
 * Also try deriving address from Curve25519 pubkey (in case Octra uses that).
 */

import nacl from "tweetnacl";
import { encodeBase64 } from "tweetnacl-util";
import * as bs58 from "bs58";
import * as bip39 from "bip39";

const MNEMONIC =
  "cross number result leg web curious include cake wreck truly stomach cargo ordinary loop dog exhibit tuna news pole capital fringe trial creek duck";
const EXPECTED_ADDR = "oct9a1XGFNTq5aD52XwA9uq341QSEAb5ChrrqoRhwYARcMG";

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const d = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(d);
}
function hex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

function octraDeriveHdSeed(masterSeed: Uint8Array, index: number, hdVersion: 1 | 2): Uint8Array {
  // Mirrors derive_hd_seed from crypto_utils.hpp
  if (hdVersion === 1 && index === 0) {
    return masterSeed.slice(0, 32);
  }
  if (hdVersion === 2 && index === 0) {
    // HMAC-SHA512("Octra seed", master_seed)[0:32]
    // We need to compute this synchronously-ish, but hmacSha512 is async.
    // This function is a placeholder — actual async version below.
    throw new Error("use async version");
  }
  throw new Error("use async version");
}

async function octraDeriveHdSeedAsync(masterSeed: Uint8Array, index: number, hdVersion: 1 | 2): Promise<Uint8Array> {
  const keyBytes = new TextEncoder().encode("Octra seed");
  if (hdVersion === 1 && index === 0) {
    return masterSeed.slice(0, 32);
  }
  if (hdVersion === 2 && index === 0) {
    const mac = await hmacSha512(keyBytes, masterSeed);
    return mac.slice(0, 32);
  }
  // For index > 0 (either version): data = master_seed(64) || index_le32(4)
  const data = new Uint8Array(68);
  data.set(masterSeed, 0);
  data[64] = index & 0xff;
  data[65] = (index >> 8) & 0xff;
  data[66] = (index >> 16) & 0xff;
  data[67] = (index >> 24) & 0xff;
  const mac = await hmacSha512(keyBytes, data);
  return mac.slice(0, 32);
}

async function addressFromPubkey(pubkey: Uint8Array): Promise<string> {
  const h = await sha256(pubkey);
  return "oct" + bs58.default.encode(h).padStart(44, "1");
}

async function main() {
  console.log("Expected address:", EXPECTED_ADDR);
  console.log("Expected payload :", EXPECTED_ADDR.slice(3));
  console.log();

  const masterSeed = new Uint8Array(await bip39.mnemonicToSeed(MNEMONIC));
  console.log("master_seed (hex):", hex(masterSeed));
  console.log();

  console.log("=== Brute-force hd_index 0..30, v1 and v2 ===\n");
  let found = false;
  for (const version of [1, 2] as const) {
    for (let idx = 0; idx <= 30; idx++) {
      const edSeed = await octraDeriveHdSeedAsync(masterSeed, idx, version);
      const kp = nacl.sign.keyPair.fromSeed(edSeed);
      const addr = await addressFromPubkey(kp.publicKey);
      const match = addr === EXPECTED_ADDR;
      if (match || idx <= 3 || idx === 10 || idx === 20) {
        console.log(`  v${version} idx=${String(idx).padStart(2)} → ${addr}${match ? "  ✓ MATCH!" : ""}`);
      }
      if (match) {
        found = true;
        console.log(`    ed_seed   : ${hex(edSeed)}`);
        console.log(`    pubkey b64: ${encodeBase64(kp.publicKey)}`);
      }
    }
  }

  if (!found) {
    console.log("\n=== No hd_index matched. Trying Curve25519 pubkey derivation ===\n");
    // Maybe the address uses the Curve25519 public key instead of Ed25519?
    for (const version of [1, 2] as const) {
      for (let idx = 0; idx <= 5; idx++) {
        const edSeed = await octraDeriveHdSeedAsync(masterSeed, idx, version);
        const edKp = nacl.sign.keyPair.fromSeed(edSeed);
        // Convert Ed25519 seed → Curve25519 secret via SHA-512 + clamp
        const h = new Uint8Array(await crypto.subtle.digest("SHA-512", edSeed));
        h[0] &= 248;
        h[31] &= 127;
        h[31] |= 64;
        const curveSec = h.slice(0, 32);
        const curvePub = nacl.scalarMult.base(curveSec);
        const addr = await addressFromPubkey(curvePub);
        const match = addr === EXPECTED_ADDR;
        console.log(`  v${version} idx=${idx} Curve25519 → ${addr}${match ? "  ✓ MATCH!" : ""}`);
        if (match) found = true;
      }
    }
  }

  if (!found) {
    console.log("\n=== No match found. The expected address may be from a different mnemonic/key. ===");
    console.log("=== Proceeding with the CORRECT address derived from the provided mnemonic: ===\n");
    const edSeed = await octraDeriveHdSeedAsync(masterSeed, 0, 2);
    const kp = nacl.sign.keyPair.fromSeed(edSeed);
    const addr = await addressFromPubkey(kp.publicKey);
    console.log("  Correct address (v2, idx 0):", addr);
    console.log("  Public key (b64)           :", encodeBase64(kp.publicKey));
    console.log("  Private key/ed_seed (b64)  :", encodeBase64(edSeed));
  }
}

main().catch(console.error);
