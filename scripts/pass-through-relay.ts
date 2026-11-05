/**
 * OctraChat Pass-Through Relay Server
 * ------------------------------------------------------------------
 * Messages pass through this relay but are NEVER stored permanently.
 *
 * Architecture:
 *   Alice → encrypt(msg, Bob_curve_pub) → relay → Bob (if online)
 *                                      ↘ held briefly (max 24h)
 *                                         → deleted after delivery or expiry
 *
 * Security properties:
 *   ✓ No on-chain storage (messages don't touch Octra chain)
 *   ✓ No permanent server storage (relay deletes after delivery)
 *   ✓ E2E encrypted (relay only sees ciphertext, can't read)
 *   ✓ Forward secrecy (Double Ratchet keys change per message)
 *   ✓ Minimal metadata (relay sees from→to addresses, not content)
 *   ✓ Deletable (users control their own data in IndexedDB)
 *
 * Octra is used ONLY for:
 *   - Identity (wallet address as user ID)
 *   - Key derivation (Ed25519 + Curve25519)
 *   - Optional: stealth outputs for initial discovery
 *
 * Run: npx tsx scripts/pass-through-relay.ts --port 9494
 */

import http from "http";
import { WebSocketServer, WebSocket } from "ws";

const PORT = parseInt(process.env.RELAY_PORT || "9494", 10);
const MAX_HOLD_HOURS = 24;
const MAX_HOLD_MS = MAX_HOLD_HOURS * 60 * 60 * 1000;

// ─── Pending messages (held for offline recipients) ───────
interface PendingMessage {
  id: string;
  to: string;          // recipient Octra address
  from: string;        // sender Octra address (or ephemeral)
  ciphertext: string;  // E2E encrypted payload (base64)
  ts: number;
  expiresAt: number;
}
const pending: Map<string, PendingMessage[]> = new Map();

// ─── Connected clients (online now) ───────────────────────
const clients: Map<string, WebSocket> = new Map();

// ─── HTTP + WebSocket server ──────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Control", "application/json");

  if (req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true,
      online: clients.size,
      pending: pending.size,
      maxHoldHours: MAX_HOLD_HOURS,
      mode: "pass-through (no permanent storage)",
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "not found" }));
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
  const url = new URL(req.url || "", `http://localhost:${PORT}`);
  const addr = url.searchParams.get("addr");

  if (!addr) {
    ws.close(1008, "missing addr parameter");
    return;
  }

  // Register client
  clients.set(addr, ws);
  console.log(`[+] ${addr.slice(0, 16)}... connected (${clients.size} online)`);

  // Deliver any pending messages for this client
  const queued = pending.get(addr);
  if (queued && queued.length > 0) {
    console.log(`[→] Delivering ${queued.length} pending messages to ${addr.slice(0, 16)}...`);
    for (const msg of queued) {
      ws.send(JSON.stringify({
        type: "message",
        from: msg.from,
        ciphertext: msg.ciphertext,
        ts: msg.ts,
      }));
    }
    pending.delete(addr); // Clear after delivery
  }

  // Handle incoming messages
  ws.on("message", (data: Buffer) => {
    try {
      const payload = JSON.parse(data.toString());

      if (payload.type === "message") {
        // Pass-through: forward to recipient if online, else hold
        const recipient = payload.to;
        const recipientWs = clients.get(recipient);

        const msg: PendingMessage = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          to: recipient,
          from: payload.from || addr,
          ciphertext: payload.ciphertext,
          ts: Date.now(),
          expiresAt: Date.now() + MAX_HOLD_MS,
        };

        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
          // Recipient is online — deliver immediately
          recipientWs.send(JSON.stringify({
            type: "message",
            from: msg.from,
            ciphertext: msg.ciphertext,
            ts: msg.ts,
          }));
          console.log(`[→] ${msg.from.slice(0, 16)}... → ${recipient.slice(0, 16)}... (delivered)`);
          // NOT stored — pass-through only
        } else {
          // Recipient offline — hold briefly (max 24h)
          const queue = pending.get(recipient) || [];
          queue.push(msg);
          pending.set(recipient, queue);
          console.log(`[⏳] ${msg.from.slice(0, 16)}... → ${recipient.slice(0, 16)}... (held, queue: ${queue.length})`);
        }
      } else if (payload.type === "ack") {
        // Acknowledge message receipt (triggers deletion from pending)
        // Not needed for pass-through since we deliver immediately when online
      } else if (payload.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
      }
    } catch (e) {
      console.error("[!] Invalid message:", e);
    }
  });

  ws.on("close", () => {
    clients.delete(addr);
    console.log(`[-] ${addr.slice(0, 16)}... disconnected (${clients.size} online)`);
  });

  ws.on("error", (err) => {
    console.error(`[!] Error for ${addr.slice(0, 16)}...:`, err.message);
    clients.delete(addr);
  });
});

// ─── Cleanup expired pending messages ─────────────────────
setInterval(() => {
  const now = Date.now();
  let expired = 0;
  for (const [addr, msgs] of pending.entries()) {
    const kept = msgs.filter((m) => m.expiresAt > now);
    expired += msgs.length - kept.length;
    if (kept.length === 0) {
      pending.delete(addr);
    } else {
      pending.set(addr, kept);
    }
  }
  if (expired > 0) {
    console.log(`[🗑] Expired ${expired} pending messages (max hold: ${MAX_HOLD_HOURS}h)`);
  }
}, 60 * 1000); // Check every minute

// ─── Start ────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║     OctraChat Pass-Through Relay                          ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log(`║  Port: ${PORT}                                              ║`);
  console.log(`║  WebSocket: ws://localhost:${PORT}/ws                        ║`);
  console.log(`║  Health:   http://localhost:${PORT}/health                  ║`);
  console.log("║                                                           ║");
  console.log("║  Security:                                                ║");
  console.log("║  ✓ Messages NOT stored on Octra chain                     ║");
  console.log("║  ✓ Pending msgs deleted after delivery                    ║");
  console.log("║  ✓ Max hold: 24h (expired msgs auto-deleted)              ║");
  console.log("║  ✓ Relay only sees ciphertext (E2E encrypted)             ║");
  console.log("║  ✓ No permanent server storage                            ║");
  console.log("║                                                           ║");
  console.log("║  Octra used ONLY for:                                     ║");
  console.log("║  - Identity (wallet address as user ID)                   ║");
  console.log("║  - Key derivation (Ed25519 + Curve25519)                  ║");
  console.log("║  - Optional stealth discovery                             ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
});
