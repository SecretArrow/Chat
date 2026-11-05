/**
 * Octra RPC client (read-only, best-effort)
 * ------------------------------------------------------------------
 * Mirrors the JSON-RPC 2.0 methods exposed by Octra lite_node and
 * used by the webcli wallet (rpc_client.hpp). Method names use the
 * `octra_*` prefix as in the real webcli client.
 *
 * Network endpoints:
 *   mainnet: https://octra.network/rpc
 *   devnet:  https://devnet.octrascan.io/rpc
 *
 * NOTE: The public endpoints may be rate-limited, may not expose all
 * methods (e.g. `octra_submit` is typically only available on a local
 * full node), and may go down. Every call is wrapped so failure does
 * not break the chat — it only affects optional read-only lookups.
 */

export type OctraNetwork = "mainnet" | "devnet" | "custom";

export interface RpcConfig {
  network: OctraNetwork;
  url?: string;
}

const NETWORK_URLS: Record<Exclude<OctraNetwork, "custom">, string> = {
  mainnet: "https://octra.network/rpc",
  devnet: "https://devnet.octrascan.io/rpc",
};

export function defaultRpcUrl(network: OctraNetwork): string {
  if (network === "custom") return "http://127.0.0.1:8080/rpc";
  return NETWORK_URLS[network];
}

interface RpcResult<T> {
  ok: boolean;
  result?: T;
  error?: string;
  code?: number;
  httpStatus?: number;
}

let nextId = 1;

async function rpcCall<T = unknown>(
  config: RpcConfig,
  method: string,
  params: unknown[] = [],
  timeoutMs = 8000
): Promise<RpcResult<T>> {
  const url = config.url ?? defaultRpcUrl(config.network);
  const body = {
    jsonrpc: "2.0",
    id: nextId++,
    method,
    params,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, httpStatus: res.status };
    }
    const json: any = await res.json();
    if (json.error) {
      return { ok: false, error: json.error.message ?? "rpc error", code: json.error.code };
    }
    return { ok: true, result: json.result as T, httpStatus: res.status };
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.name === "AbortError"
          ? "timeout"
          : err.message
        : "network error";
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export interface OctraAccount {
  address: string;
  balance?: string;
  nonce?: number;
  bets_count?: number;
  pub_key?: string;
  transfers?: number;
  bets?: number;
  total_received?: string;
  total_sent?: string;
}

export interface NodeStatus {
  epoch?: number;
  current_epoch?: number;
  head_epoch?: number;
  validator?: string;
  network_version?: string;
  timestamp?: number;
  state_root?: string;
  txid_hi?: string;
}

export class OctraRpcClient {
  config: RpcConfig;

  constructor(config: RpcConfig) {
    this.config = config;
  }

  async nodeStatus(timeoutMs = 6000): Promise<RpcResult<NodeStatus>> {
    return rpcCall<NodeStatus>(this.config, "node_status", [], timeoutMs);
  }

  async ping(): Promise<boolean> {
    const r = await this.nodeStatus(5000);
    return r.ok;
  }

  async getBalance(address: string): Promise<RpcResult<string>> {
    const r = await rpcCall<{ balance?: string; amount?: string }>(
      this.config,
      "octra_balance",
      [address]
    );
    if (!r.ok || !r.result) {
      return { ok: false, error: r.error, code: r.code, httpStatus: r.httpStatus };
    }
    return {
      ok: true,
      result: r.result.balance ?? r.result.amount ?? "0",
      httpStatus: r.httpStatus,
    };
  }

  async getAccount(address: string, limit = 20): Promise<RpcResult<OctraAccount>> {
    return rpcCall<OctraAccount>(this.config, "octra_account", [address, limit]);
  }

  async getTransaction(txHash: string, timeoutMs = 15000): Promise<RpcResult<any>> {
    return rpcCall<any>(this.config, "octra_transaction", [txHash], timeoutMs);
  }

  async getPublicKey(address: string): Promise<RpcResult<string>> {
    const r = await rpcCall<{ pub?: string; public_key?: string; pubkey?: string }>(
      this.config,
      "octra_publicKey",
      [address]
    );
    if (!r.ok || !r.result) {
      return { ok: false, error: r.error, code: r.code, httpStatus: r.httpStatus };
    }
    return {
      ok: true,
      result: r.result.pub ?? r.result.public_key ?? r.result.pubkey ?? "",
      httpStatus: r.httpStatus,
    };
  }

