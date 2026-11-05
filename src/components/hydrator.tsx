"use client";

import * as React from "react";
import { useChatStore } from "@/stores/chat-store";
import { Spinner } from "@/components/ui/spinner";

/**
 * Hydrator — mounts once on the client, calls store.hydrate(),
 * and renders children only after hydration completes.
 *
 * Place high in the tree (e.g. around the page content) so the store
 * is populated before any view-dependent rendering happens.
 */
export function Hydrator({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const hydrated = useChatStore((s) => s.hydrated);
  const hydrate = useChatStore((s) => s.hydrate);

  React.useEffect(() => {
    if (!hydrated) {
      void hydrate();
    }
  }, [hydrated, hydrate]);

  if (!hydrated) {
    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center">
        {fallback ?? (
          <div className="flex flex-col items-center gap-3 text-text-muted">
            <Spinner size="lg" />
            <p className="text-sm">Loading wallet store…</p>
          </div>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
