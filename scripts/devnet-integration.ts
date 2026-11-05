/**
 * Devnet integration test using the user's mnemonic + private key.
 *
 * 1. Derive identity from mnemonic (Octra v2 HD derivation)
 * 2. Verify the private key matches the derived ed_seed
 * 3. Query devnet RPC with correct method names:
 *    - node_status
 *    - octra_balance, octra_account for the derived address
 *    - octra_transactionsByAddress
 *    - octra_stealthOutputs (real stealth output pool from devnet!)
 *    - octra_listContracts
 *    - circle_info (with various circle IDs)
 *    - octra_circleStorageDump, octra_circleObjectList
 * 4. If stealth outputs exist, try to scan + decrypt them with our curve key
 */

import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";
import * as bs58 from "bs58";
import * as bip39 from "bip39";

const MNEMONIC =
  "cross number result leg web curious include cake wreck truly stomach cargo ordinary loop dog exhibit tuna news pole capital fringe trial creek duck";
const PRIV_KEY_B64 = "XcxHYHpg8ppVnkRLuPnb6THiMb6w0DqWJdDh9IKa20w=";
const USER_EXPECTED_ADDR = "oct9a1XGFNTq5aD52XwA9uq341QSEAb5ChrrqoRhwYARcMG";
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

async function addressFromPubkey(pubkey: Uint8Array): Promise<string> {
  const h = await sha256(pubkey);
  return "oct" + bs58.default.encode(h).padStart(44, "1");
}

