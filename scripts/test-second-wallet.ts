/**
 * Generate a second test wallet, build + sign a transfer transaction,
 * try octra_submit on devnet, and probe for a faucet endpoint.
 */

import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";
import * as bs58 from "bs58";
import * as bip39 from "bip39";

const MNEMONIC =
  "cross number result leg web curious include cake wreck truly stomach cargo ordinary loop dog exhibit tuna news pole capital fringe trial creek duck";
const DEVNET_URL = "https://devnet.octrascan.io/rpc";

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const d = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(d);
}
async function sha512(data: Uint8Array): Promise<Uint8Array> {
  const d = await crypto.subtle.digest("SHA-512", data);
  return new Uint8Array(d);
}
async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
function hex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function deriveIdentity(mnemonic: string) {
  const masterSeed = new Uint8Array(await bip39.mnemonicToSeed(mnemonic));
  const edSeed = (await hmacSha512(new TextEncoder().encode("Octra seed"), masterSeed)).slice(0, 32);
  const kp = nacl.sign.keyPair.fromSeed(edSeed);
  const h = await sha256(kp.publicKey);
  const addr = "oct" + bs58.default.encode(h).padStart(44, "1");
  // Curve key
  const ch = await sha512(edSeed);
  ch[0] &= 248; ch[31] &= 127; ch[31] |= 64;
  const curveSec = ch.slice(0, 32);
  const curvePub = nacl.scalarMult.base(curveSec);
  return { addr, edSeed, edPub: kp.publicKey, edSec: kp.secretKey, curveSec, curvePub };
}

/** Build the signing JSON — MUST match Octra's `signing_json` exactly.
 *  Field order: from, to_, amount, nonce, ou, timestamp, op_type
 *  Decimal format: stripped of leading zeros. Timestamp: float with `.0` if integer.
 */
function signingJson(tx: {
  from: string; to: string; amount: string; nonce: number; ou: string;
  timestamp: number; opType: string;
}): string {
  const dec = (v: string) => {
    const first = v.replace(/^0+/, "");
    return first === "" ? "0" : first;
  };
  const ts = Number.isInteger(tx.timestamp) ? tx.timestamp + ".0" : String(tx.timestamp);
  return `{"from":"${tx.from}","to_":"${tx.to}","amount":"${dec(tx.amount)}","nonce":${tx.nonce},"ou":"${dec(tx.ou)}","timestamp":${ts},"op_type":"${tx.opType}"}`;
}

function ed25519Sign(msg: string, sk64: Uint8Array): string {
  // TweetNaCl's crypto_sign returns sm (signed message) = sig(64) + msg
  // But Octra uses crypto_sign and takes only the first 64 bytes as the signature.
  const msgBytes = new TextEncoder().encode(msg);
  const sm = nacl.sign(msgBytes, sk64);
  // sm is sig || msg — take first 64 bytes
  return encodeBase64(sm.slice(0, 64));
}

function buildTxJson(tx: any): any {
  const dec = (v: string) => v.replace(/^0+/, "") || "0";
  const j: any = {
    from: tx.from,
    to_: tx.to,
    amount: dec(tx.amount),
    nonce: tx.nonce,
    ou: dec(tx.ou),
    timestamp: tx.timestamp,
    signature: tx.signature,
    op_type: tx.opType,
  };
  j.public_key = tx.pubKeyB64;
  return j;
}

