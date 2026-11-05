#!/usr/bin/env npx tsx
/**
 * Deploy a ChatCircle contract to Octra devnet.
 *
 * Usage:
 *   npx tsx scripts/deploy-circle.ts \
 *     --mnemonic "your 24-word mnemonic" \
 *     --bytecode build/chat_circle.bc \
 *     --name "OctraChat Public Room" \
 *     --kind room \
 *     --network devnet
 *
 *   npx tsx scripts/deploy-circle.ts verify --circle oct...
 *   npx tsx scripts/deploy-circle.ts join --circle oct... --mnemonic "..."
 *   npx tsx scripts/deploy-circle.ts post --circle oct... --mnemonic "..." --msg "Hello!"
 */

import * as bip39 from "bip39";
import nacl from "tweetnacl";
import { encodeBase64 } from "tweetnacl-util";
import * as bs58 from "bs58";

// Parse args
const args = process.argv.slice(2);
const getArg = (name: string) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
};

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
    mnemonic, edSeed, edPub: kp.publicKey, edSec: kp.secretKey, address,
    curveSec: ch.slice(0, 32),
    curvePub: nacl.scalarMult.base(ch.slice(0, 32)),
  };
}

const DEVNET_URL = "https://devnet.octrascan.io/rpc";
let rpcId = 1;
async function rpc(method: string, params: any, timeout = 15000) {
  const res = await fetch(DEVNET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
    signal: AbortSignal.timeout(timeout),
  });
  return await res.json();
}

// Import the tx-builder functions inline (since scripts aren't in the build)
function decimalText(v: string) { return v.replace(/^0+/, "") || "0"; }
function formatTs(ts: number) { return Number.isInteger(ts) ? ts + ".0" : String(ts); }

function buildSigningJson(tx: any): string {
  let s = `{`;
  s += `"from":"${tx.from}","to_":"${tx.to_}","amount":"${decimalText(tx.amount)}"`;
  s += `,"nonce":${tx.nonce},"ou":"${decimalText(tx.ou)}","timestamp":${formatTs(tx.timestamp)}`;
  s += `,"op_type":"${tx.op_type}"`;
  if (tx.message) s += `,"message":"${tx.message}"`;
  s += `}`;
  return s;
}

function signTx(tx: any, edSec: Uint8Array): string {
  const msg = new TextEncoder().encode(buildSigningJson(tx));
  const sm = nacl.sign(msg, edSec);
  return encodeBase64(sm.slice(0, 64));
}

