"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useChatStore } from "@/stores/chat-store";
import { Hydrator } from "@/components/hydrator";
import { Spinner } from "@/components/ui/spinner";
import { AppShell } from "@/components/app-shell";

/**
 * /app — app entry redirect.
 *
 * Hydrates the store and routes based on view state:
 *   - No wallets              -> /setup
 *   - Wallets but locked      -> /unlock
 *   - Unlocked (identity set) -> <AppShell/>
 */

export default function AppPage() {
  return (
    <Hydrator>
      <AppRouter />
    </Hydrator>
  );
}

function AppRouter() {
  const router = useRouter();
  const wallets = useChatStore((s) => s.wallets);
  const identity = useChatStore((s) => s.identity);
  const locked = useChatStore((s) => s.locked);

  React.useEffect(() => {
    if (wallets.length === 0) {
      router.replace("/setup");
    } else if (!identity || locked) {
      router.replace("/unlock");
    }
  }, [wallets.length, identity, locked, router]);

  if (wallets.length === 0) {
    return <RedirectPlaceholder label="Redirecting to setup…" />;
  }
  if (!identity || locked) {
    return <RedirectPlaceholder label="Redirecting to unlock…" />;
  }

  return <AppShell />;
}

function RedirectPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-3 text-text-muted">
        <Spinner size="lg" />
        <p className="text-sm">{label}</p>
      </div>
    </div>
  );
}
