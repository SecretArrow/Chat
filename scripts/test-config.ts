/**
 * Test configuration — reads keys from environment variables.
 * ------------------------------------------------------------------
 * Defaults are UNFUNDED devnet test keys (safe to commit).
 * For funded keys, set env vars in .env.local (NEVER committed).
 */

export const TEST_CONFIG = {
  // Unfunded devnet test mnemonic (safe — no value at risk)
  mnemonic: process.env.OCTRA_TEST_MNEMONIC ||
    "cross number result leg web curious include cake wreck truly stomach cargo ordinary loop dog exhibit tuna news pole capital fringe trial creek duck",

  // Corresponding private key (Ed25519 seed, base64)
  privKeyB64: process.env.OCTRA_TEST_PRIVKEY ||
    "XcxHYHpg8ppVnkRLuPnb6THiMb6w0DqWJdDh9IKa20w=",

  // Funded devnet address for RPC lookups (read-only, no key)
  fundedAddr: process.env.OCTRA_TEST_FUNDED_ADDR ||
    "oct9a1XGFNTq5aD52XwA9uq341QSEAb5ChrrqoRhwYARcMG",

  // Network
  network: (process.env.OCTRA_NETWORK || "devnet") as "devnet" | "mainnet",

  // Devnet RPC URL
  devnetRpcUrl: "https://devnet.octrascan.io/rpc",
  mainnetRpcUrl: "https://octra.network/rpc",
};

export const DEVNET_URL = TEST_CONFIG.devnetRpcUrl;
export const MAINNET_URL = TEST_CONFIG.mainnetRpcUrl;
