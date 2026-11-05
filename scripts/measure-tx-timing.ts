/**
 * Measure actual transaction confirmation times on Octra devnet.
 * - Check recent epochs and their intervals
 * - Fetch recent transactions and check their confirmation timing
 * - Try submitting a tx and measure response time
 * - Look at staging (mempool) wait times
 * - Check for encrypted/PVAC transactions specifically
 */

const DEVNET_URL = "https://devnet.octrascan.io/rpc";

let id = 1;
async function rpc(method: string, params: any, timeout = 15000) {
  const t0 = Date.now();
  try {
    const res = await fetch(DEVNET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
      signal: AbortSignal.timeout(timeout),
    });
    const json: any = await res.json();
    return { json, ms: Date.now() - t0 };
  } catch (e: any) {
    return { error: e.message, ms: Date.now() - t0 };
  }
}

async function main() {
  console.log("=== Octra Devnet Transaction Timing Analysis ===\n");

  // 1. Node status — current epoch
  console.log("--- 1. Node status ---");
  const ns = await rpc("node_status", []);
  if (ns.json?.result) {
    console.log("Current epoch:", ns.json.result.epoch);
    console.log("Network version:", ns.json.result.network_version);
    console.log("State root:", ns.json.result.state_root?.slice(0, 32), "...");
    console.log("RPC response time:", ns.ms, "ms");
  }
  console.log();

  // 2. Staging (mempool) — pending transactions
  console.log("--- 2. Staging / Mempool ---");
  const staging = await rpc("staging_view", []);
  if (staging.json?.result) {
    const s = staging.json.result;
    console.log("Pending txs:", s.count, "/", s.total);
    if (s.transactions && s.transactions.length > 0) {
      console.log("\nFirst 5 pending transactions:");
      for (const tx of s.transactions.slice(0, 5)) {
        console.log(`  hash: ${tx.hash?.slice(0, 32)}...`);
        console.log(`  from: ${tx.from?.slice(0, 20)}...`);
        console.log(`  to:   ${tx.to?.slice(0, 20)}...`);
        console.log(`  size: ${tx.message_size} bytes`);
      }
    }
  }
  console.log();

  // 3. Fetch recent transactions from the funded address
  console.log("--- 3. Recent transactions for funded address oct9a1XG... ---");
  const txs = await rpc("octra_transactionsByAddress", ["oct9a1XGFNTq5aD52XwA9uq341QSEAb5ChrrqoRhwYARcMG", 20, 0], "live");
  if (txs.json?.result) {
    const arr = txs.json.result.transactions || txs.json.result;
    if (Array.isArray(arr)) {
      console.log(`Got ${arr.length} transactions`);
      for (const tx of arr.slice(0, 5)) {
        console.log(`\n  Tx hash: ${tx.hash?.slice(0, 32)}...`);
        console.log(`  Type:    ${tx.op_type || tx.type || "?"}`);
        console.log(`  Epoch:   ${tx.epoch}`);
        console.log(`  Status:  ${tx.status}`);
        if (tx.timestamp) console.log(`  Time:    ${new Date(tx.timestamp * 1000).toISOString()}`);
        if (tx.from) console.log(`  From:    ${tx.from.slice(0, 20)}...`);
        if (tx.to) console.log(`  To:      ${tx.to.slice(0, 20)}...`);
        if (tx.amount) console.log(`  Amount:  ${tx.amount}`);
      }
    }
  }
  console.log();

  // 4. Get specific transaction details (the one that funded oct9a1XG)
  console.log("--- 4. Detailed transaction lookup ---");
  const fundedTxHash = "a6dd21a46ab9f9f71f390e56bad19f7b03708a6263a9cce96cebbe641951b3ae";
  const txDetail = await rpc("octra_transaction", [fundedTxHash]);
  if (txDetail.json?.result) {
    const tx = txDetail.json.result;
    console.log("Funded tx details:");
    console.log("  Status:    ", tx.status);
    console.log("  Epoch:     ", tx.epoch);
    console.log("  Timestamp: ", tx.timestamp, `(${new Date(tx.timestamp * 1000).toISOString()})`);
    console.log("  From:      ", tx.from);
    console.log("  To:        ", tx.to);
    console.log("  Amount:    ", tx.amount);
    console.log("  Nonce:     ", tx.nonce);
    console.log("  Op type:   ", tx.op_type);
    console.log("  OU (fee):  ", tx.ou);
    if (tx.message) console.log("  Message:   ", tx.message);
  }
  console.log();

  // 5. Check epoch intervals to estimate confirmation time
  console.log("--- 5. Epoch intervals (confirmation time) ---");
  // Fetch recent epochs from the explorer
  try {
    const res = await fetch("https://devnet.octrascan.io/index.html", { signal: AbortSignal.timeout(8000) });
    const html = await res.text();
    // Parse epoch data from HTML
    const epochMatches = html.matchAll(/(\d{1,2}\.\d)\s*s/g);
    const intervals = [];
    for (const m of epochMatches) {
      intervals.push(parseFloat(m[1]));
    }
    if (intervals.length > 0) {
      console.log("Recent epoch intervals (seconds):", intervals.slice(0, 10));
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      console.log(`Average interval: ${avg.toFixed(1)}s`);
      console.log(`Min: ${Math.min(...intervals)}s, Max: ${Math.max(...intervals)}s`);
    }
  } catch (e: any) {
    console.log("Could not fetch explorer:", e.message);
  }
  console.log();

  // 6. Try submitting a transaction and measure time
  console.log("--- 6. Submit timing test (unfunded wallet) ---");
  // Build a minimal tx just to measure RPC response time
  const submitStart = Date.now();
  const submitResult = await rpc("octra_submit", [{
    from: "oct2MPJ6vC2EYHtVd5sBwDdUME8dyRzJZ8YzqiRkNJTuMNt",
    to_: "octBoeKeyfCTZ9pRJ8S4eSxFRETYNfLvo3uYDXCg25MTw8E",
    amount: "100000000",
    nonce: 0,
    ou: "1000",
    timestamp: Date.now() / 1000,
    signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    op_type: "standard",
    public_key: "UGU5blmRqMDiABVYASkxTppkmdkxZvEaelLvp4jMnQc=",
  }], 30000);
  const submitMs = Date.now() - submitStart;
  console.log("Submit response time:", submitMs, "ms");
  console.log("Submit result:", JSON.stringify(submitResult.json).slice(0, 300));
  console.log();

  // 7. Look for encrypted/PVAC/stealth transactions
  console.log("--- 7. Encrypted / PVAC / stealth transactions ---");
  // Check stealth outputs to see timing
  const stealth = await rpc("octra_stealthOutputsPage", [0, null, 20], 20000);
  if (stealth.json?.result) {
    const arr = Array.isArray(stealth.json.result) ? stealth.json.result : [];
    console.log(`Got ${arr.length} stealth outputs`);
    if (arr.length > 0) {
      // Check epoch gaps to estimate stealth tx confirmation time
      const epochs = arr.map((o: any) => o.epoch_id).filter(Boolean).sort((a: number, b: number) => b - a);
      if (epochs.length > 1) {
        const gaps = [];
        for (let i = 0; i < epochs.length - 1; i++) {
          gaps.push(epochs[i] - epochs[i + 1]);
        }
        console.log("Stealth output epoch gaps:", gaps.slice(0, 10));
        console.log(`Average gap: ${gaps.reduce((a: number, b: number) => a + b, 0) / gaps.length} epochs`);
      }
      // Show most recent stealth output
      const recent = arr[0];
      console.log("\nMost recent stealth output:");
      console.log("  id:", recent.id);
      console.log("  epoch:", recent.epoch_id);
      console.log("  tx_hash:", recent.tx_hash?.slice(0, 32), "...");
      console.log("  eph_pub:", recent.eph_pub?.slice(0, 32), "...");
      console.log("  claimed:", recent.claimed);
    }
  }
  console.log();

  // 8. Summary
  console.log("=== TIMING SUMMARY ===");
  console.log("Standard tx confirmation: ~10-35 seconds (1 epoch)");
  console.log("RPC response time: ~" + ns.ms + "ms for node_status");
  console.log("Submit rejection time: ~" + submitMs + "ms");
  console.log("Encrypted/PVAC operations: potentially 2+ minutes (user-reported)");
  console.log("Stealth scanning: depends on output count, ~" + stealth.ms + "ms for 20 outputs");
}

main().catch(console.error);
