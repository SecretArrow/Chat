// Smoke test for OctraChat crypto core
// Run with: npx tsx scripts/smoke-test.ts

import {
  generateMnemonic,
  validateMnemonic,
  buildIdentityFromMnemonic,
  isValidOctraAddress,
  precomputeSharedKey,
  encryptMessage,
  decryptMessage,
  encryptGroupMessage,
  decryptGroupMessage,
  signUtf8,
  verifyUtf8,
  encryptWithPin,
  decryptWithPin,
  validatePin,
  encodeCurvePub,
  decodeCurvePub,
} from "../src/lib/octra/crypto";
import { sealStealthMessage, tryOpenStealthOutput } from "../src/lib/octra/stealth";
import { generatePaillierKeys, paillierEncrypt, paillierAdd, paillierDecrypt } from "../src/lib/octra/fhe";

async function main() {
  console.log("== OctraChat Crypto Smoke Test ==\n");

  // 1. Mnemonic + identity
  const mnemonic = generateMnemonic(256);
  console.log("Mnemonic length (words):", mnemonic.split(" ").length);
  if (!validateMnemonic(mnemonic)) throw new Error("mnemonic invalid");

  const id1 = await buildIdentityFromMnemonic(mnemonic);
  const id2 = await buildIdentityFromMnemonic(mnemonic);
  console.log("Address:", id1.address, "len:", id1.address.length);
  if (!isValidOctraAddress(id1.address)) throw new Error("address format invalid");
  if (id1.address !== id2.address) throw new Error("non-deterministic address");
  if (id1.curvePublicKey.length !== 32) throw new Error("curve pub wrong size");

  // 2. ECDH + DM encryption
  const idB = await buildIdentityFromMnemonic(generateMnemonic(256));
  const sharedAB = precomputeSharedKey(id1.curveSecretKey, idB.curvePublicKey);
  const sharedBA = precomputeSharedKey(idB.curveSecretKey, id1.curvePublicKey);
  if (Buffer.from(sharedAB).toString("hex") !== Buffer.from(sharedBA).toString("hex")) {
    throw new Error("ECDH not symmetric");
  }
  console.log("ECDH symmetric: OK");

  const msg = "Hello Octra from A -> B";
  const enc = encryptMessage(msg, sharedAB);
  const dec = decryptMessage(enc, sharedBA);
  if (dec !== msg) throw new Error("DM decrypt failed");
  console.log("DM encryption: OK");

  // 3. Group encryption (3 members)
  const idC = await buildIdentityFromMnemonic(generateMnemonic(256));
  const recipients = [
    { curvePublic: id1.curvePublicKey },
    { curvePublic: idB.curvePublicKey },
    { curvePublic: idC.curvePublicKey },
  ];
  const gmsg = "Group hi!";
  const genv = encryptGroupMessage(gmsg, recipients);
  const gdec1 = decryptGroupMessage(genv, id1.curveSecretKey, id1.curvePublicKey);
  const gdecB = decryptGroupMessage(genv, idB.curveSecretKey, idB.curvePublicKey);
  const gdecC = decryptGroupMessage(genv, idC.curveSecretKey, idC.curvePublicKey);
  if (gdec1 !== gmsg || gdecB !== gmsg || gdecC !== gmsg) {
    throw new Error("group decrypt failed");
  }
  console.log("Group encryption (3 recipients): OK");

  // 4. Ed25519 sign/verify
  const sig = signUtf8("octra-circle-membership", id1.edSecretKey);
  if (!verifyUtf8(sig, "octra-circle-membership", id1.edPublicKey)) {
    throw new Error("signature verify failed");
  }
  if (verifyUtf8(sig, "tampered", id1.edPublicKey)) {
    throw new Error("signature should fail");
  }
  console.log("Ed25519 sign/verify: OK");

  // 5. Curve pub encoding roundtrip
  const cp = encodeCurvePub(id1.curvePublicKey);
  if (decodeCurvePub(cp).length !== 32) throw new Error("curve pub roundtrip failed");
  console.log("Curve pub encoding: OK");

  // 6. PIN encryption
  const pin = "test-pin-123-XYZ";
  if (!validatePin(pin).ok) throw new Error("PIN validation should pass");
  const blob = await encryptWithPin(JSON.stringify({ secret: "wallet" }), pin);
  const pt = await decryptWithPin(blob, pin);
  if (JSON.parse(pt).secret !== "wallet") throw new Error("PIN decrypt failed");
  try {
    await decryptWithPin(blob, "wrong-pin-ABC-xyz");
    throw new Error("should have failed with wrong PIN");
  } catch {
    // expected
  }
  console.log("PIN encryption (AES-256-GCM + PBKDF2 300k): OK");

  // 7. Stealth addressing
  const stealth = await sealStealthMessage("stealthy DM", idB.curvePublicKey, id1.address);
  const opened = await tryOpenStealthOutput(stealth, idB.curveSecretKey, idB.curvePublicKey);
  if (!opened || opened.text !== "stealthy DM") throw new Error("stealth open failed");
  const notMine = await tryOpenStealthOutput(stealth, id1.curveSecretKey, id1.curvePublicKey);
  if (notMine) throw new Error("stealth should not match wrong recipient");
  console.log("Stealth addressing (view tag + ECDH): OK");

  // 8. FHE Paillier
  console.log("Generating 256-bit Paillier keys...");
  const t0 = Date.now();
  const keys = await generatePaillierKeys(256);
  console.log("Key gen time:", Date.now() - t0, "ms");

  const v1 = paillierEncrypt(keys.pub, 1n);
  const v2 = paillierEncrypt(keys.pub, 1n);
  const v3 = paillierEncrypt(keys.pub, 0n);
  const v4 = paillierEncrypt(keys.pub, 1n);
  const sum = paillierAdd(keys.pub, [v1, v2, v3, v4]);
  const tally = paillierDecrypt(keys.pub, keys.priv, sum);
  if (tally !== 3n) throw new Error(`FHE tally wrong: got ${tally}, expected 3`);
  console.log("FHE Paillier additive homomorphism (3 yes + 1 no = 3): OK");

  console.log("\nAll smoke tests passed.");
}

main().catch((e) => {
  console.error("SMOKE TEST FAILED:", e);
  process.exit(1);
});