let rpcId = 1;
async function rpc(method: string, params: any, timeout = 12000): Promise<any> {
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

async function rpcWithSource(method: string, params: any, source: string, timeout = 15000): Promise<any> {
  try {
    const body: any = { jsonrpc: "2.0", id: rpcId++, method, params };
    if (source) body.source = source;
    const res = await fetch(DEVNET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    return await res.json();
  } catch (e: any) {
    return { error: { message: e.message } };
  }
}

async function main() {
  console.log("=== OctraChat Devnet Integration Test ===\n");
  console.log("Mnemonic:", MNEMONIC.slice(0, 40), "...");
  console.log("User-provided private key (b64):", PRIV_KEY_B64);
  console.log("User-expected address:", USER_EXPECTED_ADDR);
  console.log();

  // Step 1: Derive identity from mnemonic using Octra v2 HD derivation
  console.log("--- Step 1: Derive identity from mnemonic ---");
  const masterSeed = new Uint8Array(await bip39.mnemonicToSeed(MNEMONIC));
  console.log("master_seed (hex):", hex(masterSeed));

  const edSeed = (await hmacSha512(new TextEncoder().encode("Octra seed"), masterSeed)).slice(0, 32);
  console.log("ed_seed (v2, idx 0, hex):", hex(edSeed));
  console.log("ed_seed (b64)            :", encodeBase64(edSeed));
  console.log("Matches provided priv key:", encodeBase64(edSeed) === PRIV_KEY_B64 ? "✓ YES" : "✗ no");

  const kp = nacl.sign.keyPair.fromSeed(edSeed);
  const derivedAddr = await addressFromPubkey(kp.publicKey);
  console.log("Derived address          :", derivedAddr);
  console.log("User-expected address    :", USER_EXPECTED_ADDR);
  console.log("Match                    :", derivedAddr === USER_EXPECTED_ADDR ? "✓ YES" : "✗ NO (expected addr is from a different key)");

  // Curve25519 keypair (for DM/stealth)
  const curveH = await sha512(edSeed);
  curveH[0] &= 248;
  curveH[31] &= 127;
  curveH[31] |= 64;
  const curveSec = curveH.slice(0, 32);
  const curvePub = nacl.scalarMult.base(curveSec);
  console.log("Curve pub (cp_...)       :", "cp_" + encodeBase64(curvePub));
  console.log();

  // Use whichever address — we'll query BOTH
  const addrsToProbe = Array.from(new Set([derivedAddr, USER_EXPECTED_ADDR]));

  // Step 2: node_status
  console.log("--- Step 2: node_status ---");
  const ns = await rpc("node_status", []);
  if (ns.result) {
    console.log("  epoch          :", ns.result.epoch);
    console.log("  network_version:", ns.result.network_version);
    console.log("  validator      :", ns.result.validator);
    console.log("  state_root     :", ns.result.state_root?.slice(0, 32), "...");
    console.log("  txid_hi        :", ns.result.txid_hi);
  } else {
    console.log("  ERROR:", ns.error?.message);
  }
  console.log();

  // Step 3: For each address, probe account methods
  for (const addr of addrsToProbe) {
    console.log(`--- Step 3: Account queries for ${addr} ---`);

    const balance = await rpc("octra_balance", [addr]);
    console.log("  octra_balance       :", balance.result ? JSON.stringify(balance.result) : `err ${balance.error?.code} "${balance.error?.message}"`);

    const account = await rpc("octra_account", [addr, 20]);
    console.log("  octra_account       :", account.result ? JSON.stringify(account.result).slice(0, 300) : `err ${account.error?.code} "${account.error?.message}"`);

    const pubKey = await rpc("octra_publicKey", [addr]);
    console.log("  octra_publicKey     :", pubKey.result ? JSON.stringify(pubKey.result) : `err ${pubKey.error?.code} "${pubKey.error?.message}"`);

    const viewPub = await rpc("octra_viewPubkey", [addr]);
    console.log("  octra_viewPubkey    :", viewPub.result ? JSON.stringify(viewPub.result) : `err ${viewPub.error?.code} "${viewPub.error?.message}"`);

    const txs = await rpcWithSource("octra_transactionsByAddress", [addr, 10, 0], "live");
    console.log("  octra_txsByAddress  :", txs.result ? `got ${Array.isArray(txs.result) ? txs.result.length : Object.keys(txs.result).length} items` : `err ${txs.error?.code} "${txs.error?.message}"`);

    console.log();
  }

  // Step 4: Stealth outputs (REAL devnet stealth pool!)
  console.log("--- Step 4: Real stealth outputs from devnet ---");
  const stealth = await rpc("octra_stealthOutputs", [0], 20000);
  if (stealth.result) {
    const arr = Array.isArray(stealth.result) ? stealth.result : [stealth.result];
    console.log(`  Got ${arr.length} stealth outputs from devnet`);
    if (arr.length > 0) {
      console.log("  First 3 outputs:");
      for (let i = 0; i < Math.min(3, arr.length); i++) {
        console.log("    ", JSON.stringify(arr[i]).slice(0, 200));
      }

      // Try to scan + decrypt each output with our curve key
      console.log("\n  Scanning outputs with our Curve25519 key...");
      let matched = 0;
      for (const out of arr) {
        // Output format unknown — try common field names
        const ephPubB64 = out.eph_pub || out.ephPub || out.ephemeral || out.pub;
        const tagB64 = out.tag || out.view_tag || out.viewTag;
        const nonceB64 = out.nonce;
        const ctB64 = out.ct || out.ciphertext || out.payload;
        if (!ephPubB64 || !nonceB64 || !ctB64) continue;

        try {
          const ephPub = decodeBase64(ephPubB64);
          // Compute shared = ECDH(curveSec, ephPub)
          const shared = nacl.scalarMult(curveSec, ephPub);
          const nonce = decodeBase64(nonceB64);
          const ct = decodeBase64(ctB64);
          const opened = nacl.secretbox.open(ct, nonce, shared);
          if (opened) {
            matched++;
            console.log(`  ✓ MATCHED output! Decrypted: ${new TextDecoder().decode(opened).slice(0, 200)}`);
          }
        } catch {}
      }
      console.log(`  Matched ${matched}/${arr.length} outputs for our curve key`);
    }
  } else {
    console.log("  ERROR:", stealth.error?.message);
  }
  console.log();

  // Step 5: List contracts + try circle methods
  console.log("--- Step 5: Contracts + circles on devnet ---");
  const contracts = await rpc("octra_listContracts", []);
  console.log("  octra_listContracts :", contracts.result ? `got ${Array.isArray(contracts.result) ? contracts.result.length : "obj"} contracts` : `err ${contracts.error?.code} "${contracts.error?.message}"`);
  if (contracts.result && Array.isArray(contracts.result) && contracts.result.length > 0) {
    console.log("  First contract:", JSON.stringify(contracts.result[0]).slice(0, 200));
  }

  const staging = await rpc("staging_view", []);
  console.log("  staging_view        :", staging.result ? JSON.stringify(staging.result).slice(0, 200) : `err ${staging.error?.message}`);

  // Try circle_info with a few candidate circle IDs
  const circleCandidates = [derivedAddr, USER_EXPECTED_ADDR, "test", "circle_1", "circ_test"];
  for (const cid of circleCandidates) {
    const ci = await rpc("circle_info", [cid]);
    const summary = ci.result ? `ok: ${JSON.stringify(ci.result).slice(0, 150)}` : `err ${ci.error?.code} "${ci.error?.message}"`;
    console.log(`  circle_info(${cid.slice(0, 20)}) → ${summary}`);
  }
  console.log();

  // Step 6: Try circle methods with both addrs as circle IDs
  console.log("--- Step 6: Circle storage/object methods ---");
  for (const cid of [derivedAddr, USER_EXPECTED_ADDR]) {
    console.log(`\n  Circle ID: ${cid.slice(0, 30)}...`);
    const methods: Array<[string, any]> = [
      ["octra_circleStorageDump", [cid]],
      ["octra_circleObjectList", [cid]],
      ["octra_circleObjectRefs", [cid]],
      ["octra_circleTransportPolicy", [cid]],
      ["octra_circleHfhePolicy", [cid]],
      ["octra_circleStorage", [cid, "messages"]],
      ["octra_circleStorage", [cid, "head"]],
    ];
    for (const [m, p] of methods) {
      const r = await rpc(m, p);
      const summary = r.result ? `ok: ${JSON.stringify(r.result).slice(0, 150)}` : `err ${r.error?.code}`;
      console.log(`    ${m.padEnd(32)} → ${summary}`);
    }
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