async function main() {
  const command = args[0] || "deploy";

  if (command === "deploy") {
    const mnemonic = getArg("mnemonic");
    const bytecodePath = getArg("bytecode");
    const name = getArg("name") || "OctraChat Circle";
    const kind = getArg("kind") || "group";
    const description = getArg("description") || "";

    if (!mnemonic || !bytecodePath) {
      console.error("Usage: deploy --mnemonic <mnemonic> --bytecode <path> [--name <name>] [--kind room|group|dm]");
      process.exit(1);
    }

    const id = await deriveIdentity(mnemonic);
    console.log("Deployer address:", id.address);

    // Check balance
    const bal = await rpc("octra_balance", [id.address]);
    if (bal.error) {
      console.error("Balance check failed:", bal.error.message);
      console.error("(Wallet must be funded on devnet to deploy)");
      process.exit(1);
    }
    console.log("Balance:", bal.result?.balance, "OCT, nonce:", bal.result?.nonce);

    // Read bytecode
    const fs = await import("fs");
    const bytecode = fs.readFileSync(bytecodePath);
    const bytecodeB64 = bytecode.toString("base64");
    console.log("Bytecode size:", bytecode.length, "bytes");

    // Compute contract address
    const computeRes = await rpc("octra_computeContractAddress", [bytecodeB64, id.address, bal.result.nonce]);
    const circleAddr = computeRes.result?.address || computeRes.result;
    console.log("Expected circle address:", circleAddr);

    // Build deploy tx
    const tx = {
      from: id.address,
      to_: id.address,
      amount: "0",
      nonce: bal.result.nonce,
      ou: "500000", // 0.005 OCT deploy fee
      timestamp: Date.now() / 1000,
      op_type: "deploy",
      message: bytecodeB64,
    };
    const sig = signTx(tx, id.edSec);
    const signedTx = { ...tx, signature: sig, public_key: encodeBase64(id.edPub) };

    console.log("\nSubmitting deploy transaction...");
    const submit = await rpc("octra_submit", [signedTx], 30000);
    if (submit.error) {
      console.error("Deploy failed:", submit.error.message);
      process.exit(1);
    }
    console.log("✓ Deploy submitted!");
    console.log("  Circle address:", circleAddr);
    console.log("  Tx result:", JSON.stringify(submit.result));

    // Poll for confirmation
    console.log("\nWaiting for confirmation (may take 2-17 minutes)...");
    const txHash = submit.result?.tx_hash || submit.result?.hash;
    if (txHash) {
      for (let i = 0; i < 240; i++) { // 20 min max
        await new Promise((r) => setTimeout(r, 5000));
        const status = await rpc("octra_transaction", [txHash], 10000);
        if (status.result?.status === "confirmed") {
          console.log("✓ CONFIRMED at epoch", status.result.epoch);
          break;
        }
        if (status.result?.status === "rejected" || status.result?.status === "failed") {
          console.error("✗ REJECTED:", status.result);
          break;
        }
        process.stdout.write(".");
      }
    }

    console.log("\n=== Deploy complete ===");
    console.log("Circle address:", circleAddr);
    console.log("Share this address with members so they can join.");

  } else if (command === "verify") {
    const circle = getArg("circle");
    if (!circle) { console.error("Usage: verify --circle <addr>"); process.exit(1); }
    console.log("Verifying circle:", circle);
    const info = await rpc("circle_info", [circle]);
    console.log("Circle info:", JSON.stringify(info, null, 2));

  } else if (command === "join") {
    const circle = getArg("circle");
    const mnemonic = getArg("mnemonic");
    if (!circle || !mnemonic) { console.error("Usage: join --circle <addr> --mnemonic <mnemonic>"); process.exit(1); }

    const id = await deriveIdentity(mnemonic);
    console.log("Joiner address:", id.address);
    const bal = await rpc("octra_balance", [id.address]);
    console.log("Balance:", bal.result?.balance);

    const curvePubB64 = encodeBase64(id.curvePub);
    const tx = {
      from: id.address,
      to_: circle,
      amount: "0",
      nonce: bal.result?.nonce || 0,
      ou: "1000",
      timestamp: Date.now() / 1000,
      op_type: "contract_call",
      message: JSON.stringify({ method: "join", params: { curve_pub: "cp_" + curvePubB64 } }),
    };
    const sig = signTx(tx, id.edSec);
    const submit = await rpc("octra_submit", [{ ...tx, signature: sig, public_key: encodeBase64(id.edPub) }]);
    console.log("Join result:", JSON.stringify(submit));

  } else if (command === "post") {
    const circle = getArg("circle");
    const mnemonic = getArg("mnemonic");
    const msg = getArg("msg");
    if (!circle || !mnemonic || !msg) { console.error("Usage: post --circle <addr> --mnemonic <mnemonic> --msg <text>"); process.exit(1); }

    const id = await deriveIdentity(mnemonic);
    console.log("Poster address:", id.address);
    const bal = await rpc("octra_balance", [id.address]);
    console.log("Balance:", bal.result?.balance);

    // For on-chain posting, encrypt with self (simplified)
    const plaintext = msg;
    const messageKey = nacl.randomBytes(32);
    const nonce = nacl.randomBytes(24);
    const body = nacl.secretbox(new TextEncoder().encode(plaintext), nonce, messageKey);
    // Wrap messageKey for self
    const eph = nacl.box.keyPair();
    const wrapNonce = nacl.randomBytes(24);
    const wrapped = nacl.box(messageKey, wrapNonce, id.curvePub, eph.secretKey);
    const wrapStr = encodeBase64(wrapped) + "." + encodeBase64(eph.publicKey) + "." + encodeBase64(wrapNonce);
    const myKey = "cp_" + encodeBase64(id.curvePub);

    const tx = {
      from: id.address,
      to_: circle,
      amount: "0",
      nonce: bal.result?.nonce || 0,
      ou: "1000",
      timestamp: Date.now() / 1000,
      op_type: "contract_call",
      message: JSON.stringify({
        method: "post_message",
        params: {
          body: encodeBase64(body),
          body_nonce: encodeBase64(nonce),
          wraps: { [myKey]: wrapStr },
        },
      }),
    };
    const sig = signTx(tx, id.edSec);
    const submit = await rpc("octra_submit", [{ ...tx, signature: sig, public_key: encodeBase64(id.edPub) }]);
    console.log("Post result:", JSON.stringify(submit));

  } else {
    console.log("Commands: deploy | verify | join | post");
    console.log("Use --help for details");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
