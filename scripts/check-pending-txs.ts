/**
 * Check pending 519-byte transactions and their wait times.
 * Also check the funded tx's actual confirmation time.
 */

const DEVNET_URL = "https://devnet.octrascan.io/rpc";

let id = 1;
async function rpc(method: string, params: any, timeout = 15000) {
  try {
    const res = await fetch(DEVNET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
      signal: AbortSignal.timeout(timeout),
    });
    return await res.json();
  } catch (e: any) {
    return { error: { message: e.message } };
  }
}

async function main() {
  console.log("=== Pending Transaction Analysis ===\n");

  // Get staging
  const staging = await rpc("staging_view", []);
  if (!staging.result) {
    console.log("No staging:", JSON.stringify(staging).slice(0, 200));
    return;
  }

  const txs = staging.result.transactions || [];
  console.log(`Total pending: ${staging.result.count}`);
  console.log();

  // Categorize by message size
  const bySize: Record<number, number> = {};
  for (const tx of txs) {
    const sz = tx.message_size || 0;
    bySize[sz] = (bySize[sz] || 0) + 1;
  }
  console.log("Pending by message size:");
  for (const [sz, cnt] of Object.entries(bySize).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  ${sz} bytes: ${cnt} txs`);
  }
  console.log();

  // Get current epoch
  const ns = await rpc("node_status", []);
  const currentEpoch = ns.result?.epoch || 0;
  console.log("Current epoch:", currentEpoch);
  console.log();

  // Try to fetch details of pending transactions
  console.log("--- Pending transaction details ---");
  for (const tx of txs.slice(0, 8)) {
    const hash = tx.hash;
    console.log(`\nTx ${hash?.slice(0, 20)}... (size: ${tx.message_size} bytes)`);
    console.log(`  from: ${tx.from?.slice(0, 25)}...`);
    console.log(`  to:   ${tx.to?.slice(0, 25)}...`);

    // Try to get full tx details
    const detail = await rpc("octra_transaction", [hash], 8000);
    if (detail.result) {
      console.log(`  op_type: ${detail.result.op_type}`);
      console.log(`  nonce:   ${detail.result.nonce}`);
      console.log(`  amount:  ${detail.result.amount}`);
      console.log(`  ou:      ${detail.result.ou}`);
      console.log(`  status:  ${detail.result.status}`);
      if (detail.result.timestamp) {
        const age = Date.now() / 1000 - detail.result.timestamp;
        console.log(`  age:     ${age.toFixed(0)}s (${(age / 60).toFixed(1)} min)`);
      }
      if (detail.result.encrypted_data) {
        console.log(`  HAS encrypted_data: ${detail.result.encrypted_data?.slice(0, 40)}...`);
      }
      if (detail.result.message) {
        console.log(`  message: ${detail.result.message?.slice(0, 60)}`);
      }
    } else if (detail.error) {
      console.log(`  detail error: ${detail.error.message}`);
    }
  }

  // Check funded tx confirmation timing
  console.log("\n\n=== Funded tx confirmation timing ===");
  const fundedTx = await rpc("octra_transaction", ["a6dd21a46ab9f9f71f390e56bad19f7b03708a6263a9cce96cebbe641951b3ae"]);
  if (fundedTx.result) {
    console.log("Status:", fundedTx.result.status);
    console.log("Epoch:", fundedTx.result.epoch);
    console.log("Timestamp:", fundedTx.result.timestamp);
    console.log("Op type:", fundedTx.result.op_type);
    console.log("OU (fee):", fundedTx.result.ou);
    // Check if there's an encrypted_data field
    console.log("Has encrypted_data:", !!fundedTx.result.encrypted_data);
    console.log("Has message:", !!fundedTx.result.message);
  }

  // Look at recent epochs for interval data
  console.log("\n=== Recent epoch intervals ===");
  // The staging_view gives us tx count per epoch but not intervals directly
  // Let me check the explorer for epoch timing
  try {
    const res = await fetch("https://devnet.octrascan.io/index.html", { signal: AbortSignal.timeout(8000) });
    const html = await res.text();
    // Extract interval data from the HTML table
    const intervalMatches = html.match(/(\d+\.\d)\s*s/g);
    if (intervalMatches) {
      console.log("Recent intervals:", intervalMatches.slice(0, 10));
    }
    // Extract epoch numbers
    const epochMatches = html.match(/1,?\d{3},?\d{3}/g);
    if (epochMatches) {
      console.log("Recent epochs:", epochMatches.slice(0, 10));
    }
  } catch (e: any) {
    console.log("Explorer fetch error:", e.message);
  }
}

main().catch(console.error);
