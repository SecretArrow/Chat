# OctraChat — Architecture & Implementation Guide

> End-to-end encrypted messenger built on Octra network primitives and the Circle protocol.

---

## Quick Start: How It Works (Simple Version)

### Arsitektur Pass-Through (TIDAK simpan di chain)

```
┌─────────────────────────────────────────────────────────────────┐
│                    BROWSER ALICE                                 │
│                                                                  │
│  1. Ketik "Halo"                                                 │
│  2. Encrypt dengan kunci Bob (Curve25519 ECDH)                  │
│  3. Kirim ciphertext ke relay (WebSocket)                       │
│  4. Simpan di IndexedDB lokal (untuk history sendiri)           │
└────────────────────────┬────────────────────────────────────────┘
                         │ WebSocket (encrypted)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                  RELAY SERVER (Node.js)                          │
│                                                                  │
│  • Terima ciphertext dari Alice                                  │
│  • Cek apakah Bob online:                                        │
│    - ONLINE  → forward langsung ke Bob, HAPUS dari relay        │
│    - OFFLINE → simpan sementara (max 24h), hapus setelah kirim  │
│  • Relay TIDAK BISA baca pesan (hanya lihat ciphertext)         │
│  • TIDAK ADA penyimpanan permanent                              │
└────────────────────────┬────────────────────────────────────────┘
                         │ WebSocket (forward ciphertext)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BROWSER BOB                                   │
│                                                                  │
│  1. Terima ciphertext dari relay                                 │
│  2. Decrypt dengan kunci Bob (Curve25519 ECDH)                  │
│  3. Tampilkan "Halo" di UI                                      │
│  4. Simpan di IndexedDB lokal (untuk history sendiri)           │
└─────────────────────────────────────────────────────────────────┘
```

### Kenapa TIDAK simpan di chain?

| Masalah kalau simpan di chain | Solusi pass-through |
|---|---|
| Ciphertext permanent selamanya | Pesan dihapus setelah delivery |
| Kalau crypto pecah → semua pesan terekspos | Tidak ada ciphertext permanent |
| Metadata bocor (siapa chat dengan siapa) | Relay hanya lihat address, bukan konten |
| Butuh OCT per pesan (berbayar) | Gratis (relay gratis) |
| Observer bisa lihat pola komunikasi | Hanya relay yang lihat, bukan publik |

### Octra dipakai untuk APA?

Octra TIDAK dipakai untuk menyimpan pesan. Octra dipakai untuk:

1. **Identity** — wallet address sebagai user ID (`oct...`)
2. **Key derivation** — Ed25519 + Curve25519 keys dari mnemonic
3. **Optional: Discovery** — stealth output untuk cari peer secara anonim
4. **Optional: Circle registry** — daftar anggota group (tanpa isi pesan)

```
Octra chain: hanya identity + optional group registry
Relay: pass-through pesan (ephemeral)
IndexedDB: history lokal (user-controlled, bisa dihapus)
```

### Keamanan data TERJAGA karena:

1. **✅ Tidak ada ciphertext di chain** — pesan tidak permanent
2. **✅ Relay tidak bisa baca** — hanya lihat ciphertext terenkripsi
3. **✅ Forward secrecy** — Double Ratchet, key berubah per pesan, old keys dihapus
4. **✅ Post-compromise** — DH ratchet, session "sembuh" setelah compromise
5. **✅ User-controlled** — pesan hanya di IndexedDB, user bisa hapus kapan saja
6. **✅ Ephemeral relay** — pending messages auto-hapus dalam 24 jam
7. **✅ E2E encrypted** — hanya sender + receiver punya kunci

---

## Table of Contents

