/**
 * Deeper devnet RPC probe.
 */
import nacl from "tweetnacl";
import { decodeBase64, encodeBase64 } from "tweetnacl-util";
import * as bs58 from "bs58";

const PRIV_KEY_B64 = "XcxHYHpg8ppVnkRLuPnb6THiMb6w0DqWJdDh9IKa20w=";
const EXPECTED_ADDR = "oct9a1XGFNTq5aD52XwA9uq341QSEAb5ChrrqoRhwYARcMG";
const DEVNET_URL = "https://devnet.octrascan.io/rpc";

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const d = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(d);
}

const seed = decodeBase64(PRIV_KEY_B64);
const kp = nacl.sign.keyPair.fromSeed(seed);

let id = 1;
async function rpc(method: string, params: any, timeout = 8000) {
  try {
    const res = await fetch(DEVNET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
      signal: AbortSignal.timeout(timeout),
    });
    const json: any = await res.json();
    return json;
  } catch (e: any) {
    return { error: { message: e.message } };
  }
}

async function main() {
  const derivedAddr = "oct" + bs58.default.encode(await sha256(kp.publicKey)).padStart(44, "1");
  console.log("Derived addr:", derivedAddr);
  console.log("Expected addr:", EXPECTED_ADDR);
  console.log("Pub key (b64):", encodeBase64(kp.publicKey));
  console.log();

  console.log("=== Probe transaction-related methods ===\n");
  const txMethods: Array<[string, any]> = [
    ["submit_tx", [{ from: EXPECTED_ADDR, to: EXPECTED_ADDR, amount: 1, nonce: 0 }]],
    ["submit_tx", [{ from: derivedAddr, to: derivedAddr, amount: 1, nonce: 0 }]],
    ["submit_tx", ["test"]],
    ["submit_tx", []],
    ["get_transaction", ["1"]],
    ["get_transaction", [1]],
    ["get_tx", ["1"]],
    ["tx_status", ["1"]],
    ["mempool", []],
    ["get_mempool", []],
    ["pending_txs", []],
  ];
  for (const [m, p] of txMethods) {
    const r = await rpc(m, p);
    const summary = r.error
      ? `error code=${r.error.code} msg="${r.error.message}"`
      : `result=${JSON.stringify(r.result).slice(0, 200)}`;
    console.log(`  ${m}(${JSON.stringify(p).slice(0, 80)}) → ${summary}`);
  }

  console.log("\n=== Probe circle methods with various param shapes ===\n");
  const circleMethods: Array<[string, any]> = [
    ["circle_info", [EXPECTED_ADDR]],
    ["circle_info", [{ circle: EXPECTED_ADDR }]],
    ["circle_info", [{ id: EXPECTED_ADDR }]],
    ["circle_info", [EXPECTED_ADDR, 0]],
    ["circle_view", [EXPECTED_ADDR]],
    ["circle_view", [EXPECTED_ADDR, 0]],
    ["circle_view", [{ circle: EXPECTED_ADDR }]],
    ["circle_view", [{ id: EXPECTED_ADDR, since: 0 }]],
    ["circle_object_members", [EXPECTED_ADDR]],
    ["circle_object_members", [{ circle: EXPECTED_ADDR }]],
    ["circle_object_members", [EXPECTED_ADDR, 0]],
    ["circle_storage", [EXPECTED_ADDR]],
    ["circle_storage", [EXPECTED_ADDR, 0]],
    ["circle_storage", [{ circle: EXPECTED_ADDR }]],
    ["circle_outbox", [EXPECTED_ADDR]],
    ["circle_summary", [EXPECTED_ADDR]],
    ["circle_detail", [EXPECTED_ADDR]],
  ];
  for (const [m, p] of circleMethods) {
    const r = await rpc(m, p);
    const summary = r.error
      ? `error code=${r.error.code} msg="${r.error.message}"`
      : `result=${JSON.stringify(r.result).slice(0, 200)}`;
    console.log(`  ${m}(${JSON.stringify(p).slice(0, 80)}) → ${summary}`);
  }

  console.log("\n=== Probe account-related methods ===\n");
  const acctMethods: Array<[string, any]> = [
    ["get_account", [EXPECTED_ADDR]],
    ["account", [EXPECTED_ADDR]],
    ["get_addr", [EXPECTED_ADDR]],
    ["address", [EXPECTED_ADDR]],
    ["addr_info", [EXPECTED_ADDR]],
    ["addr_state", [EXPECTED_ADDR]],
    ["get_address", [EXPECTED_ADDR]],
    ["account_exists", [EXPECTED_ADDR]],
    ["nonce", [EXPECTED_ADDR]],
    ["get_nonce", [EXPECTED_ADDR]],
    ["get_balance", [EXPECTED_ADDR]],
    ["balance", [EXPECTED_ADDR]],
  ];
  for (const [m, p] of acctMethods) {
    const r = await rpc(m, p);
    const summary = r.error
      ? `error code=${r.error.code} msg="${r.error.message}"`
      : `result=${JSON.stringify(r.result).slice(0, 200)}`;
    console.log(`  ${m}(${EXPECTED_ADDR.slice(0, 20)}...) → ${summary}`);
  }

  console.log("\n=== Probe octrascan explorer URL patterns ===\n");
  const urls = [
    `https://devnet.octrascan.io/a/${EXPECTED_ADDR}`,
    `https://devnet.octrascan.io/account/${EXPECTED_ADDR}`,
    `https://devnet.octrascan.io/address/${EXPECTED_ADDR}`,
    `https://devnet.octrascan.io/addr/${EXPECTED_ADDR}`,
    `https://devnet.octrascan.io/oct/${EXPECTED_ADDR}`,
    `https://devnet.octrascan.io/?address=${EXPECTED_ADDR}`,
    `https://devnet.octrascan.io/api/v1/account/${EXPECTED_ADDR}`,
    `https://devnet.octrascan.io/api/v1/address/${EXPECTED_ADDR}`,
    `https://devnet.octrascan.io/v1/account/${EXPECTED_ADDR}`,
    `https://devnet.octrascan.io/v3/account/${EXPECTED_ADDR}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000), redirect: "follow" });
      const text = await res.text();
      const title = text.match(/<title>([^<]+)<\/title>/)?.[1] ?? "?";
      const is404 = title.includes("404") || title.includes("not found");
      console.log(`  ${url.replace("https://devnet.octrascan.io", "")} → ${res.status} ${is404 ? "[404]" : title.slice(0, 60)}`);
    } catch (e: any) {
      console.log(`  ${url.replace("https://devnet.octrascan.io", "")} → ERR: ${e.message}`);
    }
  }

  console.log("\n=== Probe octrascan homepage hrefs ===\n");
  try {
    const res = await fetch("https://devnet.octrascan.io/", { signal: AbortSignal.timeout(8000) });
    const html = await res.text();
    const hrefs = html.match(/href="([^"]+)"/g)?.slice(0, 30) ?? [];
    console.log("Hrefs found on homepage:");
    for (const h of hrefs) console.log("  ", h);
  } catch (e: any) {
    console.log("ERR:", e.message);
  }
}

main().catch(console.error);