async function main() {
  console.log("=== Step 1: Generate a second test wallet ===\n");
  const mnemonic2 = bip39.generateMnemonic(256);
  const id2 = await deriveIdentity(mnemonic2);
  console.log("Wallet 2 mnemonic:", mnemonic2);
  console.log("Wallet 2 address :", id2.addr);
  console.log("Wallet 2 ed_seed :", encodeBase64(id2.edSeed));
  console.log("Wallet 2 pub_key :", encodeBase64(id2.edPub));
  console.log("Wallet 2 curvePub:", "cp_" + encodeBase64(id2.curvePub));
  console.log();

  // Wallet 1 (user's mnemonic)
  const id1 = await deriveIdentity(MNEMONIC);
  console.log("Wallet 1 address :", id1.addr, "(funded on devnet? No — 'sender not found')");
  console.log();

  console.log("=== Step 2: Check nonce + balance for wallet 1 ===\n");
  let rpcId = 1;
  async function rpc(method: string, params: any, timeout = 12000) {
    try {
      const res = await fetch(DEVNET_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
        signal: AbortSignal.timeout(timeout),
      });
      return await res.json();
    } catch (e: any) {
      return { error: { message: e.message } };
    }
  }

  const bal = await rpc("octra_balance", [id1.addr]);
  console.log("Wallet 1 balance:", bal.result ? JSON.stringify(bal.result) : `err ${bal.error?.code} "${bal.error?.message}"`);

  console.log();

  console.log("=== Step 3: Build + sign a transfer transaction (wallet 1 → wallet 2) ===\n");
  const tx = {
    from: id1.addr,
    to: id2.addr,
    amount: "100000000", // 1 OCT (8 decimals)
    nonce: 0,
    ou: "1000", // fee = 0.00001 OCT
    timestamp: Date.now() / 1000,
    opType: "standard",
  };
  const signingStr = signingJson(tx);
  console.log("Signing JSON:", signingStr);
  const sig = ed25519Sign(signingStr, id1.edSec);
  console.log("Signature (b64):", sig);
  const txJson = buildTxJson({ ...tx, signature: sig, pubKeyB64: encodeBase64(id1.edPub) });
  console.log("Transaction JSON:", JSON.stringify(txJson).slice(0, 500));
  console.log();

  console.log("=== Step 4: Try octra_submit on devnet public RPC ===\n");
  const submit = await rpc("octra_submit", [txJson], 20000);
  console.log("octra_submit result:", JSON.stringify(submit).slice(0, 600));
  console.log();

  console.log("=== Step 5: Probe for Octra faucet endpoints ===\n");
  const faucetUrls = [
    "https://devnet.octrascan.io/faucet",
    "https://devnet.octrascan.io/api/faucet",
    "https://devnet.octrascan.io/api/v1/faucet",
    "https://faucet.octrascan.io",
    "https://faucet.octra.org",
    "https://octra.org/faucet",
    "https://docs.octra.org/faucet",
  ];
  for (const url of faucetUrls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000), redirect: "follow" });
      const text = await res.text();
      const title = text.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
      console.log(`  ${url} → ${res.status} ${title.slice(0, 60) || text.slice(0, 80)}`);
    } catch (e: any) {
      console.log(`  ${url} → ERR: ${e.message}`);
    }
  }
  console.log();

  // Also try a POST to a faucet-style endpoint with the address
  console.log("=== Step 6: Try POSTing address to potential faucet endpoints ===\n");
  for (const url of [
    "https://devnet.octrascan.io/faucet",
    "https://devnet.octrascan.io/api/faucet",
  ]) {
    for (const addr of [id1.addr, id2.addr]) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: addr }),
          signal: AbortSignal.timeout(6000),
        });
        const text = await res.text();
        console.log(`  POST ${url} addr=${addr.slice(0, 20)} → ${res.status} ${text.slice(0, 120)}`);
      } catch (e: any) {
        console.log(`  POST ${url} addr=${addr.slice(0, 20)} → ERR: ${e.message}`);
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log("Wallet 1 (user mnemonic):", id1.addr);
  console.log("  - Ed25519 pub:", encodeBase64(id1.edPub));
  console.log("  - Curve pub  :", "cp_" + encodeBase64(id1.curvePub));
  console.log("Wallet 2 (newly generated):", id2.addr);
  console.log("  - Mnemonic   :", mnemonic2);
  console.log("  - Ed25519 seed:", encodeBase64(id2.edSeed));
  console.log("  - Curve pub  :", "cp_" + encodeBase64(id2.curvePub));
  console.log();
  console.log("To fund wallet 2, either:");
  console.log("  1. Send OCT from a funded wallet to", id2.addr);
  console.log("  2. Find an Octra devnet faucet");
  console.log("  3. Run a local lite_node (has a funding mechanism)");
}

main().catch(console.error);
