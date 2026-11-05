#!/usr/bin/env npx tsx
/**
 * Circle Relayer — batches messages from multiple clients into single
 * Octra transactions for cost-effective on-chain chat.
 *
 * Architecture:
 *   Client POST /relay { circle, message, wraps } → relayer queues
 *   Relayer batches every N seconds → 1 octra_submit → chain
 *   Client polls /status/{id} → confirmed when tx is on-chain
 *
 * Usage:
 *   npx tsx scripts/relayer.ts --port 9494 --network devnet --mnemonic "..."
 *
 * Endpoints:
 *   POST /relay         — submit a message for batching
 *   GET  /status/:id    — check message status
 *   GET  /batch         — view current batch
 *   POST /flush         — force-submit current batch
 */

import * as bip39 from "bip39";
import nacl from "tweetnacl";
import { encodeBase64 } from "tweetnacl-util";
import * as bs58 from "bs58";
import http from "http";

const args = process.argv.slice(2);
const getArg = (name: string) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const PORT = parseInt(getArg("port") || "9494", 10);
const NETWORK = getArg("network") || "devnet";
const MNEMONIC = getArg("mnemonic") || "";
const BATCH_INTERVAL = parseInt(getArg("batchInterval") || "30", 10); // seconds
const MAX_BATCH_SIZE = parseInt(getArg("maxBatch") || "50", 10);

const DEVNET_URL = "https://devnet.octrascan.io/rpc";
const MAINNET_URL = "https://octra.network/rpc";
const RPC_URL = NETWORK === "mainnet" ? MAINNET_URL : DEVNET_URL;

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
  return { mnemonic, edSeed, edPub: kp.publicKey, edSec: kp.secretKey, address };
}

let rpcId = 1;
async function rpc(method: string, params: any, timeout = 15000) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
    signal: AbortSignal.timeout(timeout),
  });
  return await res.json();
}

// ─── Batch queue ──────────────────────────────────────────

interface QueuedMessage {
  id: string;
  circle: string;
  fromAddr: string;
  body: string;       // base64 ciphertext
  bodyNonce: string;  // base64
  wraps: Record<string, string>;
  submittedAt: number;
  status: "queued" | "submitting" | "pending" | "confirmed" | "failed";
  txHash?: string;
  error?: string;
}

const queue: Map<string, QueuedMessage> = new Map();
let relayerIdentity: any = null;

async function flushBatch() {
  if (!relayerIdentity) {
    console.log("Relayer identity not ready");
    return;
  }

  const pending = Array.from(queue.values()).filter((m) => m.status === "queued");
  if (pending.length === 0) return;

  console.log(`Flushing batch of ${pending.length} messages...`);

  // Group by circle
  const byCircle: Map<string, QueuedMessage[]> = new Map();
  for (const msg of pending) {
    const arr = byCircle.get(msg.circle) || [];
    arr.push(msg);
    byCircle.set(msg.circle, arr);
  }

  // Submit one transaction per circle (batch)
  for (const [circle, msgs] of byCircle) {
    if (msgs.length > MAX_BATCH_SIZE) {
      // Split into chunks
      for (let i = 0; i < msgs.length; i += MAX_BATCH_SIZE) {
        await submitBatch(circle, msgs.slice(i, i + MAX_BATCH_SIZE));
      }
    } else {
      await submitBatch(circle, msgs);
    }
  }
}

async function submitBatch(circle: string, msgs: QueuedMessage[]) {
  // Mark as submitting
  for (const m of msgs) m.status = "submitting";

  // Get nonce
  const bal = await rpc("octra_balance", [relayerIdentity.address]);
  if (bal.error) {
    for (const m of msgs) { m.status = "failed"; m.error = "relayer unfunded"; }
    console.error("Relayer unfunded:", bal.error.message);
    return;
  }
  const nonce = bal.result?.nonce || 0;

  // Build batch message (multiple messages in one contract_call)
  const batchPayload = msgs.map((m) => ({
    from: m.fromAddr,
    body: m.body,
    body_nonce: m.bodyNonce,
    wraps: m.wraps,
  }));

  const tx = {
    from: relayerIdentity.address,
    to_: circle,
    amount: "0",
    nonce,
    ou: "1000", // single fee for the batch
    timestamp: Date.now() / 1000,
    op_type: "contract_call",
    message: JSON.stringify({
      method: "post_batch",
      params: { messages: batchPayload },
    }),
  };

  // Sign
  const msgBytes = new TextEncoder().encode(JSON.stringify(tx));
  const sm = nacl.sign(msgBytes, relayerIdentity.edSec);
  const sig = encodeBase64(sm.slice(0, 64));
  const signedTx = { ...tx, signature: sig, public_key: encodeBase64(relayerIdentity.edPub) };

  // Submit
  const submit = await rpc("octra_submit", [signedTx], 30000);
  if (submit.error) {
    for (const m of msgs) { m.status = "failed"; m.error = submit.error.message; }
    console.error("Batch submit failed:", submit.error.message);
    return;
  }

  const txHash = submit.result?.tx_hash || submit.result?.hash || "";
  console.log(`Batch submitted: ${msgs.length} msgs, tx=${txHash.slice(0, 16)}...`);

  // Update status
  for (const m of msgs) {
    m.status = "pending";
    m.txHash = txHash;
  }

  // Poll for confirmation (async, don't block)
  pollConfirmation(txHash, msgs);
}

