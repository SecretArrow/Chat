"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useChatStore } from "@/stores/chat-store";
import { Hydrator } from "@/components/hydrator";
import { UnlockScreen } from "@/components/unlock-screen";
import { Spinner } from "@/components/ui/spinner";

/**
 * /unlock — hydrates the store, then renders the UnlockScreen.
 *
 * Routing policy:
 *   - No wallets → /setup
 *   - Wallets exist but locked → UnlockScreen
 *   - Already unlocked (identity present) → /app
 */
export default function UnlockPage() {
  return (
    <Hydrator>
      <UnlockRouter />
    </Hydrator>
  );
}

function UnlockRouter() {
  const router = useRouter();
  const wallets = useChatStore((s) => s.wallets);
  const identity = useChatStore((s) => s.identity);
  const locked = useChatStore((s) => s.locked);

  React.useEffect(() => {
    if (wallets.length === 0) {
      router.replace("/setup");
      return;
    }
    if (identity && !locked) {
      router.replace("/app");
    }
  }, [wallets.length, identity, locked, router]);

  if (wallets.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-3 text-text-muted">
          <Spinner size="lg" />
          <p className="text-sm">Redirecting to setup…</p>
        </div>
      </div>
    );
  }

  return <UnlockScreen />;
}