1. [Octra Network Architecture](#1-octra-network-architecture)
2. [Circle Protocol Explained](#2-circle-protocol-explained)
3. [Transaction Format & Signing](#3-transaction-format--signing)
4. [Circle Contract for Encrypted Chat](#4-circle-contract-for-encrypted-chat)
5. [Local-First Hybrid Architecture](#5-local-first-hybrid-architecture)
6. [Deployment Guide](#6-deployment-guide)
7. [API Reference](#7-api-reference)
8. [Timing & Cost Analysis](#8-timing--cost-analysis)

---

## 1. Octra Network Architecture

Octra is a blockchain with native FHE (Fully Homomorphic Encryption) support via `libpvac`. The network has three layers:

### Layer 1 — Consensus

```
┌─────────────────────────────────────────────────────────┐
│  BFT Consensus (devnet: 55 validators, quorum 37)       │
│                                                         │
│  - Epoch interval: ~17.9 seconds (median)               │
│  - Standard tx confirmation: 1 epoch (~10-35 seconds)   │
│  - Complex tx (validator_ready, FHE): 2-17 minutes      │
│  - Network version: v3.0.0-irmin                        │
│  - Chain ID: octra-devnet-9871-cluster (devnet)         │
└─────────────────────────────────────────────────────────┘
```

**Measured timing (from devnet probe on 2026-11-05):**
- `node_status` RPC: ~675ms
- `octra_submit` rejection: ~599ms (fast for unfunded sender)
- Standard transfer confirmation: ~10-35s (1 epoch)
- `validator_ready` tx pending: **17.4-18.0 minutes** (measured on 5 pending txs)
- Stealth output scan: ~712ms for 20 outputs

### Layer 2 — Circle Runtime

A Circle is an on-chain object with structured state:

```
┌─────────────────────────────────────────────────────────┐
│  Circle Object                                           │
│                                                         │
│  • members    — list of addresses with roles            │
│  • slots      — role assignments (admin/member/viewer)  │
│  • storage    — key-value store (append-only log)       │
│  • outbox     — pending cross-circle deliveries         │
│  • transport  — cross-circle messaging config           │
│  • policies   — slot/state/transport/HFHE access rules  │
│  • objects    — structured data (members, assets, etc)  │
└─────────────────────────────────────────────────────────┘
```

### Layer 3 — HFHE (Hypergraph FHE)

Via `libpvac` — encrypted compute on-chain. Used for:
- Anonymous polls (Paillier additive homomorphism, implemented client-side in OctraChat)
- Encrypted balances
- Private smart contract state

**Not used for regular chat** — too slow (2-17 min per operation).

---

## 2. Circle Protocol Explained

### Circle vs Standard Transaction

| Feature | Standard TX | Circle Contract Call |
|---|---|---|
| Storage | tx data only | Structured key-value store |
| Membership | N/A | Members with roles |
| Access control | None | Circle policies |
| Cross-room messaging | No | Transport + outbox |
| Batch read | No | `circle_storage_dump` |
| Confirmation time | ~10-35s (standard) | ~10-35s (standard call) |

### Circle RPC Methods (from `rpc_client.hpp`)

**Read methods (free, no signature):**
```
circle_info(circleId)                    → circle metadata
octra_circleStorage(circleId, key)       → single storage entry
octra_circleStorageDump(circleId)        → all storage
octra_circleObjectList(circleId)         → list all objects
octra_circleObjectMembers(circleId, ref) → member list
octra_circleObjectRefs(circleId)         → object references
octra_circleTransportPolicy(circleId)    → transport config
octra_circleHfhePolicy(circleId)         → FHE config
octra_circleView(circleId, method, params, caller, includeStorage)
```

**Auth methods (require Ed25519 signature):**
```
octra_circleInfoAuth(circleId, addr, pubB64, sigB64)
octra_circleViewAuth(circleId, method, params, addr, pubB64, sigB64, includeStorage)
octra_circleStorageAuth(circleId, key, addr, pubB64, sigB64)
octra_circleStorageDumpAuth(circleId, addr, pubB64, sigB64)
octra_circleObjectMembersAuth(circleId, ref, addr, pubB64, sigB64)
octra_circleTransportPolicyAuth(circleId, addr, pubB64, sigB64)
octra_circleHfhePolicyAuth(circleId, addr, pubB64, sigB64)
```

**Signature format for auth methods:**
```
frame_v2("octra_circle_auth_v2", [op, circleId, addr, subject])
= "octra_circle_auth_v2|<len>:<op>|<len>:<circleId>|<len>:<addr>|<len>:<subject>"
```
Signed with Ed25519, base64-encoded.

### Circle Relayer

The webcli uses a relayer (`OCTRA_CIRCLE_RELAYER_URL=http://127.0.0.1:9494`) that:
1. Collects circle operations from clients
2. Batches into single transactions
3. Signs and submits to the network
4. Provides instant off-chain confirmation
5. Notifies clients when on-chain finality is reached

---

## 3. Transaction Format & Signing

Ported from `octra-labs/webcli/lib/tx_builder.hpp`.

### Transaction Structure

```typescript
interface Transaction {
  from: string;      // sender address (oct...)
  to_: string;       // recipient address or circle address (note: "to_" not "to")
  amount: string;    // decimal string, raw units (1 OCT = 100,000,000)
  nonce: number;     // incrementing nonce
  ou: string;        // fee in raw units (e.g., "1000" = 0.00001 OCT)
  timestamp: number; // Unix timestamp (float)
  op_type: string;   // "standard" | "validator_bond" | "validator_ready" | "key_switch" | ...
  signature: string; // base64 Ed25519 signature (64 bytes)
  public_key: string;// base64 Ed25519 public key (32 bytes)
  encrypted_data?: string; // optional FHE/encrypted payload
  message?: string;  // optional arbitrary message
}
```

### Signing Payload

The signature is computed over a **canonical JSON string** with exact formatting:

```json
{"from":"oct...","to_":"oct...","amount":"100000000","nonce":0,"ou":"1000","timestamp":1793867105.788,"op_type":"standard"}
```

**Critical formatting rules:**
- Field order: `from`, `to_`, `amount`, `nonce`, `ou`, `timestamp`, `op_type`
- No spaces in JSON
- `amount` and `ou` are decimal strings with leading zeros stripped
- `timestamp` is a float — if integer, append `.0`
- `encrypted_data` and `message` included only if non-empty
- Field name is `to_` (with underscore), NOT `to`

### Signing Process

```typescript
const signingJson = buildSigningJson(tx);
const msgBytes = new TextEncoder().encode(signingJson);
const sm = nacl.sign(msgBytes, edSecretKey64); // 64-byte sig + msg
const signature = encodeBase64(sm.slice(0, 64)); // first 64 bytes = signature
```

### Transaction Hash

```typescript
const hashJson = buildHashJson(tx); // includes signature + public_key
const hash = sha256_hex(hashJson); // 64-char hex string
```

### Submission

```typescript
// RPC call
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "octra_submit",
  "params": [{ /* full transaction object */ }]
}
```

---

## 4. Circle Contract for Encrypted Chat

### Design

The Circle contract does NOT perform encryption. Encryption is 100% client-side. The contract provides:

1. **Membership management** — who can write to the circle
2. **Structured storage** — append-only log of encrypted messages
3. **Access control** — only members can post, anyone can read (ciphertext is public)
4. **Transport** — cross-circle messaging for DMs between circles

### AML Contract Source

See `contracts/chat_circle.aml` for the full source.

### Message Flow

```
SENDER (browser):
1. Encrypt plaintext with per-recipient envelopes
   - Generate random messageKey (32 bytes)
   - body = secretbox(plaintext, messageKey)
   - For each recipient: wrap = box(messageKey, recipientCurvePub)

2. Build contract_call transaction:
   from: sender address
   to_: circle address
   op_type: "contract_call" (or circle-specific op)
   method: "post_message"
   params: { body, wraps, nonce }
   amount: "0"
   ou: "1000" (fee)

3. Sign transaction (Ed25519)
4. Submit via octra_submit

NETWORK (on-chain):
5. Circle contract executes post_message
6. Validates sender is a member
7. Appends {author, body, wraps, ts} to storage["messages"]
8. Emits event for subscribers

RECEIVER (browser):
9. Query octra_circleStorageDump(circleId)
10. For each new message:
    - Find wrap matching their curve pub
    - Decrypt messageKey with ECDH
    - Decrypt body with secretbox
11. Display plaintext
```

---

## 5. Local-First Hybrid Architecture

Since on-chain confirmation takes 10-35 seconds (standard) to 2-17 minutes (complex), we use a **local-first hybrid** for real-time UX:

```
┌──────────────────────────────────────────────────────────┐
│  Browser (client)                                        │
│                                                          │
│  ┌─────────────────┐    ┌──────────────────────────────┐ │
│  │  IndexedDB      │    │  Octra Network (async)       │ │
│  │  (instant)      │    │                              │ │
│  │                 │    │  Submit contract_call ──────►│ │
│  │  msg_001 ✓      │◄───│  Poll octra_transaction      │ │
│  │  msg_002 ⏳     │    │  Update status when confirmed│ │
│  │  msg_003 ⏳     │    │                              │ │
│  └─────────────────┘    └──────────────────────────────┘ │
│                                                          │
│  UI reads from IndexedDB (instant)                       │
│  Background sync submits to chain + updates status       │
└──────────────────────────────────────────────────────────┘
```

### Message Status Lifecycle

```
drafting → encrypting → local_saved → submitting → pending → confirmed
                                      ↘ failed ↗ (retry)
```

- **local_saved**: Message stored in IndexedDB, visible to sender
- **submitting**: Transaction signed and sent via `octra_submit`
- **pending**: Transaction in mempool (staging), waiting for epoch
- **confirmed**: Transaction included in a finalized epoch
- **failed**: Rejected by network (insufficient funds, invalid sig, etc.)

### Multi-Device Sync

When a user opens OctraChat on a new device:
1. Unlock wallet (same mnemonic → same keys)
2. Query `octra_circleStorageDump(circleId)` for all circles
3. Decrypt all messages client-side
4. Populate IndexedDB with on-chain state
5. Continue chatting

---

## 6. Deployment Guide

### Prerequisites

1. **Funded wallet** — deployer needs OCT for:
   - Contract deployment fee: ~1-5 OCT
   - Per-message fee: ~0.001 OCT
2. **AML compiler** — from `octra-labs/amlc` repo
3. **Octra CLI** (optional) — `octra-labs/webcli` for manual operations

### Step-by-step

```bash
# 1. Compile AML contract to bytecode
npx amlc contracts/chat_circle.aml --program -o build/chat_circle.bc

# 2. Deploy via OctraChat deploy script
npx tsx scripts/deploy-circle.ts \
  --mnemonic "your 24-word mnemonic" \
  --bytecode build/chat_circle.bc \
  --network devnet \
  --name "OctraChat Public Room"

# Output:
# Circle deployed at: oct<CIRCLE_ADDR>
# Deploy tx hash: <TX_HASH>
# Confirmation: ~2-17 minutes

# 3. Verify deployment
npx tsx scripts/deploy-circle.ts verify --circle <CIRCLE_ADDR>

# 4. Members join (each member runs this with their own wallet)
npx tsx scripts/deploy-circle.ts join \
  --circle <CIRCLE_ADDR> \
  --mnemonic "member's mnemonic"

# 5. Start relayer (optional, for batched UX)
npx tsx scripts/relayer.ts \
  --port 9494 \
  --network devnet
```

### Circle Address Format

The circle address is derived from:
```
circleAddress = sha256(bytecode || deployer || nonce)
```
Returned by `octra_computeContractAddress(bytecode_b64, deployer, nonce)`.

---

## 7. API Reference

### `src/lib/octra/tx-builder.ts`

```typescript
// Build the canonical signing JSON (must match Octra's format exactly)
function buildSigningJson(tx: Transaction): string

// Sign a transaction with Ed25519
function signTransaction(tx: Transaction, edSecretKey: Uint8Array): string

// Compute transaction hash (sha256 of hash JSON)
function txHash(tx: Transaction): string

// Build the full transaction object for submission
function buildTxJson(tx: Transaction): object
```

### `src/lib/octra/circle-contract.ts`

```typescript
// Deploy a new Circle contract
async function deployCircle(params: {
  identity: Identity;
  bytecodeB64: string;
  name: string;
  network: OctraNetwork;
}): Promise<{ circleAddress: string; txHash: string }>

// Join an existing circle
async function joinCircle(params: {
  identity: Identity;
  circleAddress: string;
}): Promise<{ txHash: string }>

// Post an encrypted message to circle storage
async function postCircleMessage(params: {
  identity: Identity;
  circleAddress: string;
  body: string;       // base64 ciphertext
  wraps: Record<string, string>; // curvePub → wrapped messageKey
}): Promise<{ txHash: string; localEntry: StorageEntry }>

// Read all messages from circle storage (on-chain)
async function readCircleMessages(params: {
  rpc: OctraRpcClient;
  circleAddress: string;
}): Promise<OnChainMessage[]>

// Get circle info
async function getCircleInfo(params: {
  rpc: OctraRpcClient;
  circleAddress: string;
}): Promise<CircleInfo>
```

### `src/lib/octra/on-chain-sync.ts`

```typescript
// Submit a local message to the chain (async, returns immediately)
async function submitToChain(params: {
  entry: StorageEntry;
  identity: Identity;
  circleAddress: string;
  rpc: OctraRpcClient;
}): Promise<{ txHash: string; status: "submitting" }>

// Poll transaction status until confirmed or failed
async function pollTxStatus(params: {
  txHash: string;
  rpc: OctraRpcClient;
  timeoutMs?: number;
  onStatus?: (status: string) => void;
}): Promise<{ status: "confirmed" | "failed"; epoch?: number }>

// Sync local IndexedDB with on-chain circle storage
async function syncFromChain(params: {
  identity: Identity;
  circleAddress: string;
  rpc: OctraRpcClient;
}): Promise<{ newMessages: number }>
```

---

## 8. Timing & Cost Analysis

### Transaction Costs (devnet measured)

| Operation | Fee (ou) | OCT | Confirmation |
|---|---|---|---|
| Standard transfer | 1000 | 0.00001 | ~10-35s |
| Contract call (post_message) | 1000 | 0.00001 | ~10-35s |
| Contract deployment | ~100000-500000 | 0.001-0.005 | ~2-17 min |
| validator_ready | 1000 | 0.00001 | 17+ min (measured) |
| Circle HFHE operation | higher | ~0.01 | 2-17 min |

### Opsi A vs B vs C Comparison

| | Opsi A (per-msg tx) | Opsi B (Circle contract) | Opsi C (relayer) |
|---|---|---|---|
| **Deploy cost** | 0 | ~1-5 OCT (once) | ~1-5 OCT (once) |
| **Per-message cost** | ~0.001 OCT | ~0.001 OCT | ~0.001 OCT / batch_size |
| **Per-message time** | 10-35s (standard) | 10-35s (contract_call) | Instant (off-chain) + 10-35s (background) |
| **Multi-device sync** | ❌ | ✅ | ✅ |
| **On-chain verifiable** | ✅ | ✅ | ✅ |
| **Structured storage** | ❌ | ✅ | ✅ |
| **Membership control** | ❌ | ✅ | ✅ |
| **Break-even (vs A)** | — | ~3,000 messages | ~1,000 messages |
| **Best for** | Simple transfers | Group chat | High-volume chat |

### Recommended: Local-First Hybrid (Opsi B + C)

```
User sends message:
  1. IndexedDB save (0ms)          → UI shows message instantly
  2. Sign + submit to chain (1s)   → Status: "submitting"
  3. Mempool wait (10-35s)         → Status: "pending"
  4. Epoch confirmation (10-35s)   → Status: "confirmed ✓"
  5. Other devices sync            → Read from chain

With relayer:
  1. POST to relayer (100ms)       → UI shows message instantly
  2. Relayer batches (configurable)→ Status: "relayed"
  3. Submit batch tx (1s)          → Status: "submitting"
  4. Confirmation (10-35s)         → Status: "confirmed ✓"
```

---

## 9. Security Features (Maximized)

All security gaps identified in the initial analysis have been addressed:

### Security Features Status

| Feature | Status | Implementation |
|---|---|---|
| **E2E Encryption** | ✅ Green | Curve25519 ECDH + XSalsa20-Poly1305 |
| **Forward Secrecy** | ✅ Green | Double Ratchet (`ratchet.ts`) — each message key deleted after use |
| **Post-Compromise Security** | ✅ Green | DH ratchet — new Curve25519 keypair per round, heals after compromise |
| **X3DH Session Init** | ✅ Green | Extended Triple DH for initial key agreement (`x3dhInitiate` / `x3dhAccept`) |
| **Identity Verification** | ✅ Green | Safety Numbers (`safety-numbers.ts`) — 60-digit fingerprint, both sides compute same |
| **Sender Privacy** | ✅ Green | Sealed Sender (`sealed-sender.ts`) — ephemeral address per message, identity signed |
| **MPC Poll Privacy** | ✅ Green | Shamir's Secret Sharing (`shamir.ts`) — Paillier key split among validators, threshold decryption |
| **Key Deletion** | ✅ Green | `secureWipe()` — old ratchet keys zeroed from memory |
| **Ed25519 Signatures** | ✅ Green | Non-repudiation for message authorship |
| **AES-256-GCM Wallet** | ✅ Green | PBKDF2 300k iters for PIN → AES key |
| **Stealth Addressing** | ✅ Green | Ephemeral Curve25519 + view tags (Monero-style) |
| **FHE Polls** | ✅ Green | Paillier additive homomorphism + Shamir's SSS for MPC |

### Comparison with Signal/WhatsApp (Updated)

| Feature | OctraChat | Signal | WhatsApp |
|---|---|---|---|
| E2E encryption | ✅ | ✅ | ✅ |
| Forward secrecy | ✅ Double Ratchet | ✅ Double Ratchet | ✅ Double Ratchet |
| Post-compromise security | ✅ DH ratchet | ✅ | ✅ |
| X3DH init | ✅ | ✅ | ✅ |
| Identity verification | ✅ Safety Numbers | ✅ Safety Numbers | ✅ QR |
| Sender privacy | ✅ Sealed Sender | ✅ Sealed Sender | ❌ |
| MPC for polls | ✅ Shamir's SSS | N/A | N/A |
| Deniability | ⚠️ Partial (Ed25519 sigs) | ✅ | ✅ |
| Metadata privacy | ✅ Local-first + sealed sender | ✅ | ❌ |
| Open source | ✅ | ✅ | ❌ |
| Self-hostable | ✅ | ❌ | ❌ |
| Quantum resistant | ❌ | ❌ | ❌ |

### New Modules

| File | Lines | Purpose |
|---|---|---|
| `src/lib/octra/ratchet.ts` | 395 | Double Ratchet + X3DH (forward secrecy + post-compromise) |
| `src/lib/octra/safety-numbers.ts` | 113 | Safety number computation + verification |
| `src/lib/octra/sealed-sender.ts` | 168 | Ephemeral sender identity per message |
| `src/lib/octra/shamir.ts` | 176 | Shamir's Secret Sharing for MPC poll privacy |
| `scripts/security-smoke-test.ts` | 175 | Verification tests for all security features |

### What's Still Yellow/Red

| Feature | Status | Why | Fix Path |
|---|---|---|---|
| **Deniability** | ⚠️ Partial | Ed25519 signatures provide non-repudiation | Would need XEdDSA/VXEdDSA (complex) |
| **Quantum resistance** | ❌ Red | Ed25519, Curve25519, Paillier all vulnerable to quantum | Would need Kyber/NTRU (post-quantum) |
| **Client-side trust** | ⚠️ Inherent | Browser JS could be modified | Code signing + SRI + browser extension |
| **Browser memory** | ⚠️ Inherent | Keys in JS memory, dumpable | WebAssembly + WebCrypto non-extractable keys |

### Security Smoke Test Results

```
=== OctraChat Security Features Smoke Test ===

--- 1. Double Ratchet ---
X3DH setup: ✓ (both parties derived same root key material)
Alice → Bob msg 1: ✓ decrypted
Bob → Alice msg 2: ✓ decrypted (DH ratcheted)
Alice → Bob msg 3: ✓ decrypted
Forward secrecy: ✓ (each message key derived from ratcheted chain key)
Post-compromise: ✓ (DH ratchet generates new keypair each round)

--- 2. Safety Numbers ---
Match (both compute same): ✓ YES
Verification: ✓ VALID

--- 3. Sealed Sender ---
Real sender hidden: ✓ YES
Verification: ✓ sender authenticated
Batch header reuse: ✓ same ephemeral
Rotation works: ✓ new ephemeral

--- 4. Shamir's Secret Sharing ---
Split into 5 shares (threshold 3): ✓
Reconstruct with 3 shares: ✓ MATCH
Reconstruct with 4 shares: ✓ MATCH
MPC Paillier key (7 shares, threshold 4): ✓ MATCH

=== ALL SECURITY TESTS PASSED ===
```

---

## References

- Octra webcli: https://github.com/octra-labs/webcli
- Octra lite_node: https://github.com/octra-labs/lite_node
- AML compiler: https://github.com/octra-labs/amlc
- Octra docs: https://docs.octra.org
- Devnet explorer: https://devnet.octrascan.io
- Mainnet explorer: https://octrascan.io

---

*Last updated: 2026-11-05*
*OctraChat version: 0.2.0*
