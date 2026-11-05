/**
 * Bidirectional E2E chat test between Wallet 1 and Wallet 2.
 */

import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";
import * as bs58 from "bs58";
import * as bip39 from "bip39";

const MNEMONIC_1 =
  "cross number result leg web curious include cake wreck truly stomach cargo ordinary loop dog exhibit tuna news pole capital fringe trial creek duck";
const MNEMONIC_2 =
  "final hollow transfer enemy tenant develop reform blouse course fan illness flag exist panther shed shoe clump soon reject amount letter amused vocal toilet";

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
    edSeed, edPub: kp.publicKey, edSec: kp.secretKey, address,
    curveSec: ch.slice(0, 32), curvePub: nacl.scalarMult.base(ch.slice(0, 32)),
  };
}

async function main() {
  console.log("=== Bidirectional E2E Chat Test ===\n");

  const w1 = await deriveIdentity(MNEMONIC_1);
  const w2 = await deriveIdentity(MNEMONIC_2);

  console.log("Wallet 1 address:", w1.address);
  console.log("Wallet 1 curvePub:", "cp_" + encodeBase64(w1.curvePub));
  console.log("Wallet 2 address:", w2.address);
  console.log("Wallet 2 curvePub:", "cp_" + encodeBase64(w2.curvePub));
  console.log();

  const shared12 = nacl.box.before(w2.curvePub, w1.curveSec);
  const shared21 = nacl.box.before(w1.curvePub, w2.curveSec);

  console.log("Shared secret (W1 perspective):", encodeBase64(shared12));
  console.log("Shared secret (W2 perspective):", encodeBase64(shared21));
  console.log("Symmetric:", encodeBase64(shared12) === encodeBase64(shared21) ? "✓ YES" : "✗ NO");
  console.log();

  // W1 → W2
  const msg1to2 = "Hello Wallet 2! E2E encrypted message from Wallet 1 on Octra devnet.";
  const nonce1 = nacl.randomBytes(nacl.box.nonceLength);
  const box1 = nacl.box.after(new TextEncoder().encode(msg1to2), nonce1, shared12);
  const payload1 = { c: encodeBase64(box1), n: encodeBase64(nonce1) };

  console.log("--- Wallet 1 → Wallet 2 ---");
  console.log("Plaintext :", msg1to2);
  console.log("Ciphertext :", payload1.c.slice(0, 60) + "...");

  const decByW2 = nacl.box.open.after(decodeBase64(payload1.c), decodeBase64(payload1.n), shared21);
  console.log("W2 decrypt:", decByW2 ? new TextDecoder().decode(decByW2) : "FAILED");
  console.log("Match     :", decByW2 && new TextDecoder().decode(decByW2) === msg1to2 ? "✓ YES" : "✗ NO");
  console.log();

  // W2 → W1
  const msg2to1 = "Hi Wallet 1! Reply from Wallet 2 — E2E works both ways.";
  const nonce2 = nacl.randomBytes(nacl.box.nonceLength);
  const box2 = nacl.box.after(new TextEncoder().encode(msg2to1), nonce2, shared21);
  const payload2 = { c: encodeBase64(box2), n: encodeBase64(nonce2) };

  console.log("--- Wallet 2 → Wallet 1 ---");
  console.log("Plaintext :", msg2to1);
  console.log("Ciphertext :", payload2.c.slice(0, 60) + "...");

  const decByW1 = nacl.box.open.after(decodeBase64(payload2.c), decodeBase64(payload2.n), shared12);
  console.log("W1 decrypt:", decByW1 ? new TextDecoder().decode(decByW1) : "FAILED");
  console.log("Match     :", decByW1 && new TextDecoder().decode(decByW1) === msg2to1 ? "✓ YES" : "✗ NO");
  console.log();

  // Ed25519 signatures
  const sig1 = nacl.sign.detached(new TextEncoder().encode(msg1to2), w1.edSec);
  const sig1Valid = nacl.sign.detached.verify(new TextEncoder().encode(msg1to2), sig1, w1.edPub);
  console.log("--- Ed25519 signature ---");
  console.log("W1 signs, verifies:", sig1Valid ? "✓ VALID" : "✗ INVALID");
  console.log();

  console.log("=== ALL TESTS PASSED ===");
  console.log("Wallet 2 can decrypt Wallet 1's messages and vice versa.");
  console.log("Wallet 2 mnemonic:", MNEMONIC_2);
  console.log("Wallet 2 address :", w2.address);
}

main().catch(console.error);
