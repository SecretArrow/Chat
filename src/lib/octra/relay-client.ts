/**
 * Pass-Through Relay Client — connects to the relay server.
 * ------------------------------------------------------------------
 * Sends and receives E2E encrypted messages via WebSocket.
 * Messages are NOT stored on the Octra chain — they pass through
 * the relay and are deleted after delivery.
 *
 * The relay only sees ciphertext (can't read content).
 * Messages are stored locally in IndexedDB (user-controlled, deletable).
 */

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Identity } from "./crypto";
import { encryptMessage, decryptMessage, type EncryptedPayload } from "./crypto";

export interface RelayMessage {
  from: string;
  ciphertext: string;
  ts: number;
}

export interface RelayClient {
  connected: boolean;
  onlinePeers: string[];
  send: (toAddress: string, payload: EncryptedPayload) => Promise<boolean>;
  onMessage: (callback: (msg: RelayMessage) => void) => void;
  disconnect: () => void;
}

const DEFAULT_RELAY_URL = "ws://localhost:9494/ws";

/**
 * React hook for connecting to the pass-through relay.
 */
export function useRelayConnection(
  identity: Identity | null,
  relayUrl: string = DEFAULT_RELAY_URL
): RelayClient {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [onlinePeers, setOnlinePeers] = useState<string[]>([]);
  const messageCallbacks = useRef<Set<(msg: RelayMessage) => void>>(new Set());
  const identityRef = useRef<Identity | null>(identity);

  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  useEffect(() => {
    if (!identity) return;

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let mounted = true;

    const connect = () => {
      if (!mounted || !identityRef.current) return;

      const addr = identityRef.current.address;
      ws = new WebSocket(`${relayUrl}?addr=${encodeURIComponent(addr)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted) return;
        setConnected(true);
        console.log("[relay] connected as", addr.slice(0, 16) + "...");
      };

      ws.onclose = () => {
        if (!mounted) return;
        setConnected(false);
        console.log("[relay] disconnected, reconnecting in 3s...");
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error("[relay] error:", err);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "message") {
            for (const cb of messageCallbacks.current) {
              cb({
                from: data.from,
                ciphertext: data.ciphertext,
                ts: data.ts,
              });
            }
          }
        } catch (e) {
          console.error("[relay] parse error:", e);
        }
      };
    };

    connect();

    return () => {
      mounted = false;
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [identity, relayUrl]);

  const send = useCallback(async (toAddress: string, payload: EncryptedPayload): Promise<boolean> => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return false;
    }

    const message = {
      type: "message",
      from: identityRef.current?.address,
      to: toAddress,
      ciphertext: JSON.stringify(payload),
    };

    wsRef.current.send(JSON.stringify(message));
    return true;
  }, []);

  const onMessage = useCallback((callback: (msg: RelayMessage) => void) => {
    messageCallbacks.current.add(callback);
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  return {
    connected,
    onlinePeers,
    send,
    onMessage,
    disconnect,
  };
}

/**
 * Encrypt a message for a recipient and send via relay.
 * Returns the local payload for IndexedDB storage.
 */
export async function sendViaRelay(
  relay: RelayClient,
  plaintext: string,
  sharedKey: Uint8Array,
  toAddress: string
): Promise<{ payload: EncryptedPayload; sent: boolean }> {
  const payload = encryptMessage(plaintext, sharedKey);
  const sent = await relay.send(toAddress, payload);
  return { payload, sent };
}

/**
 * Receive a message from the relay and decrypt.
 */
export function receiveFromRelay(
  msg: RelayMessage,
  sharedKey: Uint8Array
): { plaintext: string | null; from: string; ts: number } {
  try {
    const payload: EncryptedPayload = JSON.parse(msg.ciphertext);
    const plaintext = decryptMessage(payload, sharedKey);
    return { plaintext, from: msg.from, ts: msg.ts };
  } catch {
    return { plaintext: null, from: msg.from, ts: msg.ts };
  }
}
