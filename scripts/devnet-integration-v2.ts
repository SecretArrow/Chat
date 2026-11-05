/**
 * Devnet integration v2: paginated stealth outputs + try to use the funded address.
 *
 * Key finding from v1:
 *   - Mnemonic + private key derive address oct2MPJ6... (unfunded on devnet)
 *   - User's expected address oct9a1XG... IS funded (balance 100.213801, nonce 384)
 *     with registered pubkey R/i3hxy5qDMuYk+6912DaxrNk/cHCdx1kxA6conkCu0=
 *   - The registered pubkey does NOT match the mnemonic-derived pubkey
 *
 * This script:
 *   1. Fetches real stealth outputs via the paginated API
 *   2. Scans them with our curve key (from the mnemonic)
 *   3. Also fetches the funded address's recent transactions
 *   4. Probes more circle methods to find an existing circle
 */

import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";
import * as bs58 from "bs58";
import * as bip39 from "bip39";

const MNEMONIC =
  "cross number result leg web curious include cake wreck truly stomach cargo ordinary loop dog exhibit tuna news pole capital fringe trial creek duck";
const DERIVED_ADDR = "oct2MPJ6vC2EYHtVd5sBwDdUME8dyRzJZ8YzqiRkNJTuMNt";
const FUNDED_ADDR = "oct9a1XGFNTq5aD52XwA9uq341QSEAb5ChrrqoRhwYARcMG";
const DEVNET_URL = "https://devnet.octrascan.io/rpc";

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

async function main() {
  // Derive curve key from mnemonic
  const masterSeed = new Uint8Array(await bip39.mnemonicToSeed(MNEMONIC));
  const edSeed = (await hmacSha512(new TextEncoder().encode("Octra seed"), masterSeed)).slice(0, 32);
  const curveH = await sha512(edSeed);
  curveH[0] &= 248;
  curveH[31] &= 127;
  curveH[31] |= 64;
  const curveSec = curveH.slice(0, 32);
  const curvePub = nacl.scalarMult.base(curveSec);
  console.log("Our curve pub:", "cp_" + encodeBase64(curvePub));
  console.log("Our address  :", DERIVED_ADDR);
  console.log("Funded addr  :", FUNDED_ADDR);
  console.log();

  let id = 100;
  async function rpc(method: string, params: any, timeout = 15000) {
    try {
      const res = await fetch(DEVNET_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
        signal: AbortSignal.timeout(timeout),
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return { error: { message: "non-JSON response, len=" + text.length } };
      }
    } catch (e: any) {
      return { error: { message: e.message } };
    }
  }

  // 1. Fetch stealth outputs (paginated, small limit)
  console.log("=== Stealth outputs (paginated) ===");
  const stealthPage = await rpc("octra_stealthOutputsPage", [0, null, 50], 20000);
  if (stealthPage.result) {
    const arr = Array.isArray(stealthPage.result) ? stealthPage.result : (stealthPage.result.outputs ?? stealthPage.result.items ?? []);
    console.log(`Got ${arr.length} stealth outputs`);
    if (arr.length > 0) {
      console.log("First output keys:", Object.keys(arr[0]));
      console.log("First output:", JSON.stringify(arr[0]).slice(0, 400));

      // Scan with our curve key
      let matched = 0;
      const fields = ["eph_pub", "ephPub", "ephemeral_pub", "ephemeral", "pub", "eph_pubkey"];
      for (const out of arr) {
        let ephPubB64: string | undefined;
        for (const f of fields) {
          if (out[f]) { ephPubB64 = out[f]; break; }
        }
        const nonceB64 = out.nonce || out.n;
        const ctB64 = out.ct || out.ciphertext || out.payload || out.encrypted;
        if (!ephPubB64 || !nonceB64 || !ctB64) continue;

        try {
          const ephPub = decodeBase64(ephPubB64);
          const shared = nacl.scalarMult(curveSec, ephPub);
          const nonce = decodeBase64(nonceB64);
          const ct = decodeBase64(ctB64);
          const opened = nacl.secretbox.open(ct, nonce, shared);
          if (opened) {
            matched++;
            console.log(`  ✓ MATCHED! Decrypted: ${new TextDecoder().decode(opened).slice(0, 200)}`);
          }
        } catch {}
      }
      console.log(`Scanned ${arr.length} outputs, matched ${matched} for our curve key`);
    }
  } else {
    console.log("ERROR:", stealthPage.error?.message ?? JSON.stringify(stealthPage).slice(0, 300));
  }
  console.log();

  // 2. Fetch funded address's recent transactions (real data!)
  console.log("=== Funded address recent transactions ===");
  const account = await rpc("octra_account", [FUNDED_ADDR, 20]);
  if (account.result) {
    console.log("Balance:", account.result.balance);
    console.log("Nonce  :", account.result.nonce);
    console.log("Tx count:", account.result.tx_count);
    if (account.result.recent_txs) {
      console.log("Recent txs:");
      for (const tx of account.result.recent_txs.slice(0, 5)) {
        console.log("  ", JSON.stringify(tx));
      }
    }
  }
  console.log();

  // 3. Get a specific transaction by hash
  console.log("=== Get transaction by hash ===");
  if (account.result?.recent_txs?.[0]?.hash) {
    const txHash = account.result.recent_txs[0].hash;
    const tx = await rpc("octra_transaction", [txHash]);
    if (tx.result) {
      console.log("Transaction:", JSON.stringify(tx.result).slice(0, 600));
    } else {
      console.log("ERROR:", tx.error?.message);
    }
  }
  console.log();

  // 4. List contracts (to find circles deployed as contracts)
  console.log("=== Contracts on devnet ===");
  const contracts = await rpc("octra_listContracts", []);
  if (contracts.result) {
    const arr = Array.isArray(contracts.result) ? contracts.result : [];
    console.log(`Got ${arr.length} contracts`);
    for (const c of arr.slice(0, 5)) {
      console.log("  ", JSON.stringify(c).slice(0, 200));
    }
    // Try circle_info with each contract address
    console.log("\nTrying circle_info on each contract address:");
    for (const c of arr.slice(0, 10)) {
      const addr = typeof c === "string" ? c : (c.address || c.addr || c.id);
      if (!addr || typeof addr !== "string") continue;
      const ci = await rpc("circle_info", [addr]);
      const summary = ci.result ? `ok: ${JSON.stringify(ci.result).slice(0, 200)}` : `err ${ci.error?.code}`;
      console.log(`  circle_info(${addr.slice(0, 30)}) → ${summary}`);
    }
  }
  console.log();

  // 5. staging_view (pending transactions)
  console.log("=== Staging (pending transactions) ===");
  const staging = await rpc("staging_view", []);
  if (staging.result) {
    console.log("Pending txs:", staging.result.count, "/", staging.result.total);
    if (staging.result.transactions) {
      for (const t of staging.result.transactions.slice(0, 3)) {
        console.log("  ", JSON.stringify(t).slice(0, 200));
      }
    }
  }
  console.log();

  // 6. Validator set proof
  console.log("=== Validator set proof ===");
  const proof = await rpc("octra_validatorSetProof", []);
  if (proof.result) {
    console.log("Result:", JSON.stringify(proof.result).slice(0, 300));
  } else {
    console.log("ERROR:", proof.error?.message);
  }
}

main().catch(console.error);