async function pollConfirmation(txHash: string, msgs: QueuedMessage[]) {
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const status = await rpc("octra_transaction", [txHash], 10000);
      if (status.result?.status === "confirmed") {
        for (const m of msgs) m.status = "confirmed";
        console.log(`Batch confirmed: ${txHash.slice(0, 16)}... (${msgs.length} msgs)`);
        return;
      }
      if (status.result?.status === "rejected" || status.result?.status === "failed") {
        for (const m of msgs) { m.status = "failed"; m.error = "rejected by chain"; }
        console.error(`Batch rejected: ${txHash.slice(0, 16)}...`);
        return;
      }
    } catch {}
  }
  for (const m of msgs) { m.status = "failed"; m.error = "timeout"; }
}

// ─── HTTP server ──────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "", `http://localhost:${PORT}`);

  if (req.method === "POST" && url.pathname === "/relay") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const data = JSON.parse(body);
      const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const msg: QueuedMessage = {
        id,
        circle: data.circle,
        fromAddr: data.from,
        body: data.body,
        bodyNonce: data.bodyNonce,
        wraps: data.wraps,
        submittedAt: Date.now(),
        status: "queued",
      };
      queue.set(id, msg);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, id, status: "queued" }));
      console.log(`Queued message ${id} for circle ${data.circle.slice(0, 20)}...`);
    } catch (e: any) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/status/")) {
    const id = url.pathname.split("/")[2];
    const msg = queue.get(id);
    if (msg) {
      res.writeHead(200);
      res.end(JSON.stringify({ id, status: msg.status, txHash: msg.txHash, error: msg.error }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "not found" }));
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/batch") {
    const pending = Array.from(queue.values()).filter((m) => m.status === "queued");
    res.writeHead(200);
    res.end(JSON.stringify({ queued: pending.length, messages: pending }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/flush") {
    await flushBatch();
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, flushed: true }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true,
      relayer: relayerIdentity?.address,
      network: NETWORK,
      queued: queue.size,
      batchInterval: BATCH_INTERVAL,
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "not found" }));
});

async function main() {
  if (!MNEMONIC) {
    console.error("Usage: npx tsx scripts/relayer.ts --port 9494 --network devnet --mnemonic <mnemonic>");
    console.error("The relayer wallet must be funded on the target network.");
    process.exit(1);
  }

  console.log("Starting OctraChat Circle Relayer...");
  console.log("Network:", NETWORK);
  console.log("RPC URL:", RPC_URL);

  relayerIdentity = await deriveIdentity(MNEMONIC);
  console.log("Relayer address:", relayerIdentity.address);

  // Check balance
  const bal = await rpc("octra_balance", [relayerIdentity.address]);
  if (bal.result) {
    console.log("Relayer balance:", bal.result.balance, "OCT");
  } else {
    console.warn("⚠️  Relayer wallet not found on network — fund it to enable submissions");
    console.warn("   Fund address:", relayerIdentity.address);
  }

  server.listen(PORT, () => {
    console.log(`\n✓ Relayer listening on http://0.0.0.0:${PORT}`);
    console.log(`   POST /relay    — submit message for batching`);
    console.log(`   GET  /status/:id — check message status`);
    console.log(`   GET  /batch    — view queued batch`);
    console.log(`   POST /flush    — force-submit batch`);
    console.log(`   GET  /health   — health check`);
    console.log(`\nBatch interval: ${BATCH_INTERVAL}s (max ${MAX_BATCH_SIZE} msgs/batch)`);
  });

  // Auto-flush on interval
  setInterval(flushBatch, BATCH_INTERVAL * 1000);
  console.log(`Auto-flush every ${BATCH_INTERVAL}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
