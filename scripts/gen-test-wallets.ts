/**
 * Generate 3 test wallets (Wallet 2, 3, 4) and print their details
 * for use as contacts in the OctraChat app.
 */

import nacl from "tweetnacl";
import { encodeBase64 } from "tweetnacl-util";
import * as bs58 from "bs58";
import * as bip39 from "bip39";

async function sha256(d: Uint8Array) { return new Uint8Array(await crypto.subtle.digest("SHA-256", d)); }
async function sha512(d: Uint8Array) { return new Uint8Array(await crypto.subtle.digest("SHA-512", d)); }
async function hmacSha512(k: Uint8Array, d: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, d));
}

async function deriveIdentity(mnemonic: string) {
  const masterSeed = new Uint8Array(await bip39.mnemonicToSeed(mnemonic));
  const edSeed = (await hmacSha512(new TextEncoder().encode("Octra seed"), masterSeed)).slice(0, 32);
  const kp = nacl.sign.keyPair.fromSeed(edSeed);
  const h = await sha256(kp.publicKey);
  const address = "oct" + bs58.default.encode(h).padStart(44, "1");
  const ch = await sha512(edSeed);
  ch[0] &= 248; ch[31] &= 127; ch[31] |= 64;
  return {
    mnemonic,
    edSeed, edPub: kp.publicKey, address,
    curveSec: ch.slice(0, 32),
    curvePub: nacl.scalarMult.base(ch.slice(0, 32)),
    curvePubEncoded: "cp_" + encodeBase64(nacl.scalarMult.base(ch.slice(0, 32))),
    privKeyB64: encodeBase64(edSeed),
  };
}

async function main() {
  const wallets = [];
  for (let i = 0; i < 3; i++) {
    const m = bip39.generateMnemonic(256);
    const id = await deriveIdentity(m);
    wallets.push(id);
  }

  console.log("=== 3 Test Wallets for OctraChat ===\n");
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    console.log(`Wallet ${i + 2}:`);
    console.log(`  Address  : ${w.address}`);
    console.log(`  Mnemonic : ${w.mnemonic}`);
    console.log(`  Priv key : ${w.privKeyB64}`);
    console.log(`  Curve pub: ${w.curvePubEncoded}`);
    console.log();
  }

  // Output as JSON for easy copy-paste
  console.log("=== JSON for contacts ===");
  console.log(JSON.stringify(wallets.map((w, i) => ({
    label: `Test Wallet ${i + 2}`,
    address: w.address,
    curvePub: w.curvePubEncoded,
  })), null, 2));
}

main().catch(console.error);
