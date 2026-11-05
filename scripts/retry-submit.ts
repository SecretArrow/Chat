/**
 * Retry octra_submit with backoff, then check if the tx was accepted.
 */

import nacl from "tweetnacl";
import { encodeBase64 } from "tweetnacl-util";
import * as bs58 from "bs58";
import * as bip39 from "bip39";

const MNEMONIC =
  "cross number result leg web curious include cake wreck truly stomach cargo ordinary loop dog exhibit tuna news pole capital fringe trial creek duck";
const WALLET2_ADDR = "octBoeKeyfCTZ9pRJ8S4eSxFRETYNfLvo3uYDXCg25MTw8E";
const DEVNET_URL = "https://devnet.octrascan.io/rpc";

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
  const addr = "oct" + bs58.default.encode(h).padStart(44, "1");
  const ch = await sha512(edSeed);
  ch[0] &= 248; ch[31] &= 127; ch[31] |= 64;
  return { addr, edSeed, edPub: kp.publicKey, edSec: kp.secretKey, curveSec: ch.slice(0,32), curvePub: nacl.scalarMult.base(ch.slice(0,32)) };
}

function signingJson(tx: any): string {
  const dec = (v: string) => v.replace(/^0+/, "") || "0";
  const ts = Number.isInteger(tx.timestamp) ? tx.timestamp + ".0" : String(tx.timestamp);
  return `{"from":"${tx.from}","to_":"${tx.to}","amount":"${dec(tx.amount)}","nonce":${tx.nonce},"ou":"${dec(tx.ou)}","timestamp":${ts},"op_type":"${tx.opType}"}`;
}

function ed25519Sign(msg: string, sk64: Uint8Array): string {
  const sm = nacl.sign(new TextEncoder().encode(msg), sk64);
  return encodeBase64(sm.slice(0, 64));
}

let rpcId = 1;
async function rpc(method: string, params: any, timeout = 20000) {
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

async function main() {
  const id1 = await deriveIdentity(MNEMONIC);
  console.log("Wallet 1:", id1.addr);
  console.log("Wallet 2:", WALLET2_ADDR);
  console.log();

  // First, check if wallet 1 has any nonce (even if "sender not found")
  const bal = await rpc("octra_balance", [id1.addr]);
  console.log("Wallet 1 balance check:", JSON.stringify(bal).slice(0, 200));
  console.log();

  // Build + sign tx: send 0.001 OCT (100000 raw units) from w1 to w2
  const tx = {
    from: id1.addr,
    to: WALLET2_ADDR,
    amount: "100000",    // 0.001 OCT
    nonce: 0,
    ou: "1000",          // fee 0.00001 OCT
    timestamp: Date.now() / 1000,
    opType: "standard",
  };
  const sigStr = signingJson(tx);
  const sig = ed25519Sign(sigStr, id1.edSec);
  const txJson = {
    from: tx.from,
    to_: tx.to,
    amount: tx.amount,
    nonce: tx.nonce,
    ou: tx.ou,
    timestamp: tx.timestamp,
    signature: sig,
    op_type: tx.opType,
    public_key: encodeBase64(id1.edPub),
  };

  console.log("=== Retry octra_submit with backoff ===\n");
  for (let attempt = 1; attempt <= 5; attempt++) {
    console.log(`--- Attempt ${attempt} ---`);
    const submit = await rpc("octra_submit", [txJson], 25000);
    console.log("Response:", JSON.stringify(submit).slice(0, 400));
    if (submit.result) {
      console.log("✓ Transaction submitted! Result:", JSON.stringify(submit.result));
      // Check tx status
      const txHash = submit.result.tx_hash || submit.result.hash;
      if (txHash) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await rpc("octra_transaction", [txHash]);
        console.log("Tx status:", JSON.stringify(status).slice(0, 400));
      }
      break;
    }
    if (submit.error) {
      const msg = submit.error.message || "";
      if (msg.includes("capacity") || msg.includes("retry")) {
        console.log("  → capacity issue, waiting 8s before retry...");
        await new Promise((r) => setTimeout(r, 8000));
        continue;
      } else {
        console.log("  → hard error, stopping");
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Also try the funded address — maybe we can query its nonce and see what a funded account looks like
  console.log("\n=== Check funded address oct9a1XG... for reference ===\n");
  const fundedBal = await rpc("octra_balance", ["oct9a1XGFNTq5aD52XwA9uq341QSEAb5ChrrqoRhwYARcMG"]);
  console.log("Funded address balance:", JSON.stringify(fundedBal.result).slice(0, 300));
}

main().catch(console.error);