  async getViewPubkey(address: string): Promise<RpcResult<string>> {
    const r = await rpcCall<{ view_pubkey?: string; view?: string }>(
      this.config,
      "octra_viewPubkey",
      [address]
    );
    if (!r.ok || !r.result) {
      return { ok: false, error: r.error, code: r.code, httpStatus: r.httpStatus };
    }
    return {
      ok: true,
      result: r.result.view_pubkey ?? r.result.view ?? "",
      httpStatus: r.httpStatus,
    };
  }

  async getTxsByAddress(
    address: string,
    limit = 20,
    offset = 0,
    source: "live" | "archive" | "" = ""
  ): Promise<RpcResult<unknown[]>> {
    // The webcli adds a "source" field at the top-level of the request for this method
    const url = this.config.url ?? defaultRpcUrl(this.config.network);
    const body: any = {
      jsonrpc: "2.0",
      id: nextId++,
      method: "octra_transactionsByAddress",
      params: [address, limit, offset],
    };
    if (source) body.source = source;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const json: any = await res.json();
      if (json.error) return { ok: false, error: json.error.message, code: json.error.code };
      return { ok: true, result: json.result as unknown[], httpStatus: res.status };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  async getStealthOutputs(fromEpoch = 0, timeoutMs = 15000): Promise<RpcResult<unknown[]>> {
    return rpcCall<unknown[]>(this.config, "octra_stealthOutputs", [fromEpoch], timeoutMs);
  }

  async getStealthOutputsPage(
    fromEpoch: number,
    beforeId: number | null = null,
    limit = 256,
    timeoutMs = 10000
  ): Promise<RpcResult<unknown[]>> {
    return rpcCall<unknown[]>(
      this.config,
      "octra_stealthOutputsPage",
      [fromEpoch, beforeId, limit],
      timeoutMs
    );
  }

  async validatorSetProof(timeoutMs = 8000): Promise<RpcResult<unknown>> {
    return rpcCall<unknown>(this.config, "octra_validatorSetProof", [], timeoutMs);
  }

  async listContracts(timeoutMs = 8000): Promise<RpcResult<unknown[]>> {
    return rpcCall<unknown[]>(this.config, "octra_listContracts", [], timeoutMs);
  }

  async stagingView(timeoutMs = 5000): Promise<RpcResult<unknown>> {
    return rpcCall<unknown>(this.config, "staging_view", [], timeoutMs);
  }

  // ---- Circle methods ----

  async circleInfo(circleId: string, timeoutMs = 10000): Promise<RpcResult<unknown>> {
    return rpcCall<unknown>(this.config, "circle_info", [circleId], timeoutMs);
  }

  async circleStorageDump(circleId: string, timeoutMs = 10000): Promise<RpcResult<unknown>> {
    return rpcCall<unknown>(this.config, "octra_circleStorageDump", [circleId], timeoutMs);
  }

  async circleStorage(circleId: string, key: string, timeoutMs = 10000): Promise<RpcResult<unknown>> {
    return rpcCall<unknown>(this.config, "octra_circleStorage", [circleId, key], timeoutMs);
  }

  async circleObjectList(circleId: string, timeoutMs = 10000): Promise<RpcResult<unknown>> {
    return rpcCall<unknown>(this.config, "octra_circleObjectList", [circleId], timeoutMs);
  }

  async circleObjectRefs(circleId: string, timeoutMs = 10000): Promise<RpcResult<unknown>> {
    return rpcCall<unknown>(this.config, "octra_circleObjectRefs", [circleId], timeoutMs);
  }

  async circleObjectMembers(
    circleId: string,
    objectRef: string,
    timeoutMs = 10000
  ): Promise<RpcResult<unknown>> {
    return rpcCall<unknown>(
      this.config,
      "octra_circleObjectMembers",
      [circleId, objectRef],
      timeoutMs
    );
  }

  async circleTransportPolicy(circleId: string, timeoutMs = 10000): Promise<RpcResult<unknown>> {
    return rpcCall<unknown>(this.config, "octra_circleTransportPolicy", [circleId], timeoutMs);
  }

  async circleHfhePolicy(circleId: string, timeoutMs = 10000): Promise<RpcResult<unknown>> {
    return rpcCall<unknown>(this.config, "octra_circleHfhePolicy", [circleId], timeoutMs);
  }

  async contractStorage(
    address: string,
    key: string,
    timeoutMs = 10000
  ): Promise<RpcResult<unknown>> {
    return rpcCall<unknown>(this.config, "octra_contractStorage", [address, key], timeoutMs);
  }

  async contractAbi(address: string, timeoutMs = 10000): Promise<RpcResult<unknown>> {
    return rpcCall<unknown>(this.config, "octra_contractAbi", [address], timeoutMs);
  }
}
